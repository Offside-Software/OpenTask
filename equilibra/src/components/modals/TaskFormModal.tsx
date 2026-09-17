import React, { useState } from 'react';
import { X, CheckSquare } from 'lucide-react';
import type { Task, TaskType } from '../../models';

const TASK_TYPES: TaskType[] = ['CODE', 'REQUIREMENT', 'DESIGN', 'NON-CODE', 'OTHER'];

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
  const [type, setType] = useState<TaskType>(initial.type ?? 'CODE');
  const [weight, setWeight] = useState(initial.weight ?? 3);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    onClose();
    await onSubmit({ project_id: projectId, title: taskTitle.trim(), type, weight, bucket_id: initial.bucket_id });
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
          <button onClick={onClose} className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
            <X size={16} strokeWidth={3} />
          </button>
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
              <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">TYPE</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as TaskType)}
                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2.5 text-[13px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
              >
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
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
