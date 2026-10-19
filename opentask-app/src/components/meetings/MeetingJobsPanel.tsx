import React from "react";
import { ListChecks, Mic, FileText, Video, AlertTriangle, RefreshCw } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Skeleton } from "../../design-system/Skeleton";
import type { MeetingJobSummary } from "../../models";
import { JOB_STATUS_LABEL, JOB_STATUS_VARIANT, SOURCE_LABEL, describeJob, isJobActive } from "./meetingJobUi";

interface MeetingJobsPanelProps {
  jobs: MeetingJobSummary[];
  loading: boolean;
  onRefresh: () => void;
  onReview: (jobId: string) => void;
}

const SourceIcon: React.FC<{ source: string }> = ({ source }) => {
  if (source === "RECALL_BOT") return <Mic size={14} strokeWidth={2.5} />;
  if (source === "MEDIA") return <Video size={14} strokeWidth={2.5} />;
  return <FileText size={14} strokeWidth={2.5} />;
};

export const MeetingJobsPanel: React.FC<MeetingJobsPanelProps> = ({ jobs, loading, onRefresh, onReview }) => {
  const needsReview = jobs.filter((j) => j.status === "DRAFTS_READY").length;

  return (
    <SurfaceCard
      title="Meeting Jobs"
      subtitle={needsReview > 0 ? `${needsReview} waiting for review` : `${jobs.length} processed meetings`}
      icon={ListChecks}
      rightElement={
        <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh meeting jobs">
          <RefreshCw size={13} strokeWidth={2.5} />
        </Button>
      }
    >
      {loading && jobs.length === 0 ? (
        <div className="space-y-3">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-neutral-400 font-mono text-[12px] py-6 text-center border-2 border-dashed border-neutral-700">
          No meetings processed yet. Send a bot or upload notes above.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const reviewable = job.status === "DRAFTS_READY";
            return (
              <li
                key={job.id}
                className={`border-2 p-3 flex flex-col md:flex-row md:items-center gap-3 ${
                  reviewable ? "border-black bg-[#181B20] shadow-[3px_3px_0px_0px_#000000]" : "border-neutral-700 bg-[#121417]"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-neutral-300">
                      <SourceIcon source={job.source_type} />
                    </span>
                    <span className="text-white font-mono font-bold text-[13px] truncate max-w-[22rem]">
                      {job.meeting_title || "Untitled meeting"}
                    </span>
                    <Badge variant={JOB_STATUS_VARIANT[job.status]}>
                      {isJobActive(job.status) && <span className="w-1.5 h-1.5 bg-current animate-pulse" />}
                      {JOB_STATUS_LABEL[job.status]}
                    </Badge>
                    {job.gate?.failed_open && (
                      <Badge variant="outline" className="normal-case">
                        <AlertTriangle size={10} /> gate skipped
                      </Badge>
                    )}
                  </div>
                  <p className="text-neutral-400 font-mono text-[11px] leading-relaxed">
                    {SOURCE_LABEL[job.source_type] ?? job.source_type} · {job.meeting_date.slice(0, 10)} ·{" "}
                    {describeJob(job, job.source_type)}
                  </p>
                </div>
                {reviewable && (
                  <Button variant="primary" size="sm" onClick={() => onReview(job.id)} className="shrink-0">
                    Review {job.pending_drafts} tasks
                  </Button>
                )}
                {job.status === "REVIEWED" && (
                  <Button variant="outline" size="sm" onClick={() => onReview(job.id)} className="shrink-0">
                    View
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceCard>
  );
};
