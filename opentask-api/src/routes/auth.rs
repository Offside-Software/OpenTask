use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;

use crate::config::Config;
use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::models::safe_id::SafeId;
use crate::models::user::{AuthMeResponse, DatabaseUser, GitHubUserResponse};
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub installation_id: Option<i64>,
    pub setup_action: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", get(auth_login))
        .route("/auth/callback", get(auth_callback))
        .route("/auth/me", get(auth_me))
        .route("/auth/sync-user", post(auth_sync_user))
        .route("/auth/logout", post(auth_logout))
        .route("/login", get(auth_login))
        .route("/callback", get(auth_callback))
        .route("/me", get(auth_me))
        .route("/sync-user", post(auth_sync_user))
        .route("/logout", post(auth_logout))
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
}

pub async fn get_or_create_user(
    pool: &PgPool,
    github_id: Option<i64>,
    email: Option<&str>,
    username: Option<&str>,
    display_name: Option<&str>,
    telegram_chat_id: Option<&str>,
    gh_access_token: Option<&str>,
) -> Result<DatabaseUser, AppError> {
    // 1. Check by GitHub ID (as string)
    if let Some(gh_id_num) = github_id {
        let gh_id_str = gh_id_num.to_string();
        let existing = sqlx::query_as::<_, DatabaseUser>(
            r#"
            SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
            FROM opentask.users
            WHERE gh_id = $1
            LIMIT 1;
            "#
        )
        .bind(&gh_id_str)
        .fetch_optional(pool)
        .await?;

        if let Some(mut u) = existing {
            if let Some(token) = gh_access_token {
                if u.gh_access_token.as_deref() != Some(token) {
                    let _ = sqlx::query("UPDATE opentask.users SET gh_access_token = $1 WHERE id = $2;")
                        .bind(token)
                        .bind(u.id.as_ref().map(|s| s.0))
                        .execute(pool)
                        .await;
                    u.gh_access_token = Some(token.to_string());
                }
            }
            if let (Some(dn), Some(un)) = (display_name, username) {
                if u.display_name.as_deref() != Some(dn) || u.gh_username.as_deref() != Some(un) {
                    let _ = sqlx::query("UPDATE opentask.users SET display_name = $1, gh_username = $2 WHERE id = $3;")
                        .bind(dn)
                        .bind(un)
                        .bind(u.id.as_ref().map(|s| s.0))
                        .execute(pool)
                        .await;
                    u.display_name = Some(dn.to_string());
                    u.gh_username = Some(un.to_string());
                }
            }
            return Ok(u);
        }
    }

    // 2. Check by username
    if let Some(un) = username {
        if !un.trim().is_empty() {
            let existing = sqlx::query_as::<_, DatabaseUser>(
                r#"
                SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
                FROM opentask.users
                WHERE gh_username = $1
                LIMIT 1;
                "#
            )
            .bind(un)
            .fetch_optional(pool)
            .await?;

            if let Some(mut u) = existing {
                let gh_id_str = github_id.map(|id| id.to_string());
                let _ = sqlx::query(
                    r#"
                    UPDATE opentask.users
                    SET gh_id = COALESCE($1, gh_id),
                        gh_access_token = COALESCE($2, gh_access_token),
                        display_name = COALESCE($3, display_name)
                    WHERE id = $4;
                    "#
                )
                .bind(&gh_id_str)
                .bind(gh_access_token)
                .bind(display_name)
                .bind(u.id.as_ref().map(|s| s.0))
                .execute(pool)
                .await;

                if gh_id_str.is_some() {
                    u.gh_id = gh_id_str;
                }
                if gh_access_token.is_some() {
                    u.gh_access_token = gh_access_token.map(String::from);
                }
                if display_name.is_some() {
                    u.display_name = display_name.map(String::from);
                }
                return Ok(u);
            }
        }
    }

    // 3. Check by email
    if let Some(em) = email {
        if !em.trim().is_empty() {
            let existing = sqlx::query_as::<_, DatabaseUser>(
                r#"
                SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
                FROM opentask.users
                WHERE email = $1
                LIMIT 1;
                "#
            )
            .bind(em)
            .fetch_optional(pool)
            .await?;

            if let Some(mut u) = existing {
                let gh_id_str = github_id.map(|id| id.to_string());
                let _ = sqlx::query(
                    r#"
                    UPDATE opentask.users
                    SET gh_id = COALESCE($1, gh_id),
                        gh_username = COALESCE($2, gh_username),
                        gh_access_token = COALESCE($3, gh_access_token),
                        display_name = COALESCE($4, display_name)
                    WHERE id = $5;
                    "#
                )
                .bind(&gh_id_str)
                .bind(username)
                .bind(gh_access_token)
                .bind(display_name)
                .bind(u.id.as_ref().map(|s| s.0))
                .execute(pool)
                .await;

                if gh_id_str.is_some() {
                    u.gh_id = gh_id_str;
                }
                return Ok(u);
            }
        }
    }

    // 4. Not found: insert new user
    let new_user_id = next_id();
    let safe_chat_id = telegram_chat_id.unwrap_or("");
    let gh_id_str = github_id.map(|id| id.to_string());

    let inserted = sqlx::query_as::<_, DatabaseUser>(
        r#"
        INSERT INTO opentask.users (id, display_name, telegram_chat_id, gh_username, gh_access_token, gh_id, email, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key;
        "#
    )
    .bind(new_user_id)
    .bind(display_name)
    .bind(safe_chat_id)
    .bind(username)
    .bind(gh_access_token)
    .bind(gh_id_str)
    .bind(email)
    .fetch_one(pool)
    .await?;

    Ok(inserted)
}

pub async fn auth_login(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let client_id = &state.config.gh_app_client_id;
    let redirect_uri = get_redirect_uri(&state.config, &headers);
    let rand_state = format!("{:x}", rand::random::<u128>());

    let target = format!(
        "https://github.com/login/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&state={rand_state}"
    );

    let is_https = redirect_uri.contains("https");
    let cookie = format!(
        "oauth_state={rand_state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax{}",
        if is_https { "; Secure" } else { "" }
    );

    let mut response = Redirect::temporary(&target).into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie.parse().unwrap());
    response
}

pub async fn auth_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Result<Response, AppError> {
    let frontend_url = get_frontend_url(&state.config, &headers);

    let code = match query.code {
        Some(c) => c,
        None => return Ok(Redirect::temporary(&frontend_url).into_response()),
    };

    let client = Client::new();
    let redirect_uri = get_redirect_uri(&state.config, &headers);

    let token_resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": state.config.gh_app_client_id,
            "client_secret": state.config.gh_app_client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to exchange OAuth code: {e}")))?;

    if !token_resp.status().is_success() {
        return Err(AppError::Unauthorized("Failed to exchange OAuth code".to_string()));
    }

    let token_data: serde_json::Value = token_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let access_token = match token_data["access_token"].as_str() {
        Some(t) => t,
        None => return Ok(Redirect::temporary(&frontend_url).into_response()),
    };

    // Fetch GitHub user
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if user_resp.status().is_success() {
        let gh_user: GitHubUserResponse = user_resp
            .json()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Upsert user in database using get_or_create_user
        let _ = get_or_create_user(
            &state.pool,
            Some(gh_user.id),
            gh_user.email.as_deref(),
            Some(&gh_user.login),
            gh_user.name.as_deref(),
            None,
            Some(access_token),
        )
        .await;
    }

    let is_https = frontend_url.contains("https");
    let cookie = format!(
        "gh_token={access_token}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax{}",
        60 * 60 * 24 * 30, // 30 days
        if is_https { "; Secure" } else { "" }
    );

    let mut response = Redirect::temporary(&frontend_url).into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie.parse().unwrap());
    Ok(response)
}

pub async fn auth_me(
    State(state): State<AppState>,
    CurrentUser(gh_user, token): CurrentUser,
) -> Result<Json<AuthMeResponse>, AppError> {
    let db_user = get_or_create_user(
        &state.pool,
        Some(gh_user.id),
        gh_user.email.as_deref(),
        Some(&gh_user.login),
        gh_user.name.as_deref(),
        None,
        Some(&token),
    )
    .await
    .ok();

    let res = AuthMeResponse {
        id: Some(SafeId(gh_user.id)),
        login: Some(gh_user.login),
        name: gh_user.name,
        email: gh_user.email,
        avatar_url: gh_user.avatar_url,
        html_url: gh_user.html_url,
        public_repos: gh_user.public_repos,
        followers: gh_user.followers,
        db_user,
    };

    Ok(Json(res))
}

pub async fn auth_sync_user(
    State(state): State<AppState>,
    CurrentUser(gh_user, token): CurrentUser,
) -> Result<Json<Option<DatabaseUser>>, AppError> {
    let db_user = get_or_create_user(
        &state.pool,
        Some(gh_user.id),
        gh_user.email.as_deref(),
        Some(&gh_user.login),
        gh_user.name.as_deref(),
        None,
        Some(&token),
    )
    .await
    .ok();

    Ok(Json(db_user))
}

pub async fn auth_logout() -> Response {
    let mut response = (StatusCode::OK, Json(json!({ "message": "Logged out successfully" }))).into_response();
    let cookie = "gh_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
    response.headers_mut().insert(header::SET_COOKIE, cookie.parse().unwrap());
    response
}

fn get_redirect_uri(config: &Config, headers: &HeaderMap) -> String {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(if host.contains("vercel.app") { "https" } else { "http" });

    if !host.is_empty() && !host.contains("localhost") && !host.contains("127.0.0.1") {
        return format!("{proto}://{host}/api/auth/callback");
    }

    config.gh_oauth_redirect_uri.clone()
}

fn get_frontend_url(config: &Config, headers: &HeaderMap) -> String {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(if host.contains("vercel.app") { "https" } else { "http" });

    if !host.is_empty() && !host.contains("localhost") && !host.contains("127.0.0.1") {
        return format!("{proto}://{host}");
    }

    config.frontend_url.clone()
}
