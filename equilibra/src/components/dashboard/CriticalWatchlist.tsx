import React from 'react';
import { Filter, MoreHorizontal, TrendingDown, ArrowUpRight } from 'lucide-react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { ProgressBar } from '../../design-system/ProgressBar';
import { useProjects } from '../../controllers/useProjects';
import { CardSkeleton } from '../../design-system/Skeleton';

const CRITICAL_STATUSES = ['Blocked', 'At Risk', 'Stalled'];

const statusVariant = (status: string): 'critical' | 'warning' | 'default' => {
  if (status === 'Blocked' || status === 'Stalled') return 'critical';
  if (status === 'At Risk') return 'warning';
  return 'default';
};

interface CriticalWatchlistProps {
  onNavigate: (projectId: number | string) => void;
}

export const CriticalWatchlist: React.FC<CriticalWatchlistProps> = ({ onNavigate }) => {
  const { leadProjects, collaboratingProjects, loading } = useProjects();
  const allProjects = [...leadProjects, ...collaboratingProjects];
  const criticalProjects = allProjects.filter(p => p.status && CRITICAL_STATUSES.includes(p.status));

  return (
    <SurfaceCard 
      title="CRITICAL WATCHLIST" 
      subtitle="PROJECT PIPELINE BOTTLENECKS & STALLED CONTRACTS" 
      icon={Filter} 
      rightElement={<MoreHorizontal className="text-neutral-500 cursor-pointer" size={18} />}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {loading ? (
          [1, 2, 3, 4].map(i => <CardSkeleton key={i} />)
        ) : criticalProjects.length === 0 ? (
          <div className="col-span-4 text-neutral-500 font-mono text-[12px] text-center py-10 border-2 border-dashed border-neutral-700 rounded-none uppercase">
            // ALL PROJECTS IN HEALTHY PIPELINE VELOCITY
          </div>
        ) : (
          criticalProjects.map(proj => (
            <div
              key={proj.id!}
              onClick={() => onNavigate(proj.id!)}
              className="p-4 rounded-none border-2 border-neutral-700 bg-[#101214] hover:border-[#FFE600] hover:shadow-[4px_4px_0px_0px_#000000] transition-all cursor-pointer relative flex flex-col justify-between h-44 group select-none"
            >
              <div>
                <div className="flex justify-between items-start mb-2 gap-2">
                  <h4 className="text-white font-bold text-[13px] uppercase tracking-wider line-clamp-1 font-mono">
                    {proj.name}
                  </h4>
                  <Badge variant={statusVariant(proj.status!)} className="!text-[8px] flex-shrink-0">
                    {proj.status}
                  </Badge>
                </div>
                <p className="text-neutral-400 font-mono text-[11px] leading-snug flex items-start gap-1.5">
                  <TrendingDown size={14} className="text-[#FF3333] flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                  <span className="line-clamp-2">{proj.issue || 'No issue summary available.'}</span>
                </p>
              </div>
              
              <div className="flex justify-between items-end gap-3 mt-3">
                <ProgressBar value={proj.progress ?? 0} label="SPRINT VELOCITY" colorClass="bg-[#FF3333]" />
                <div className="w-7 h-7 rounded-none bg-[#1E2227] border-2 border-neutral-700 text-neutral-300 flex items-center justify-center group-hover:bg-[#FFE600] group-hover:text-black group-hover:border-black transition-all flex-shrink-0 mb-0.5 shadow-[1.5px_1.5px_0px_0px_#000000]">
                  <ArrowUpRight size={14} strokeWidth={3} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SurfaceCard>
  );
};
