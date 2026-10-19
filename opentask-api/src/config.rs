use std::env;
use std::fs;
use std::io::Cursor;
use std::path::Path;

/// Recall.ai regions. Each is a separate deployment with its own API keys.
pub const RECALL_REGIONS: [&str; 4] = ["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"];

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub supabase_url: String,
    pub supabase_key: String,

    // GitHub App & OAuth
    pub gh_app_id: u64,
    pub gh_app_private_key: String,
    pub gh_webhook_secret: String,
    pub gh_app_client_id: String,
    pub gh_app_client_secret: String,
    pub gh_app_installation_id: Option<u64>,
    pub gh_oauth_redirect_uri: String,
    pub frontend_url: String,

    // AI & 3rd Party
    pub gemini_api_key: String,
    pub secret_key: String,
    pub recall_api_key: Option<String>,
    pub telegram_bot_token: Option<String>,

    // Meeting-to-task pipeline
    pub meeting_pipeline_enabled: bool,
    pub groq_api_key: Option<String>,
    pub recall_region: String,

    // Web Push (VAPID)
    pub vapid_public_key: String,
    pub vapid_private_key: String,
    pub vapid_claim_email: String,
}

fn clean_val(v: String) -> String {
    v.trim().trim_matches('"').trim_matches('\'').trim().to_string()
}

pub(crate) fn get_clean_env(key: &str) -> Option<String> {
    env::var(key).ok().map(clean_val).filter(|s| !s.is_empty())
}

fn load_env_file(path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut normalized = String::with_capacity(content.len());
    let mut in_private_key = false;
    let mut private_key = String::new();

    for line in content.lines() {
        if line.starts_with("GH_APP_PRIVATE_KEY=") {
            in_private_key = true;
            private_key.push_str(line.trim_start_matches("GH_APP_PRIVATE_KEY="));
            continue;
        }

        let is_assignment = line
            .split_once('=')
            .map(|(name, _)| {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|character| character == '_' || character.is_ascii_alphanumeric())
            })
            .unwrap_or(false);

        if in_private_key && is_assignment {
            normalized.push_str("GH_APP_PRIVATE_KEY=\"");
            normalized.push_str(&private_key.replace('"', "\\\""));
            normalized.push_str("\"\n");
            private_key.clear();
            in_private_key = false;
        }

        if !in_private_key {
            normalized.push_str(line);
            normalized.push('\n');
        } else {
            if !private_key.ends_with("\\n") {
                private_key.push_str("\\n");
            }
            private_key.push_str(line);
        }
    }

    if in_private_key {
        normalized.push_str("GH_APP_PRIVATE_KEY=\"");
        normalized.push_str(&private_key.replace('"', "\\\""));
        normalized.push_str("\"\n");
    }

    dotenvy::from_read(Cursor::new(normalized)).map_err(|error| error.to_string())
}

impl Config {
    pub fn load() -> Self {
        // Try to load env files from known paths
        let candidates = [
            Path::new(".env"),
            Path::new(".env.local"),
            Path::new("../.env"),
            Path::new("../.env.local"),
        ];

        for path in candidates {
            if path.exists() {
                if let Err(error) = load_env_file(path) {
                    tracing::warn!("Failed to load environment file {}: {error}", path.display());
                }
            }
        }

        let database_url = Self::resolve_database_url();

        let port = get_clean_env("PORT")
            .and_then(|p| p.parse().ok())
            .unwrap_or(8000);

        let gh_app_id = get_clean_env("GH_APP_ID")
            .and_then(|id| id.parse().ok())
            .unwrap_or(0);

        let gh_app_installation_id = get_clean_env("GH_APP_INSTALLATION_ID")
            .and_then(|id| id.parse().ok());

        let gh_oauth_redirect_uri = get_clean_env("GH_OAUTH_REDIRECT_URI")
            .or_else(|| get_clean_env("GITHUB_REDIRECT_URI"))
            .unwrap_or_else(|| "http://localhost:5173/api/auth/callback".to_string());

        let frontend_url = get_clean_env("FRONTEND_URL")
            .unwrap_or_else(|| "https://open-task-five.vercel.app".to_string());

        if gh_app_id == 0 || get_clean_env("GH_APP_PRIVATE_KEY").is_none() {
            tracing::warn!(
                "GitHub App credentials are not configured: set GH_APP_ID and GH_APP_PRIVATE_KEY on the Rust API host"
            );
        }

        let meeting_pipeline_enabled = get_clean_env("MEETING_PIPELINE_ENABLED")
            .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);
        let groq_api_key = get_clean_env("GROQ_API_KEY");

        // Recall keys are region-specific; the legacy Python service used ap-northeast-1.
        let recall_region = get_clean_env("RECALL_REGION").unwrap_or_else(|| "ap-northeast-1".to_string());
        if !RECALL_REGIONS.contains(&recall_region.as_str()) {
            tracing::warn!(
                "RECALL_REGION={recall_region} is not a Recall region; expected one of {}",
                RECALL_REGIONS.join(", ")
            );
        }

        if meeting_pipeline_enabled && groq_api_key.is_none() {
            tracing::warn!("MEETING_PIPELINE_ENABLED is set but GROQ_API_KEY is missing: meeting jobs cannot be processed");
        }

        Self {
            port,
            database_url,
            supabase_url: get_clean_env("SUPABASE_URL").unwrap_or_default(),
            supabase_key: get_clean_env("SUPABASE_KEY").unwrap_or_default(),
            gh_app_id,
            gh_app_private_key: get_clean_env("GH_APP_PRIVATE_KEY")
                .unwrap_or_default()
                .replace("\\n", "\n"),
            gh_webhook_secret: get_clean_env("GH_WEBHOOK_SECRET").unwrap_or_default(),
            gh_app_client_id: get_clean_env("GH_APP_CLIENT_ID").unwrap_or_default(),
            gh_app_client_secret: get_clean_env("GH_APP_CLIENT_SECRET").unwrap_or_default(),
            gh_app_installation_id,
            gh_oauth_redirect_uri,
            frontend_url,
            gemini_api_key: get_clean_env("GEMINI_API_KEY").unwrap_or_default(),
            secret_key: get_clean_env("SECRET_KEY")
                .unwrap_or_else(|| "opentask-local-development-secret-key-32chars".to_string()),
            recall_api_key: get_clean_env("RECALL_API_KEY"),
            telegram_bot_token: get_clean_env("TELEGRAM_BOT_TOKEN"),
            meeting_pipeline_enabled,
            groq_api_key,
            recall_region,
            vapid_public_key: get_clean_env("VAPID_PUBLIC_KEY").unwrap_or_else(|| {
                "BFNGNl-sWQwDl1GTuh9-iM6bmHSVdosX8T7ax7hqLTPYzjM_G1DHrS0vwO1JRC75x9cOjvgybHK-19GbTWlrSN8".to_string()
            }),
            vapid_private_key: get_clean_env("VAPID_PRIVATE_KEY").unwrap_or_else(|| {
                "u9WEYzZFke7f46Kkv5q98geTM08rAYQP8evwPxBp6G4".to_string()
            }),
            vapid_claim_email: get_clean_env("VAPID_CLAIM_EMAIL").unwrap_or_else(|| {
                "mailto:evangelionxyz10@gmail.com".to_string()
            }),
        }
    }

    fn resolve_database_url() -> String {
        if let Some(url) = get_clean_env("POSTGRESQL_DATABASE_URL").or_else(|| get_clean_env("DATABASE_URL")) {
            // Keep Supabase Session Pooler (port 5432) for SQLx.
            // SQLx uses the PostgreSQL extended protocol for bound parameters,
            // and Supavisor transaction pooling (port 6543) can route Parse and
            // Bind messages to different backend sessions, returning another
            // query's rows (e.g. "Value Buffer exceeds 8 bytes" decode errors).
            if url.contains(".pooler.supabase.com:6543") {
                tracing::warn!(
                    "Supabase transaction pooler detected; switching from :6543 to Session Pooler :5432 for SQLx compatibility"
                );
                return url.replace(".pooler.supabase.com:6543", ".pooler.supabase.com:5432");
            }
            return url;
        }

        let user = get_clean_env("POSTGRESQL_USERNAME").unwrap_or_else(|| "postgres".to_string());
        let pwd = get_clean_env("POSTGRESQL_PASSWORD").unwrap_or_default();
        let host = get_clean_env("POSTGRESQL_HOST").unwrap_or_else(|| "localhost".to_string());
        let port = get_clean_env("POSTGRESQL_PORT").unwrap_or_else(|| "5432".to_string());
        let db = get_clean_env("POSTGRESQL_DATABASE").unwrap_or_else(|| "postgres".to_string());

        format!("postgres://{user}:{pwd}@{host}:{port}/{db}")
    }
}
