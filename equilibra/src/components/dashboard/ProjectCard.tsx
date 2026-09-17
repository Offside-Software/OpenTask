import React from 'react';
import { Briefcase, ArrowUpRight } from 'lucide-react';
import { ProgressBar } from '../../design-system/ProgressBar';

interface ProjectCardProps {
  title: string;
  desc: string;
  progress?: number;
  tasks?: number;
  onClick?: () => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  title,
  desc,
  progress,
  tasks,
  onClick
}) => (
  <div 
    onClick={onClick} 
    className="bg-[#121417] border-2 border-black rounded-none p-6 shadow-[4px_4px_0px_0px_#000000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#000000] active:translate-x-[0px] active:translate-y-[0px] active:shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer group flex flex-col h-full select-none"
  >
    <div className="flex justify-between items-start mb-6">
      <div className="p-2.5 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
        <Briefcase size={20} strokeWidth={2.5} />
      </div>
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-black text-neutral-300 border border-neutral-700 px-2 py-0.5">
        // WS-PROJECT
      </span>
    </div>
    <h3 className="text-white text-[18px] font-mono font-black uppercase tracking-wider mb-2 group-hover:text-[#FFE600] transition-colors">{title}</h3>
    <p className="text-neutral-400 text-[12px] font-mono leading-relaxed mb-6 line-clamp-2">{desc}</p>

    {progress !== undefined ? (
      <ProgressBar value={progress} label="Team Velocity" colorClass={progress < 60 ? "bg-[#EF4444]" : "bg-[#22C55E]"} />
    ) : (
      <div className="flex justify-between items-end border-t-2 border-black pt-4 mt-auto">
        <div>
          <p className="text-neutral-400 text-[10px] uppercase font-mono font-bold tracking-wider mb-1">// ASSIGNED TASKS</p>
          <p className="text-white text-[18px] font-mono font-black">{tasks} <span className="text-neutral-500 font-medium text-[12px]">PENDING</span></p>
        </div>
        <div className="w-8 h-8 rounded-none bg-white border-2 border-black text-black flex items-center justify-center group-hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-all">
          <ArrowUpRight size={16} strokeWidth={3} />
        </div>
      </div>
    )}
  </div>
);
