import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { Skeleton } from '../../design-system/Skeleton';
import { TrashButton } from '../../design-system/TrashButton';
import { useToast } from '../../design-system/Toast';
import { Calendar, Clock, FileText, ChevronRight, Download, CheckCircle2, Loader2, Trash2, ClipboardCheck } from 'lucide-react';

import type { Bucket, Meeting, MeetingDraftTask, MeetingJobSummary, ProjectMember } from '../../models';
import { meetingJobService } from '../../services/meetingJobService';
import { JOB_STATUS_LABEL, JOB_STATUS_VARIANT, SOURCE_LABEL, describeJob, isJobActive } from '../meetings/meetingJobUi';

interface MeetingProps {
  meeting: Meeting;
  job?: MeetingJobSummary;
  buckets: Bucket[];
  members: ProjectMember[];
  isDefaultExpanded?: boolean;
  refreshSignal?: string;
  onReview?: (jobId: string) => void;
  onTranscript?: (jobId: string) => void;
  onDraftsChanged?: () => void;
  onDelete?: () => void;
}

const WITH_TRANSCRIPT = new Set(['EXTRACTING', 'DRAFTS_READY', 'REVIEWED', 'NO_ACTIONS']);

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meeting';

export const MeetingAccordion: React.FC<MeetingProps> = ({
  meeting,
  job,
  buckets,
  members,
  isDefaultExpanded = false,
  refreshSignal,
  onReview,
  onTranscript,
  onDraftsChanged,
  onDelete,
}) => {
  const [isExpanded, setIsExpanded] = useState(isDefaultExpanded);
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<MeetingDraftTask[] | null>(null);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const targetBuckets = useMemo(() => buckets.filter(b => b.state === 'TODO' || b.state === 'PENDING'), [buckets]);
  const [targetBucketId, setTargetBucketId] = useState('');
  const effectiveTarget = targetBucketId || String(targetBuckets.find(b => b.state === 'TODO')?.id ?? targetBuckets[0]?.id ?? '');

  const reviewable = job?.status === 'DRAFTS_READY' || job?.status === 'REVIEWED';
  const jobId = job?.id;
  const jobStatus = job?.status;
  const pendingCount = job?.pending_drafts;

  useEffect(() => {
    if (!isExpanded || !jobId || !reviewable) return;
    let cancelled = false;
    meetingJobService
      .getJob(jobId)
      .then(detail => {
        if (cancelled) return;
        setDrafts(detail.drafts);
        setDraftsError(null);
      })
      .catch(err => {
        if (!cancelled) setDraftsError((err as Error).message || 'Could not load the action items');
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, jobId, reviewable, jobStatus, pendingCount, refreshSignal, reloadTick]);

  const memberName = (userId?: string | null) => {
    if (!userId) return null;
    const m = members.find(x => String(x.user_id) === String(userId));
    return m ? m.display_name || m.gh_username || 'Member' : null;
  };
  const bucketName = (bucketId?: string | null) =>
    buckets.find(b => String(b.id) === String(bucketId))?.name ?? 'the board';

  const afterDecision = () => {
    setReloadTick(t => t + 1);
    onDraftsChanged?.();
  };

  const accept = async (draft: MeetingDraftTask) => {
    if (!jobId) return;
    const assignees = draft.assignee_ids.length > 0 ? draft.assignee_ids : draft.resolved_user_id ? [draft.resolved_user_id] : [];
    setBusyTask(draft.task_id);
    try {
      // No Todo/Pending column yet: the server makes a Todo column.
      await meetingJobService.approveDrafts(jobId, [{ task_id: draft.task_id, bucket_id: effectiveTarget || undefined, assignee_ids: assignees }]);
      showToast(effectiveTarget ? `Moved to ${bucketName(effectiveTarget)}` : 'Moved to a new Todo column', 'success');
      afterDecision();
    } catch (err) {
      showToast((err as Error).message || 'Could not accept the task', 'error');
    } finally {
      setBusyTask(null);
    }
  };

  const reject = async (draft: MeetingDraftTask) => {
    if (!jobId) return;
    setBusyTask(draft.task_id);
    try {
      await meetingJobService.rejectDrafts(jobId, [draft.task_id]);
      showToast('Draft rejected and deleted', 'info');
      afterDecision();
    } catch (err) {
      showToast((err as Error).message || 'Could not reject the draft', 'error');
    } finally {
      setBusyTask(null);
    }
  };

  const summaryLines = (meeting.mom_summary ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const decisions = Array.isArray(meeting.key_decisions) ? meeting.key_decisions.filter(Boolean) : [];
  const legacyItems = Array.isArray(meeting.action_items) ? meeting.action_items : [];
  const pendingDrafts = drafts?.filter(d => d.bucket_state === 'DRAFT') ?? [];

  const meetingDate = job?.meeting_date?.slice(0, 10) ?? meeting.date ?? meeting.created_at?.slice(0, 10) ?? '';
  const duration = formatDuration(job?.duration_sec) ?? meeting.duration;
  const title = meeting.title || 'Untitled meeting';

  const downloadMinutes = () => {
    const lines = [`# ${title}`, '', `Date: ${meetingDate}`, ''];
    if (summaryLines.length) lines.push('## Summary', '', ...summaryLines.map(l => `- ${l}`), '');
    if (decisions.length) lines.push('## Decisions', '', ...decisions.map(d => `- ${d}`), '');
    if (drafts && drafts.length) {
      lines.push('## Action items', '');
      for (const d of drafts) {
        const who = memberName(d.lead_assignee_id) ?? memberName(d.resolved_user_id) ?? d.assignee_hint;
        const state = d.bucket_state === 'DRAFT' ? 'draft' : `in ${bucketName(d.bucket_id)}`;
        lines.push(`- ${d.title}${who ? ` (${who})` : ''}${d.due_date ? `, due ${d.due_date}` : ''} [${state}]`);
      }
      lines.push('');
    } else if (legacyItems.length) {
      lines.push('## Action items', '', ...legacyItems.map(a => `- ${a.task}${a.deadline ? `, due ${a.deadline}` : ''}`), '');
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug(title)}-minutes.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderActionItems = () => {
    if (!job) {
      if (legacyItems.length === 0) return <p className="text-xs text-muted-foreground">No action items were recorded.</p>;
      return (
        <div className="space-y-2">
          {legacyItems.map((act, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              <span className="text-xs font-medium text-foreground">{act.task}</span>
              {act.deadline && <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock size={11} /> {act.deadline}</span>}
            </div>
          ))}
        </div>
      );
    }
    if (!reviewable) {
      return (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          {isJobActive(job.status) && <Loader2 size={12} className="animate-spin shrink-0" />}
          {isJobActive(job.status) ? 'Tasks appear here once the meeting is processed. ' : ''}
          {describeJob(job, job.source_type)}
        </p>
      );
    }
    if (draftsError) return <div className="border border-destructive/20 bg-destructive/10 text-destructive text-xs rounded-lg p-2.5">{draftsError}</div>;
    if (!drafts) {
      return (
        <div className="space-y-2">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      );
    }
    if (drafts.length === 0) return <p className="text-xs text-muted-foreground">No draft tasks are left for this meeting.</p>;
    return (
      <div className="space-y-2">
        {drafts.map(d => {
          const who = memberName(d.lead_assignee_id) ?? memberName(d.resolved_user_id) ?? (d.assignee_hint ? `“${d.assignee_hint}”` : null);
          const isDraft = d.bucket_state === 'DRAFT';
          const busy = busyTask === d.task_id;
          return (
            <div key={d.task_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border shadow-xs">
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">{d.title}</span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                  {who && <span>{who}</span>}
                  {d.due_date && <span className="flex items-center gap-1"><Clock size={11} /> {d.due_date}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isDraft ? (
                  <>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void reject(d)} aria-label={`Reject ${d.title}`}>
                      <Trash2 size={12} /> Reject
                    </Button>
                    <Button variant="success" size="sm" disabled={busy} onClick={() => void accept(d)} aria-label={`Accept ${d.title} into ${effectiveTarget ? bucketName(effectiveTarget) : 'a new Todo column'}`}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
                    </Button>
                  </>
                ) : (
                  <Badge variant="success">In {bucketName(d.bucket_id)}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden shadow-xs select-none">
       <div
         className="group p-4 sm:p-5 flex justify-between items-center gap-4 bg-card cursor-pointer hover:bg-muted/40 transition-colors"
         onClick={() => setIsExpanded(!isExpanded)}
       >
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <h4 className="text-base font-semibold text-foreground">{title}</h4>
              <Badge variant="accent" className="text-[9px]">{SOURCE_LABEL[meeting.source_type] ?? meeting.source_type}</Badge>
              {job && (
                <Badge variant={JOB_STATUS_VARIANT[job.status]} className="text-[9px]">
                  {isJobActive(job.status) && <span className="w-1.5 h-1.5 bg-current animate-pulse rounded-full mr-1" />}
                  {job.status === 'DRAFTS_READY' && job.pending_drafts > 0 ? `${job.pending_drafts} to review` : JOB_STATUS_LABEL[job.status]}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
               {meetingDate && <span className="flex items-center gap-1"><Calendar size={12} /> {meetingDate}</span>}
               {(meeting.time || duration) && (
                 <span className="flex items-center gap-1"><Clock size={12} /> {[meeting.time, duration].filter(Boolean).join(' • ')}</span>
               )}
            </div>
          </div>
          <div className="flex gap-2 items-center shrink-0" onClick={e => e.stopPropagation()}>
             {job && WITH_TRANSCRIPT.has(job.status) && onTranscript && (
               <Button variant="outline" size="sm" onClick={() => onTranscript(job.id)} title="Read the transcript the tasks came from">
                 <FileText size={13} /> Transcript
               </Button>
             )}
             {onDelete && <TrashButton onClick={onDelete} aria-label={`Delete ${title}`} />}
             <button
               type="button"
               onClick={() => setIsExpanded(!isExpanded)}
               aria-expanded={isExpanded}
               aria-label={isExpanded ? 'Collapse meeting' : 'Expand meeting'}
               title={isExpanded ? 'Collapse' : 'Show minutes and action items'}
               className="w-7 h-7 rounded-md border border-border bg-card text-muted-foreground flex items-center justify-center hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
             >
               <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
             </button>
          </div>
       </div>

       {isExpanded && (
         <div className="p-5 sm:p-6 bg-card border-t border-border">
            <div className="flex justify-between items-center mb-5 pb-2 border-b border-border">
               <h5 className="text-primary text-xs font-semibold uppercase tracking-wider">Minutes of Meeting</h5>
               <Button variant="ghost" size="sm" onClick={downloadMinutes} title="Download the minutes as a Markdown file">
                 <Download size={13} /> Download
               </Button>
            </div>

            <div className="space-y-5">
               {summaryLines.length > 0 && (
                 <section>
                    <h6 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Key Points Discussed</h6>
                    <ul className="space-y-1.5 pl-1">
                       {summaryLines.map((pt, i) => (
                         <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                           <span className="text-primary font-bold">→</span>
                           <span className="leading-relaxed">{pt}</span>
                         </li>
                       ))}
                    </ul>
                 </section>
               )}

               {decisions.length > 0 && (
                 <section>
                    <h6 className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Decisions Made</h6>
                    <div className="space-y-1.5">
                       {decisions.map((d: string, i: number) => (
                         <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                           <CheckCircle2 className="text-emerald-500 shrink-0" size={13} /> {d}
                         </div>
                       ))}
                    </div>
                 </section>
               )}

               <section>
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <h6 className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Action Items</h6>
                    {reviewable && pendingDrafts.length > 0 && (
                      <div className="flex items-center gap-2">
                        {targetBuckets.length > 1 && (
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>Accept into</span>
                            <select
                              value={effectiveTarget}
                              onChange={e => setTargetBucketId(e.target.value)}
                              className="bg-background border border-input rounded-md px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              {targetBuckets.map(b => <option key={String(b.id)} value={String(b.id)}>{b.name}</option>)}
                            </select>
                          </label>
                        )}
                        {jobId && onReview && (
                          <Button variant="primary" size="sm" onClick={() => onReview(jobId)} title="Edit titles, assignees and dates before accepting">
                            <ClipboardCheck size={12} /> Review &amp; edit
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {renderActionItems()}
               </section>
            </div>
         </div>
       )}
    </div>
  );
};
