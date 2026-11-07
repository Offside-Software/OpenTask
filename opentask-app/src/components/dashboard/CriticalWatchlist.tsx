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
      title="Critical Watchlist" 
      subtitle="Project pipeline bottlenecks & stalled contracts" 
      icon={Filter} 
      rightElement={<MoreHorizontal className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors" size={18} />}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {loading ? (
          [1, 2, 3, 4].map(i => <CardSkeleton key={i} />)
        ) : criticalProjects.length === 0 ? (
          <div className="col-span-4 text-muted-foreground text-xs text-center py-10 border border-dashed border-border rounded-xl">
            All projects in healthy pipeline velocity
          </div>
        ) : (
          criticalProjects.map(proj => (
            <div
              key={proj.id!}
              onClick={() => onNavigate(proj.id!)}
              className="p-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 shadow-xs hover:shadow-sm transition-all cursor-pointer relative flex flex-col justify-between h-44 group select-none"
            >
              <div>
                <div className="flex justify-between items-start mb-2 gap-2">
                  <h4 className="text-foreground font-semibold text-xs tracking-wide line-clamp-1">
                    {proj.name}
                  </h4>
                  <Badge variant={statusVariant(proj.status!)} className="text-[10px] shrink-0">
                    {proj.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-snug flex items-start gap-1.5">
                  <TrendingDown size={14} className="text-destructive shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{proj.issue || 'No issue summary available.'}</span>
                </p>
              </div>
              
              <div className="flex justify-between items-end gap-3 mt-3">
                <ProgressBar value={proj.progress ?? 0} label="Sprint Velocity" colorClass="bg-destructive" />
                <div className="w-7 h-7 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all shrink-0 mb-0.5">
                  <ArrowUpRight size={14} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SurfaceCard>
  );
};
