use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use super::config::{GroqTier, PipelineConfig};
use crate::error::AppError;

/// 0 means no limit.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Limits {
    pub rpm: u32,
    pub rpd: u32,
    pub tpm: u32,
    pub tpd: u32,
    pub audio_per_hour: u32,
    pub audio_per_day: u32,
}

#[derive(Default)]
struct Window {
    /// (when, tokens, audio seconds) of the last hour's calls.
    recent: VecDeque<(Instant, u32, u32)>,
    day: Option<NaiveDate>,
    requests: u32,
    tokens: u64,
    audio: u32,
}

impl Window {
    fn roll(&mut self, today: NaiveDate) {
        if self.day != Some(today) {
            self.day = Some(today);
            self.requests = 0;
            self.tokens = 0;
            self.audio = 0;
        }
    }

    fn prune(&mut self, at: Instant) {
        while self.recent.front().is_some_and(|(t, _, _)| at.duration_since(*t) >= HOUR) {
            self.recent.pop_front();
        }
    }

    /// How long until `extra` more fits under `limit` within `span`, using `amount` of each call.
    fn wait_within(&self, at: Instant, span: Duration, limit: u32, extra: u32, amount: impl Fn(&(Instant, u32, u32)) -> u32) -> Option<Duration> {
        if limit == 0 {
            return None;
        }
        let inside: Vec<&(Instant, u32, u32)> = self.recent.iter().filter(|e| at.duration_since(e.0) < span).collect();
        let mut used: u32 = inside.iter().map(|e| amount(e)).sum();
        if used + extra <= limit || inside.is_empty() {
            // A single call bigger than the whole limit is let through; the provider decides.
            return None;
        }
        for entry in inside {
            used -= amount(entry);
            if used + extra <= limit {
                return Some(span.saturating_sub(at.duration_since(entry.0)));
            }
        }
        None
    }
}

const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(3600);

/// Whose quota a call uses: the shared key (`None`) or a project's own key.
pub type Scope = Option<i64>;

pub struct UsageLimiter {
    shared: HashMap<String, Limits>,
    own_key: HashMap<String, Limits>,
    windows: Mutex<HashMap<(Scope, String), Window>>,
    pool: Option<PgPool>,
}

static LIMITER: OnceLock<UsageLimiter> = OnceLock::new();

/// The process-wide limiter, once the worker has started it.
pub fn global() -> Option<&'static UsageLimiter> {
    LIMITER.get()
}

pub async fn init(pool: PgPool, cfg: &PipelineConfig) {
    let limiter = UsageLimiter::new(limits_for(cfg), own_key_limits(cfg), Some(pool.clone()));
    if let Err(e) = limiter.seed_today(&pool).await {
        tracing::warn!("[Meeting Pipeline] Could not read today's AI usage: {e}");
    }
    let _ = LIMITER.set(limiter);
}

/// Limits of the shared keys.
pub fn limits_for(cfg: &PipelineConfig) -> HashMap<String, Limits> {
    let mut limits = if cfg.groq_tier == GroqTier::Free { own_key_limits(cfg) } else { HashMap::new() };
    limits.insert(cfg.cf_asr_model.to_string(), Limits { audio_per_day: cfg.cf_audio_sec_per_day, ..Default::default() });
    limits
}

/// Groq free-tier limits, also used for a project's own free-tier key.
pub fn own_key_limits(cfg: &PipelineConfig) -> HashMap<String, Limits> {
    let mut limits = HashMap::new();
    {
        let chat = Limits { rpm: cfg.extract_rpm, rpd: cfg.extract_rpd, tpm: cfg.extract_tpm, tpd: cfg.extract_tpd, ..Default::default() };
        for model in [cfg.extract_model, cfg.gate_model, cfg.gate_fallback_model, cfg.summary_model] {
            limits.insert(model.to_string(), chat);
        }
        limits.insert(
            cfg.asr_model.to_string(),
            Limits {
                rpm: cfg.asr_rpm,
                rpd: cfg.asr_rpd,
                audio_per_hour: cfg.asr_audio_sec_per_hour,
                audio_per_day: cfg.asr_audio_sec_per_day,
                ..Default::default()
            },
        );
    }
    limits
}

fn until_midnight(now: DateTime<Utc>) -> Duration {
    let midnight = (now.date_naive() + chrono::Days::new(1)).and_hms_opt(0, 0, 0).unwrap_or_default().and_utc();
    (midnight - now).to_std().unwrap_or(HOUR)
}

impl UsageLimiter {
    pub fn new(shared: HashMap<String, Limits>, own_key: HashMap<String, Limits>, pool: Option<PgPool>) -> Self {
        Self { shared, own_key, windows: Mutex::new(HashMap::new()), pool }
    }

    fn limits(&self, scope: Scope, model: &str) -> Option<&Limits> {
        if scope.is_some() { self.own_key.get(model) } else { self.shared.get(model) }
    }

    /// How long until a call of this size fits, or `None` when it fits now.
    pub fn wait_for(&self, scope: Scope, model: &str, tokens: u32, audio: u32) -> Option<Duration> {
        self.wait_at(scope, model, tokens, audio, Instant::now(), Utc::now())
    }

    pub fn wait_at(&self, scope: Scope, model: &str, tokens: u32, audio: u32, at: Instant, now: DateTime<Utc>) -> Option<Duration> {
        let limits = self.limits(scope, model)?;
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        let window = windows.entry((scope, model.to_string())).or_default();
        window.roll(now.date_naive());
        window.prune(at);

        let day = until_midnight(now);
        let over_day = (limits.rpd > 0 && window.requests + 1 > limits.rpd)
            || (limits.tpd > 0 && window.tokens + tokens as u64 > limits.tpd as u64)
            || (limits.audio_per_day > 0 && window.audio + audio > limits.audio_per_day);
        [
            over_day.then_some(day),
            window.wait_within(at, MINUTE, limits.rpm, 1, |_| 1),
            window.wait_within(at, MINUTE, limits.tpm, tokens, |e| e.1),
            window.wait_within(at, HOUR, limits.audio_per_hour, audio, |e| e.2),
        ]
        .into_iter()
        .flatten()
        .max()
    }

    pub fn record(&self, project_id: Option<i64>, own_key: bool, model: &str, tokens: u32, audio: u32) {
        let now = Utc::now();
        let scope = if own_key { project_id } else { None };
        self.record_at(scope, model, tokens, audio, Instant::now(), now);
        if let Some(pool) = self.pool.clone() {
            let model = model.to_string();
            tokio::spawn(async move {
                if let Err(e) = persist(&pool, now.date_naive(), project_id.unwrap_or(0), own_key, &model, tokens, audio).await {
                    tracing::warn!("[Meeting Pipeline] Could not record AI usage: {e}");
                }
            });
        }
    }

    pub fn record_at(&self, scope: Scope, model: &str, tokens: u32, audio: u32, at: Instant, now: DateTime<Utc>) {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        let window = windows.entry((scope, model.to_string())).or_default();
        window.roll(now.date_naive());
        window.prune(at);
        window.recent.push_back((at, tokens, audio));
        window.requests += 1;
        window.tokens += tokens as u64;
        window.audio += audio;
    }

    async fn seed_today(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        let today = Utc::now().date_naive();
        let rows = crate::db::query_as::<_, (Option<i64>, String, i64, i64, i64)>(
            r#"
            SELECT CASE WHEN own_key THEN project_id END, model,
                   SUM(requests)::bigint, SUM(tokens)::bigint, SUM(audio_seconds)::bigint
            FROM opentask.ai_usage_daily WHERE day = $1 GROUP BY 1, model;
            "#,
        )
        .bind(today)
        .fetch_all(pool)
        .await?;
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        for (scope, model, requests, tokens, audio) in rows {
            let window = windows.entry((scope, model)).or_default();
            window.roll(today);
            window.requests = requests as u32;
            window.tokens = tokens as u64;
            window.audio = audio as u32;
        }
        Ok(())
    }
}

async fn persist(
    pool: &PgPool,
    day: NaiveDate,
    project_id: i64,
    own_key: bool,
    model: &str,
    tokens: u32,
    audio: u32,
) -> Result<(), sqlx::Error> {
    crate::db::query(
        r#"
        INSERT INTO opentask.ai_usage_daily (day, project_id, model, own_key, requests, tokens, audio_seconds)
        VALUES ($1, $2, $3, $4, 1, $5, $6)
        ON CONFLICT (day, project_id, model, own_key) DO UPDATE
        SET requests = ai_usage_daily.requests + 1,
            tokens = ai_usage_daily.tokens + EXCLUDED.tokens,
            audio_seconds = ai_usage_daily.audio_seconds + EXCLUDED.audio_seconds;
        "#,
    )
    .bind(day)
    .bind(project_id)
    .bind(model)
    .bind(own_key)
    .bind(tokens as i64)
    .bind(audio as i32)
    .execute(pool)
    .await?;
    Ok(())
}

/// Today's totals per model, across projects.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ModelUsage {
    pub model: String,
    pub requests: i64,
    pub tokens: i64,
    pub audio_seconds: i64,
}

/// Today's use of the shared keys (`own_key_of: None`) or of one project's own key.
pub async fn usage_today(pool: &PgPool, own_key_of: Option<i64>) -> Result<Vec<ModelUsage>, sqlx::Error> {
    crate::db::query_as::<_, ModelUsage>(
        r#"
        SELECT model, SUM(requests)::bigint AS requests, SUM(tokens)::bigint AS tokens,
               SUM(audio_seconds)::bigint AS audio_seconds
        FROM opentask.ai_usage_daily
        WHERE day = (NOW() AT TIME ZONE 'UTC')::date
          AND own_key = ($1::bigint IS NOT NULL) AND ($1::bigint IS NULL OR project_id = $1)
        GROUP BY model ORDER BY model;
        "#,
    )
    .bind(own_key_of)
    .fetch_all(pool)
    .await
}

/// Seconds of audio this project has had transcribed today (UTC) with the shared keys.
pub async fn project_audio_today(pool: &PgPool, project_id: i64, cfg: &PipelineConfig) -> Result<i64, sqlx::Error> {
    crate::db::query_scalar(
        r#"
        SELECT COALESCE(SUM(audio_seconds), 0)::bigint FROM opentask.ai_usage_daily
        WHERE day = (NOW() AT TIME ZONE 'UTC')::date AND project_id = $1 AND model = ANY($2) AND NOT own_key;
        "#,
    )
    .bind(project_id)
    .bind(vec![cfg.asr_model.to_string(), cfg.cf_asr_model.to_string()])
    .fetch_one(pool)
    .await
}

/// Meeting jobs this project started today (UTC).
pub async fn project_jobs_today(pool: &PgPool, project_id: i64) -> Result<i64, sqlx::Error> {
    crate::db::query_scalar(
        r#"
        SELECT COUNT(*) FROM opentask.meetings
        WHERE project_id = $1 AND source_type IN ('TEXT', 'MEDIA', 'RECALL_BOT')
          AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
        "#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
}

/// Refuses a new job once the project has used today's quota of jobs or of transcription minutes
/// (`audio_seconds` when the length is already known). Projects with their own Groq key are not
/// limited: the quotas protect the shared key.
pub async fn check_project_quota(pool: &PgPool, cfg: &PipelineConfig, project_id: i64, audio_seconds: Option<u32>) -> Result<(), AppError> {
    if super::keys::has_project_key(pool, project_id).await? {
        return Ok(());
    }
    if cfg.project_jobs_per_day > 0 && project_jobs_today(pool, project_id).await? >= cfg.project_jobs_per_day as i64 {
        return Err(AppError::Conflict(format!(
            "This project has started its {} meeting jobs for today. The quota resets at 00:00 UTC.",
            cfg.project_jobs_per_day
        )));
    }
    if let (Some(seconds), true) = (audio_seconds, cfg.project_audio_minutes_per_day > 0) {
        let used = project_audio_today(pool, project_id, cfg).await?;
        let quota = cfg.project_audio_minutes_per_day as i64 * 60;
        if used + seconds as i64 > quota {
            return Err(AppError::Conflict(format!(
                "This recording is {} min, but the project has {} of its {} transcription minutes left today. The quota resets at 00:00 UTC.",
                (seconds as i64 + 59) / 60,
                ((quota - used).max(0)) / 60,
                cfg.project_audio_minutes_per_day
            )));
        }
    }
    Ok(())
}

pub fn next_utc_midnight(now: DateTime<Utc>) -> DateTime<Utc> {
    now + chrono::Duration::from_std(until_midnight(now)).unwrap_or(chrono::Duration::hours(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter(limits: Limits) -> UsageLimiter {
        UsageLimiter::new(HashMap::from([("m".to_string(), limits)]), HashMap::from([("m".to_string(), limits)]), None)
    }

    fn noon() -> DateTime<Utc> {
        "2026-10-20T12:00:00Z".parse().unwrap()
    }

    #[test]
    fn requests_per_minute_wait_for_the_oldest_to_leave() {
        let l = limiter(Limits { rpm: 2, ..Default::default() });
        let t0 = Instant::now();
        l.record_at(None, "m", 0, 0, t0, noon());
        l.record_at(None, "m", 0, 0, t0 + Duration::from_secs(10), noon());
        assert_eq!(l.wait_at(None, "m", 0, 0, t0 + Duration::from_secs(20), noon()), Some(Duration::from_secs(40)));
        assert_eq!(l.wait_at(None, "m", 0, 0, t0 + Duration::from_secs(61), noon()), None);
        assert_eq!(l.wait_at(None, "other", 0, 0, t0, noon()), None, "models without limits always fit");
    }

    #[test]
    fn tokens_per_minute_free_up_as_calls_age() {
        let l = limiter(Limits { tpm: 8_000, ..Default::default() });
        let t0 = Instant::now();
        l.record_at(None, "m", 3_000, 0, t0, noon());
        l.record_at(None, "m", 4_000, 0, t0 + Duration::from_secs(30), noon());
        assert_eq!(l.wait_at(None, "m", 1_000, 0, t0 + Duration::from_secs(40), noon()), None);
        // 6,000 more needs both earlier calls gone: the second leaves at 90 s.
        assert_eq!(l.wait_at(None, "m", 6_000, 0, t0 + Duration::from_secs(40), noon()), Some(Duration::from_secs(50)));
        assert_eq!(l.wait_at(None, "m", 20_000, 0, t0 + Duration::from_secs(200), noon()), None, "one oversized call is let through");
    }

    #[test]
    fn daily_limits_wait_until_utc_midnight() {
        let l = limiter(Limits { rpd: 2, tpd: 10_000, audio_per_day: 600, ..Default::default() });
        let t0 = Instant::now();
        l.record_at(None, "m", 9_000, 300, t0, noon());
        assert_eq!(l.wait_at(None, "m", 2_000, 0, t0, noon()), Some(Duration::from_secs(12 * 3600)), "tokens per day");
        assert_eq!(l.wait_at(None, "m", 500, 400, t0, noon()), Some(Duration::from_secs(12 * 3600)), "audio per day");
        assert_eq!(l.wait_at(None, "m", 500, 200, t0, noon()), None);
        l.record_at(None, "m", 0, 0, t0, noon());
        assert!(l.wait_at(None, "m", 0, 0, t0, noon()).is_some(), "requests per day");
        let tomorrow: DateTime<Utc> = "2026-10-21T00:00:01Z".parse().unwrap();
        assert_eq!(l.wait_at(None, "m", 2_000, 400, t0 + Duration::from_secs(43_202), tomorrow), None, "a new day starts fresh");
    }

    #[test]
    fn audio_per_hour_counts_seconds_not_calls() {
        let l = limiter(Limits { audio_per_hour: 7_200, ..Default::default() });
        let t0 = Instant::now();
        l.record_at(None, "m", 0, 1_200, t0, noon());
        l.record_at(None, "m", 0, 1_200, t0 + Duration::from_secs(600), noon());
        assert_eq!(l.wait_at(None, "m", 0, 1_200, t0 + Duration::from_secs(1_200), noon()), None);
        l.record_at(None, "m", 0, 4_000, t0 + Duration::from_secs(1_200), noon());
        assert_eq!(l.wait_at(None, "m", 0, 1_200, t0 + Duration::from_secs(1_800), noon()), Some(Duration::from_secs(1_800)));
    }

    #[test]
    fn a_projects_own_key_has_its_own_budget() {
        let l = limiter(Limits { rpd: 1, ..Default::default() });
        let t0 = Instant::now();
        l.record_at(None, "m", 0, 0, t0, noon());
        assert!(l.wait_at(None, "m", 0, 0, t0, noon()).is_some(), "the shared key is used up");
        assert_eq!(l.wait_at(Some(7), "m", 0, 0, t0, noon()), None, "project 7's own key is not");
        l.record_at(Some(7), "m", 0, 0, t0, noon());
        assert!(l.wait_at(Some(7), "m", 0, 0, t0, noon()).is_some());
        assert_eq!(l.wait_at(Some(8), "m", 0, 0, t0, noon()), None, "each project's key counts alone");
    }

    #[test]
    fn free_tier_limits_cover_every_model_used() {
        let cfg = PipelineConfig::from_env();
        let limits = limits_for(&cfg);
        if cfg.groq_tier == GroqTier::Free {
            for model in [cfg.extract_model, cfg.gate_model, cfg.summary_model, cfg.asr_model] {
                assert!(limits.contains_key(model), "{model}");
            }
            assert_eq!(limits[cfg.asr_model].audio_per_day, cfg.asr_audio_sec_per_day);
        }
        assert!(limits[cfg.cf_asr_model].audio_per_day > 0);
        let own = own_key_limits(&cfg);
        assert!(own.contains_key(cfg.extract_model) && own.contains_key(cfg.asr_model), "own free keys are always limited");
        assert!(!own.contains_key(cfg.cf_asr_model), "Cloudflare always uses the shared key");
        assert_eq!(next_utc_midnight(noon()), "2026-10-21T00:00:00Z".parse::<DateTime<Utc>>().unwrap());
    }
}
