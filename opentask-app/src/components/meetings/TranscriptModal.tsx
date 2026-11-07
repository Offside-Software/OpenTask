import React, { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { CloseButton } from "../../design-system/CloseButton";
import { Skeleton } from "../../design-system/Skeleton";
import type { TranscriptSegment } from "../../models";
import { meetingJobService } from "../../services/meetingJobService";
import { formatTimestamp } from "./meetingJobUi";

interface TranscriptModalProps {
  jobId: string;
  title: string;
  onClose: () => void;
}

export const TranscriptModal: React.FC<TranscriptModalProps> = ({ jobId, title, onClose }) => {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .getTranscript(jobId)
      .then((data) => {
        if (cancelled) return;
        setSegments(data.segments);
        setLanguage(data.language ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Could not load the transcript");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-100" onClick={onClose}>
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
      >
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 bg-card">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <h2 id="transcript-title" className="text-foreground font-semibold text-base">
                Transcript
              </h2>
              <p className="text-muted-foreground text-xs mt-0.5 truncate">
                {title}
                {segments ? ` · ${segments.length} segments` : ""}
                {language ? ` · ${language}` : ""}
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} aria-label="Close transcript" />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="border border-destructive/20 bg-destructive/10 text-destructive text-xs rounded-lg p-3">{error}</div>}
          {!segments && !error && (
            <div className="space-y-2">
              <Skeleton height={20} />
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          )}
          {segments && segments.length === 0 && (
            <p className="text-muted-foreground text-xs text-center py-6">No speech was found in this recording.</p>
          )}
          {segments && segments.length > 0 && (
            <ol className="space-y-2">
              {segments.map((s) => {
                const ts = formatTimestamp(s.start_sec);
                return (
                  <li key={s.index} className="text-xs leading-relaxed text-muted-foreground flex gap-2">
                    {ts && <span className="text-primary font-medium shrink-0">[{ts}]</span>}
                    <span>
                      {s.speaker && <span className="text-foreground font-medium mr-1.5">{s.speaker}:</span>}
                      <span className="whitespace-pre-wrap">{s.text}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};
