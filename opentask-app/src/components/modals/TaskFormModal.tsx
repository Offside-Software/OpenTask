import React, { useState } from 'react';
import { CheckSquare, Plus } from 'lucide-react';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
import type { Task, TaskType } from '../../models';
import { getAllTaskTypes, saveCustomTaskType, parseTaskTypes, serializeTaskTypes, getTaskTypeVariant } from '../../utils/taskTypes';

interface TaskFormModalProps {
  projectId: number | string;
  onClose: () => void;
  onSubmit: (data: { project_id: number | string; title: string; type: TaskType; weight: number; bucket_id?: number | string }) => Promise<void>;
  initial?: Partial<Task>;
  title?: string;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  projectId, onClose, onSubmit, initial = {}, title = 'New Task',
}) => {
  const [taskTitle, setTaskTitle] = useState(initial.title ?? '');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(() => {
    const parsed = parseTaskTypes(initial.type);
    return parsed.length > 0 ? parsed : ['CODE'];
  });
  const [weight, setWeight] = useState(initial.weight ?? 3);
  const [availableTypes, setAvailableTypes] = useState<string[]>(() => getAllTaskTypes([initial.type]));
  const [isAddingType, setIsAddingType] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState('');

  const handleToggleType = (t: string) => {
    setSelectedTypes(prev => {
      if (prev.includes(t)) {
        if (prev.length === 1) return prev;
        return prev.filter(item => item !== t);
      } else {
        return [...prev, t];
      }
    });
  };

  const handleAddCustomType = () => {
    const trimmed = customTypeInput.trim().toUpperCase();
    if (!trimmed) return;
    saveCustomTaskType(trimmed);
    setAvailableTypes(getAllTaskTypes([trimmed]));
    setSelectedTypes(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    setCustomTypeInput('');
    setIsAddingType(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    onClose();
    const finalType = serializeTaskTypes(selectedTypes) || 'OTHER';
    await onSubmit({ project_id: projectId, title: taskTitle.trim(), type: finalType, weight, bucket_id: initial.bucket_id });
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <CheckSquare size={18} />
            </div>
            <h2 className="text-foreground font-semibold text-base">{title}</h2>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Task title <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="e.g. Refactor authentication module"
              className="w-full bg-background border border-input rounded-lg px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Type</label>
                {!isAddingType && (
                  <button
                    type="button"
                    onClick={() => setIsAddingType(true)}
                    className="text-xs text-primary hover:underline font-medium flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus size={11} /> New
                  </button>
                )}
              </div>

              {/* Selected Type Badges */}
              <div className="flex flex-wrap gap-1.5 min-h-[32px] mb-2 p-1.5 bg-muted/20 border border-border rounded-lg">
                {selectedTypes.map(t => (
                  <Badge key={t} variant={getTaskTypeVariant(t)} className="py-0.5 px-2 text-xs">
                    {t}
                    {selectedTypes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleToggleType(t)}
                        className="hover:text-destructive cursor-pointer ml-1"
                        title={`Remove ${t}`}
                      >
                        ✕
                      </button>
                    )}
                  </Badge>
                ))}
              </div>

              {isAddingType ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    placeholder="Custom tag…"
                    value={customTypeInput}
                    onChange={(e) => setCustomTypeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomType();
                      } else if (e.key === 'Escape') {
                        setIsAddingType(false);
                      }
                    }}
                    className="flex-1 min-w-0 bg-background border border-primary rounded-lg px-2.5 py-1 text-xs uppercase text-foreground focus:outline-none"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleAddCustomType}
                    disabled={!customTypeInput.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddingType(false)}
                  >
                    ✕
                  </Button>
                </div>
              ) : (
                <select
                  value=""
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '__ADD_NEW__') {
                      setIsAddingType(true);
                    } else if (val) {
                      handleToggleType(val);
                    }
                  }}
                  className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
                >
                  <option value="">+ Toggle type…</option>
                  {availableTypes.map(t => (
                    <option key={t} value={t}>
                      {selectedTypes.includes(t) ? `✓ ${t}` : `+ ${t}`}
                    </option>
                  ))}
                  <option value="__ADD_NEW__">+ Add custom type…</option>
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Weight (1–5)</label>
              <input
                type="number"
                min={1} max={5}
                value={weight}
                onChange={e => setWeight(Number(e.target.value))}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-2.5 pt-3 border-t border-border">
            <Button 
              type="button" 
              variant="outline" 
              size="md"
              onClick={onClose} 
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!taskTitle.trim()}
              className="flex-1"
            >
              {title}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
