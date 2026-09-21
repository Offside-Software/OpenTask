use std::env;
use std::path::Path;

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

    // Web Push (VAPID)
    pub vapid_public_key: String,
    pub vapid_private_key: String,
    pub vapid_claim_email: String,
}

fn clean_val(v: String) -> String {
    v.trim().trim_matches('"').trim_matches('\'').trim().to_string()
}

fn get_clean_env(key: &str) -> Option<String> {
    env::var(key).ok().map(clean_val).filter(|s| !s.is_empty())
}

impl Config {
    pub fn load() -> Self {
        // Try to load env files from known paths
        let candidates = [
            Path::new("../.env"),
            Path::new("../.env.local"),
        ];

        for path in candidates {
            if path.exists() {
                let _ = dotenvy::from_path(path);
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
            .unwrap_or_else(|| "http://localhost:5173".to_string());

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
            // Supabase Pooler note: Port 6543 is Transaction Mode (which does not support SQLx prepared statements).
            // Port 5432 on the pooler is Session Mode (officially designated by Supabase for SQLx/Prisma with prepared statements).
            if url.contains(".pooler.supabase.com:6543") {
                tracing::info!("Switching Supabase pooler from Transaction Mode (:6543) to Session Mode (:5432) for SQLx prepared statement support.");
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
