import React, { useEffect, useMemo, useRef, useState } from "react";
import { Video } from "lucide-react";
import type { Bucket, Meeting, MeetingJobSummary, ProjectMember } from "../../models";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Skeleton } from "../../design-system/Skeleton";
import { meetingJobService } from "../../services/meetingJobService";
import { useMeetingUploads } from "../../services/meetingUploads";
import { MeetingIntakePanel } from "../meetings/MeetingIntakePanel";
import { MeetingJobsPanel } from "../meetings/MeetingJobsPanel";
import { DraftReviewModal } from "../meetings/DraftReviewModal";
import { TranscriptModal } from "../meetings/TranscriptModal";
import { isJobActive } from "../meetings/meetingJobUi";
import { MeetingAccordion } from "./MeetingAccordion";

interface MeetingIntelligenceTabProps {
  projectId: string | number;
  members: ProjectMember[];
  buckets: Bucket[];
  refreshKey?: number;
  initialJobId?: string | null;
  onReviewClosed?: () => void;
  meetings: Meeting[];
  meetingsLoading: boolean;
  onMeetingChanged: (meetingId: string) => void;
  onMeetingsChanged: () => void;
  onDeleteMeeting: (meetingId: string | number) => Promise<void> | void;
}

const FALLBACK_REFRESH_MS = 20_000;

const jobFingerprint = (job: MeetingJobSummary) => `${job.status}:${job.pending_drafts}:${job.total_drafts}`;

export const MeetingIntelligenceTab: React.FC<MeetingIntelligenceTabProps> = ({
  projectId,
  members,
  buckets,
  refreshKey = 0,
  initialJobId,
  onReviewClosed,
  meetings,
  meetingsLoading,
  onMeetingChanged,
  onMeetingsChanged,
  onDeleteMeeting,
}) => {
  const [jobs, setJobs] = useState<MeetingJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [transcriptFor, setTranscriptFor] = useState<{ jobId: string; title: string } | null>(null);
  
  const reviewTarget = reviewJobId ?? initialJobId ?? null;
  const seenJobs = useRef<Map<string, string> | null>(null);
  const reload = () => {
    setIsRefreshingHistory(true);
    setReloadTick((t) => t + 1);
    setIsRefreshingHistory(false);
  };

  // A recording's job only exists once its upload starts; reload when an upload here gets or finishes one.
  const uploads = useMeetingUploads();
  const uploadSignal = uploads
    .filter((u) => u.projectId === String(projectId) && u.jobId)
    .map((u) => `${u.jobId}:${u.stage}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .listJobs(projectId)
      .then((data) => {
        if (cancelled) return;
        setJobs(data);
        const previous = seenJobs.current;
        seenJobs.current = new Map(data.map((j) => [j.id, jobFingerprint(j)]));
        if (previous === null) {
          onMeetingsChanged();
          return;
        }
        const changed = new Set(data.filter((j) => previous.get(j.id) !== jobFingerprint(j)).map((j) => j.meeting_id));
        changed.forEach((meetingId) => onMeetingChanged(meetingId));
      })
      .catch((err) => console.error("Failed to load meeting jobs", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, reloadTick, pollTick, uploadSignal, onMeetingChanged, onMeetingsChanged]);

  const hasActiveJob = jobs.some((job) => isJobActive(job.status));
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = setInterval(() => setPollTick((t) => t + 1), FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasActiveJob]);

  const latestJob = useMemo(() => {
    const byMeeting = new Map<string, MeetingJobSummary>();
    for (const job of jobs) {
      if (!byMeeting.has(String(job.meeting_id))) byMeeting.set(String(job.meeting_id), job);
    }
    return byMeeting;
  }, [jobs]);
  
  const refreshSignal = `${refreshKey}:${reloadTick}`;

  const closeReview = () => {
    setReviewJobId(null);
    onReviewClosed?.();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-6">
        <MeetingIntakePanel className="col-span-3" projectId={projectId} members={members} onSubmitted={reload} />
        <MeetingJobsPanel className="col-span-2" jobs={jobs} loading={loading} isRefreshing={isRefreshingHistory} onRefresh={reload} onReview={setReviewJobId} />
      </div>

      <SurfaceCard title="Historical Meetings" subtitle={`${meetings.length} Past Sessions`} icon={Video} rightElement={null}>
        {meetingsLoading && meetings.length === 0 ? (
          <div className="space-y-3">
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        ) : meetings.length === 0 ? (
          <div className="text-neutral-400 font-mono text-[12px] text-center py-12 border-2 border-dashed border-neutral-700">
            No meeting history.
          </div>
        ) : (
          <div className="space-y-4">
            {meetings.map((mtg, idx) => (
              <MeetingAccordion
                key={String(mtg.id)}
                meeting={mtg}
                job={latestJob.get(String(mtg.id))}
                buckets={buckets}
                members={members}
                isDefaultExpanded={idx === 0}
                refreshSignal={refreshSignal}
                onReview={setReviewJobId}
                onTranscript={(jobId) => setTranscriptFor({ jobId, title: mtg.title || "Meeting" })}
                onDraftsChanged={reload}
                onDelete={async () => {
                  await onDeleteMeeting(mtg.id!);
                  reload();
                }}
              />
            ))}
          </div>
        )}
      </SurfaceCard>

      {reviewTarget && (
        <DraftReviewModal
          key={reviewTarget}
          jobId={reviewTarget}
          members={members}
          buckets={buckets}
          onClose={closeReview}
          onChanged={reload}
        />
      )}
      {transcriptFor && (
        <TranscriptModal jobId={transcriptFor.jobId} title={transcriptFor.title} onClose={() => setTranscriptFor(null)} />
      )}
    </div>
  );
};
