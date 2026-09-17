import React, { useState, useEffect } from 'react';
import { X, Settings2, AlignLeft, Activity } from 'lucide-react';
import type { Bucket, BucketState } from '../../models';

const BUCKET_STATES: { state: BucketState; label: string; description: string; color: string }[] = [
  { state: 'DRAFT', label: 'DRAFT', description: 'AI & backlog tasks pending triage', color: 'bg-slate-500' },
  { state: 'PENDING', label: 'PENDING', description: 'Queued for planning or assignment', color: 'bg-[#F59E0B]' },
  { state: 'TODO', label: 'TODO', description: 'Ready to be picked up', color: 'bg-[#3B82F6]' },
  { state: 'ONGOING', label: 'ONGOING', description: 'In active development/execution', color: 'bg-[#16A34A]' },
  { state: 'ON_REVIEW', label: 'ON_REVIEW', description: 'Under review or PR verification', color: 'bg-[#8B5CF6]' },
  { state: 'COMPLETED', label: 'COMPLETED', description: 'Finished and verified tasks', color: 'bg-slate-400' },
];

interface BucketSettingsModalProps {
  bucket: Bucket | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (bucketId: string | number, data: { name: string; description?: string; state?: BucketState }) => Promise<void>;
}

export const BucketSettingsModal: React.FC<BucketSettingsModalProps> = ({
  bucket,
  isOpen,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<BucketState>('TODO');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bucket) {
      setName(bucket.name || '');
      setDescription(bucket.description || '');
      setState(bucket.state || 'TODO');
    }
  }, [bucket]);

  if (!isOpen || !bucket) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !bucket.id) return;

    setSaving(true);
    try {
      await onSave(bucket.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        state,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="bg-[#121417] border-3 border-black rounded-none w-full max-w-md shadow-[8px_8px_0px_0px_#000000] overflow-hidden animate-in zoom-in-95 duration-100 font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b-2 border-black bg-[#181B20]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <Settings2 size={16} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-white font-mono font-black uppercase tracking-wider text-[15px]">
                COLUMN SETTINGS
              </h2>
              <p className="text-neutral-400 text-[10px] uppercase tracking-wider mt-0.5">
                // STATE: {bucket.state}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">
              COLUMN NAME <span className="text-[#EF4444]">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. In Progress"
              className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Activity size={13} /> BEHAVIOR STATE (PIPELINE STAGE)</span>
              <span className="text-[10px] text-[#FFE600] font-mono">// {state}</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {BUCKET_STATES.map((s) => {
                const isSelected = state === s.state;
                return (
                  <button
                    key={s.state}
                    type="button"
                    onClick={() => setState(s.state)}
                    className={`p-2.5 rounded-none border-2 text-left font-mono transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-[#181B20] border-[#FFE600] shadow-[2px_2px_0px_0px_#FFE600]'
                        : 'bg-[#0B0E14] border-black hover:border-neutral-700 shadow-[2px_2px_0px_0px_#000000]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2.5 h-2.5 rounded-none border border-black shrink-0 ${s.color}`} />
                      <span className={`text-[11px] font-black tracking-wider ${isSelected ? 'text-[#FFE600]' : 'text-white'}`}>
                        {s.label}
                      </span>
                    </div>
                    <span className="text-[9px] text-neutral-400 line-clamp-1 leading-tight">
                      {s.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlignLeft size={13} /> DESCRIPTION
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what tasks belong in this bucket..."
              className="w-full h-24 bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors resize-none"
            />
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
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 rounded-none text-[12px] font-mono font-black uppercase tracking-wider bg-[#FFE600] text-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
            >
              {saving ? 'SAVING...' : 'SAVE SETTINGS'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

