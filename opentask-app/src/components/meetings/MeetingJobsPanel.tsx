import React, { useState } from "react";
import { ListChecks, Mic, FileText, Video, AlertTriangle, RefreshCw, History } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Skeleton } from "../../design-system/Skeleton";
import type { MeetingJobSummary } from "../../models";
import { JOB_STATUS_LABEL, JOB_STATUS_VARIANT, SOURCE_LABEL, describeJob, isJobActive } from "./meetingJobUi";

interface MeetingJobsPanelProps {
  jobs: MeetingJobSummary[];
  loading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onReview: (jobId: string) => void;
  className?: string;
}

const SourceIcon: React.FC<{ source: string }> = ({ source }) => {
  if (source === "RECALL_BOT") return <Mic size={14} aria-label="Meeting bot" />;
  if (source === "MEDIA") return <Video size={14} aria-label="Recording" />;
  return <FileText size={14} aria-label="Notes" />;
};

const isCurrent = (job: MeetingJobSummary) => isJobActive(job.status) || job.status === "DRAFTS_READY";

const JobRow: React.FC<{ job: MeetingJobSummary; onReview: (jobId: string) => void }> = ({ job, onReview }) => {
  const reviewable = job.status === "DRAFTS_READY";
  return (
    <li
      className={`border rounded-xl p-3.5 flex flex-col md:flex-row md:items-center gap-3 transition-colors ${
        reviewable ? "border-primary/40 bg-primary/5 shadow-xs" : "border-border bg-card/60"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-muted-foreground" title={SOURCE_LABEL[job.source_type] ?? job.source_type}>
            <SourceIcon source={job.source_type} />
          </span>
          <span className="text-foreground font-semibold text-xs truncate max-w-[22rem]">
            {job.meeting_title || "Untitled meeting"}
          </span>
          <Badge variant={JOB_STATUS_VARIANT[job.status]}>
            {isJobActive(job.status) && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            {JOB_STATUS_LABEL[job.status]}
          </Badge>
          {job.gate?.failed_open && (
            <Badge variant="outline" className="normal-case">
              <AlertTriangle size={10} /> gate skipped
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {SOURCE_LABEL[job.source_type] ?? job.source_type} · {job.meeting_date.slice(0, 10)} ·{" "}
          {describeJob(job, job.source_type)}
        </p>
      </div>
      {reviewable && (
        <Button variant="primary" size="sm" onClick={() => onReview(job.id)} className="shrink-0">
          Review {job.pending_drafts} tasks
        </Button>
      )}
      {job.status === "REVIEWED" && job.total_drafts > 0 && (
        <Button variant="outline" size="sm" onClick={() => onReview(job.id)} className="shrink-0">
          View
        </Button>
      )}
    </li>
  );
};

export const MeetingJobsPanel: React.FC<MeetingJobsPanelProps> = ({ jobs, loading, isRefreshing, onRefresh, onReview, className }) => {
  const [showHistory, setShowHistory] = useState(false);
  
  const current = jobs.filter(isCurrent);
  const history = jobs.filter((j) => !isCurrent(j));
  const needsReview = current.filter((j) => j.status === "DRAFTS_READY").length;
  const running = current.length - needsReview;
  const shown = showHistory ? history : current;

  const subtitle = showHistory
    ? `${history.length} completed or failed`
    : needsReview > 0
      ? `${needsReview} waiting for review${running > 0 ? ` · ${running} processing` : ""}`
      : running > 0
        ? `${running} processing`
        : "Nothing in progress";

  return (
    <SurfaceCard
      className={className}
      title={showHistory ? "Job History" : "Meeting Jobs"}
      subtitle={subtitle}
      icon={showHistory ? History : ListChecks}
      rightElement={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            title={showHistory ? "Back to the jobs in progress" : "Show completed and failed jobs"}
          >
            <History size={13} />
            <span>{showHistory ? "Current" : `History (${history.length})`}</span>
          </Button>
          <Button 
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label="Refresh meeting jobs"
            title="Refresh"
            disabled={isRefreshing}
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin text-primary" : ""} />
            <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
          </Button>
        </div>
      }
    >
      {loading && jobs.length === 0 ? (
        <div className="space-y-3">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-xs py-8 text-center border border-dashed border-border rounded-xl">
          {showHistory
            ? "No completed or failed jobs yet."
            : history.length > 0
              ? "Nothing is being processed or waiting for review. Finished jobs are under History."
              : "No meetings processed yet. Send a bot or upload notes above."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((job) => (
            <JobRow key={job.id} job={job} onReview={onReview} />
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
};
