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
    className="bg-card text-card-foreground border border-border rounded-xl p-5 shadow-xs hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group flex flex-col h-full select-none"
  >
    <div className="flex justify-between items-start mb-4">
      <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
        <Briefcase size={18} />
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-md">
        Workspace
      </span>
    </div>
    <h3 className="text-foreground text-base font-semibold tracking-tight mb-1.5 group-hover:text-primary transition-colors">{title}</h3>
    <p className="text-muted-foreground text-xs leading-relaxed mb-5 line-clamp-2">{desc}</p>

    {progress !== undefined ? (
      <ProgressBar value={progress} label="Team Velocity" colorClass={progress < 60 ? "bg-amber-500" : "bg-emerald-500"} />
    ) : (
      <div className="flex justify-between items-end border-t border-border pt-3.5 mt-auto">
        <div>
          <p className="text-muted-foreground text-[10px] uppercase font-medium tracking-wider mb-0.5">Assigned Tasks</p>
          <p className="text-foreground text-base font-semibold">{tasks ?? 0} <span className="text-muted-foreground font-normal text-xs">pending</span></p>
        </div>
        <div className="w-7 h-7 rounded-md bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground flex items-center justify-center transition-colors">
          <ArrowUpRight size={14} />
        </div>
      </div>
    )}
  </div>
);
