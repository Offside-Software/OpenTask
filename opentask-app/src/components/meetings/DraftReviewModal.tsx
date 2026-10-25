import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Quote, Trash2 } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { CloseButton } from "../../design-system/CloseButton";
import { Skeleton } from "../../design-system/Skeleton";
import { useToast } from "../../design-system/Toast";
import type { Bucket, MeetingDraftTask, MeetingJobDetail, ProjectMember, TranscriptSegment } from "../../models";
import { meetingJobService } from "../../services/meetingJobService";
import { getAllTaskTypes } from "../../utils/taskTypes";
import { formatTimestamp } from "./meetingJobUi";

interface DraftReviewModalProps {
  jobId: string;
  members: ProjectMember[];
  buckets: Bucket[];
  onClose: () => void;
  onChanged: () => void;
}

interface DraftEdit {
  title: string;
  description: string;
  type: string;
  weight: string;
  assignee: string;
  bucketId: string;
  dueDate: string;
  priority: string;
}

const CONFIDENCE_VARIANT = { high: "success", medium: "warning", low: "outline" } as const;

const inputClass =
  "w-full bg-[#0B0E14] border-2 border-neutral-700 rounded-none px-2.5 py-1.5 text-white font-mono text-[12px] focus:outline-none focus:border-[#FFE600]";
const labelClass = "block text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-wider mb-1";

export const DraftReviewModal: React.FC<DraftReviewModalProps> = ({ jobId, members, buckets, onClose, onChanged }) => {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<MeetingJobDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null);
  const [contextFor, setContextFor] = useState<string | null>(null);

  const targetBuckets = useMemo(
    () => buckets.filter((b) => b.state === "TODO" || b.state === "PENDING"),
    [buckets],
  );
  const defaultBucketId = String(targetBuckets.find((b) => b.state === "TODO")?.id ?? targetBuckets[0]?.id ?? "");

  const applyDetail = useCallback(
    (data: MeetingJobDetail) => {
      setDetail(data);
      setLoadError(null);
      setEdits((prev) => {
        const next = { ...prev };
        for (const d of data.drafts) {
          next[d.task_id] ??= {
            title: d.title,
            description: d.description ?? "",
            type: (d.type ?? "OTHER").toUpperCase(),
            weight: String(d.weight ?? 3),
            assignee: d.resolved_user_id ?? "",
            bucketId: defaultBucketId,
            dueDate: d.due_date ?? "",
            priority: d.priority ?? "",
          };
        }
        return next;
      });
      setSelected((prev) => {
        const pending = data.drafts.filter((d) => d.bucket_state === "DRAFT").map((d) => d.task_id);
        return prev.size === 0 ? new Set(pending) : new Set(pending.filter((id) => prev.has(id)));
      });
    },
    [defaultBucketId],
  );

  const load = async () => {
    try {
      applyDetail(await meetingJobService.getJob(jobId));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .getJob(jobId)
      .then((data) => {
        if (!cancelled) applyDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, applyDetail]);

  const pending = detail?.drafts.filter((d) => d.bucket_state === "DRAFT") ?? [];
  const decided = detail?.drafts.filter((d) => d.bucket_state !== "DRAFT") ?? [];

  const update = (taskId: string, patch: Partial<DraftEdit>) =>
    setEdits((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...patch } }));

  const toggle = (taskId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const finish = async (pendingLeft: number) => {
    onChanged();
    if (pendingLeft === 0) {
      showToast("Review complete", "success");
      onClose();
    } else {
      await load();
    }
  };

  const approve = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    const missingTitle = taskIds.find((id) => !edits[id]?.title.trim());
    if (missingTitle) {
      showToast("Every approved task needs a title", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await meetingJobService.approveDrafts(
        jobId,
        taskIds.map((id) => {
          const e = edits[id];
          return {
            task_id: id,
            title: e.title.trim(),
            description: e.description,
            type: e.type,
            weight: Number(e.weight) || undefined,
            bucket_id: e.bucketId || undefined,
            assignee_ids: e.assignee ? [e.assignee] : [],
            due_date: e.dueDate,
            priority: e.priority,
          };
        }),
      );
      showToast(`${taskIds.length} task${taskIds.length === 1 ? "" : "s"} added to the board`, "success");
      await finish(result.pending_drafts);
    } catch (err) {
      showToast((err as Error).message || "Could not approve the tasks", "error");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    setBusy(true);
    try {
      const result = await meetingJobService.rejectDrafts(jobId, taskIds);
      showToast(`${taskIds.length} draft${taskIds.length === 1 ? "" : "s"} rejected and deleted`, "info");
      await finish(result.pending_drafts);
    } catch (err) {
      showToast((err as Error).message || "Could not reject the drafts", "error");
    } finally {
      setBusy(false);
    }
  };

  const showContext = async (draft: MeetingDraftTask) => {
    if (contextFor === draft.task_id) {
      setContextFor(null);
      return;
    }
    if (!transcript) {
      try {
        const data = await meetingJobService.getTranscript(jobId);
        setTranscript(data.segments);
      } catch (err) {
        showToast((err as Error).message || "Could not load the transcript", "error");
        return;
      }
    }
    setContextFor(draft.task_id);
  };

  const memberName = (userId?: string | null) => {
    const m = members.find((x) => String(x.user_id) === String(userId));
    return m ? m.display_name || m.gh_username || "Member" : null;
  };

  const selectedPending = pending.map((d) => d.task_id).filter((id) => selected.has(id));

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-100" onClick={onClose}>
      <div
        className="bg-[#121417] border-2 border-black rounded-none w-full max-w-4xl max-h-[90vh] flex flex-col shadow-[8px_8px_0px_0px_#000000]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-review-title"
      >
        <div className="p-5 border-b-2 border-black flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <ClipboardCheck size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h2 id="draft-review-title" className="text-white font-mono font-black uppercase tracking-wide text-[16px]">
                Review meeting tasks
              </h2>
              <p className="text-neutral-400 font-mono text-[11px] uppercase tracking-wider mt-0.5">
                {detail ? `${detail.meeting.title ?? "Meeting"} · ${pending.length} waiting · ${decided.length} decided` : "Loading…"}
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} aria-label="Close review" />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loadError && (
            <p className="border-2 border-black bg-[#FF3333] text-white font-mono text-[12px] p-3">{loadError}</p>
          )}
          {!detail && !loadError && (
            <div className="space-y-3">
              <Skeleton height={140} />
              <Skeleton height={140} />
            </div>
          )}

          {detail?.meeting.mom_summary && (
            <div className="border-2 border-neutral-700 bg-[#141619] p-3">
              <p className={labelClass}>Summary</p>
              <p className="text-neutral-300 font-mono text-[12px] leading-relaxed">{detail.meeting.mom_summary}</p>
            </div>
          )}

          {pending.map((draft) => {
            const e = edits[draft.task_id];
            if (!e) return null;
            const ts = formatTimestamp(draft.evidence_start_sec);
            const heardAs = draft.assignee_hint;
            const context =
              contextFor === draft.task_id && transcript && draft.evidence_segment != null
                ? transcript.slice(Math.max(0, draft.evidence_segment - 2), draft.evidence_segment + 3)
                : null;
            return (
              <div key={draft.task_id} className="border-2 border-black bg-[#141619] shadow-[3px_3px_0px_0px_#000000]">
                <div className="flex items-start gap-3 p-3 border-b-2 border-neutral-800">
                  <input
                    type="checkbox"
                    checked={selected.has(draft.task_id)}
                    onChange={() => toggle(draft.task_id)}
                    className="mt-2 w-4 h-4 accent-[#FFE600] cursor-pointer"
                    aria-label={`Select ${draft.title}`}
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      className={`${inputClass} font-bold text-[13px]`}
                      value={e.title}
                      maxLength={200}
                      onChange={(ev) => update(draft.task_id, { title: ev.target.value })}
                      aria-label="Task title"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={CONFIDENCE_VARIANT[draft.confidence]}>{draft.confidence} confidence</Badge>
                      {!draft.evidence_verified && (
                        <Badge variant="critical">
                          <AlertTriangle size={10} /> Unverified evidence
                        </Badge>
                      )}
                      {heardAs && (
                        <span className="text-neutral-400 font-mono text-[11px]">
                          Heard as “{heardAs}”{draft.resolved_user_id ? ` → ${memberName(draft.resolved_user_id)}` : " (no unique match)"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3 space-y-3">
                  <div className="flex gap-2 items-start bg-[#0B0E14] border-l-4 border-[#FFE600] p-2.5">
                    <Quote size={14} className="text-[#FFE600] shrink-0 mt-0.5" />
                    <p className="text-neutral-300 font-mono text-[12px] leading-relaxed flex-1">
                      {ts && <span className="text-[#FFE600] font-bold mr-1.5">[{ts}]</span>}
                      {draft.evidence_quote}
                    </p>
                    {draft.evidence_segment != null && (
                      <button
                        type="button"
                        onClick={() => void showContext(draft)}
                        className="text-neutral-400 hover:text-white font-mono text-[10px] uppercase tracking-wider underline shrink-0 cursor-pointer"
                      >
                        {contextFor === draft.task_id ? "Hide context" : "Context"}
                      </button>
                    )}
                  </div>
                  {context && (
                    <div className="border-2 border-neutral-700 p-2 space-y-1">
                      {context.map((s) => (
                        <p
                          key={s.index}
                          className={`font-mono text-[11px] leading-relaxed ${
                            s.index === draft.evidence_segment ? "text-white font-bold" : "text-neutral-400"
                          }`}
                        >
                          {formatTimestamp(s.start_sec) && <span className="mr-1">[{formatTimestamp(s.start_sec)}]</span>}
                          {s.speaker && <span className="mr-1">{s.speaker}:</span>}
                          {s.text}
                        </p>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className={labelClass} htmlFor={`desc-${draft.task_id}`}>Description</label>
                    <textarea
                      id={`desc-${draft.task_id}`}
                      className={`${inputClass} min-h-[56px] resize-y`}
                      value={e.description}
                      maxLength={2000}
                      onChange={(ev) => update(draft.task_id, { description: ev.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass} htmlFor={`assignee-${draft.task_id}`}>Assignee</label>
                      <select
                        id={`assignee-${draft.task_id}`}
                        className={inputClass}
                        value={e.assignee}
                        onChange={(ev) => update(draft.task_id, { assignee: ev.target.value })}
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={String(m.user_id)} value={String(m.user_id)}>
                            {m.display_name || m.gh_username || String(m.user_id)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`bucket-${draft.task_id}`}>Column</label>
                      <select
                        id={`bucket-${draft.task_id}`}
                        className={inputClass}
                        value={e.bucketId}
                        onChange={(ev) => update(draft.task_id, { bucketId: ev.target.value })}
                      >
                        {targetBuckets.length === 0 && <option value="">New “Todo” column</option>}
                        {targetBuckets.map((b) => (
                          <option key={String(b.id)} value={String(b.id)}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`type-${draft.task_id}`}>Type</label>
                      <select
                        id={`type-${draft.task_id}`}
                        className={inputClass}
                        value={e.type}
                        onChange={(ev) => update(draft.task_id, { type: ev.target.value })}
                      >
                        {getAllTaskTypes([e.type]).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`weight-${draft.task_id}`}>Weight</label>
                      <select
                        id={`weight-${draft.task_id}`}
                        className={inputClass}
                        value={e.weight}
                        onChange={(ev) => update(draft.task_id, { weight: ev.target.value })}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
                          <option key={w} value={String(w)}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`due-${draft.task_id}`}>
                        Due {draft.due_text ? `(“${draft.due_text}”)` : ""}
                      </label>
                      <input
                        id={`due-${draft.task_id}`}
                        type="date"
                        className={inputClass}
                        value={e.dueDate}
                        onChange={(ev) => update(draft.task_id, { dueDate: ev.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`priority-${draft.task_id}`}>Priority</label>
                      <select
                        id={`priority-${draft.task_id}`}
                        className={inputClass}
                        value={e.priority}
                        onChange={(ev) => update(draft.task_id, { priority: ev.target.value })}
                      >
                        <option value="">None</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void reject([draft.task_id])}>
                      <Trash2 size={12} /> Reject
                    </Button>
                    <Button variant="success" size="sm" disabled={busy} onClick={() => void approve([draft.task_id])}>
                      <CheckCircle2 size={12} /> Approve
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {detail && pending.length === 0 && (
            <p className="text-neutral-300 font-mono text-[12px] border-2 border-dashed border-neutral-700 p-4 text-center">
              Nothing left to review for this meeting.
            </p>
          )}

          {decided.length > 0 && (
            <div>
              <p className={labelClass}>Decided</p>
              <ul className="space-y-1">
                {decided.map((d) => (
                  <li key={d.task_id} className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
                    <Badge variant="success">
                      In {buckets.find((b) => String(b.id) === String(d.bucket_id))?.name ?? "the board"}
                    </Badge>
                    <span className="truncate">{d.title}</span>
                    {d.lead_assignee_id && <span>· {memberName(d.lead_assignee_id)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {pending.length > 0 && (
          <div className="p-4 border-t-2 border-black flex flex-wrap items-center justify-between gap-3">
            <span className="text-neutral-400 font-mono text-[11px] uppercase tracking-wider">
              {selectedPending.length} of {pending.length} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="md" disabled={busy || selectedPending.length === 0} onClick={() => void reject(selectedPending)}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Reject selected
              </Button>
              <Button variant="primary" size="md" disabled={busy || selectedPending.length === 0} onClick={() => void approve(selectedPending)}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve selected
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
