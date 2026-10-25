use reqwest::Client;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::{HashSet, HashMap};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::config::Config;
use crate::error::AppError;

static TELEGRAM_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .pool_idle_timeout(Duration::from_secs(30))
        .tcp_keepalive(Duration::from_secs(30))
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| Client::new())
});

static RECENT_COMMANDS: Mutex<Option<HashMap<(String, String), Instant>>> = Mutex::new(None);
static RECENT_CALLBACKS: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
static RECENT_SENT_ALERTS: Mutex<Option<HashMap<i64, Instant>>> = Mutex::new(None);

pub fn check_and_record_alert_sent(alert_id: i64) -> bool {
    let mut guard = match RECENT_SENT_ALERTS.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let map = guard.get_or_insert_with(HashMap::new);

    let now = Instant::now();
    map.retain(|_, time| now.duration_since(*time) < Duration::from_secs(300));

    if let Some(prev) = map.get(&alert_id) {
        if now.duration_since(*prev) < Duration::from_secs(300) {
            return true; // Already processed recently
        }
    }
    map.insert(alert_id, now);
    false
}

pub fn escape_markdown(text: &str) -> String {
    text.replace('_', "\\_")
        .replace('*', "\\*")
        .replace('`', "\\`")
        .replace('[', "\\[")
}

fn check_and_record_command_cooldown(chat_id: &str, text: &str, cooldown_secs: u64) -> bool {
    let mut guard = match RECENT_COMMANDS.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let map = guard.get_or_insert_with(HashMap::new);

    let now = Instant::now();
    // Prune entries older than 30s
    map.retain(|_, time| now.duration_since(*time) < Duration::from_secs(30));

    let key = (chat_id.to_string(), text.to_string());
    if let Some(prev) = map.get(&key) {
        if now.duration_since(*prev) < Duration::from_secs(cooldown_secs) {
            return true; // Already processed recently (duplicate / double-click)
        }
    }
    map.insert(key, now);
    false
}

fn check_and_record_callback_cooldown(callback_id_or_key: &str, cooldown_secs: u64) -> bool {
    let mut guard = match RECENT_CALLBACKS.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let map = guard.get_or_insert_with(HashMap::new);

    let now = Instant::now();
    map.retain(|_, time| now.duration_since(*time) < Duration::from_secs(30));

    let key = callback_id_or_key.to_string();
    if let Some(prev) = map.get(&key) {
        if now.duration_since(*prev) < Duration::from_secs(cooldown_secs) {
            return true;
        }
    }
    map.insert(key, now);
    false
}

pub async fn send_telegram_message(
    bot_token: &str,
    chat_id: &str,
    text: &str,
) -> Result<(), AppError> {
    send_telegram_message_with_keyboard(bot_token, chat_id, text, None).await
}

pub async fn send_telegram_message_with_keyboard(
    bot_token: &str,
    chat_id: &str,
    text: &str,
    reply_markup: Option<Value>,
) -> Result<(), AppError> {
    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");

    let mut payload = json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown"
    });

    if let Some(markup) = &reply_markup {
        payload["reply_markup"] = markup.clone();
    }

    let mut send_res = TELEGRAM_CLIENT.post(&url).json(&payload).send().await;

    // Retry once if there was a stale pooled connection drop
    if send_res.is_err() {
        tracing::warn!("[Telegram] First send attempt failed, retrying once...");
        tokio::time::sleep(Duration::from_millis(100)).await;
        send_res = TELEGRAM_CLIENT.post(&url).json(&payload).send().await;
    }

    let resp = match send_res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[Telegram] Failed to send message to {chat_id}: {e}");
            return Err(AppError::Internal(format!("Failed to send Telegram message: {e}")));
        }
    };

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        tracing::warn!("Telegram send error with Markdown: {}. Retrying as plain text...", err);
        let mut fallback_payload = json!({
            "chat_id": chat_id,
            "text": text
        });
        if let Some(markup) = reply_markup {
            fallback_payload["reply_markup"] = markup;
        }
        let _ = TELEGRAM_CLIENT.post(&url).json(&fallback_payload).send().await;
    }

    Ok(())
}

pub async fn answer_callback_query(
    bot_token: &str,
    callback_query_id: &str,
    text: &str,
) {
    let url = format!("https://api.telegram.org/bot{bot_token}/answerCallbackQuery");
    let payload = json!({
        "callback_query_id": callback_query_id,
        "text": text,
        "show_alert": false
    });
    let _ = TELEGRAM_CLIENT.post(&url).json(&payload).send().await;
}

pub async fn edit_telegram_message_text(
    bot_token: &str,
    chat_id: &str,
    message_id: i64,
    new_text: &str,
    reply_markup: Option<Value>,
) {
    let url = format!("https://api.telegram.org/bot{bot_token}/editMessageText");
    let mut payload = json!({
        "chat_id": chat_id,
        "message_id": message_id,
        "text": new_text,
        "parse_mode": "Markdown"
    });
    if let Some(markup) = reply_markup {
        payload["reply_markup"] = markup;
    }
    let _ = TELEGRAM_CLIENT.post(&url).json(&payload).send().await;
}

pub async fn handle_telegram_callback_query(
    pool: &PgPool,
    realtime: &crate::services::realtime::RealtimeHub,
    bot_token: &str,
    callback_query_id: &str,
    chat_id: &str,
    message_id: Option<i64>,
    original_text: &str,
    data: &str,
) {
    // Prevent duplicate button click processing within 1.5 seconds
    let cb_key = format!("{}:{}:{}", chat_id, message_id.unwrap_or(0), data);
    if check_and_record_callback_cooldown(&cb_key, 2) {
        answer_callback_query(bot_token, callback_query_id, "Sedang diproses...").await;
        return;
    }
    // 1. Verify user is registered
    let user_check = crate::db::query(
        "SELECT id, display_name FROM opentask.users WHERE telegram_chat_id = $1 LIMIT 1;"
    )
    .bind(chat_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (user_id, user_name) = match user_check {
        Some(u) => {
            let uid: i64 = u.try_get("id").unwrap_or(0);
            let name: String = u.try_get("display_name").unwrap_or_else(|_| "User".to_string());
            (uid, name)
        }
        None => {
            answer_callback_query(bot_token, callback_query_id, "⚠️ Akun Telegram belum terhubung ke OpenTask").await;
            return;
        }
    };

    if data == "nav_updatetask_list" {
        let tasks_res = crate::db::query(
            r#"
            SELECT t.id, t.title, t.project_id, p.name as project_name, b.name as bucket_name, b.state as bucket_state
            FROM opentask.tasks t
            LEFT JOIN opentask.projects p ON t.project_id = p.id
            LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
            WHERE (t.lead_assignee_id = $1 OR $1 = ANY(COALESCE(t.assignee_ids, '{}'::BIGINT[])))
              AND (b.state IS NULL OR b.state NOT IN ('COMPLETED', 'DRAFT'))
            ORDER BY t.updated_at DESC
            LIMIT 10;
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await;

        match tasks_res {
            Ok(tasks) if !tasks.is_empty() => {
                answer_callback_query(bot_token, callback_query_id, "Memuat daftar tugas...").await;
                let mut list_text = format!("🔄 *Pilih Tugas untuk Diupdate Progress ({})*\n\n", user_name);
                let mut keyboard_rows = Vec::new();

                for (i, t) in tasks.iter().enumerate() {
                    let tid: i64 = t.try_get("id").unwrap_or(0);
                    let title: String = t.try_get("title").unwrap_or_default();
                    let proj: String = t.try_get("project_name").unwrap_or_else(|_| "Project".to_string());
                    let b_name: String = t.try_get("bucket_name").unwrap_or_else(|_| "TODO".to_string());

                    list_text.push_str(&format!("{}. *{}*\n   📁 {} | 🏷️ {}\n", i + 1, title, proj, b_name));

                    let short_title = if title.chars().count() > 24 {
                        format!("{}...", title.chars().take(22).collect::<String>())
                    } else {
                        title
                    };

                    keyboard_rows.push(vec![
                        json!({ "text": format!("{}. {}", i + 1, short_title), "callback_data": format!("sel_task_{}", tid) })
                    ]);
                }

                list_text.push_str("\nSilakan ketuk nomor/judul tugas di bawah yang ingin kamu ubah statusnya:");

                if let Some(mid) = message_id {
                    let keyboard = json!({ "inline_keyboard": keyboard_rows });
                    edit_telegram_message_text(bot_token, chat_id, mid, &list_text, Some(keyboard)).await;
                }
            }
            Ok(_) => {
                answer_callback_query(bot_token, callback_query_id, "Tidak ada tugas aktif").await;
                if let Some(mid) = message_id {
                    let text = "🎉 *Tidak ada tugas aktif!*\n\nSemua tugas kamu sudah selesai.";
                    edit_telegram_message_text(bot_token, chat_id, mid, text, None).await;
                }
            }
            Err(e) => {
                tracing::error!("Error fetching tasks for nav: {e}");
                answer_callback_query(bot_token, callback_query_id, "⚠️ Gagal memuat tugas").await;
            }
        }
        return;
    } else if data.starts_with("sel_task_") {
        let task_id_str = data.trim_start_matches("sel_task_");
        if let Ok(task_id) = task_id_str.parse::<i64>() {
            let task_res = crate::db::query(
                r#"
                SELECT t.id, t.title, t.project_id, p.name as project_name, b.name as bucket_name, b.state as bucket_state
                FROM opentask.tasks t
                LEFT JOIN opentask.projects p ON t.project_id = p.id
                LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
                WHERE t.id = $1 LIMIT 1;
                "#
            )
            .bind(task_id)
            .fetch_optional(pool)
            .await;

            if let Ok(Some(task)) = task_res {
                let tid: i64 = task.try_get("id").unwrap_or(0);
                let title: String = task.try_get("title").unwrap_or_default();
                let proj: String = task.try_get("project_name").unwrap_or_else(|_| "Project".to_string());
                let b_name: String = task.try_get("bucket_name").unwrap_or_else(|_| "TODO".to_string());
                let b_state: String = task.try_get("bucket_state").unwrap_or_else(|_| "TODO".to_string());
                let pid: i64 = task.try_get("project_id").unwrap_or(0);

                let is_ongoing = b_state.to_uppercase() == "ONGOING" || b_name.to_lowercase().contains("ongoing") || b_name.to_lowercase().contains("progress");

                let card_text = format!(
                    "📌 *Update Progress Tugas*\n\n\
                     Tugas: *{}*\n\
                     📁 Project: {}\n\
                     🏷️ Status Saat Ini: *{}*\n\n\
                     Pilih status baru yang diinginkan:",
                    title, proj, b_name
                );

                let action_row = if is_ongoing {
                    vec![
                        json!({ "text": "⏸️ Kembalikan ke To Do", "callback_data": format!("act_todo_{}", tid) }),
                        json!({ "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", tid) }),
                    ]
                } else {
                    vec![
                        json!({ "text": "▶️ Kerjakan (Ongoing)", "callback_data": format!("act_ongoing_{}", tid) }),
                        json!({ "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", tid) }),
                    ]
                };

                let keyboard = json!({
                    "inline_keyboard": [
                        [
                            json!({ "text": "🔗 Buka di OpenTask", "url": format!("https://open-task-five.vercel.app/projects/{}?taskId={}", pid, tid) })
                        ],
                        action_row,
                        [
                            json!({ "text": "🔙 Kembali ke Daftar Tugas", "callback_data": "nav_updatetask_list" })
                        ]
                    ]
                });

                answer_callback_query(bot_token, callback_query_id, "Tugas dipilih").await;
                if let Some(mid) = message_id {
                    edit_telegram_message_text(bot_token, chat_id, mid, &card_text, Some(keyboard)).await;
                }
                return;
            }
        }
        answer_callback_query(bot_token, callback_query_id, "⚠️ Tugas tidak ditemukan").await;
        return;
    } else if data.starts_with("act_ongoing_") {
        let task_id_str = data.trim_start_matches("act_ongoing_");
        if let Ok(task_id) = task_id_str.parse::<i64>() {
            let task_res = crate::db::query("SELECT id, title, project_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
                .bind(task_id)
                .fetch_optional(pool)
                .await;

            if let Ok(Some(task)) = task_res {
                let project_id: i64 = task.try_get("project_id").unwrap_or(0);
                let _title: String = task.try_get("title").unwrap_or_default();

                let bucket_res = crate::db::query(
                    "SELECT id FROM opentask.buckets 
                     WHERE project_id = $1 AND (state = 'ONGOING' OR LOWER(name) LIKE '%ongoing%' OR LOWER(name) LIKE '%progress%')
                     ORDER BY order_idx ASC LIMIT 1;"
                )
                .bind(project_id)
                .fetch_optional(pool)
                .await;

                if let Ok(Some(b_row)) = bucket_res {
                    let bucket_id: i64 = b_row.try_get("id").unwrap_or(0);
                    let moved = crate::db::query(
                        "UPDATE opentask.tasks SET bucket_id = $1, last_activity_at = NOW(), updated_at = NOW() WHERE id = $2;"
                    )
                    .bind(bucket_id)
                    .bind(task_id)
                    .execute(pool)
                    .await;
                    if moved.is_ok() {
                        realtime.publish(project_id, "task", "moved", Some(task_id));
                    }

                    answer_callback_query(bot_token, callback_query_id, "Tugas dipindahkan ke Ongoing! ▶️").await;

                    if let Some(mid) = message_id {
                        let clean_base = original_text
                            .split("\n\n⚡ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n✅ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n📋 *Status:*").next().unwrap_or(original_text);
                        let updated_text = format!("{}\n\n⚡ *Status:* Diubah ke *ONGOING* (Sedang Dikerjakan) ▶️ oleh {}", clean_base, user_name);
                        let updated_keyboard = json!({
                            "inline_keyboard": [
                                [
                                    { "text": "🔗 Buka di OpenTask", "url": format!("https://open-task-five.vercel.app/projects/{}?taskId={}", project_id, task_id) }
                                ],
                                [
                                    { "text": "⏸️ Kembalikan ke To Do", "callback_data": format!("act_todo_{}", task_id) },
                                    { "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", task_id) }
                                ],
                                [
                                    { "text": "🔙 Update Tugas Lain", "callback_data": "nav_updatetask_list" }
                                ]
                            ]
                        });
                        edit_telegram_message_text(bot_token, chat_id, mid, &updated_text, Some(updated_keyboard)).await;
                    }
                    return;
                }
            }
        }
        answer_callback_query(bot_token, callback_query_id, "⚠️ Gagal mengubah status tugas").await;
    } else if data.starts_with("act_todo_") {
        let task_id_str = data.trim_start_matches("act_todo_");
        if let Ok(task_id) = task_id_str.parse::<i64>() {
            let task_res = crate::db::query("SELECT id, title, project_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
                .bind(task_id)
                .fetch_optional(pool)
                .await;

            if let Ok(Some(task)) = task_res {
                let project_id: i64 = task.try_get("project_id").unwrap_or(0);

                let bucket_res = crate::db::query(
                    "SELECT id FROM opentask.buckets 
                     WHERE project_id = $1 AND (state = 'TODO' OR LOWER(name) LIKE '%todo%' OR LOWER(name) LIKE '%to do%' OR LOWER(name) LIKE '%backlog%')
                     ORDER BY order_idx ASC LIMIT 1;"
                )
                .bind(project_id)
                .fetch_optional(pool)
                .await;

                if let Ok(Some(b_row)) = bucket_res {
                    let bucket_id: i64 = b_row.try_get("id").unwrap_or(0);
                    let moved = crate::db::query(
                        "UPDATE opentask.tasks SET bucket_id = $1, last_activity_at = NOW(), updated_at = NOW() WHERE id = $2;"
                    )
                    .bind(bucket_id)
                    .bind(task_id)
                    .execute(pool)
                    .await;
                    if moved.is_ok() {
                        realtime.publish(project_id, "task", "moved", Some(task_id));
                    }

                    answer_callback_query(bot_token, callback_query_id, "Tugas dikembalikan ke To Do! 📋").await;

                    if let Some(mid) = message_id {
                        let clean_base = original_text
                            .split("\n\n⚡ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n✅ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n📋 *Status:*").next().unwrap_or(original_text);
                        let updated_text = format!("{}\n\n📋 *Status:* Dikembalikan ke *TO DO* ⏸️ oleh {}", clean_base, user_name);
                        let updated_keyboard = json!({
                            "inline_keyboard": [
                                [
                                    { "text": "🔗 Buka di OpenTask", "url": format!("https://open-task-five.vercel.app/projects/{}?taskId={}", project_id, task_id) }
                                ],
                                [
                                    { "text": "▶️ Kerjakan (Ongoing)", "callback_data": format!("act_ongoing_{}", task_id) },
                                    { "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", task_id) }
                                ],
                                [
                                    { "text": "🔙 Update Tugas Lain", "callback_data": "nav_updatetask_list" }
                                ]
                            ]
                        });
                        edit_telegram_message_text(bot_token, chat_id, mid, &updated_text, Some(updated_keyboard)).await;
                    }
                    return;
                }
            }
        }
        answer_callback_query(bot_token, callback_query_id, "⚠️ Gagal mengembalikan status tugas").await;
    } else if data.starts_with("act_done_") {
        let task_id_str = data.trim_start_matches("act_done_");
        if let Ok(task_id) = task_id_str.parse::<i64>() {
            let task_res = crate::db::query("SELECT id, title, project_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
                .bind(task_id)
                .fetch_optional(pool)
                .await;

            if let Ok(Some(task)) = task_res {
                let project_id: i64 = task.try_get("project_id").unwrap_or(0);

                let bucket_res = crate::db::query(
                    "SELECT id FROM opentask.buckets 
                     WHERE project_id = $1 AND (state = 'COMPLETED' OR LOWER(name) LIKE '%done%' OR LOWER(name) LIKE '%complete%' OR LOWER(name) LIKE '%finish%')
                     ORDER BY order_idx ASC LIMIT 1;"
                )
                .bind(project_id)
                .fetch_optional(pool)
                .await;

                if let Ok(Some(b_row)) = bucket_res {
                    let bucket_id: i64 = b_row.try_get("id").unwrap_or(0);
                    let moved = crate::db::query(
                        "UPDATE opentask.tasks SET bucket_id = $1, last_activity_at = NOW(), updated_at = NOW() WHERE id = $2;"
                    )
                    .bind(bucket_id)
                    .bind(task_id)
                    .execute(pool)
                    .await;
                    if moved.is_ok() {
                        realtime.publish(project_id, "task", "moved", Some(task_id));
                    }

                    answer_callback_query(bot_token, callback_query_id, "Tugas ditandai Selesai! 🎉").await;

                    if let Some(mid) = message_id {
                        let clean_base = original_text
                            .split("\n\n⚡ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n✅ *Status:*").next().unwrap_or(original_text)
                            .split("\n\n📋 *Status:*").next().unwrap_or(original_text);
                        let updated_text = format!("{}\n\n✅ *Status:* Ditandai *SELESAI* (Done) 🎉 oleh {}", clean_base, user_name);
                        let updated_keyboard = json!({
                            "inline_keyboard": [
                                [
                                    { "text": "🔗 Buka di OpenTask", "url": format!("https://open-task-five.vercel.app/projects/{}?taskId={}", project_id, task_id) }
                                ],
                                [
                                    { "text": "↩️ Buka Kembali (To Do)", "callback_data": format!("act_todo_{}", task_id) }
                                ],
                                [
                                    { "text": "🔙 Update Tugas Lain", "callback_data": "nav_updatetask_list" }
                                ]
                            ]
                        });
                        edit_telegram_message_text(bot_token, chat_id, mid, &updated_text, Some(updated_keyboard)).await;
                    }
                    return;
                }
            }
        }
        answer_callback_query(bot_token, callback_query_id, "⚠️ Gagal mengubah status tugas").await;
    } else if data.starts_with("act_touch_") {
        let task_id_str = data.trim_start_matches("act_touch_");
        if let Ok(task_id) = task_id_str.parse::<i64>() {
            let _ = crate::db::query(
                "UPDATE opentask.tasks SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1;"
            )
            .bind(task_id)
            .execute(pool)
            .await;

            answer_callback_query(bot_token, callback_query_id, "Aktivitas tugas diperbarui! ⏰").await;

            if let Some(mid) = message_id {
                let updated_text = format!("{}\n\n⏳ *Update:* Dikonfirmasi masih dikerjakan oleh {}.", original_text, user_name);
                edit_telegram_message_text(bot_token, chat_id, mid, &updated_text, None).await;
            }
            return;
        }
        answer_callback_query(bot_token, callback_query_id, "⚠️ Gagal memperbarui aktivitas tugas").await;
    } else {
        answer_callback_query(bot_token, callback_query_id, "Perintah diterima").await;
    }
}

pub async fn handle_incoming_telegram_message(
    pool: &PgPool,
    bot_token: &str,
    chat_id: &str,
    text: &str,
) {
    // Prevent duplicate processing from double-taps or duplicate poll deliveries within 2 seconds
    if check_and_record_command_cooldown(chat_id, text, 2) {
        tracing::info!("[Telegram] Ignored duplicate command '{text}' for chat_id={chat_id}");
        return;
    }
    if text.starts_with("/start") {
        let parts: Vec<&str> = text.split_whitespace().collect();
        if parts.len() > 1 && parts[1].starts_with("link_") {
            let param = parts[1].trim_start_matches("link_").trim();
            let parsed_id = param.parse::<i64>().ok();

            let update_res = crate::db::query(
                "UPDATE opentask.users 
                 SET telegram_chat_id = $1 
                 WHERE ($2::BIGINT IS NOT NULL AND id = $2) 
                    OR gh_id = $3 
                    OR LOWER(gh_username) = LOWER($3) 
                 RETURNING id, display_name, gh_username;"
            )
            .bind(chat_id)
            .bind(parsed_id)
            .bind(param)
            .fetch_optional(pool)
            .await;

            match update_res {
                Ok(Some(row)) => {
                    let name: String = row.try_get("display_name").unwrap_or_else(|_| "User".to_string());
                    let gh: String = row.try_get("gh_username").unwrap_or_default();
                    let reply = format!(
                        "✅ *Akun Berhasil Terhubung!*\n\n\
                         Halo *{}* (@{})! Akun OpenTask kamu telah sukses terhubung otomatis dengan bot ini.\n\n\
                         Chat ID kamu (`{}`) telah tersimpan di akun OpenTask kamu.\n\n\
                         Kamu sekarang dapat:\n\
                         • 📋 Ketik `/tasks` untuk melihat daftar tugas aktif\n\
                         • 🔄 Ketik `/updatetask` untuk mengubah progress tugas langsung dari Telegram\n\
                         • 🔔 Menerima notifikasi instan saat ada tugas baru atau AI review PR",
                        name, gh, chat_id
                    );
                    let _ = send_telegram_message(bot_token, chat_id, &reply).await;
                    return;
                }
                Ok(None) => {
                    let reply = format!(
                        "⚠️ *User tidak ditemukan*\n\n\
                         Akun OpenTask untuk identifier `{}` tidak ditemukan di database.\n\
                         Chat ID kamu: `{}`\n\n\
                         Silakan login ke OpenTask di browser terlebih dahulu atau masukkan Chat ID kamu secara manual di Settings.",
                        param, chat_id
                    );
                    let _ = send_telegram_message(bot_token, chat_id, &reply).await;
                    return;
                }
                Err(e) => {
                    tracing::error!("Failed to auto-link telegram chat_id: {e}");
                }
            }
        }

        let user_check = crate::db::query(
            "SELECT display_name, gh_username FROM opentask.users WHERE telegram_chat_id = $1 LIMIT 1;"
        )
        .bind(chat_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let welcome = match user_check {
            Some(row) => {
                let name: String = row.try_get("display_name").unwrap_or_else(|_| "User".to_string());
                format!(
                    "👋 *Halo kembali, {}!*\n\n\
                     Akun Telegram kamu sudah *terhubung* dengan OpenTask.\n\n\
                     Chat ID: `{}`\n\n\
                     Ketik `/tasks` untuk melihat tugas aktif atau `/updatetask` untuk mengupdate progress tugas.",
                    name, chat_id
                )
            }
            None => {
                format!(
                    "👋 *Selamat Datang di OpenTask Bot!*\n\n\
                     Chat ID Telegram kamu adalah:\n\
                     `{}`\n\
                     _(ketuk untuk menyalin)_\n\n\
                     Silakan salin Chat ID tersebut dan masukkan ke menu *Settings > Telegram Dispatch Pipeline* di web OpenTask untuk menghubungkan akun.",
                    chat_id
                )
            }
        };

        let _ = send_telegram_message(bot_token, chat_id, &welcome).await;
    } else if text.starts_with("/status") {
        let user_check = crate::db::query(
            "SELECT display_name, gh_username FROM opentask.users WHERE telegram_chat_id = $1 LIMIT 1;"
        )
        .bind(chat_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let reply = match user_check {
            Some(row) => {
                let name: String = row.try_get("display_name").unwrap_or_default();
                let gh: String = row.try_get("gh_username").unwrap_or_default();
                format!(
                    "✅ *Status: Terhubung*\n\n\
                     • Nama: *{}*\n\
                     • GitHub: *{}*\n\
                     • Chat ID: `{}`",
                    name, gh, chat_id
                )
            }
            None => {
                format!(
                    "⚠️ *Status: Belum Terhubung*\n\n\
                     Chat ID kamu: `{}`\n\n\
                     Akun Telegram ini belum terhubung ke akun OpenTask manapun. Buka menu Settings di web OpenTask untuk menghubungkannya.",
                    chat_id
                )
            }
        };
        let _ = send_telegram_message(bot_token, chat_id, &reply).await;
    } else if text.starts_with("/tasks") {
        let user_check = crate::db::query(
            "SELECT id, display_name FROM opentask.users WHERE telegram_chat_id = $1 LIMIT 1;"
        )
        .bind(chat_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        match user_check {
            Some(row) => {
                let user_id: i64 = row.try_get("id").unwrap_or(0);
                let name: String = row.try_get("display_name").unwrap_or_else(|_| "User".to_string());

                let tasks_res = crate::db::query(
                    r#"
                    SELECT t.id, t.title, t.project_id, p.name as project_name, b.name as bucket_name
                    FROM opentask.tasks t
                    LEFT JOIN opentask.projects p ON t.project_id = p.id
                    LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
                    WHERE (t.lead_assignee_id = $1 OR $1 = ANY(COALESCE(t.assignee_ids, '{}'::BIGINT[])))
                      AND (b.state IS NULL OR b.state NOT IN ('COMPLETED', 'DRAFT'))
                    ORDER BY t.updated_at DESC
                    LIMIT 10;
                    "#
                )
                .bind(user_id)
                .fetch_all(pool)
                .await;

                match tasks_res {
                    Ok(tasks) if !tasks.is_empty() => {
                        let mut msg = format!("📋 *Daftar Tugas Aktif ({})*\n\n", escape_markdown(&name));
                        for (i, t) in tasks.iter().enumerate() {
                            let tid: i64 = t.try_get("id").unwrap_or(0);
                            let title: String = t.try_get("title").unwrap_or_default();
                            let proj: String = t.try_get("project_name").unwrap_or_else(|_| "Project".to_string());
                            let b_name: String = t.try_get("bucket_name").unwrap_or_else(|_| "TODO".to_string());
                            let pid: i64 = t.try_get("project_id").unwrap_or(0);
                            msg.push_str(&format!(
                                "{}. *{}*\n   📁 Project: {}\n   🏷️ Status: {}\n   🔗 [Buka Task](https://open-task-five.vercel.app/projects/{}?taskId={})\n\n",
                                i + 1, escape_markdown(&title), escape_markdown(&proj), escape_markdown(&b_name), pid, tid
                            ));
                        }
                        msg.push_str("💡 *Tips:* Gunakan perintah `/updatetask` untuk mengubah status progress tugas langsung dari Telegram.");
                        let _ = send_telegram_message(bot_token, chat_id, &msg).await;
                    }
                    Ok(_) => {
                        let reply = format!("🎉 *Tidak ada tugas aktif!*\n\nHalo *{}*, semua tugas kamu sudah selesai atau belum ada tugas baru yang ditugaskan ke kamu.", name);
                        let _ = send_telegram_message(bot_token, chat_id, &reply).await;
                    }
                    Err(e) => {
                        tracing::error!("Failed to fetch tasks for telegram user {user_id}: {e}");
                        let reply = "⚠️ Gagal mengambil daftar tugas dari database. Coba lagi beberapa saat lagi.";
                        let _ = send_telegram_message(bot_token, chat_id, reply).await;
                    }
                }
            }
            None => {
                let reply = format!(
                    "⚠️ *Akun Belum Terhubung*\n\n\
                     Chat ID kamu: `{}`\n\n\
                     Silakan hubungkan akun OpenTask kamu terlebih dahulu melalui menu Settings di web atau gunakan link dari web.",
                    chat_id
                );
                let _ = send_telegram_message(bot_token, chat_id, &reply).await;
            }
        }
    } else if text.starts_with("/updatetask") {
        let user_check = crate::db::query(
            "SELECT id, display_name FROM opentask.users WHERE telegram_chat_id = $1 LIMIT 1;"
        )
        .bind(chat_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        match user_check {
            Some(row) => {
                let user_id: i64 = row.try_get("id").unwrap_or(0);
                let name: String = row.try_get("display_name").unwrap_or_else(|_| "User".to_string());

                let tasks_res = crate::db::query(
                    r#"
                    SELECT t.id, t.title, t.project_id, p.name as project_name, b.name as bucket_name, b.state as bucket_state
                    FROM opentask.tasks t
                    LEFT JOIN opentask.projects p ON t.project_id = p.id
                    LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
                    WHERE (t.lead_assignee_id = $1 OR $1 = ANY(COALESCE(t.assignee_ids, '{}'::BIGINT[])))
                      AND (b.state IS NULL OR b.state NOT IN ('COMPLETED', 'DRAFT'))
                    ORDER BY t.updated_at DESC
                    LIMIT 10;
                    "#
                )
                .bind(user_id)
                .fetch_all(pool)
                .await;

                match tasks_res {
                    Ok(tasks) if tasks.is_empty() => {
                        let reply = format!("🎉 *Tidak ada tugas aktif!*\n\nHalo *{}*, tidak ada tugas aktif yang perlu diupdate progressnya.", name);
                        let _ = send_telegram_message(bot_token, chat_id, &reply).await;
                    }
                    Ok(tasks) if tasks.len() == 1 => {
                        let t = &tasks[0];
                        let tid: i64 = t.try_get("id").unwrap_or(0);
                        let title: String = t.try_get("title").unwrap_or_default();
                        let proj: String = t.try_get("project_name").unwrap_or_else(|_| "Project".to_string());
                        let b_name: String = t.try_get("bucket_name").unwrap_or_else(|_| "TODO".to_string());
                        let b_state: String = t.try_get("bucket_state").unwrap_or_else(|_| "TODO".to_string());
                        let pid: i64 = t.try_get("project_id").unwrap_or(0);

                        let is_ongoing = b_state.to_uppercase() == "ONGOING" || b_name.to_lowercase().contains("ongoing") || b_name.to_lowercase().contains("progress");

                        let card_text = format!(
                            "📌 *Update Progress Tugas*\n\n\
                             Tugas: *{}*\n\
                             📁 Project: {}\n\
                             🏷️ Status Saat Ini: *{}*\n\n\
                             Pilih status baru yang diinginkan:",
                            escape_markdown(&title), escape_markdown(&proj), escape_markdown(&b_name)
                        );

                        let action_row = if is_ongoing {
                            vec![
                                json!({ "text": "⏸️ Kembalikan ke To Do", "callback_data": format!("act_todo_{}", tid) }),
                                json!({ "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", tid) }),
                            ]
                        } else {
                            vec![
                                json!({ "text": "▶️ Kerjakan (Ongoing)", "callback_data": format!("act_ongoing_{}", tid) }),
                                json!({ "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", tid) }),
                            ]
                        };

                        let keyboard = json!({
                            "inline_keyboard": [
                                [
                                    json!({ "text": "🔗 Buka di OpenTask", "url": format!("https://open-task-five.vercel.app/projects/{}?taskId={}", pid, tid) })
                                ],
                                action_row
                            ]
                        });

                        let _ = send_telegram_message_with_keyboard(bot_token, chat_id, &card_text, Some(keyboard)).await;
                    }
                    Ok(tasks) => {
                        let mut list_text = format!("🔄 *Pilih Tugas untuk Diupdate Progress ({})*\n\n", escape_markdown(&name));
                        let mut keyboard_rows = Vec::new();

                        for (i, t) in tasks.iter().enumerate() {
                            let tid: i64 = t.try_get("id").unwrap_or(0);
                            let title: String = t.try_get("title").unwrap_or_default();
                            let proj: String = t.try_get("project_name").unwrap_or_else(|_| "Project".to_string());
                            let b_name: String = t.try_get("bucket_name").unwrap_or_else(|_| "TODO".to_string());

                            list_text.push_str(&format!("{}. *{}*\n   📁 {} | 🏷️ {}\n", i + 1, escape_markdown(&title), escape_markdown(&proj), escape_markdown(&b_name)));

                            let short_title = if title.chars().count() > 24 {
                                format!("{}...", title.chars().take(22).collect::<String>())
                            } else {
                                title
                            };

                            keyboard_rows.push(vec![
                                json!({ "text": format!("{}. {}", i + 1, short_title), "callback_data": format!("sel_task_{}", tid) })
                            ]);
                        }

                        list_text.push_str("\nSilakan ketuk tombol tugas di bawah yang ingin kamu ubah statusnya:");
                        let keyboard = json!({ "inline_keyboard": keyboard_rows });
                        let _ = send_telegram_message_with_keyboard(bot_token, chat_id, &list_text, Some(keyboard)).await;
                    }
                    Err(e) => {
                        tracing::error!("Failed to fetch tasks for telegram user {user_id}: {e}");
                        let reply = "⚠️ Gagal mengambil daftar tugas dari database. Coba lagi beberapa saat lagi.";
                        let _ = send_telegram_message(bot_token, chat_id, reply).await;
                    }
                }
            }
            None => {
                let reply = format!(
                    "⚠️ *Akun Belum Terhubung*\n\n\
                     Chat ID kamu: `{}`\n\n\
                     Silakan hubungkan akun OpenTask kamu terlebih dahulu melalui menu Settings di web atau gunakan link dari web.",
                    chat_id
                );
                let _ = send_telegram_message(bot_token, chat_id, &reply).await;
            }
        }
    } else if text.starts_with("/unlink") {
        let _ = crate::db::query(
            "UPDATE opentask.users SET telegram_chat_id = '' WHERE telegram_chat_id = $1;"
        )
        .bind(chat_id)
        .execute(pool)
        .await;

        let reply = "🔌 *Akun Berhasil Diputus*\n\nNotifikasi OpenTask tidak akan lagi dikirim ke akun Telegram ini.";
        let _ = send_telegram_message(bot_token, chat_id, reply).await;
    } else if text.starts_with("/help") {
        let reply = "🤖 *Pusat Bantuan & Perintah OpenTask Bot*\n\n\
                     Gunakan perintah berikut untuk mengelola tugas langsung dari Telegram:\n\n\
                     • `/tasks` — 📋 *Lihat Daftar Tugas*\n\
                       Menampilkan ringkasan teks seluruh tugas aktif kamu beserta project dan statusnya.\n\n\
                     • `/updatetask` — 🔄 *Update Progress Tugas*\n\
                       Pilih tugas yang ingin diubah dan perbarui statusnya:\n\
                       ▶️ *Kerjakan* (pindah ke Ongoing)\n\
                       ⏸️ *Kembalikan ke To Do*\n\
                       ✅ *Tandai Selesai* (pindah ke Done)\n\
                       🔙 Tombol kembali untuk memilih tugas lain\n\n\
                     • `/status` — 👤 *Status Akun*\n\
                       Cek status keterhubungan akun OpenTask, GitHub, dan Chat ID kamu.\n\n\
                     • `/start` — ⚡ *Mulai & Auto-Link*\n\
                       Mulai bot dan hubungkan akun OpenTask kamu secara otomatis.\n\n\
                     • `/unlink` — 🔌 *Putus Hubungan*\n\
                       Hentikan pengiriman notifikasi ke akun Telegram ini.\n\n\
                     • `/help` — ❓ *Panduan Perintah*\n\
                       Tampilkan informasi bantuan ini.\n\n\
                     💡 *Tips:* Saat ada notifikasi tugas baru atau alert macet masuk, kamu juga bisa langsung klik tombol aksi di bawah pesan tanpa mengetik perintah.";
        let _ = send_telegram_message(bot_token, chat_id, reply).await;
    }
}

pub async fn run_telegram_polling(pool: PgPool, config: Config, realtime: crate::services::realtime::RealtimeHub) {
    let bot_token = match &config.telegram_bot_token {
        Some(t) if !t.trim().is_empty() => t.clone(),
        _ => {
            tracing::info!("[Telegram Polling] TELEGRAM_BOT_TOKEN not configured; polling disabled.");
            return;
        }
    };

    tracing::info!("[Telegram Polling] Starting 24/7 Telegram Long-Polling worker...");
    let client = Client::builder()
        .timeout(Duration::from_secs(40))
        .build()
        .unwrap_or_else(|_| Client::new());

    let del_webhook_url = format!("https://api.telegram.org/bot{bot_token}/deleteWebhook");
    let _ = client.post(&del_webhook_url).send().await;

    let set_cmd_url = format!("https://api.telegram.org/bot{bot_token}/setMyCommands");
    let cmd_payload = json!({
        "commands": [
            {"command": "tasks", "description": "Lihat daftar tugas aktif saya"},
            {"command": "updatetask", "description": "Update progress & status tugas"},
            {"command": "status", "description": "Cek status akun & koneksi notifikasi"},
            {"command": "start", "description": "Mulai bot & Hubungkan Akun OpenTask"},
            {"command": "help", "description": "Panduan penggunaan & daftar perintah"},
            {"command": "unlink", "description": "Putuskan integrasi notifikasi"}
        ]
    });
    let _ = client.post(&set_cmd_url).json(&cmd_payload).send().await;

    let mut offset: i64 = 0;
    let mut processed_updates: HashSet<i64> = HashSet::new();

    loop {
        let url = format!(
            "https://api.telegram.org/bot{bot_token}/getUpdates?offset={offset}&timeout=25"
        );

        match client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().as_u16() == 409 {
                    tracing::warn!("[Telegram Polling] 409 Conflict: another instance is running getUpdates with this bot token. Backing off 5s...");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }

                if let Ok(data) = resp.json::<Value>().await {
                    if let Some(updates) = data["result"].as_array() {
                        for update in updates {
                            let uid = match update["update_id"].as_i64() {
                                Some(id) => id,
                                None => continue,
                            };
                            offset = uid + 1;

                            if !processed_updates.insert(uid) {
                                tracing::debug!("[Telegram Polling] Skip already processed update_id {uid}");
                                continue;
                            }
                            if processed_updates.len() > 1000 {
                                processed_updates.clear();
                                processed_updates.insert(uid);
                            }

                            if let Some(message) = update.get("message") {
                                if let (Some(cid), Some(txt)) = (
                                    message["chat"]["id"].as_i64(),
                                    message["text"].as_str(),
                                ) {
                                    handle_incoming_telegram_message(
                                        &pool,
                                        &bot_token,
                                        &cid.to_string(),
                                        txt.trim(),
                                    )
                                    .await;
                                }
                            }

                            if let Some(cb) = update.get("callback_query") {
                                if let (Some(qid), Some(data)) = (
                                    cb["id"].as_str(),
                                    cb["data"].as_str(),
                                ) {
                                    let from_id = cb["from"]["id"].as_i64().unwrap_or(0);
                                    let message_id = cb["message"]["message_id"].as_i64();
                                    let chat_id = cb["message"]["chat"]["id"].as_i64().unwrap_or(from_id);
                                    let orig_text = cb["message"]["text"].as_str().unwrap_or("");

                                    handle_telegram_callback_query(
                                        &pool,
                                        &realtime,
                                        &bot_token,
                                        qid,
                                        &chat_id.to_string(),
                                        message_id,
                                        orig_text,
                                        data,
                                    )
                                    .await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!("[Telegram Polling] Error: {e}. Retrying in 3s...");
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

pub async fn run_telegram_alert_dispatcher(pool: PgPool, config: Config) {
    let bot_token = match &config.telegram_bot_token {
        Some(t) if !t.trim().is_empty() => t.clone(),
        _ => return,
    };

    tracing::info!("[Telegram Dispatcher] Starting guaranteed 24/7 background notification dispatcher (3s interval)...");
    let mut interval = tokio::time::interval(Duration::from_secs(3));

    loop {
        interval.tick().await;

        let query_str = r#"
            SELECT a.id, a.user_id, a.context_id, a.project_id, a.title, a.description, a.type,
                   u.telegram_chat_id
            FROM opentask.alerts a
            JOIN opentask.users u ON a.user_id = u.id
            WHERE (a.telegram_sent IS FALSE OR a.telegram_sent IS NULL)
              AND u.telegram_chat_id IS NOT NULL
              AND u.telegram_chat_id != ''
              AND a.created_at <= NOW() - INTERVAL '10 seconds'
              AND a.created_at >= NOW() - INTERVAL '2 hours'
            ORDER BY a.created_at ASC
            LIMIT 10;
        "#;

        let rows = match crate::db::query(query_str).fetch_all(&pool).await {
            Ok(r) => r,
            Err(_) => continue,
        };

        for r in rows {
            let alert_id: i64 = r.try_get("id").unwrap_or(0);

            // In-memory deduplication check
            if check_and_record_alert_sent(alert_id) {
                let _ = crate::db::query("UPDATE opentask.alerts SET telegram_sent = TRUE WHERE id = $1;")
                    .bind(alert_id)
                    .execute(&pool)
                    .await;
                continue;
            }

            // Immediately mark in DB so concurrent runs or queries don't grab it
            let _ = crate::db::query("UPDATE opentask.alerts SET telegram_sent = TRUE, updated_at = NOW() WHERE id = $1;")
                .bind(alert_id)
                .execute(&pool)
                .await;

            let chat_id: String = r.try_get("telegram_chat_id").unwrap_or_default();
            let alert_title: String = r.try_get("title").unwrap_or_default();
            let alert_desc: String = r.try_get("description").unwrap_or_default();
            let context_id: Option<i64> = r.try_get("context_id").ok().flatten();
            let project_id: Option<i64> = r.try_get("project_id").ok().flatten();
            let alert_type: String = r.try_get("type").unwrap_or_default();

            if chat_id.trim().is_empty() {
                continue;
            }

            let base_url = if !config.frontend_url.trim().is_empty() && !config.frontend_url.contains("localhost") {
                config.frontend_url.trim_end_matches('/')
            } else {
                "https://open-task-five.vercel.app"
            };

            let path_url = match (project_id, context_id) {
                (Some(pid), Some(tid)) => format!("{}/projects/{}?taskId={}", base_url, pid, tid),
                (Some(pid), None) => format!("{}/projects/{}", base_url, pid),
                _ => base_url.to_string(),
            };

            let text = format!("🔔 *{}*\n\n{}", alert_title, alert_desc);

            let mut keyboard_rows = vec![
                vec![
                    json!({ "text": "🔗 Buka di OpenTask", "url": path_url })
                ]
            ];

            if alert_type == "TASK_ASSIGNED" {
                if let Some(tid) = context_id {
                    keyboard_rows.push(vec![
                        json!({ "text": "▶️ Kerjakan (Ongoing)", "callback_data": format!("act_ongoing_{}", tid) }),
                        json!({ "text": "✅ Selesai (Done)", "callback_data": format!("act_done_{}", tid) }),
                    ]);
                }
            }

            let reply_markup = json!({ "inline_keyboard": keyboard_rows });

            let send_res = send_telegram_message_with_keyboard(
                &bot_token,
                &chat_id,
                &text,
                Some(reply_markup),
            ).await;

            if let Err(e) = send_res {
                tracing::warn!("[Telegram Dispatcher] Failed to deliver alert {} to {}: {}", alert_id, chat_id, e);
            } else {
                tracing::info!("[Telegram Dispatcher] Successfully delivered alert {} to chat_id={}", alert_id, chat_id);
            }
        }
    }
}
