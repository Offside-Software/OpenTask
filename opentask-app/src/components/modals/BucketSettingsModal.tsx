import React, { useState, useEffect } from 'react';
import { Settings2, AlignLeft, Activity } from 'lucide-react';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
import type { Bucket, BucketState } from '../../models';
import { cn } from '@/lib/utils';

const BUCKET_STATES: { state: BucketState; label: string; description: string; color: string }[] = [
  { state: 'DRAFT', label: 'Draft', description: 'AI & backlog tasks pending triage', color: 'bg-neutral-500' },
  { state: 'PENDING', label: 'Pending', description: 'Queued for planning or assignment', color: 'bg-amber-500' },
  { state: 'TODO', label: 'To Do', description: 'Ready to be picked up', color: 'bg-blue-500' },
  { state: 'ONGOING', label: 'Ongoing', description: 'In active development/execution', color: 'bg-emerald-500' },
  { state: 'ON_REVIEW', label: 'Review', description: 'Under review or PR verification', color: 'bg-purple-500' },
  { state: 'COMPLETED', label: 'Completed', description: 'Finished and verified tasks', color: 'bg-neutral-400' },
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
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Settings2 size={18} />
            </div>
            <div>
              <h2 className="text-foreground font-semibold text-base">
                Column Settings
              </h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                Current state: {bucket.state}
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Column name <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. In Progress"
              className="w-full bg-background border border-input rounded-lg px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Activity size={13} /> Pipeline stage</span>
              <span className="text-xs text-primary font-medium">{state}</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {BUCKET_STATES.map((s) => {
                const isSelected = state === s.state;
                return (
                  <button
                    key={s.state}
                    type="button"
                    onClick={() => setState(s.state)}
                    className={cn(
                      'p-2.5 rounded-lg border text-left transition-colors cursor-pointer flex flex-col justify-between shadow-xs',
                      isSelected
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'bg-muted/30 border-border hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', s.color)} />
                      <span className="text-xs font-semibold text-foreground">
                        {s.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground line-clamp-1 leading-tight">
                      {s.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <AlignLeft size={13} /> Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what tasks belong in this bucket..."
              className="w-full h-24 bg-background border border-input rounded-lg px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors resize-none"
            />
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
              disabled={saving || !name.trim()}
              className="flex-1"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
