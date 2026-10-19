import React, { useEffect, useState } from "react";
import type { Bucket, MeetingJobSummary, ProjectMember } from "../../models";
import { meetingJobService } from "../../services/meetingJobService";
import { MeetingIntakePanel } from "../meetings/MeetingIntakePanel";
import { MeetingJobsPanel } from "../meetings/MeetingJobsPanel";
import { DraftReviewModal } from "../meetings/DraftReviewModal";
import { isJobActive } from "../meetings/meetingJobUi";

interface MeetingIntelligenceTabProps {
  projectId: string | number;
  members: ProjectMember[];
  buckets: Bucket[];
  refreshKey?: number;
  initialJobId?: string | null;
  onReviewClosed?: () => void;
  onMeetingsChanged?: () => void;
}

const FALLBACK_REFRESH_MS = 20_000;

export const MeetingIntelligenceTab: React.FC<MeetingIntelligenceTabProps> = ({
  projectId,
  members,
  buckets,
  refreshKey = 0,
  initialJobId,
  onReviewClosed,
  onMeetingsChanged,
}) => {
  const [jobs, setJobs] = useState<MeetingJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const reviewTarget = reviewJobId ?? initialJobId ?? null;
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .listJobs(projectId)
      .then((data) => {
        if (cancelled) return;
        setJobs(data);
        if (refreshKey > 0) onMeetingsChanged?.();
      })
      .catch((err) => console.error("Failed to load meeting jobs", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, reloadTick, onMeetingsChanged]);

  const hasActiveJob = jobs.some((job) => isJobActive(job.status));
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = setInterval(() => setReloadTick((t) => t + 1), FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasActiveJob]);

  const closeReview = () => {
    setReviewJobId(null);
    onReviewClosed?.();
  };

  return (
    <div className="space-y-6">
      <MeetingIntakePanel
        projectId={projectId}
        members={members}
        onSubmitted={() => {
          reload();
          onMeetingsChanged?.();
        }}
      />
      <MeetingJobsPanel jobs={jobs} loading={loading} onRefresh={reload} onReview={setReviewJobId} />
      {reviewTarget && (
        <DraftReviewModal
          key={reviewTarget}
          jobId={reviewTarget}
          members={members}
          buckets={buckets}
          onClose={closeReview}
          onChanged={() => {
            reload();
            onMeetingsChanged?.();
          }}
        />
      )}
    </div>
  );
};
