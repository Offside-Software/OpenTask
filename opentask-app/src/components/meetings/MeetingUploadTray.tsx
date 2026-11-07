import React from "react";
import { CheckCircle2, Loader2, UploadCloud, AlertTriangle } from "lucide-react";
import { Button } from "../../design-system/Button";
import { CloseButton } from "../../design-system/CloseButton";
import { ProgressBar } from "../../design-system/ProgressBar";
import {
  cancelMeetingUpload,
  dismissMeetingUpload,
  useMeetingUploads,
  type MeetingUpload,
} from "../../services/meetingUploads";

const STAGE_LABEL: Record<MeetingUpload["stage"], string> = {
  extracting: "Extracting audio",
  uploading: "Uploading",
  finishing: "Checking the upload",
  done: "Uploaded",
  failed: "Failed",
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const UploadRow: React.FC<{ upload: MeetingUpload }> = ({ upload }) => {
  const active = upload.stage === "extracting" || upload.stage === "uploading" || upload.stage === "finishing";
  const percent = Math.round(upload.progress * 100);
  return (
    <li className="p-3 border-t border-border first:border-t-0 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground font-semibold text-xs truncate" title={upload.fileName}>
            {upload.title}
          </p>
          <p className="text-muted-foreground text-[11px] flex items-center gap-1.5 mt-0.5">
            {active && <Loader2 size={11} className="animate-spin text-primary" />}
            {upload.stage === "done" && <CheckCircle2 size={11} className="text-emerald-500" />}
            {upload.stage === "failed" && <AlertTriangle size={11} className="text-destructive" />}
            {STAGE_LABEL[upload.stage]}
            {upload.stage === "uploading" && ` · ${formatSize(upload.bytes)}${upload.extracted ? " of audio" : ""}`}
          </p>
        </div>
        {active ? (
          <Button variant="outline" size="sm" onClick={() => void cancelMeetingUpload(upload.id)} aria-label={`Cancel uploading ${upload.title}`}>
            Cancel
          </Button>
        ) : (
          <CloseButton size="sm" onClick={() => dismissMeetingUpload(upload.id)} aria-label="Dismiss" />
        )}
      </div>
      {(upload.stage === "extracting" || upload.stage === "uploading") && (
        <ProgressBar value={percent} label={upload.stage === "extracting" ? "Audio" : "Sent"} />
      )}
      {upload.stage === "done" && (
        <p className="text-muted-foreground text-xs">Transcription has started. The draft tasks appear in the meeting.</p>
      )}
      {upload.error && <p className="rounded-lg border border-destructive/30 bg-destructive/15 text-destructive text-xs p-2 font-medium">{upload.error}</p>}
    </li>
  );
};

/** Recording uploads in progress, on every page. */
export const MeetingUploadTray: React.FC = () => {
  const uploads = useMeetingUploads();
  if (uploads.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[90] w-[min(22rem,calc(100vw-2rem))] bg-card text-card-foreground border border-border rounded-xl shadow-lg overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <div className="px-3.5 py-2.5 bg-primary/10 text-primary border-b border-border flex items-center gap-2 font-medium text-xs">
        <UploadCloud size={14} /> Meeting recordings
      </div>
      <ul className="max-h-[50vh] overflow-y-auto">
        {uploads.map((u) => (
          <UploadRow key={u.id} upload={u} />
        ))}
      </ul>
    </div>
  );
};
