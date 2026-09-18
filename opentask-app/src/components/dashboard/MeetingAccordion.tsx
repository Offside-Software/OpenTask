import React, { useState } from 'react';
import { Badge } from '../../design-system/Badge';
import { Calendar, Clock, Target, FileText, ChevronRight, Download, CheckCircle2, Loader2, Plus } from 'lucide-react';

import type { Meeting } from '../../models';
import { useTasks } from '../../controllers/useTasks';
import { useBuckets } from '../../controllers/useBuckets';
import { useToast } from '../../design-system/Toast';

interface MeetingProps {
  meeting: Meeting;
  isDefaultExpanded?: boolean;
}

export const MeetingAccordion: React.FC<MeetingProps> = ({ meeting, isDefaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(isDefaultExpanded);
  const { createTask } = useTasks(meeting.project_id);
  const { buckets } = useBuckets(meeting.project_id);
  const { showToast } = useToast();
  const [syncingTasks, setSyncingTasks] = useState<Record<number, boolean>>({});
  const [syncedTasks, setSyncedTasks] = useState<Record<number, boolean>>({});

  const handleSyncTask = async (index: number, taskTitle: string) => {
    setSyncingTasks(prev => ({ ...prev, [index]: true }));
    
    const targetBucketId = buckets?.[0]?.id;
    if (!targetBucketId) {
      showToast("Cannot sync task: Project has no column buckets.", "error");
      setSyncingTasks(prev => ({ ...prev, [index]: false }));
      return;
    }

    try {
      await createTask({
        project_id: meeting.project_id,
        bucket_id: targetBucketId,
        title: taskTitle,
        type: 'OTHER',
        weight: 5
      });
      setSyncedTasks(prev => ({ ...prev, [index]: true }));
      showToast("Task created from history", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to create task", "error");
    } finally {
      setSyncingTasks(prev => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div className="mt-4 rounded-none border-2 border-black bg-[#0C0D0E] overflow-hidden shadow-[4px_4px_0px_0px_#000000] select-none">
       <div
         className="p-5 flex justify-between items-center bg-[#141619] cursor-pointer hover:bg-[#1A1D22] transition-colors"
         onClick={() => setIsExpanded(!isExpanded)}
       >
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h4 className="text-[17px] font-mono font-black uppercase tracking-wide text-white">{meeting.title}</h4>
              <Badge variant="primary" className="font-mono text-[9px] uppercase">{meeting.source_type}</Badge>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-neutral-400 font-medium flex-wrap">
               <span className="flex items-center gap-1.5"><Calendar size={13}/> {meeting.date}</span>
               <span className="flex items-center gap-1.5"><Clock size={13}/> {meeting.time} • {meeting.duration}</span>
               <div className="flex -space-x-1 ml-1">
                  {meeting.attendees?.map((att, i) => (
                    <div key={i} className="w-6 h-6 rounded-none bg-black text-[#FFE600] border border-neutral-700 flex items-center justify-center font-mono text-[9px] font-black">
                      {att}
                    </div>
                  ))}
               </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
             <button className="w-8 h-8 rounded-none bg-white border-2 border-black text-black flex items-center justify-center hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()} title="Open Recording">
               <Target size={14} strokeWidth={2.5}/>
             </button>
             <button className="w-8 h-8 rounded-none bg-white border-2 border-black text-black flex items-center justify-center hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()} title="Open Transcript">
               <FileText size={14} strokeWidth={2.5}/>
             </button>
             <div className="w-0.5 h-6 bg-neutral-800 mx-1"></div>
             <button className="w-8 h-8 rounded-none bg-[#1F2937] border-2 border-black text-neutral-300 flex items-center justify-center hover:bg-[#FFE600] hover:text-black shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
               <ChevronRight size={16} strokeWidth={3} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
             </button>
          </div>
       </div>
       
       {isExpanded && (
         <div className="p-6 bg-[#121417] border-t-2 border-black">
            <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-neutral-800">
               <h5 className="text-[#22C55E] font-mono text-[11px] font-black uppercase tracking-widest">// MINUTES OF MEETING</h5>
               <button className="text-neutral-400 hover:text-white p-1 cursor-pointer"><Download size={16}/></button>
            </div>
           
            <div className="space-y-6 font-mono">
               <section>
                  <h6 className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest mb-3">// KEY POINTS DISCUSSED</h6>
                  <ul className="space-y-2.5 pl-1">
                     {meeting.mom_summary?.split('\n').map((pt, i) => (
                       <li key={i} className="text-[12px] text-neutral-300 flex items-start gap-2.5">
                         <span className="text-[#FFE600] font-black">→</span>
                         <span className="leading-relaxed">{pt}</span>
                       </li>
                     ))}
                  </ul>
               </section>

               <section>
                  <h6 className="text-[#22C55E] text-[10px] font-black uppercase tracking-widest mb-3">// DECISIONS MADE</h6>
                  <div className="space-y-2">
                     {meeting.key_decisions?.map((d: string, i: number) => (
                       <div key={i} className="flex items-center gap-2.5 text-[12px] text-neutral-300">
                         <CheckCircle2 className="text-[#22C55E] shrink-0" size={14} strokeWidth={3} /> {d}
                       </div>
                     ))}
                  </div>
               </section>

               <section>
                  <h6 className="text-[#F59E0B] text-[10px] font-black uppercase tracking-widest mb-3">// ACTION ITEMS</h6>
                   <div className="space-y-3">
                      {meeting.action_items?.map((act, i: number) => (
                        <div key={i} className="flex justify-between items-center p-3 rounded-none bg-[#181B20] border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
                           <div className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded-none bg-[#F59E0B] text-black border border-black flex items-center justify-center text-[10px] font-black">{act.initials}</div>
                              <div className="flex flex-col">
                                 <span className="text-[12px] font-bold text-white">{act.task}</span>
                                 <span className="text-[10px] text-neutral-400 flex items-center gap-1"><Clock size={11}/> {act.deadline}</span>
                              </div>
                           </div>
                           
                           <button 
                             onClick={() => handleSyncTask(i, act.task)}
                             disabled={syncingTasks[i] || syncedTasks[i]}
                             className={`flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[10px] font-mono font-black uppercase tracking-wider transition-all border-2 border-black shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer ${
                               syncedTasks[i] 
                               ? 'bg-[#22C55E] text-black' 
                               : 'bg-[#FFE600] text-black hover:translate-x-[-1px] hover:translate-y-[-1px]'
                             }`}
                           >
                              {syncingTasks[i] ? <Loader2 size={12} className="animate-spin" /> : syncedTasks[i] ? <CheckCircle2 size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />}
                              {syncingTasks[i] ? 'SYNCING...' : syncedTasks[i] ? 'SYNCED' : 'ADD TO BOARD'}
                           </button>
                        </div>
                      ))}
                   </div>
               </section>
            </div>
         </div>
       )}
    </div>
  );
};
