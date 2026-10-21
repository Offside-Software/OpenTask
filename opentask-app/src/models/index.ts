export type MeetingSource = "RECALL_BOT" | "MEDIA" | "TEXT" | "MANUAL";
export type MeetingStatus = "PROCESSING" | "COMPLETED" | "FAILED";
export type MeetingJobStatus =
  | "CREATED"
  | "QUEUED"
  | "TRANSCRIBING"
  | "GATING"
  | "EXTRACTING"
  | "DRAFTS_READY"
  | "REVIEWED"
  | "NO_ACTIONS"
  | "FAILED";
export type ExtractionConfidence = "high" | "medium" | "low";
export type BucketState =
  | "DRAFT"
  | "PENDING"
  | "TODO"
  | "ONGOING"
  | "ON_REVIEW"
  | "COMPLETED";

export type DefaultTaskType = "CODE" | "REQUIREMENT" | "DESIGN" | "OTHER" | "NON-CODE";
export type TaskType = DefaultTaskType | string;
export type AlertType =
  | "STAGNATION"
  | "REALLOCATION"
  | "DRAFT_APPROVAL"
  | "TASK_ASSIGNED"
  | "TASK_UNASSIGNED"
  | "TASK_COMPLETED"
  | "TASK_REOPENED"
  | "SYSTEM_TEST"
  | "PR_REVIEWED"
  | "FORGOTTEN_TASK"
  | (string & {});

export interface Bucket {
  id?: number | string;
  project_id: number | string;
  name: string;
  description?: string;
  state: BucketState;
  is_system_locked?: boolean;
  task_count?: number;
  order_idx: number;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id?: number;
  gh_id: number;
  gh_username: string;
  gh_access_token?: string;
  telegram_chat_id?: string;
  display_name?: string;
  email?: string;
  created_at?: string;
}

export interface UserAlias {
  user_id: number;
  alias: string;
}

export interface Project {
  id?: number | string;
  name: string;
  gh_repo_url: string[];
  description?: string;
  status?: string;
  progress?: number;
  issue?: string;
  tags?: string[];
  isLead?: boolean;
  tasksPending?: number;
  custom_ai_api_key?: string;
  api_key?: string;
}

export interface ProjectMember {
  id?: number | string;
  user_id: number | string;
  project_id: number | string;
  role: string;
  kpi_score: number; // VISIBLE TIER
  max_capacity: number;
  current_load: number; // For workload distribution chart
  gh_username?: string;
  display_name?: string;
  avatar_url?: string;
  task_count?: number;
  task_points?: number;
}

export interface Activity {
  id?: number | string;
  project_id: number | string;
  user_name: string;
  action: string; // e.g., 'pushed', 'moved', 'generated', 'created', 'completed'
  target: string; // e.g., 'auth-v2', 'Task A to QA'
  created_at?: string;
  avatar_url?: string;
}

export interface TimelineBucket {
  timestamp: string;
  label: string;
  count: number;
  activities: Activity[];
}

export interface TimelineData {
  interval: string;
  range_start: string;
  range_end: string;
  total_activities: number;
  peak_count: number;
  buckets: TimelineBucket[];
}

export interface ProjectHistoryItem {
  id: string | number;
  project_id: string | number;
  user_id?: string | number;
  user_name?: string;
  event_type: string;
  entity_type: string;
  entity_id?: string | number;
  description: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface ProjectMetric {
  id?: number | string;
  project_id: number | string;
  label: string; // e.g., 'Code Review Cycle'
  value: string; // e.g., '48h'
  progress: number; // 0-100
  status: "critical" | "warning" | "success" | "default";
  target_label: string; // e.g., 'Target < 12h'
}

export interface UserProjectStats {
  user_id: number | string;
  project_id: number | string;
  points_completed: number;
  velocity_percentile: number;
}

export interface Meeting {
  id?: number | string;
  project_id: number | string;
  created_by?: string | null;
  source_type: MeetingSource | string;
  status?: MeetingStatus;
  recall_bot_id?: string | null;
  mom_summary?: string; // LAZY LOAD TIER
  key_decisions?: string[]; // LAZY LOAD TIER
  title?: string;
  date?: string;
  time?: string;
  duration?: string;
  attendees?: string[]; // not stored; job attendee_ids are user ids
  action_items?: { initials: string; task: string; deadline: string }[];
  created_at?: string;
  updated_at?: string;
}

export interface GateResult {
  verdict: "yes" | "no" | "unsure";
  reason?: string | null;
  doc_type?: string | null;
  model?: string | null;
  failed_open: boolean;
}

export interface MeetingJob {
  id: string;
  meeting_id: string;
  source_type: MeetingSource;
  status: MeetingJobStatus;
  meeting_date: string;
  timezone: string;
  attendee_ids: string[];
  duration_sec?: number | null;
  gate?: GateResult | null;
  attempts: number;
  next_attempt_at?: string | null;
  failure_reason?: string | null;
}

export interface MeetingJobSummary extends MeetingJob {
  meeting_title?: string | null;
  created_at?: string | null;
  pending_drafts: number;
  total_drafts: number;
}

/** A task the meeting pipeline extracted, waiting in AI Drafts for review. */
export interface MeetingDraftTask {
  task_id: string;
  bucket_id?: string | null;
  bucket_state?: string | null;
  title: string;
  description?: string | null;
  type?: TaskType | null;
  weight?: number | null;
  lead_assignee_id?: string | null;
  assignee_ids: string[];
  evidence_quote: string;
  evidence_verified: boolean;
  evidence_segment?: number | null;
  evidence_start_sec?: number | null;
  confidence: ExtractionConfidence;
  assignee_hint?: string | null;
  resolved_user_id?: string | null;
  due_text?: string | null;
  due_date?: string | null;
  priority?: string | null;
}

export interface MeetingJobDetail {
  job: MeetingJob;
  meeting: Meeting;
  drafts: MeetingDraftTask[];
}

export interface MeetingUploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

export interface MeetingMediaIntake {
  meeting: Meeting;
  job: MeetingJob;
  upload: MeetingUploadTarget;
}

/** 0 means no limit. */
export interface AiLimits {
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number;
  audio_per_hour: number;
  audio_per_day: number;
}

export interface ModelUsageToday {
  model: string;
  requests: number;
  tokens: number;
  audio_seconds: number;
  limits: AiLimits;
}

/** A project's own provider key. The key itself never leaves the server. */
export interface ProjectAiKey {
  provider: "groq";
  configured: boolean;
  hint?: string | null;
  tier?: "free" | "developer" | null;
  updated_at?: string | null;
  can_manage: boolean;
}

export interface MeetingHealth {
  can_manage: boolean;
  quota: {
    jobs_today: number;
    jobs_per_day: number;
    audio_minutes_today: number;
    audio_minutes_per_day: number;
    /** The project uses its own key, so the quotas do not apply. */
    exempt: boolean;
  };
  models: ModelUsageToday[];
  own_models: ModelUsageToday[];
  key: ProjectAiKey;
  jobs: { job: MeetingJob; meeting_title?: string | null; problem?: string | null; can_retry: boolean }[];
}

export interface MeetingIntake {
  meeting: Meeting;
  job: MeetingJob;
}

export interface TranscriptSegment {
  index: number;
  speaker?: string | null;
  start_sec?: number | null;
  end_sec?: number | null;
  text: string;
  char_offset: number;
}

export interface ApproveDraftItem {
  task_id: string;
  title?: string;
  description?: string;
  type?: string;
  weight?: number;
  bucket_id?: string;
  assignee_ids: string[];
  due_date?: string;
  priority?: string;
}

export interface DraftReviewResult {
  job: MeetingJob;
  moved_task_ids: string[];
  pending_drafts: number;
}

export interface Task {
  id?: number | string;
  project_id: number | string;
  bucket_id?: number | string; // Replaces static status in logic
  order_idx?: number;
  meeting_id?: number | string;
  parent_task_id?: number | string;
  lead_assignee_id?: number | string | null; // VISIBLE TIER
  suggested_assignee_id?: number | string | null;
  assignee_ids?: (number | string)[];
  title: string;
  description?: string; // LAZY LOAD TIER
  status?: BucketState; // Derived from bucket for UI
  type: TaskType;
  weight: number; // VISIBLE TIER
  branch_name?: string;
  last_activity_at?: Date | string; // VISIBLE TIER
  warnStagnant?: boolean;
  isSuggested?: boolean;
  prUrl?: string;
  repo_url?: string;
  attachments?: TaskAttachment[];
}

export interface TaskAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  path: string;
  url: string;
  created_at: string;
}

export interface TaskAssignee {
  task_id: number;
  user_id: number;
}

export interface Alert {
  id?: number | string;
  user_id: number | string;
  context_id?: number | string;
  project_id: number | string;
  title: string;
  description: string;
  type: AlertType;
  severity: "critical" | "warning" | "info";
  suggested_actions: string[];
  is_resolved: boolean;
  pr_url?: string;
  created_at?: string;
}

export interface ExtractedTask {
  title: string;
  description?: string;
  reason?: string;
  priority?: string;
  type?: string;
  weight?: number;
}

export interface ExtractedTaskPayload {
  title: string;
  description?: string;
  type?: string;
  weight?: number;
  assignee_id: number;
}

export interface GithubInstallation {
  installation_id: number;
  account_login: string;
  account_type: 'Organization' | 'User';
  account_avatar_url?: string;
  app_install_url?: string;
}

export interface GithubInstallationRepo {
  full_name: string;
  html_url: string;
  private: boolean;
  description?: string;
  installation_id?: number;
  account_login?: string;
  account_type?: string;
  is_connected?: boolean;
}

export interface PrReview {
  id: string | number;
  project_id: string | number;
  task_id?: string | number;
  repo_full_name: string;
  pr_number: number;
  pr_title?: string;
  pr_url?: string;
  verdict: 'PASS' | 'FAIL';
  feedback?: string;
  matched_task_title?: string;
  completeness_score?: number;
  reviewed_at?: string;
}

export type FeedbackType = 'FEEDBACK' | 'BUG' | 'FEATURE' | 'GENERAL';
export type FeedbackStatus = 'PENDING' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';

export interface Feedback {
  id: string;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  feedback_type: FeedbackType;
  category?: string | null;
  rating?: number | null;
  title?: string | null;
  description: string;
  device_info?: Record<string, any> | null;
  status: FeedbackStatus;
  created_at?: string;
  updated_at?: string;
}

export interface CreateFeedbackInput {
  feedback_type?: FeedbackType;
  category?: string;
  rating?: number;
  title?: string;
  description: string;
  user_email?: string;
  user_name?: string;
  device_info?: Record<string, any>;
}

