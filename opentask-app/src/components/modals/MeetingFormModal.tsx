import React, { useState } from 'react';
import { X, Video } from 'lucide-react';

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
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none" onClick={onClose}>
      <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-md shadow-[8px_8px_0px_0px_#000000] font-mono" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b-2 border-black bg-[#181B20]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <Video size={16} strokeWidth={2.5} />
            </div>
            <h2 className="text-white font-mono font-black uppercase tracking-wider text-[15px]">SCHEDULE MEETING</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">
              MEETING TITLE <span className="text-[#EF4444]">*</span>
            </label>
            <input
              autoFocus
              value={meetingTitle}
              onChange={e => setMeetingTitle(e.target.value)}
              placeholder="e.g. Sprint Review Q1"
              className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">DATE</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2.5 text-[13px] font-mono text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">TIME</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2.5 text-[13px] font-mono text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors [color-scheme:dark]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-neutral-400 uppercase tracking-wider mb-2">DURATION (MINUTES)</label>
            <div className="flex gap-2">
              {['30', '60', '90', '120'].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2 rounded-none text-[12px] font-mono font-black border-2 border-black transition-all shadow-[2px_2px_0px_0px_#000000] cursor-pointer ${
                    duration === d
                      ? 'bg-[#FFE600] text-black'
                      : 'bg-[#0B0E14] text-neutral-400 hover:text-white'
                  }`}
                >
                  {d}M
                </button>
              ))}
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
              disabled={saving || !meetingTitle.trim()}
              className="flex-1 py-2.5 rounded-none text-[12px] font-mono font-black uppercase tracking-wider bg-[#FFE600] text-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
            >
              {saving ? 'SCHEDULING…' : 'SCHEDULE MEETING'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
