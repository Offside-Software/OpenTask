import React, { useState } from 'react';
import { X, Briefcase } from 'lucide-react';
import type { Project } from '../../models';

interface ProjectFormModalProps {
  onClose: () => void;
  onSubmit?: (data: Pick<Project, 'name' | 'gh_repo_url'> & {}) => Promise<void>;
  initial?: Partial<Project>;
  title?: string;
}

export const ProjectFormModal: React.FC<ProjectFormModalProps> = ({
  onClose, onSubmit, initial = {}, title = 'New Project',
}) => {
  const [name, setName] = useState(initial.name ?? '');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = { name: name.trim(), gh_repo_url: [] } as Pick<Project, 'name' | 'gh_repo_url'> & {};
    if (onSubmit) {
      await onSubmit(payload);
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none" onClick={onClose}>
      <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-md shadow-[8px_8px_0px_0px_#000000]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b-2 border-black bg-[#181B20]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <Briefcase size={16} strokeWidth={2.5} />
            </div>
            <h2 className="text-white font-mono font-black uppercase tracking-wider text-[15px]">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Form Project Name */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 font-mono">
          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">
              PROJECT NAME <span className="text-[#EF4444]">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Project Alpha"
              className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
            />
          </div>

          {/* Cancel / Create Button */}
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
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 rounded-none text-[12px] font-mono font-black uppercase tracking-wider bg-[#FFE600] text-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
            >
              {saving ? 'SAVING…' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
