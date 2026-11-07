import React from 'react';
import { Target, Play, Code, GitMerge } from 'lucide-react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { taskService } from '../../services/taskService';

const CURRENT_USER_ID = 1;

import { getTaskTypeVariant, parseTaskTypes } from '../../utils/taskTypes';

export const MyQueue: React.FC<{ className?: string }> = ({ className = "" }) => {
  const [tasks, setTasks] = React.useState<Awaited<ReturnType<typeof taskService.getMyTasks>>>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    taskService.getMyTasks(CURRENT_USER_ID).then(t => {
      setTasks(t.filter(task => task.status !== 'COMPLETED'));
      setLoading(false);
    });
  }, []);

  return (
    <SurfaceCard 
      title="My Queue" 
      icon={Target} 
      className={className} 
      rightElement={tasks.length > 0 ? <Badge variant="primary">{tasks.length} Tasks</Badge> : null}
    >
      <div className="space-y-2.5 flex-1 overflow-y-auto no-scrollbar pr-1 min-h-0">
        {loading ? (
          <div className="text-muted-foreground text-xs py-4 text-center">Loading queue...</div>
        ) : tasks.length === 0 ? (
          <div className="text-muted-foreground text-xs py-8 text-center border border-dashed border-border rounded-xl">
            Queue empty • No pending assignments
          </div>
        ) : tasks.map(task => (
          <div 
            key={task.id} 
            className="p-3.5 rounded-lg bg-card/60 border border-border hover:border-primary/40 shadow-xs transition-all flex justify-between items-center group"
          >
            <div>
              <div className="flex gap-1.5 mb-1.5 flex-wrap items-center">
                {parseTaskTypes(task.type).map((t) => (
                  <Badge key={t} variant={getTaskTypeVariant(t)} className="py-0.5 px-1.5 text-[10px]">
                    {t === 'CODE' ? <Code size={10} /> : <GitMerge size={10} />}
                    {t}
                  </Badge>
                ))}
                <span className="text-[10px] text-muted-foreground font-mono font-medium">#{task.id}</span>
              </div>
              <h5 className="text-foreground text-xs font-semibold line-clamp-1">{task.title}</h5>
              <p className="text-muted-foreground text-[11px] mt-0.5 capitalize">{task.status?.toLowerCase()}</p>
            </div>
            <Button variant="outline" size="sm" className="p-2 shrink-0 h-8 w-8 rounded-lg hover:bg-primary hover:text-primary-foreground hover:border-primary">
              <Play size={13} fill="currentColor" />
            </Button>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
};
