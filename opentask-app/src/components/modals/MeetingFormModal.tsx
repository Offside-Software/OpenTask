import React, { useState } from 'react';
import { Video } from 'lucide-react';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';

interface MeetingFormModalProps {
  projectId: number | string;
  onClose: () => void;
  onSubmit: (data: {
    project_id: number | string;
    title: string;
    date: string;
    time: string;
    duration?: string;
  }) => Promise<void>;
}

export const MeetingFormModal: React.FC<MeetingFormModalProps> = ({ projectId, onClose, onSubmit }) => {
  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = `${String(now.getHours()).padStart(2, '0')}:00`;

  const [meetingTitle, setMeetingTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [duration, setDuration] = useState('60');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingTitle.trim()) return;
    setSaving(true);
    await onSubmit({ project_id: projectId, title: meetingTitle.trim(), date, time, duration: `${duration}min` });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-100">
      <div 
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md shadow-xl overflow-hidden animate-in zoom-in-95 duration-100" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Video size={18} />
            </div>
            <h2 className="text-foreground font-semibold text-base">Schedule Meeting</h2>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Meeting Title <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={meetingTitle}
              onChange={e => setMeetingTitle(e.target.value)}
              placeholder="e.g. Sprint Review Q1"
              className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Duration</label>
            <div className="grid grid-cols-4 gap-2">
              {['30', '60', '90', '120'].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    duration === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {d}m
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t border-border justify-end">
            <Button 
              type="button" 
              variant="outline"
              onClick={onClose} 
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !meetingTitle.trim()}
            >
              {saving ? 'Scheduling…' : 'Schedule Meeting'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
