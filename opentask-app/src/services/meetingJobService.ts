import { apiFetch } from "./apiClient";
import type {
  ApproveDraftItem,
  DraftReviewResult,
  MeetingIntake,
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
