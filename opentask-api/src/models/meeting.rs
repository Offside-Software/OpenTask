use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::Json;

use crate::models::safe_id::SafeId;

/// Gives a fieldless enum `as_str`, `FromStr`, `Display` and sqlx TEXT encoding.
macro_rules! text_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(&self) -> &'static str {
                match self {
                    $($name::$variant => $text),+
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $($text => Ok($name::$variant),)+
                    other => Err(format!("unknown {} value: {other}", stringify!($name))),
                }
            }
        }

        impl sqlx::Type<sqlx::Postgres> for $name {
            fn type_info() -> sqlx::postgres::PgTypeInfo {
                <&str as sqlx::Type<sqlx::Postgres>>::type_info()
            }

            fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
                <&str as sqlx::Type<sqlx::Postgres>>::compatible(ty)
            }
        }

        impl<'q> sqlx::Encode<'q, sqlx::Postgres> for $name {
            fn encode_by_ref(
                &self,
                buf: &mut sqlx::postgres::PgArgumentBuffer,
            ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
                <&str as sqlx::Encode<sqlx::Postgres>>::encode(self.as_str(), buf)
            }
        }

        impl<'r> sqlx::Decode<'r, sqlx::Postgres> for $name {
            fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
                let text = <&str as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
                text.parse::<$name>().map_err(Into::into)
            }
        }
    };
}

/// `meetings.status`: follows the meeting's latest job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MeetingStatus {
    Processing,
    Completed,
    Failed,
}

text_enum!(MeetingStatus {
    Processing => "PROCESSING",
    Completed => "COMPLETED",
    Failed => "FAILED",
});

/// `meeting_jobs.status`: the contract between the worker and the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobStatus {
    Created,
    Queued,
    Transcribing,
    Gating,
    Extracting,
    DraftsReady,
    Reviewed,
    NoActions,
    Failed,
}

text_enum!(JobStatus {
    Created => "CREATED",
    Queued => "QUEUED",
    Transcribing => "TRANSCRIBING",
    Gating => "GATING",
    Extracting => "EXTRACTING",
    DraftsReady => "DRAFTS_READY",
    Reviewed => "REVIEWED",
    NoActions => "NO_ACTIONS",
    Failed => "FAILED",
});

impl JobStatus {
    /// Statuses the worker picks up. Keep in sync with the claim query and the `idx_meeting_jobs_claim` partial index.
    pub fn is_claimable(self) -> bool {
        matches!(self, Self::Queued | Self::Transcribing | Self::Gating | Self::Extracting)
    }

    /// Statuses during which a meeting must not be deleted.
    pub fn is_running(self) -> bool {
        matches!(self, Self::Transcribing | Self::Gating | Self::Extracting)
    }

    pub fn meeting_status(self) -> MeetingStatus {
        match self {
            Self::Created | Self::Queued | Self::Transcribing | Self::Gating | Self::Extracting => {
                MeetingStatus::Processing
            }
            Self::DraftsReady | Self::Reviewed | Self::NoActions => MeetingStatus::Completed,
            Self::Failed => MeetingStatus::Failed,
        }
    }
}

/// `meetings.source_type` and `meeting_jobs.source_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceType {
    RecallBot,
    #[serde(alias = "MANUAL_UPLOAD")]
    Media,
    Text,
    Manual,
}

text_enum!(SourceType {
    RecallBot => "RECALL_BOT",
    Media => "MEDIA",
    Text => "TEXT",
    Manual => "MANUAL",
});

/// `task_extraction_meta.confidence`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

text_enum!(Confidence {
    High => "high",
    Medium => "medium",
    Low => "low",
});

/// The gate's answer to "does this record hold follow-up work?".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateVerdict {
    Yes,
    No,
    Unsure,
}

/// `meeting_jobs.gate`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateResult {
    pub verdict: GateVerdict,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub doc_type: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub failed_open: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub index: u32,
    #[serde(default)]
    pub speaker: Option<String>,
    #[serde(default)]
    pub start_sec: Option<f32>,
    #[serde(default)]
    pub end_sec: Option<f32>,
    pub text: String,
    pub char_offset: u32,
}

/// Columns of `opentask.meetings`, in `DatabaseMeeting` order.
pub const MEETING_COLUMNS: &str = "id, project_id, created_by, title, date, time, duration, source_type, \
    mom_summary, key_decisions, action_items, status, recall_bot_id, created_at, updated_at";

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseMeeting {
    pub id: SafeId,
    pub project_id: Option<SafeId>,
    pub created_by: Option<String>,
    pub title: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub duration: Option<String>,
    pub source_type: Option<SourceType>,
    pub mom_summary: Option<String>,
    pub key_decisions: Option<Value>,
    pub action_items: Option<Value>,
    pub status: MeetingStatus,
    pub recall_bot_id: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Columns of `opentask.meeting_jobs`, in `MeetingJob` order.
pub const MEETING_JOB_COLUMNS: &str = "id, meeting_id, source_type, status, meeting_date, timezone, \
    attendee_ids, r2_keys, duration_sec, gate, attempts, locked_until, next_attempt_at, last_error, alert_id";

/// A `meeting_jobs` row. Never sent to the frontend as is: use `MeetingJobResponse`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MeetingJob {
    pub id: SafeId,
    pub meeting_id: SafeId,
    pub source_type: SourceType,
    pub status: JobStatus,
    pub meeting_date: DateTime<Utc>,
    pub timezone: String,
    pub attendee_ids: Vec<SafeId>,
    pub r2_keys: Json<Vec<String>>,
    pub duration_sec: Option<i32>,
    pub gate: Option<Json<GateResult>>,
    pub attempts: i32,
    pub locked_until: Option<DateTime<Utc>>,
    pub next_attempt_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    /// The DRAFT_APPROVAL alert raised for this job.
    pub alert_id: Option<SafeId>,
}

/// Front end payload of meeting jobs
#[derive(Debug, Clone, Serialize)]
pub struct MeetingJobResponse {
    pub id: SafeId,
    pub meeting_id: SafeId,
    pub source_type: SourceType,
    pub status: JobStatus,
    pub meeting_date: DateTime<Utc>,
    pub timezone: String,
    pub attendee_ids: Vec<SafeId>,
    pub duration_sec: Option<i32>,
    pub gate: Option<GateResult>,
    pub attempts: i32,
    pub next_attempt_at: Option<DateTime<Utc>>,
    pub failure_reason: Option<String>,
}

impl From<MeetingJob> for MeetingJobResponse {
    fn from(job: MeetingJob) -> Self {
        let failure_reason = (job.status == JobStatus::Failed && job.source_type == SourceType::RecallBot && job.attempts == 0)
            .then(|| job.last_error.clone())
            .flatten();
        Self {
            failure_reason,
            id: job.id,
            meeting_id: job.meeting_id,
            source_type: job.source_type,
            status: job.status,
            meeting_date: job.meeting_date,
            timezone: job.timezone,
            attendee_ids: job.attendee_ids,
            duration_sec: job.duration_sec,
            gate: job.gate.map(|g| g.0),
            attempts: job.attempts,
            next_attempt_at: job.next_attempt_at,
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MeetingTranscript {
    pub job_id: SafeId,
    pub language: Option<String>,
    pub segments: Json<Vec<Segment>>,
    pub extraction_checkpoint: Option<Value>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Evidence and the as-extracted snapshot behind a task the pipeline created.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TaskExtractionMeta {
    pub task_id: SafeId,
    pub job_id: SafeId,
    pub evidence_quote: String,
    pub evidence_verified: bool,
    pub evidence_segment: Option<i32>,
    pub evidence_start_sec: Option<i32>,
    pub confidence: Confidence,
    pub assignee_hint: Option<String>,
    pub resolved_user_id: Option<SafeId>,
    pub due_text: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub original: Value,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMeetingPayload {
    pub project_id: SafeId,
    pub title: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub duration: Option<String>,
    pub source_type: Option<SourceType>,
    pub mom_summary: Option<String>,
    pub key_decisions: Option<Value>,
    pub action_items: Option<Value>,
}

/// Fields left out keep their current value.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateMeetingPayload {
    pub title: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub duration: Option<String>,
    pub mom_summary: Option<String>,
    pub key_decisions: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetailResponse {
    #[serde(flatten)]
    pub meeting: DatabaseMeeting,
    /// Newest first.
    pub jobs: Vec<MeetingJobResponse>,
}

/// `POST /meeting-jobs/text`: notes or a transcript the browser already turned into text.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTextJobPayload {
    pub project_id: SafeId,
    pub title: Option<String>,
    pub meeting_date: Option<String>,
    pub timezone: Option<String>,
    #[serde(default)]
    pub attendee_ids: Vec<SafeId>,
    pub text: String,
}

/// `POST /invite-bot`: send a Recall bot to a live meeting.
#[derive(Debug, Clone, Deserialize)]
pub struct InviteBotPayload {
    pub project_id: SafeId,
    pub meeting_url: String,
    pub title: Option<String>,
    pub meeting_date: Option<String>,
    pub timezone: Option<String>,
    #[serde(default)]
    pub attendee_ids: Vec<SafeId>,
    pub bot_name: Option<String>,
}

/// Intake endpoints return.
#[derive(Debug, Clone, Serialize)]
pub struct IntakeResponse {
    pub meeting: DatabaseMeeting,
    pub job: MeetingJobResponse,
}

/// Project's job.
#[derive(Debug, Clone, Serialize)]
pub struct MeetingJobSummary {
    #[serde(flatten)]
    pub job: MeetingJobResponse,
    pub meeting_title: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub pending_drafts: i64,
    pub total_drafts: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct DraftTaskView {
    pub task_id: SafeId,
    pub bucket_id: Option<SafeId>,
    pub bucket_state: Option<String>,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub weight: Option<i32>,
    pub lead_assignee_id: Option<SafeId>,
    pub assignee_ids: Vec<SafeId>,
    pub evidence_quote: String,
    pub evidence_verified: bool,
    pub evidence_segment: Option<i32>,
    pub evidence_start_sec: Option<i32>,
    pub confidence: Confidence,
    pub assignee_hint: Option<String>,
    pub resolved_user_id: Option<SafeId>,
    pub due_text: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingJobDetail {
    pub job: MeetingJobResponse,
    pub meeting: DatabaseMeeting,
    pub drafts: Vec<DraftTaskView>,
}

/// One reviewed draft. Left-out fields keep the draft's values.
#[derive(Debug, Clone, Deserialize)]
pub struct ApproveDraftItem {
    pub task_id: SafeId,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub weight: Option<i32>,
    pub bucket_id: Option<SafeId>,
    #[serde(default)]
    pub assignee_ids: Vec<SafeId>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApproveDraftsPayload {
    pub items: Vec<ApproveDraftItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RejectDraftsPayload {
    pub task_ids: Vec<SafeId>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewResult {
    pub job: MeetingJobResponse,
    pub moved_task_ids: Vec<SafeId>,
    pub pending_drafts: i64,
}


#[cfg(test)]
mod tests {
    use super::*;

    fn assert_serde_matches_text<T>(all: &[T])
    where
        T: Serialize + for<'de> Deserialize<'de> + std::fmt::Display + std::str::FromStr + PartialEq + std::fmt::Debug,
        <T as std::str::FromStr>::Err: std::fmt::Debug,
    {
        for value in all {
            let json = serde_json::to_value(value).unwrap();
            assert_eq!(json, Value::String(value.to_string()), "serde name differs from stored text");
            let back: T = serde_json::from_value(json).unwrap();
            assert_eq!(&back, value);
            assert_eq!(&value.to_string().parse::<T>().unwrap(), value);
        }
    }

    #[test]
    fn text_enums_round_trip_through_serde_and_text() {
        assert_serde_matches_text(MeetingStatus::ALL);
        assert_serde_matches_text(JobStatus::ALL);
        assert_serde_matches_text(SourceType::ALL);
        assert_serde_matches_text(Confidence::ALL);
    }

    #[test]
    fn unknown_text_is_rejected() {
        assert!("IN_REVIEW".parse::<JobStatus>().is_err());
        assert!("processing".parse::<MeetingStatus>().is_err());
    }

    #[test]
    fn legacy_manual_upload_reads_as_media() {
        let source: SourceType = serde_json::from_str("\"MANUAL_UPLOAD\"").unwrap();
        assert_eq!(source, SourceType::Media);
    }

    #[test]
    fn job_status_drives_meeting_status() {
        use JobStatus::*;
        for status in [Created, Queued, Transcribing, Gating, Extracting] {
            assert_eq!(status.meeting_status(), MeetingStatus::Processing);
        }
        for status in [DraftsReady, Reviewed, NoActions] {
            assert_eq!(status.meeting_status(), MeetingStatus::Completed);
        }
        assert_eq!(Failed.meeting_status(), MeetingStatus::Failed);

        let claimable: Vec<_> = JobStatus::ALL.iter().filter(|s| s.is_claimable()).collect();
        assert_eq!(claimable, [&Queued, &Transcribing, &Gating, &Extracting]);
        assert!(!Queued.is_running() && Extracting.is_running());
    }

    #[test]
    fn job_response_serializes_ids_as_strings_and_hides_internals() {
        let job = MeetingJob {
            id: SafeId(101418559460085760),
            meeting_id: SafeId(101418347630956544),
            source_type: SourceType::RecallBot,
            status: JobStatus::DraftsReady,
            meeting_date: DateTime::parse_from_rfc3339("2026-10-19T00:00:00+07:00").unwrap().into(),
            timezone: "Asia/Jakarta".to_string(),
            attendee_ids: vec![SafeId(94695191667019776)],
            r2_keys: Json(vec!["ingest/1/2/source.ogg".to_string()]),
            duration_sec: None,
            gate: Some(Json(GateResult {
                verdict: GateVerdict::Unsure,
                reason: None,
                doc_type: None,
                model: Some("llama-3.1-8b-instant".to_string()),
                failed_open: true,
            })),
            attempts: 1,
            locked_until: None,
            next_attempt_at: None,
            last_error: Some("provider said: secret detail".to_string()),
            alert_id: None,
        };

        let value = serde_json::to_value(MeetingJobResponse::from(job)).unwrap();
        assert_eq!(value["id"], "101418559460085760");
        assert_eq!(value["meeting_id"], "101418347630956544");
        assert_eq!(value["attendee_ids"][0], "94695191667019776");
        assert_eq!(value["status"], "DRAFTS_READY");
        assert_eq!(value["source_type"], "RECALL_BOT");
        assert_eq!(value["gate"]["verdict"], "unsure");
        assert!(value.get("last_error").is_none());
        assert!(value.get("r2_keys").is_none());
        assert!(value.get("locked_until").is_none());
        assert!(value["failure_reason"].is_null());
    }

    #[test]
    fn job_response_shows_only_intake_failure_reasons() {
        let job = |source_type, attempts| MeetingJob {
            id: SafeId(1),
            meeting_id: SafeId(2),
            source_type,
            status: JobStatus::Failed,
            meeting_date: Utc::now(),
            timezone: "Asia/Jakarta".to_string(),
            attendee_ids: vec![],
            r2_keys: Json(vec![]),
            duration_sec: None,
            gate: None,
            attempts,
            locked_until: None,
            next_attempt_at: None,
            last_error: Some("The bot left without recording anything.".to_string()),
            alert_id: None,
        };
        let shown = MeetingJobResponse::from(job(SourceType::RecallBot, 0));
        assert_eq!(shown.failure_reason.as_deref(), Some("The bot left without recording anything."));
        // Failed in the worker (claimed at least once), or not a bot job: kept internal.
        assert_eq!(MeetingJobResponse::from(job(SourceType::RecallBot, 3)).failure_reason, None);
        assert_eq!(MeetingJobResponse::from(job(SourceType::Text, 0)).failure_reason, None);
    }

    #[test]
    fn gate_result_tolerates_missing_optional_fields() {
        let gate: GateResult = serde_json::from_str(r#"{"verdict":"no"}"#).unwrap();
        assert_eq!(gate.verdict, GateVerdict::No);
        assert!(!gate.failed_open);
    }
}
