import React, { useState } from 'react';
import { Briefcase } from 'lucide-react';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
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
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Briefcase size={18} />
            </div>
            <h2 className="text-foreground font-semibold text-base">{title}</h2>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Project name <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Project Alpha"
              className="w-full bg-background border border-input rounded-lg px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
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
              {saving ? 'Saving…' : title}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
