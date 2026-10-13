import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, CheckSquare, Square, AlertCircle, Loader2, UserCheck, Layers } from 'lucide-react';
import { taskService } from '../../services/taskService';
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
      className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-[2px] animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="bg-[#121417] dark:bg-[#121417] light:bg-[#FFFFFF] border-3 border-black rounded-none w-full max-w-4xl shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden max-h-[94vh] font-mono text-white dark:text-white light:text-black animate-in zoom-in-95 duration-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b-2 border-black bg-[#181B20] dark:bg-[#181B20] light:bg-[#F4F4F0] flex items-start gap-4 shrink-0">
          <div className="p-3 bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
            <Sparkles size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-black uppercase tracking-widest text-[#FFE600] dark:text-[#FFE600] light:text-amber-700 block mb-1">
              // TASK EXTRACTION FROM CODE REVIEW
            </span>
            <h2 className="text-[17px] sm:text-[19px] font-black uppercase tracking-wide truncate">
              {reviewTitle || 'SELECT SUGGESTIONS TO CREATE AS TASKS'}
            </h2>
            <p className="text-[12px] text-neutral-400 dark:text-neutral-400 light:text-neutral-600 mt-0.5">
              {selectedIndices.size} of {tasks.length} tasks selected for creation
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Global Configuration Bar (Target Bucket & Assignee) */}
        <div className="p-4 sm:p-5 border-b-2 border-black bg-[#0E1012] dark:bg-[#0E1012] light:bg-[#EAEAE4] grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
          {/* Target Column/Bucket */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-400 light:text-neutral-700 mb-1.5 flex items-center gap-1.5">
              <Layers size={13} className="text-[#FFE600] dark:text-[#FFE600] light:text-amber-600" />
              DESTINATION COLUMN
            </label>
            <select
              value={targetBucketId}
              onChange={e => setTargetBucketId(e.target.value)}
              className="w-full bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#FFFFFF] border-2 border-black rounded-none px-3.5 py-2 text-[12px] font-mono font-bold uppercase text-white dark:text-white light:text-black focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] cursor-pointer"
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
            <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-400 light:text-neutral-700 mb-1.5 flex items-center gap-1.5">
              <UserCheck size={13} className="text-[#00FF66] dark:text-[#00FF66] light:text-emerald-700" />
              AUTO-ASSIGN TO MEMBER
            </label>
            <select
              value={selectedAssigneeId}
              onChange={e => setSelectedAssigneeId(e.target.value)}
              className="w-full bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#FFFFFF] border-2 border-black rounded-none px-3.5 py-2 text-[12px] font-mono font-bold uppercase text-white dark:text-white light:text-black focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] cursor-pointer"
            >
              <option value="">-- UNASSIGNED --</option>
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
        <div className="px-5 sm:px-6 py-3 border-b-2 border-black bg-[#14171C] dark:bg-[#14171C] light:bg-[#F0F0EC] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="inline-flex items-center gap-2 text-[12px] font-black uppercase text-neutral-300 dark:text-neutral-300 light:text-neutral-800 hover:text-[#FFE600] transition-colors cursor-pointer"
          >
            {allSelected ? (
              <CheckSquare size={17} className="text-[#FFE600]" />
            ) : (
              <Square size={17} className="text-neutral-500" />
            )}
            <span>{allSelected ? 'DESELECT ALL' : 'SELECT ALL'}</span>
          </button>
          <span className="text-[11px] font-bold text-neutral-400 uppercase font-mono">
            {tasks.length} SUGGESTION{tasks.length !== 1 ? 'S' : ''} DETECTED
          </span>
        </div>

        {/* Task Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {tasks.map((task, idx) => {
            const isSelected = selectedIndices.has(idx);

            return (
              <div
                key={idx}
                className={`border-2 border-black p-4 sm:p-5 transition-all shadow-[3px_3px_0px_0px_#000000] ${
                  isSelected
                    ? 'bg-[#181B20] dark:bg-[#181B20] light:bg-[#FFFFFF]'
                    : 'bg-[#0E1012] dark:bg-[#0E1012] light:bg-[#F4F4F0] opacity-60'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(idx)}
                    className="mt-1 shrink-0 p-1 text-neutral-400 hover:text-[#FFE600] cursor-pointer"
                  >
                    {isSelected ? (
                      <CheckSquare size={22} className="text-[#FFE600]" />
                    ) : (
                      <Square size={22} className="text-neutral-500" />
                    )}
                  </button>

                  {/* Task details */}
                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Title input */}
                    <input
                      type="text"
                      value={task.title}
                      onChange={e => handleUpdateTaskField(idx, 'title', e.target.value)}
                      disabled={!isSelected}
                      placeholder="Task title..."
                      className="w-full bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#F9F9F6] border-2 border-black dark:border-neutral-700 light:border-neutral-400 px-3.5 py-2 text-[14px] font-bold text-white dark:text-white light:text-black focus:outline-none focus:border-[#FFE600] disabled:opacity-50 shadow-[1px_1px_0px_0px_#000000]"
                    />

                    {/* Metadata controls: Type & Weight */}
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase text-neutral-400">
                        <span>TYPE:</span>
                        <select
                          value={task.type}
                          onChange={e => handleUpdateTaskField(idx, 'type', e.target.value)}
                          disabled={!isSelected}
                          className="bg-black dark:bg-black light:bg-neutral-200 border-2 border-black px-2.5 py-1 text-[11px] font-mono font-bold text-[#FFE600] dark:text-[#FFE600] light:text-amber-800 disabled:opacity-50 shadow-[1px_1px_0px_0px_#000000]"
                        >
                          <option value="BUG">BUG</option>
                          <option value="IMPROVEMENT">IMPROVEMENT</option>
                          <option value="CODE">CODE</option>
                          <option value="SECURITY">SECURITY</option>
                          <option value="REQUIREMENT">REQUIREMENT</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase text-neutral-400">
                        <span>POINTS:</span>
                        <select
                          value={task.weight}
                          onChange={e => handleUpdateTaskField(idx, 'weight', Number(e.target.value))}
                          disabled={!isSelected}
                          className="bg-black dark:bg-black light:bg-neutral-200 border-2 border-black px-2.5 py-1 text-[11px] font-mono font-bold text-[#00FF66] dark:text-[#00FF66] light:text-emerald-800 disabled:opacity-50 shadow-[1px_1px_0px_0px_#000000]"
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
                        rows={3}
                        className="w-full bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#F9F9F6] border border-neutral-700 dark:border-neutral-700 light:border-neutral-300 p-3 text-[12px] leading-relaxed font-mono text-neutral-200 dark:text-neutral-200 light:text-neutral-800 focus:outline-none focus:border-[#FFE600] disabled:opacity-50 resize-y shadow-inner"
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
          <div className="mx-5 mb-3 p-3 bg-red-950/40 border-2 border-red-700 text-red-300 font-mono text-[12px] flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t-2 border-black bg-[#181B20] dark:bg-[#181B20] light:bg-[#F4F4F0] flex items-center justify-end gap-3.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 border-2 border-black bg-[#1E2227] dark:bg-[#1E2227] light:bg-neutral-200 text-neutral-300 dark:text-neutral-300 light:text-black font-black font-mono text-[12px] uppercase hover:bg-neutral-800 transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateSelectedTasks}
            disabled={saving || noneSelected}
            className="px-5 py-2.5 border-2 border-black bg-[#FFE600] text-black font-black font-mono text-[12px] uppercase hover:bg-yellow-300 disabled:opacity-50 transition-all shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>CREATING TASKS...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>
                  CREATE {selectedIndices.size} TASK{selectedIndices.size !== 1 ? 'S' : ''}
                  {assignedMember ? ` (FOR @${assignedMember.gh_username || assignedMember.display_name})` : ''}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
