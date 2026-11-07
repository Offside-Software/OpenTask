import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { BotMessageSquare, CheckSquare, Square, AlertCircle, Loader2 } from 'lucide-react';
import { alertService } from '../../services/alertService';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
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
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm select-none animate-in fade-in duration-100"
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-xl shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Header ─────────────────────────────────────── */}
        <div className="p-5 border-b border-border bg-card flex items-start gap-4 flex-shrink-0">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <BotMessageSquare size={20} />
          </div>
          <div className="flex-1 mt-0.5 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-0.5">
              AI Extracted Tasks
            </p>
            <h2 className="text-foreground font-semibold text-base leading-snug">
              Review &amp; Confirm Tasks
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">
              {selectedIndices.size} of {extractedTasks.length} tasks committed
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* ─── Select-all bar ──────────────────────────────── */}
        <div className="px-5 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between flex-shrink-0">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 text-xs font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
          >
            {allSelected ? (
              <CheckSquare size={16} className="text-primary" />
            ) : (
              <Square size={16} className="text-muted-foreground" />
            )}
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <span className="text-xs text-muted-foreground">
            {extractedTasks.length} task{extractedTasks.length !== 1 ? 's' : ''} detected
          </span>
        </div>

        {/* ─── Task list ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {extractedTasks.map((task, idx) => {
            const selected = selectedIndices.has(idx);
            const w = task.weight ?? 3;

            return (
              <button
                key={idx}
                onClick={() => toggle(idx)}
                className={`w-full text-left rounded-lg border p-3.5 transition-all flex gap-3 group cursor-pointer ${
                  selected
                    ? 'bg-card border-primary/50 shadow-xs ring-1 ring-primary/20'
                    : 'bg-muted/30 border-border hover:border-muted-foreground/30 opacity-75'
                }`}
              >
                {/* Checkbox icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {selected ? (
                    <CheckSquare size={16} className="text-primary" />
                  ) : (
                    <Square size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-foreground text-sm font-semibold leading-snug">
                      {task.title}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-primary/20 bg-primary/10 text-primary"
                    >
                      W{w}
                    </span>
                    {task.type && parseTaskTypes(task.type).map(t => (
                      <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                        {t}
                      </span>
                    ))}
                  </div>

                  {task.description && (
                    <p className="text-muted-foreground text-xs leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  {task.reason && (
                    <p className="mt-1 text-xs text-primary/80 italic line-clamp-1">
                      ↳ {task.reason}
                    </p>
                  )}

                  {/* Assignee Dropdown */}
                  {selected && (
                    <div className="mt-2.5" onClick={e => e.stopPropagation()}>
                      <select
                        value={assignees[idx] || ''}
                        onChange={e => handleAssigneeChange(idx, Number(e.target.value))}
                        className={`w-full bg-background border ${
                          !assignees[idx] ? 'border-destructive' : 'border-input'
                        } text-foreground text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring transition-colors`}
                      >
                        <option value="" disabled>Select assignee...</option>
                        {members.map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.display_name || m.gh_username || `Member #${m.user_id}`} ({m.role})
                          </option>
                        ))}
                      </select>
                      {!assignees[idx] && (
                        <p className="text-destructive text-[11px] font-medium mt-1">Assignee required</p>
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
          <div className="mx-5 mb-3 flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex-shrink-0 text-xs">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <p className="leading-snug">{error}</p>
          </div>
        )}

        {/* ─── Footer ──────────────────────────────────────── */}
        <div className="p-4 border-t border-border bg-card flex gap-3 flex-shrink-0 justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={loading || noneSelected || hasMissingAssignees}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              `Confirm ${selectedIndices.size} task${selectedIndices.size !== 1 ? 's' : ''}`
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
