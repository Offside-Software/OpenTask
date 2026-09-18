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
      title="MY QUEUE" 
      icon={Target} 
      className={className} 
      rightElement={tasks.length > 0 ? <Badge variant="primary">{tasks.length} TASKS</Badge> : null}
    >
      <div className="space-y-2.5 flex-1 overflow-y-auto no-scrollbar pr-1 min-h-0">
        {loading ? (
          <div className="text-neutral-500 font-mono text-[11px] py-4 text-center">// LOADING QUEUE...</div>
        ) : tasks.length === 0 ? (
          <div className="text-neutral-500 font-mono text-[11px] py-8 text-center border-2 border-dashed border-neutral-700 rounded-none uppercase">
            // QUEUE EMPTY • NO PENDING ASSIGNMENTS
          </div>
        ) : tasks.map(task => (
          <div 
            key={task.id} 
            className="p-3.5 rounded-none bg-[#141619] border-2 border-black hover:border-white shadow-[2px_2px_0px_0px_#000000] transition-all flex justify-between items-center group"
          >
            <div>
              <div className="flex gap-1.5 mb-1.5 flex-wrap items-center">
                {parseTaskTypes(task.type).map((t) => (
                  <Badge key={t} variant={getTaskTypeVariant(t)} className="!py-0.2 !px-1.5 !text-[9px]">
                    {t === 'CODE' ? <Code size={9} /> : <GitMerge size={9} />}
                    {t}
                  </Badge>
                ))}
                <span className="text-[10px] text-neutral-400 font-mono font-bold">#TASK-{task.id}</span>
              </div>
              <h5 className="text-white text-[13px] font-bold line-clamp-1">{task.title}</h5>
              <p className="text-neutral-500 font-mono text-[10px] mt-0.5 uppercase tracking-wider">// {task.status}</p>
            </div>
            <Button variant="success" size="sm" className="!p-2 flex-shrink-0">
              <Play size={14} strokeWidth={3} />
            </Button>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
};
