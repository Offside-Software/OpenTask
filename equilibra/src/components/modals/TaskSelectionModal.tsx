import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, BotMessageSquare, CheckSquare, Square, AlertCircle, Loader2 } from 'lucide-react';
import { alertService } from '../../services/alertService';
import type { ProjectMember, ExtractedTask, ExtractedTaskPayload } from '../../models';
import { parseTaskTypes } from '../../utils/taskTypes';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  alertId: number;
  projectId: number | string;
  extractedTasks: ExtractedTask[];
  members: ProjectMember[];
  onSuccess?: () => void;
}

// ─── Weight pill colours ─────────────────────────────────────────────────────
// ─── Component ───────────────────────────────────────────────────────────────

export const TaskSelectionModal: React.FC<TaskSelectionModalProps> = ({
  isOpen,
  onClose,
  alertId,
  projectId,
  extractedTasks,
  members,
  onSuccess,
}) => {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(extractedTasks.map((_, i) => i)),
  );
  const [assignees, setAssignees] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggle = (idx: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIndices(prev =>
      prev.size === extractedTasks.length
        ? new Set()
        : new Set(extractedTasks.map((_, i) => i)),
    );
  };

  const handleAssigneeChange = (taskIdx: number, userId: number) => {
    setAssignees(prev => ({ ...prev, [taskIdx]: userId }));
  };

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);

    const tasksToSubmit: ExtractedTaskPayload[] = extractedTasks
      .map((t, i) => ({ task: t, origIndex: i }))
      .filter(({ origIndex }) => selectedIndices.has(origIndex))
      .map(({ task, origIndex }) => {
        const rawType = (task.type || '').toUpperCase();
        const validTypes = ['CODE', 'REQUIREMENT', 'DESIGN', 'OTHER'];
        const safeType = validTypes.includes(rawType) ? rawType : 'OTHER';

        return {
          title: task.title,
          description: task.description,
          type: safeType,
          weight: task.weight ?? 3,
          assignee_id: assignees[origIndex],
        };
      });

    try {
      await alertService.confirmTasks(alertId, projectId, tasksToSubmit);
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const allSelected = selectedIndices.size === extractedTasks.length;
  const noneSelected = selectedIndices.size === 0;

  // Check if any *selected* task is missing an assignee
  const hasMissingAssignees = Array.from(selectedIndices).some(
    idx => !assignees[idx]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 select-none animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="bg-[#121417] border-3 border-black rounded-none w-full max-w-xl shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 max-h-[90vh] font-mono"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Header ─────────────────────────────────────── */}
        <div className="p-6 border-b-2 border-black bg-[#181B20] flex items-start gap-4 flex-shrink-0">
          <div className="p-3 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
            <BotMessageSquare size={22} strokeWidth={2.5} />
          </div>
          <div className="flex-1 mt-0.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#FFE600] mb-1">
              // AI EXTRACTED TASKS
            </p>
            <h2 className="text-white font-black text-[18px] uppercase tracking-wide leading-snug">
              REVIEW &amp; CONFIRM TASKS
            </h2>
            <p className="text-neutral-400 text-[11px] uppercase tracking-wider mt-1">
              {selectedIndices.size} OF {extractedTasks.length} TASKS COMMITTED
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer"
          >
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        {/* ─── Select-all bar ──────────────────────────────── */}
        <div className="px-6 py-3 border-b-2 border-black bg-[#0E1012] flex items-center justify-between flex-shrink-0">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-neutral-300 hover:text-[#FFE600] transition-colors cursor-pointer"
          >
            {allSelected ? (
              <CheckSquare size={16} strokeWidth={3} className="text-[#FFE600]" />
            ) : (
              <Square size={16} strokeWidth={2} />
            )}
            {allSelected ? 'DESELECT ALL' : 'SELECT ALL'}
          </button>
          <span className="text-[11px] text-neutral-400 uppercase">
            {extractedTasks.length} TASK{extractedTasks.length !== 1 ? 'S' : ''} DETECTED
          </span>
        </div>

        {/* ─── Task list ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {extractedTasks.map((task, idx) => {
            const selected = selectedIndices.has(idx);
            const w = task.weight ?? 3;

            return (
              <button
                key={idx}
                onClick={() => toggle(idx)}
                className={`w-full text-left rounded-none border-2 border-black p-4 transition-all flex gap-3 group cursor-pointer ${selected
                  ? 'bg-[#181B20] shadow-[3px_3px_0px_0px_#FFE600]'
                  : 'bg-[#0D1017] border-neutral-800 hover:border-black shadow-[2px_2px_0px_0px_#000000]'
                  }`}
              >
                {/* Checkbox icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {selected ? (
                    <CheckSquare size={16} strokeWidth={3} className="text-[#FFE600]" />
                  ) : (
                    <Square size={16} strokeWidth={2} className="text-neutral-500 group-hover:text-white transition-colors" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 font-mono">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-white text-[13px] font-bold uppercase leading-snug">
                      {task.title}
                    </span>
                    <span
                      className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-none border border-black bg-[#FFE600] text-black"
                    >
                      W{w}
                    </span>
                    {task.type && parseTaskTypes(task.type).map(t => (
                      <span key={t} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-none bg-black text-neutral-300 border border-neutral-700">
                        {t}
                      </span>
                    ))}
                  </div>

                  {task.description && (
                    <p className="text-neutral-300 text-[12px] leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  {task.reason && (
                    <p className="mt-1.5 text-[11px] text-[#FFE600] italic line-clamp-1">
                      ↳ {task.reason}
                    </p>
                  )}

                  {/* Assignee Dropdown */}
                  {selected && (
                    <div className="mt-3" onClick={e => e.stopPropagation()}>
                      <select
                        value={assignees[idx] || ''}
                        onChange={e => handleAssigneeChange(idx, Number(e.target.value))}
                        className={`w-full bg-[#0B0E14] border-2 ${!assignees[idx] ? 'border-[#EF4444]' : 'border-black'
                          } text-white text-[12px] font-mono rounded-none px-3 py-1.5 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors`}
                      >
                        <option value="" disabled>SELECT ASSIGNEE...</option>
                        {members.map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            Member #{m.user_id} ({m.role})
                          </option>
                        ))}
                      </select>
                      {!assignees[idx] && (
                        <p className="text-[#EF4444] text-[10px] font-bold mt-1 uppercase">// ASSIGNEE REQUIRED</p>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ─── Error banner ────────────────────────────────── */}
        {error && (
          <div className="mx-4 mb-2 mt-2 flex items-start gap-3 px-4 py-3 rounded-none bg-[#EF4444]/15 border-2 border-black flex-shrink-0 shadow-[2px_2px_0px_0px_#000000]">
            <AlertCircle size={16} strokeWidth={2.5} className="text-[#EF4444] mt-0.5 flex-shrink-0" />
            <p className="text-[12px] font-bold text-[#EF4444] leading-snug">{error}</p>
          </div>
        )}

        {/* ─── Footer ──────────────────────────────────────── */}
        <div className="p-4 border-t-2 border-black bg-[#0E1012] flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-none text-[12px] font-black uppercase tracking-wider text-neutral-300 border-2 border-black bg-[#1E2227] shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || noneSelected || hasMissingAssignees}
            className="flex-1 py-2.5 rounded-none text-[12px] font-black uppercase tracking-wider bg-[#FFE600] text-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                SAVING…
              </>
            ) : (
              `CONFIRM ${selectedIndices.size} TASK${selectedIndices.size !== 1 ? 'S' : ''}`
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
