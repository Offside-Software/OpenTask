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
    <li className="p-3 border-t-2 border-black first:border-t-0 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white font-mono font-bold text-[12px] truncate" title={upload.fileName}>
            {upload.title}
          </p>
          <p className="text-neutral-400 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5">
            {active && <Loader2 size={10} className="animate-spin" />}
            {upload.stage === "done" && <CheckCircle2 size={10} className="text-[#00FF66]" />}
            {upload.stage === "failed" && <AlertTriangle size={10} className="text-[#FF3333]" />}
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
        <p className="text-neutral-300 font-mono text-[11px]">Transcription has started. The draft tasks appear in the meeting.</p>
      )}
      {upload.error && <p className="border-2 border-black bg-[#FF3333] text-white font-mono text-[11px] p-2">{upload.error}</p>}
    </li>
  );
};

/** Recording uploads in progress, on every page. */
export const MeetingUploadTray: React.FC = () => {
  const uploads = useMeetingUploads();
  if (uploads.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[90] w-[min(22rem,calc(100vw-2rem))] bg-[#121417] border-2 border-black rounded-none shadow-[4px_4px_0px_0px_#000000]"
      role="status"
      aria-live="polite"
    >
      <div className="px-3 py-2 bg-[#FFE600] text-black border-b-2 border-black flex items-center gap-2 font-mono font-black uppercase text-[11px] tracking-wider">
        <UploadCloud size={14} strokeWidth={2.5} /> Meeting recordings
      </div>
      <ul className="max-h-[50vh] overflow-y-auto">
        {uploads.map((u) => (
          <UploadRow key={u.id} upload={u} />
        ))}
      </ul>
    </div>
  );
};
