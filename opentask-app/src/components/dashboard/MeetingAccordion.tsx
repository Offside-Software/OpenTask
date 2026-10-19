import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { Skeleton } from '../../design-system/Skeleton';
import { TrashButton } from '../../design-system/TrashButton';
import { useToast } from '../../design-system/Toast';
import { Calendar, Clock, FileText, ChevronRight, Download, CheckCircle2, Loader2, Archive, ClipboardCheck } from 'lucide-react';

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
    if (!effectiveTarget) {
      showToast('Add a Todo or Pending column first', 'error');
      return;
    }
    const assignees = draft.assignee_ids.length > 0 ? draft.assignee_ids : draft.resolved_user_id ? [draft.resolved_user_id] : [];
    setBusyTask(draft.task_id);
    try {
      await meetingJobService.approveDrafts(jobId, [{ task_id: draft.task_id, bucket_id: effectiveTarget, assignee_ids: assignees }]);
      showToast(`Moved to ${bucketName(effectiveTarget)}`, 'success');
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
      showToast('Draft rejected and archived', 'info');
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
        const state = d.bucket_state === 'DRAFT' ? 'draft' : d.bucket_state === 'ARCHIVED' ? 'rejected' : `in ${bucketName(d.bucket_id)}`;
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
      if (legacyItems.length === 0) return <p className="text-[12px] text-neutral-400">No action items were recorded.</p>;
      return (
        <div className="space-y-2">
          {legacyItems.map((act, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-none bg-[#181B20] border-2 border-black">
              <span className="text-[12px] font-bold text-white">{act.task}</span>
              {act.deadline && <span className="text-[10px] text-neutral-400 flex items-center gap-1"><Clock size={11} /> {act.deadline}</span>}
            </div>
          ))}
        </div>
      );
    }
    if (!reviewable) {
      return (
        <p className="text-[12px] text-neutral-400 flex items-center gap-2">
          {isJobActive(job.status) && <Loader2 size={12} className="animate-spin shrink-0" />}
          {isJobActive(job.status) ? 'Tasks appear here once the meeting is processed. ' : ''}
          {describeJob(job, job.source_type)}
        </p>
      );
    }
    if (draftsError) return <p className="border-2 border-black bg-[#FF3333] text-white text-[12px] p-2.5">{draftsError}</p>;
    if (!drafts) {
      return (
        <div className="space-y-2">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      );
    }
    if (drafts.length === 0) return <p className="text-[12px] text-neutral-400">No draft tasks are left for this meeting.</p>;
    return (
      <div className="space-y-2.5">
        {drafts.map(d => {
          const who = memberName(d.lead_assignee_id) ?? memberName(d.resolved_user_id) ?? (d.assignee_hint ? `“${d.assignee_hint}”` : null);
          const isDraft = d.bucket_state === 'DRAFT';
          const busy = busyTask === d.task_id;
          return (
            <div key={d.task_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-none bg-[#181B20] border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <div className="min-w-0">
                <span className="block text-[12px] font-bold text-white">{d.title}</span>
                <span className="text-[10px] text-neutral-400 flex items-center gap-2 flex-wrap mt-0.5">
                  {who && <span>{who}</span>}
                  {d.due_date && <span className="flex items-center gap-1"><Clock size={11} /> {d.due_date}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isDraft ? (
                  <>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void reject(d)} aria-label={`Reject ${d.title}`}>
                      <Archive size={12} /> Reject
                    </Button>
                    <Button variant="success" size="sm" disabled={busy} onClick={() => void accept(d)} aria-label={`Accept ${d.title} into ${bucketName(effectiveTarget)}`}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
                    </Button>
                  </>
                ) : d.bucket_state === 'ARCHIVED' ? (
                  <Badge variant="outline">Rejected</Badge>
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
    <div className="mt-4 rounded-none border-2 border-black bg-[#0C0D0E] overflow-hidden shadow-[4px_4px_0px_0px_#000000] select-none">
       <div
         className="group p-5 flex justify-between items-center gap-4 bg-[#141619] cursor-pointer hover:bg-[#1A1D22] transition-colors"
         onClick={() => setIsExpanded(!isExpanded)}
       >
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h4 className="text-[17px] font-mono font-black uppercase tracking-wide text-white">{title}</h4>
              <Badge variant="primary" className="font-mono text-[9px] uppercase">{SOURCE_LABEL[meeting.source_type] ?? meeting.source_type}</Badge>
              {job && (
                <Badge variant={JOB_STATUS_VARIANT[job.status]} className="font-mono text-[9px]">
                  {isJobActive(job.status) && <span className="w-1.5 h-1.5 bg-current animate-pulse" />}
                  {job.status === 'DRAFTS_READY' && job.pending_drafts > 0 ? `${job.pending_drafts} to review` : JOB_STATUS_LABEL[job.status]}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-neutral-400 font-medium flex-wrap">
               {meetingDate && <span className="flex items-center gap-1.5"><Calendar size={13} /> {meetingDate}</span>}
               {(meeting.time || duration) && (
                 <span className="flex items-center gap-1.5"><Clock size={13} /> {[meeting.time, duration].filter(Boolean).join(' • ')}</span>
               )}
            </div>
          </div>
          <div className="flex gap-2 items-center shrink-0" onClick={e => e.stopPropagation()}>
             {job && WITH_TRANSCRIPT.has(job.status) && onTranscript && (
               <Button variant="white" size="sm" onClick={() => onTranscript(job.id)} title="Read the transcript the tasks came from">
                 <FileText size={13} strokeWidth={2.5} /> Transcript
               </Button>
             )}
             {onDelete && <TrashButton onClick={onDelete} aria-label={`Delete ${title}`} />}
             <button
               type="button"
               onClick={() => setIsExpanded(!isExpanded)}
               aria-expanded={isExpanded}
               aria-label={isExpanded ? 'Collapse meeting' : 'Expand meeting'}
               title={isExpanded ? 'Collapse' : 'Show minutes and action items'}
               className="w-8 h-8 rounded-none bg-[#1F2937] border-2 border-black text-neutral-300 flex items-center justify-center hover:bg-[#FFE600] hover:text-black shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer"
             >
               <ChevronRight size={16} strokeWidth={3} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
             </button>
          </div>
       </div>

       {isExpanded && (
         <div className="p-6 bg-[#121417] border-t-2 border-black">
            <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-neutral-800">
               <h5 className="text-[#22C55E] font-mono text-[11px] font-black uppercase tracking-widest">// MINUTES OF MEETING</h5>
               <Button variant="ghost" size="sm" onClick={downloadMinutes} title="Download the minutes as a Markdown file">
                 <Download size={13} /> Download
               </Button>
            </div>

            <div className="space-y-6 font-mono">
               {summaryLines.length > 0 && (
                 <section>
                    <h6 className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest mb-3">// KEY POINTS DISCUSSED</h6>
                    <ul className="space-y-2.5 pl-1">
                       {summaryLines.map((pt, i) => (
                         <li key={i} className="text-[12px] text-neutral-300 flex items-start gap-2.5">
                           <span className="text-[#FFE600] font-black">→</span>
                           <span className="leading-relaxed">{pt}</span>
                         </li>
                       ))}
                    </ul>
                 </section>
               )}

               {decisions.length > 0 && (
                 <section>
                    <h6 className="text-[#22C55E] text-[10px] font-black uppercase tracking-widest mb-3">// DECISIONS MADE</h6>
                    <div className="space-y-2">
                       {decisions.map((d: string, i: number) => (
                         <div key={i} className="flex items-center gap-2.5 text-[12px] text-neutral-300">
                           <CheckCircle2 className="text-[#22C55E] shrink-0" size={14} strokeWidth={3} /> {d}
                         </div>
                       ))}
                    </div>
                 </section>
               )}

               <section>
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <h6 className="text-[#F59E0B] text-[10px] font-black uppercase tracking-widest">// ACTION ITEMS</h6>
                    {reviewable && pendingDrafts.length > 0 && (
                      <div className="flex items-center gap-2">
                        {targetBuckets.length > 1 && (
                          <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 uppercase tracking-wider">
                            Accept into
                            <select
                              value={effectiveTarget}
                              onChange={e => setTargetBucketId(e.target.value)}
                              className="bg-[#0B0E14] border-2 border-neutral-700 rounded-none px-2 py-1 text-white font-mono text-[11px] focus:outline-none focus:border-[#FFE600]"
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
