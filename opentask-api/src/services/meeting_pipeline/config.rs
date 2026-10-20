use crate::config::{get_clean_env, Config};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroqTier {
    Free,
    Developer,
}

#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub groq_tier: GroqTier,
    pub groq_base_url: String,

    // Worker
    pub lease_minutes: i32,
    pub max_attempts: i32,
    pub idle_poll_secs: u64,
    pub retry_base_secs: i64,
    pub retry_max_secs: i64,

    // Speech to text (MEDIA jobs)
    pub asr_model: &'static str,
    pub asr_max_file_mb: u32,
    pub asr_rpm: u32,
    pub asr_rpd: u32,
    pub asr_audio_sec_per_hour: u32,
    pub asr_audio_sec_per_day: u32,
    pub asr_prompt_max_tokens: u32,
    pub cf_asr_model: &'static str,
    pub cf_account_id: Option<String>,
    pub cf_api_token: Option<String>,
    pub cf_api_base: String,
    pub asr_language: Option<String>,
    pub asr_part_secs: u32,
    pub asr_bitrate: &'static str,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub max_audio_minutes: u32,
    pub max_download_mb: u64,

    // Recording uploads
    pub media_store: Option<super::storage::MediaStore>,
    pub max_upload_mb: u64,
    pub upload_url_minutes: u64,
    pub upload_max_wait_hours: i64,

    // Recall bots
    pub recall_poll_secs: u64,
    pub recall_max_wait_hours: i64,
    pub recall_no_audio_grace_mins: i64,

    // Gate
    pub gate_model: &'static str,
    pub gate_fallback_model: &'static str,
    pub gate_head_chars: usize,
    pub gate_tail_chars: usize,

    // Extraction and summary
    pub extract_model: &'static str,
    pub extract_rpm: u32,
    pub extract_rpd: u32,
    pub extract_tpm: u32,
    pub extract_tpd: u32,
    pub extract_dev_tpm: u32,
    pub chunk_tokens: u32,
    pub overlap_tokens: u32,
    pub max_output_tokens: u32,
    pub tpm_safety_margin: f32,
    pub summary_model: &'static str,

    // Limits
    pub max_tasks_per_job: usize,
    pub max_text_chars: usize,
}

impl PipelineConfig {
    pub fn from_env() -> Self {
        let groq_tier = match get_clean_env("MEETING_GROQ_TIER").as_deref().map(str::to_ascii_lowercase) {
            Some(tier) if tier == "developer" || tier == "dev" => GroqTier::Developer,
            _ => GroqTier::Free,
        };

        Self {
            groq_tier,
            groq_base_url: get_clean_env("GROQ_BASE_URL").unwrap_or_else(|| super::llm::GROQ_BASE_URL.to_string()),

            lease_minutes: 10,
            max_attempts: 8,
            idle_poll_secs: 15,
            retry_base_secs: 30,
            retry_max_secs: 30 * 60,

            asr_model: "whisper-large-v3-turbo",
            asr_max_file_mb: match groq_tier {
                GroqTier::Free => 25,
                GroqTier::Developer => 100,
            },
            asr_rpm: 20,
            asr_rpd: 2_000,
            asr_audio_sec_per_hour: 7_200,
            asr_audio_sec_per_day: 28_800,
            asr_prompt_max_tokens: 224,
            cf_asr_model: "@cf/openai/whisper-large-v3-turbo",
            cf_account_id: get_clean_env("CLOUDFLARE_ACCOUNT_ID"),
            cf_api_token: get_clean_env("CLOUDFLARE_API_TOKEN"),
            cf_api_base: get_clean_env("CLOUDFLARE_API_BASE_URL")
                .unwrap_or_else(|| "https://api.cloudflare.com/client/v4".to_string()),
            // Indonesian by default; MEETING_ASR_LANGUAGE=auto to detect.
            asr_language: match get_clean_env("MEETING_ASR_LANGUAGE").map(|l| l.to_ascii_lowercase()) {
                Some(l) if l == "auto" => None,
                Some(l) => Some(l),
                None => Some("id".to_string()),
            },
            asr_part_secs: 1_200,
            asr_bitrate: "24k",
            ffmpeg_path: get_clean_env("FFMPEG_PATH").unwrap_or_else(|| "ffmpeg".to_string()),
            ffprobe_path: get_clean_env("FFPROBE_PATH").unwrap_or_else(|| "ffprobe".to_string()),
            max_audio_minutes: 240,
            max_download_mb: 1_024,

            media_store: super::storage::MediaStore::from_env(),
            max_upload_mb: 1_024,
            upload_url_minutes: 60,
            upload_max_wait_hours: 6,

            recall_poll_secs: 60,
            recall_max_wait_hours: 12,
            recall_no_audio_grace_mins: 5,

            gate_model: "openai/gpt-oss-20b",
            gate_fallback_model: "openai/gpt-oss-120b",
            gate_head_chars: 7_500,
            gate_tail_chars: 1_500,

            extract_model: "openai/gpt-oss-120b",
            extract_rpm: 30,
            extract_rpd: 1_000,
            extract_tpm: 8_000,
            extract_tpd: 200_000,
            extract_dev_tpm: 250_000,
            chunk_tokens: 4_000,
            overlap_tokens: 300,
            max_output_tokens: 2_000,
            tpm_safety_margin: 0.15,
            summary_model: "openai/gpt-oss-20b",

            max_tasks_per_job: 30,
            max_text_chars: 300_000,
        }
    }

    pub fn retry_delay_secs(&self, attempts: i32) -> i64 {
        let exponent = attempts.saturating_sub(1).clamp(0, 20) as u32;
        self.retry_base_secs
            .saturating_mul(1_i64 << exponent)
            .min(self.retry_max_secs)
    }
}

/// The Groq key for a project's meeting jobs. Environment only for now (Scalable to per project later on)
pub fn resolve_groq_key(config: &Config, _project_id: i64) -> Option<String> {
    config.groq_api_key.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_doubles_and_caps() {
        let cfg = PipelineConfig::from_env();
        assert_eq!(cfg.retry_delay_secs(0), 30);
        assert_eq!(cfg.retry_delay_secs(1), 30);
        assert_eq!(cfg.retry_delay_secs(2), 60);
        assert_eq!(cfg.retry_delay_secs(4), 240);
        assert_eq!(cfg.retry_delay_secs(8), 1_800);
        assert_eq!(cfg.retry_delay_secs(i32::MAX), 1_800);
    }
}
