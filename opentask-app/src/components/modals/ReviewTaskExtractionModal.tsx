import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, CheckSquare, Square, AlertCircle, Loader2, UserCheck, Layers } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
import { useToast } from '../../design-system/Toast';
import type { Bucket, ProjectMember, ExtractedTask, Task } from '../../models';

interface EditableExtractedTask {
  title: string;
  description: string;
  type: string;
  weight: number;
}

interface ReviewTaskExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number | string;
  defaultBucketId?: number | string | null;
  defaultAssigneeId?: number | string | null;
  reviewTitle?: string;
  extractedTasks: ExtractedTask[];
  buckets: Bucket[];
  members: ProjectMember[];
  onSuccess?: () => void;
}

export const ReviewTaskExtractionModal: React.FC<ReviewTaskExtractionModalProps> = ({
  isOpen,
  onClose,
  projectId,
  defaultBucketId,
  defaultAssigneeId,
  reviewTitle,
  extractedTasks,
  buckets,
  members,
  onSuccess,
}) => {
  const { showToast } = useToast();

  // Find initial bucket (prefer defaultBucketId, or TODO, or first bucket)
  const initialBucketId = (() => {
    if (defaultBucketId) return String(defaultBucketId);
    const todo = buckets.find(b => b.state === 'TODO');
    if (todo) return String(todo.id);
    return buckets[0]?.id ? String(buckets[0].id) : '';
  })();

  const [targetBucketId, setTargetBucketId] = useState<string>(initialBucketId);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>(
    defaultAssigneeId ? String(defaultAssigneeId) : ''
  );

  const [tasks, setTasks] = useState<EditableExtractedTask[]>(() =>
    extractedTasks.map(t => ({
      title: t.title || 'Untitled Action Item',
      description: t.description || '',
      type: (t.type || 'IMPROVEMENT').toUpperCase(),
      weight: t.weight ?? 3,
    }))
  );

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(extractedTasks.map((_, i) => i))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const assignedMember = members.find(m => String(m.user_id) === String(selectedAssigneeId));

  const toggleSelect = (index: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIndices(prev =>
      prev.size === tasks.length ? new Set() : new Set(tasks.map((_, i) => i))
    );
  };

  const handleUpdateTaskField = (
    index: number,
    field: keyof EditableExtractedTask,
    value: string | number
  ) => {
    setTasks(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleCreateSelectedTasks = async () => {
    const toCreate = tasks.filter((_, i) => selectedIndices.has(i));
    if (toCreate.length === 0) {
      setError('Please select at least one task to create.');
      return;
    }

    if (!targetBucketId) {
      setError('Please select a target column/bucket for the tasks.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let createdCount = 0;
      for (const item of toCreate) {
        const payload: Task = {
          title: item.title.trim(),
          description: item.description.trim() || undefined,
          type: item.type,
          weight: item.weight,
          project_id: projectId,
          bucket_id: targetBucketId,
          lead_assignee_id: selectedAssigneeId ? selectedAssigneeId : undefined,
        };

        await taskService.createTask(payload);
        createdCount++;
      }

      const assigneeLabel = assignedMember?.gh_username || assignedMember?.display_name;
      showToast(
        `Created ${createdCount} task${createdCount !== 1 ? 's' : ''}${
          assigneeLabel ? ` assigned to @${assigneeLabel}` : ''
        }!`,
        'success'
      );

      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to create extracted tasks', err);
      setError(err?.message || 'Failed to create tasks. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const allSelected = selectedIndices.size === tasks.length;
  const noneSelected = selectedIndices.size === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6 bg-background/80 backdrop-blur-sm animate-in fade-in duration-100"
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-4xl shadow-xl flex flex-col overflow-hidden max-h-[94vh] animate-in zoom-in-95 duration-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-border bg-card flex items-start gap-4 shrink-0">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Sparkles size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary block mb-0.5">
              Task Extraction From Code Review
            </span>
            <h2 className="text-base sm:text-lg font-semibold truncate">
              {reviewTitle || 'Select suggestions to create as tasks'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedIndices.size} of {tasks.length} tasks selected for creation
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Global Configuration Bar (Target Bucket & Assignee) */}
        <div className="p-4 sm:p-5 border-b border-border bg-muted/30 grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
          {/* Target Column/Bucket */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Layers size={13} className="text-primary" />
              Destination Column
            </label>
            <select
              value={targetBucketId}
              onChange={e => setTargetBucketId(e.target.value)}
              className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              {buckets.map(b => (
                <option key={String(b.id)} value={String(b.id)}>
                  {b.name} ({b.state})
                </option>
              ))}
            </select>
          </div>

          {/* Target Assignee (Pre-filled with task assignee!) */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <UserCheck size={13} className="text-emerald-500" />
              Auto-Assign to Member
            </label>
            <select
              value={selectedAssigneeId}
              onChange={e => setSelectedAssigneeId(e.target.value)}
              className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              <option value="">-- Unassigned --</option>
              {members.map(m => (
                <option key={String(m.user_id)} value={String(m.user_id)}>
                  {m.gh_username || m.display_name || `Member #${m.user_id}`} ({m.role})
                  {String(m.user_id) === String(defaultAssigneeId) ? ' [CURRENT ASSIGNEE]' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Toggle Bar */}
        <div className="px-5 sm:px-6 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="inline-flex items-center gap-2 text-xs font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
          >
            {allSelected ? (
              <CheckSquare size={16} className="text-primary" />
            ) : (
              <Square size={16} className="text-muted-foreground" />
            )}
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <span className="text-xs text-muted-foreground font-mono">
            {tasks.length} suggestion{tasks.length !== 1 ? 's' : ''} detected
          </span>
        </div>

        {/* Task Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {tasks.map((task, idx) => {
            const isSelected = selectedIndices.has(idx);

            return (
              <div
                key={idx}
                className={`border rounded-lg p-4 transition-all shadow-xs ${
                  isSelected
                    ? 'bg-card border-border'
                    : 'bg-muted/30 border-border opacity-60'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(idx)}
                    className="mt-1 shrink-0 p-1 text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                  >
                    {isSelected ? (
                      <CheckSquare size={18} className="text-primary" />
                    ) : (
                      <Square size={18} className="text-muted-foreground" />
                    )}
                  </button>

                  {/* Task details */}
                  <div className="flex-1 min-w-0 space-y-2.5">
                    {/* Title input */}
                    <input
                      type="text"
                      value={task.title}
                      onChange={e => handleUpdateTaskField(idx, 'title', e.target.value)}
                      disabled={!isSelected}
                      placeholder="Task title..."
                      className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    />

                    {/* Metadata controls: Type & Weight */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Type:</span>
                        <select
                          value={task.type}
                          onChange={e => handleUpdateTaskField(idx, 'type', e.target.value)}
                          disabled={!isSelected}
                          className="bg-background border border-input rounded-md px-2 py-1 text-xs text-foreground disabled:opacity-50"
                        >
                          <option value="BUG">BUG</option>
                          <option value="IMPROVEMENT">IMPROVEMENT</option>
                          <option value="CODE">CODE</option>
                          <option value="SECURITY">SECURITY</option>
                          <option value="REQUIREMENT">REQUIREMENT</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Points:</span>
                        <select
                          value={task.weight}
                          onChange={e => handleUpdateTaskField(idx, 'weight', Number(e.target.value))}
                          disabled={!isSelected}
                          className="bg-background border border-input rounded-md px-2 py-1 text-xs text-foreground disabled:opacity-50"
                        >
                          <option value={1}>1 pt</option>
                          <option value={2}>2 pts</option>
                          <option value={3}>3 pts</option>
                          <option value={5}>5 pts</option>
                          <option value={8}>8 pts</option>
                        </select>
                      </div>
                    </div>

                    {/* Description textarea */}
                    {task.description && (
                      <textarea
                        value={task.description}
                        onChange={e => handleUpdateTaskField(idx, 'description', e.target.value)}
                        disabled={!isSelected}
                        rows={2}
                        className="w-full bg-background border border-input rounded-md p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-y"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Error notification */}
        {error && (
          <div className="mx-5 mb-3 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-border bg-card flex items-center justify-end gap-3 shrink-0">
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={handleCreateSelectedTasks}
            disabled={saving || noneSelected}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Creating tasks...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>
                  Create {selectedIndices.size} task{selectedIndices.size !== 1 ? 's' : ''}
                  {assignedMember ? ` (for @${assignedMember.gh_username || assignedMember.display_name})` : ''}
                </span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
