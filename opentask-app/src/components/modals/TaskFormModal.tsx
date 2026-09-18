import React, { useState } from 'react';
import { CheckSquare, Plus } from 'lucide-react';
import { Badge } from '../../design-system/Badge';
import type { Task, TaskType } from '../../models';
import { getAllTaskTypes, saveCustomTaskType, parseTaskTypes, serializeTaskTypes, getTaskTypeVariant } from '../../utils/taskTypes';
import { CloseButton } from '../../design-system/CloseButton';

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
        if (prev.length === 1) return prev; // keep at least 1 type
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
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none" onClick={onClose}>
      <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-md shadow-[8px_8px_0px_0px_#000000]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b-2 border-black bg-[#181B20]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <CheckSquare size={16} strokeWidth={2.5} />
            </div>
            <h2 className="text-white font-mono font-black uppercase tracking-wider text-[15px]">{title}</h2>
          </div>
          <CloseButton onClick={onClose}></CloseButton>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 font-mono">
          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">
              TASK TITLE <span className="text-[#EF4444]">*</span>
            </label>
            <input
              autoFocus
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="e.g. Refactor authentication module"
              className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider">TYPE</label>
                {!isAddingType && (
                  <button
                    type="button"
                    onClick={() => setIsAddingType(true)}
                    className="text-[10px] text-[#FFE600] hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus size={10} strokeWidth={3} /> NEW
                  </button>
                )}
              </div>
              {/* Selected Type Badges */}
              <div className="flex flex-wrap gap-1.5 min-h-[28px] mb-2 p-1.5 bg-[#0B0E14] border-2 border-black">
                {selectedTypes.map(t => (
                  
                  <Badge key={t} variant={getTaskTypeVariant(t)} className="!py-0.5 !px-1.5 !text-[11px]">
                    {t}
                    {selectedTypes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleToggleType(t)}
                        className="hover:text-[#FF3333] cursor-pointer ml-0.5"
                        title={`Remove ${t}`}
                      >✕
                      </button>
                    )}
                  </Badge>
                ))}
              </div>

              {isAddingType ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    placeholder="CUSTOM TAG..."
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
                    className="flex-1 min-w-0 bg-[#0B0E14] border-2 border-[#FFE600] rounded-none px-2 py-1.5 text-[11px] font-mono uppercase text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomType}
                    disabled={!customTypeInput.trim()}
                    className="px-2 py-1.5 bg-[#FFE600] text-black font-black text-[10px] rounded-none border border-black disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    ADD
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingType(false)}
                    className="px-2 py-1.5 bg-[#1E2227] text-neutral-400 hover:text-white text-[10px] rounded-none border border-neutral-700 cursor-pointer shrink-0"
                  >
                    ✕
                  </button>
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
                  className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                >
                  <option value="">+ APPEND / TOGGLE TYPE...</option>
                  {availableTypes.map(t => (
                    <option key={t} value={t}>
                      {selectedTypes.includes(t) ? `✓ ${t}` : `+ ${t}`}
                    </option>
                  ))}
                  <option value="__ADD_NEW__">+ ADD CUSTOM TYPE...</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">WEIGHT (1–5)</label>
              <input
                type="number"
                min={1} max={5}
                value={weight}
                onChange={e => setWeight(Number(e.target.value))}
                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2.5 text-[13px] font-mono text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t-2 border-neutral-800">
            <button 
              type="button" 
              onClick={onClose} 
              className="flex-1 py-2.5 rounded-none text-[12px] font-mono font-black uppercase tracking-wider text-neutral-300 bg-[#1E2227] border-2 border-black shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!taskTitle.trim()}
              className="flex-1 py-2.5 rounded-none text-[12px] font-mono font-black uppercase tracking-wider bg-[#FFE600] text-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
            >
              {title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
