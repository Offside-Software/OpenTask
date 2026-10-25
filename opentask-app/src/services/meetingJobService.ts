import { apiFetch } from "./apiClient";
import type {
  ApproveDraftItem,
  DraftReviewResult,
  MeetingHealth,
  MeetingIntake,
  MeetingJob,
  MeetingMediaIntake,
  ProjectAiKey,
  MeetingJobDetail,
  MeetingJobSummary,
  TranscriptSegment,
} from "../models";

export interface MeetingIntakeFields {
  project_id: string;
  title?: string;
  meeting_date?: string; // YYYY-MM-DD
  timezone?: string;
  attendee_ids?: string[];
}

export const meetingJobService = {
  listJobs: (projectId: string | number) =>
    apiFetch<MeetingJobSummary[]>(`/meeting-jobs?project_id=${projectId}`),

  getJob: (jobId: string) => apiFetch<MeetingJobDetail>(`/meeting-jobs/${jobId}`),

  getTranscript: (jobId: string) =>
    apiFetch<{ language?: string | null; segments: TranscriptSegment[] }>(`/meeting-jobs/${jobId}/transcript`),

  createTextJob: (fields: MeetingIntakeFields & { text: string }) =>
    apiFetch<MeetingIntake>("/meeting-jobs/text", {
      method: "POST",
      body: JSON.stringify(fields),
    }),

  inviteBot: (fields: MeetingIntakeFields & { meeting_url: string; bot_name?: string }) =>
    apiFetch<MeetingIntake>("/invite-bot", {
      method: "POST",
      body: JSON.stringify(fields),
    }),

  /** Creates the meeting and job for a recording and returns where to upload it. */
  createMediaJob: (fields: MeetingIntakeFields & { file_name: string; content_type?: string; size_bytes: number; duration_sec?: number }) =>
    apiFetch<MeetingMediaIntake>("/meeting-jobs", {
      method: "POST",
      body: JSON.stringify(fields),
    }),

  completeUpload: (jobId: string) =>
    apiFetch<MeetingIntake>(`/meeting-jobs/${jobId}/complete`, { method: "POST" }),

  getHealth: (projectId: string | number) => apiFetch<MeetingHealth>(`/meeting-jobs/health?project_id=${projectId}`),

  retryJob: (jobId: string) => apiFetch<MeetingJob>(`/meeting-jobs/${jobId}/retry`, { method: "POST" }),

  getAiKey: (projectId: string | number) => apiFetch<ProjectAiKey>(`/meeting-jobs/ai-key?project_id=${projectId}`),

  setAiKey: (projectId: string | number, apiKey: string, tier: "free" | "developer") =>
    apiFetch<ProjectAiKey>("/meeting-jobs/ai-key", {
      method: "PUT",
      body: JSON.stringify({ project_id: String(projectId), api_key: apiKey, tier }),
    }),

  removeAiKey: (projectId: string | number) =>
    apiFetch<ProjectAiKey>(`/meeting-jobs/ai-key?project_id=${projectId}`, { method: "DELETE" }),

  approveDrafts: (jobId: string, items: ApproveDraftItem[]) =>
    apiFetch<DraftReviewResult>(`/meeting-jobs/${jobId}/drafts/approve`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  rejectDrafts: (jobId: string, taskIds: string[]) =>
    apiFetch<DraftReviewResult>(`/meeting-jobs/${jobId}/drafts/reject`, {
      method: "POST",
      body: JSON.stringify({ task_ids: taskIds }),
    }),
};

/** Today's date in the browser's timezone, as YYYY-MM-DD. */
export const todayLocal = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";
  } catch {
    return "Asia/Jakarta";
  }
};
