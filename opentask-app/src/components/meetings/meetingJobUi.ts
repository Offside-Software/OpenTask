import type { MeetingJob, MeetingJobStatus, MeetingSource } from "../../models";

type BadgeVariant = "critical" | "success" | "warning" | "primary" | "default" | "outline";

export const JOB_STATUS_LABEL: Record<MeetingJobStatus, string> = {
  CREATED: "Waiting",
  QUEUED: "Queued",
  TRANSCRIBING: "Transcribing",
  GATING: "Checking",
  EXTRACTING: "Extracting",
  DRAFTS_READY: "Ready to review",
  REVIEWED: "Reviewed",
  NO_ACTIONS: "No action items",
  FAILED: "Failed",
};

export const JOB_STATUS_VARIANT: Record<MeetingJobStatus, BadgeVariant> = {
  CREATED: "outline",
  QUEUED: "default",
  TRANSCRIBING: "primary",
  GATING: "primary",
  EXTRACTING: "primary",
  DRAFTS_READY: "warning",
  REVIEWED: "success",
  NO_ACTIONS: "default",
  FAILED: "critical",
};

export const SOURCE_LABEL: Record<string, string> = {
  RECALL_BOT: "Meeting bot",
  MEDIA: "Recording",
  TEXT: "Notes",
  MANUAL: "Manual",
};

export const isJobActive = (status: MeetingJobStatus) =>
  status === "CREATED" || status === "QUEUED" || status === "TRANSCRIBING" || status === "GATING" || status === "EXTRACTING";

/** One line explaining where a job is, for the jobs list. */
export const describeJob = (job: MeetingJob & { pending_drafts?: number; total_drafts?: number }, source: MeetingSource | string) => {
  switch (job.status) {
    case "CREATED":
      return source === "RECALL_BOT"
        ? "The bot is recording. Transcription starts a minute or two after it leaves the meeting."
        : "Waiting for the upload to finish.";
    case "QUEUED":
    case "TRANSCRIBING":
    case "GATING":
    case "EXTRACTING": {
      const retryAt = job.next_attempt_at ? new Date(job.next_attempt_at) : null;
      if (retryAt && retryAt.getTime() > Date.now()) {
        return `Waiting for the AI free-tier limit; continues at ${retryAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
      }
      if (job.status === "TRANSCRIBING") return "Transcribing the recording…";
      return "Reading the meeting and drafting tasks…";
    }
    case "DRAFTS_READY":
      return `${job.pending_drafts ?? 0} of ${job.total_drafts ?? 0} draft tasks waiting for review.`;
    case "REVIEWED":
      return `Reviewed: ${job.total_drafts ?? 0} draft tasks decided.`;
    case "NO_ACTIONS":
      return job.gate?.reason
        ? `Saved without tasks. ${job.gate.reason}`
        : "Saved without tasks: no follow-up work was found.";
    case "FAILED":
      if (job.failure_reason) return job.failure_reason;
      return source === "RECALL_BOT" ? "Processing failed. Send the bot again." : "Processing failed. Try uploading again.";
  }
};

export const formatTimestamp = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined) return null;
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
