import React from 'react';
import {
  AlertCircle,
  Users,
  TrendingDown,
  GitPullRequest,
  Clock,
  Zap,
  Target,
  GitBranch
} from 'lucide-react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Button } from '../../design-system/Button';
import { Badge } from '../../design-system/Badge';
import { ProgressBar } from '../../design-system/ProgressBar';
import { useAlerts } from '../../controllers/useAlerts';
import { useDashboard } from '../../controllers/useDashboard';
import { useTasks } from '../../controllers/useTasks';
import { useBuckets } from '../../controllers/useBuckets';
import { useUserProjectStats } from '../../controllers/useUserProjectStats';
import { useAuth } from '../../auth/useAuth';

import { Skeleton } from '../../design-system/Skeleton';
import { ProjectPulseChart } from './ProjectPulseChart';
import type { Task, Bucket } from '../../models';

interface ProjectOverviewProps {
  projectId: string | number;
}

interface ProjectOverviewDevProps extends ProjectOverviewProps {
  tasks: Task[];
  buckets: Bucket[];
  onDropTask: (taskId: string | number, newBucketId: string | number, targetTaskId?: string | number) => Promise<void>;
  onUpdateTask: (taskId: string | number, data: Partial<Task>) => Promise<void>;
}

const getInitials = (name?: string): string => {
  if (!name) return '?';
  const clean = name.replace(/^User\s*#/i, '').trim();
  const parts = clean.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
};

export const ProjectOverviewPM: React.FC<ProjectOverviewProps> = ({ projectId }) => {
  const { loading: alertsLoading } = useAlerts(projectId);
  const { metrics, members, loading: dashboardLoading } = useDashboard(projectId);
  const { tasks, loading: tasksLoading } = useTasks(projectId);
  const { buckets } = useBuckets(projectId);

  const memberWorkloads = React.useMemo(() => {
    if (!members.length) return [];

    // Identify completed buckets
    const completedBucketIds = new Set(
      buckets.filter(b => b.state === 'COMPLETED').map(b => String(b.id))
    );

    // Active tasks assigned to members (bucket not COMPLETED)
    const activeTasks = tasks.filter(t => t.lead_assignee_id && !completedBucketIds.has(String(t.bucket_id)));
    // If there are active assigned tasks, calculate from them; otherwise fallback to all assigned tasks
    const candidateTasks = activeTasks.length > 0
      ? activeTasks
      : tasks.filter(t => t.lead_assignee_id);

    const totalWeight = candidateTasks.reduce((sum, t) => sum + (Number(t.weight) || 3), 0);

    return members.map(m => {
      const userTasks = candidateTasks.filter(t => String(t.lead_assignee_id) === String(m.user_id));
      const userWeight = userTasks.reduce((sum, t) => sum + (Number(t.weight) || 3), 0);
      const userCount = userTasks.length;

      // Calculate distribution percentage based on assigned tasks
      let load = 0;
      if (totalWeight > 0) {
        load = Math.round((userWeight / totalWeight) * 100);
      } else if (m.current_load !== undefined && m.current_load !== null) {
        load = Math.round(m.current_load);
      }

      // Member username & avatar: prioritize gh_username for GitHub integration
      const ghUsername = m.gh_username || m.display_name || (m as any).alias || `User #${m.user_id}`;
      const avatarUrl = m.avatar_url || (m.gh_username ? `https://github.com/${m.gh_username}.png?size=64` : undefined);

      return {
        ...m,
        ghUsername,
        avatarUrl,
        displayName: m.display_name || ghUsername,
        calculatedLoad: load,
        taskCount: userCount || m.task_count || 0,
        taskPoints: userWeight || m.task_points || 0,
      };
    });
  }, [members, tasks, buckets]);

  const avgLoad = memberWorkloads.length
    ? Math.round(memberWorkloads.reduce((acc, m) => acc + m.calculatedLoad, 0) / memberWorkloads.length)
    : 0;

  const overloadedCount = memberWorkloads.filter(
    m => m.calculatedLoad > 100 || (memberWorkloads.length > 1 && m.calculatedLoad >= 80)
  ).length;

  const isBalanced = overloadedCount === 0;
  const tasksAtRisk = tasks.filter(t => t.warnStagnant || t.status === 'ON_REVIEW').slice(0, 3);

  const isLoading = alertsLoading || dashboardLoading || tasksLoading;

  return (
    <div className="flex flex-col animate-in fade-in duration-300 gap-4 sm:gap-6 w-full min-w-0">

      {/* Main Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 sm:gap-6 w-full">
        
        { /* Task At Risk */}
        <div className="col-span-1 md:col-span-1 xl:col-span-4 min-w-0">
          <SurfaceCard title="Tasks at Risk" subtitle="Detect tasks to nudge" rightElement={
            isLoading
              ? <Skeleton width={40} height={18} /> 
              : <Badge variant="accent">{tasksAtRisk.length} Detected</Badge>} className="h-full">
            
            <div className="space-y-2 sm:space-y-2.5 flex-1 overflow-y-auto max-h-[260px] sm:max-h-[300px] pr-1">
              {isLoading ? (
                [1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-2 p-2 sm:p-2.5 rounded-lg bg-card border border-border">
                    <Skeleton width={12} height={12} className="rounded-full shrink-0" />
                    <div className="flex-1 min-w-0">
                      <Skeleton width="80%" height={12} className="mb-1" />
                      <Skeleton width="40%" height={8} />
                    </div>
                  </div>
                ))
              ) : (
                tasksAtRisk.map((task) => (
                  <div key={task.id!} className="flex items-center gap-2.5 p-2 sm:p-2.5 rounded-lg bg-card border border-border shadow-xs cursor-pointer hover:border-primary/40 transition-colors">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${task.warnStagnant ? 'bg-destructive' : 'bg-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-xs font-semibold truncate">{task.title}</p>
                      <p className="text-muted-foreground text-[10px]">{task.type}</p>
                    </div>
                  </div>
                ))
              )}
              {!isLoading && tasksAtRisk.length === 0 && <p className="text-muted-foreground text-xs text-center py-4">All tasks on track.</p>}
            </div>
            {!isLoading && tasksAtRisk.length > 0 && <Button variant="outline" className="w-full mt-3 sm:mt-4 text-xs py-2 sm:py-1.5 touch-manipulation">Nudge Selected</Button>}
          </SurfaceCard>
        </div>

        { /* Stagnation Radar */}
        <div className="col-span-1 md:col-span-1 xl:col-span-3 min-w-0">
          <SurfaceCard title="Stagnation Radar" subtitle="Granular Bottleneck Analysis" icon={TrendingDown} className="h-full">
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:gap-y-8 mt-2">
              {isLoading ? (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Skeleton width="40%" height={12} />
                    <Skeleton width="15%" height={14} />
                  </div>
                  <Skeleton width="30%" height={32} className="mb-2" />
                  <Skeleton width="100%" height={8} className="mb-2" />
                  <Skeleton width="50%" height={10} />
                </div>
              ) : (
                metrics.map(m => (
                  <div key={m.id!}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-foreground font-mono text-xs font-bold uppercase tracking-wider">{m.label}</span>
                      <Badge
                        variant={m.status as "success" | "warning" | "critical" | "primary" | "default" | "outline"}
                        className="!text-[8px] uppercase">{m.status}
                      </Badge>
                    </div>
                    <div className="flex items-end gap-2 mb-2">
                      {m.value.includes('/') ? (
                        // Handle ratio format like "28/34"
                        (() => {
                          const [completed, total] = m.value.split('/');
                          return (
                            <span className="text-2xl sm:text-[32px] text-foreground font-mono font-black leading-none">
                              {completed}
                              <span className="text-xs sm:text-[14px] text-muted-foreground font-mono font-bold ml-1">
                                {total}
                              </span>
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-2xl sm:text-[32px] text-foreground font-mono font-black leading-none">
                          {m.value.replace(/[^0-9]/g, '')}
                          <span className="text-xs sm:text-[14px] text-muted-foreground font-mono font-bold ml-1">
                            {m.value.replace(/[0-9]/g, '')}
                          </span>
                        </span>
                      )}
                    </div>
                    <ProgressBar value={m.progress} colorClass={m.status === 'critical' ? "bg-destructive" : m.status === 'warning' ? "bg-amber-500" : "bg-emerald-500"} label="" />
                    <p className="text-muted-foreground text-[10px] mt-1 font-medium">{m.target_label}</p>
                    {(m.draft_tasks ?? 0) > 0 && (
                      <Badge variant="warning" className="mt-2 text-[10px] leading-tight">
                        {m.draft_tasks} drafted task{m.draft_tasks === 1 ? "" : "s"} awaiting review, not counted
                      </Badge>
                    )}
                  </div>
                ))
              )}
              {!isLoading && metrics.length === 0 && <div className="text-muted-foreground text-xs text-center py-8">No metrics available.</div>}
            </div>
          </SurfaceCard>
        </div>

        { /* Workload Distribution */}
        <div className="col-span-1 md:col-span-2 xl:col-span-5 min-w-0">
          <SurfaceCard title="Workload Distribution" subtitle="Team Capacity" icon={Users} className="h-full">
            <div className="overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0">
              <div className="flex items-end justify-between min-h-36 sm:min-h-40 mt-4 sm:mt-6 gap-2 sm:gap-3 min-w-[280px]">
                {isLoading ? (
                  [1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="flex-1 flex flex-col items-center min-w-[42px] sm:min-w-[50px]">
                      <Skeleton width="100%" height={50 + (i * 10) % 40} className="rounded-md" />
                      <Skeleton width="60%" height={8} className="mt-2 rounded-md" />
                      <Skeleton width="40%" height={8} className="mt-1 rounded-md" />
                    </div>
                  ))
                ) : (
                  memberWorkloads.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center group min-w-[42px] sm:min-w-[50px] max-w-[90px]">
                      <div
                        className="w-full bg-muted border border-border rounded-lg h-28 sm:h-32 relative overflow-hidden shadow-xs"
                        title={`${m.ghUsername}${m.displayName && m.displayName !== m.ghUsername ? ` (${m.displayName})` : ''}: ${m.calculatedLoad}% (${m.taskCount} tasks, ${m.taskPoints} pts)`}
                      >
                        <div
                          className={`absolute bottom-0 left-0 right-0 ${m.calculatedLoad > 100 ? 'bg-destructive' : m.calculatedLoad >= 80 ? 'bg-amber-500' : 'bg-emerald-500'} transition-all rounded-t-sm`}
                          style={{ height: `${Math.min(100, Math.max(m.calculatedLoad, m.taskCount > 0 ? 6 : 0))}%` }}
                        />
                      </div>

                      {/* User profile picture + GitHub username */}
                      <div
                        className="flex items-center justify-center gap-1 mt-2 sm:mt-2.5 max-w-full px-0.5"
                        title={m.displayName && m.displayName !== m.ghUsername ? `${m.ghUsername} (${m.displayName})` : m.ghUsername}
                      >
                        {m.avatarUrl ? (
                          <img
                            src={m.avatarUrl}
                            alt={m.ghUsername}
                            className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border border-border object-cover shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.nextElementSibling;
                              if (fallback) fallback.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <span
                          className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center shrink-0 border border-primary/20 ${m.avatarUrl ? 'hidden' : ''
                            }`}
                        >
                          {getInitials(m.ghUsername)}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-medium text-foreground truncate max-w-[44px] sm:max-w-[70px]">
                          {m.ghUsername}
                        </span>
                      </div>

                      <span className={`text-[9px] sm:text-[10px] font-semibold mt-0.5 ${m.calculatedLoad > 100 ? 'text-destructive' : m.calculatedLoad >= 80 ? 'text-amber-500' : 'text-foreground'}`}>
                        {m.calculatedLoad}%
                      </span>
                      <span className="text-[8px] sm:text-[9px] text-muted-foreground uppercase mt-0.5 truncate max-w-full">
                        {m.taskCount} {m.taskCount === 1 ? 'task' : 'tasks'}
                      </span>
                    </div>
                  ))
                )}
                {!isLoading && memberWorkloads.length === 0 && (
                  <div className="w-full text-center py-8 text-muted-foreground text-xs">
                    No team members assigned.
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-border grid grid-cols-3 gap-2">
              <div className="text-center min-w-0">
                <p className="text-muted-foreground text-[9px] sm:text-[10px] font-medium uppercase tracking-wider mb-0.5 truncate">Avg Load</p>
                {isLoading ? <Skeleton width="100%" height={20} /> : (
                  <p className="text-foreground font-bold text-xs sm:text-sm">
                    {avgLoad}%
                  </p>
                )}
              </div>
              <div className="text-center min-w-0">
                <p className="text-muted-foreground text-[9px] sm:text-[10px] font-medium uppercase tracking-wider mb-0.5 truncate">Overloaded</p>
                {isLoading ? <Skeleton width="100%" height={20} /> : (
                  <p className="text-destructive font-bold text-xs sm:text-sm truncate">
                    {overloadedCount} <span className="text-[9px] sm:text-[10px] text-muted-foreground font-normal">{overloadedCount === 1 ? 'member' : 'members'}</span>
                  </p>
                )}
              </div>
              <div className="text-center min-w-0">
                <p className="text-muted-foreground text-[9px] sm:text-[10px] font-medium uppercase tracking-wider mb-0.5 truncate">Balance</p>
                {isLoading ? <Skeleton width="100%" height={20} /> : (
                  <p className={`${isBalanced ? 'text-emerald-500' : overloadedCount > 0 ? 'text-destructive' : 'text-amber-500'} font-bold text-xs sm:text-sm truncate`}>
                    {isBalanced ? 'Optimal' : 'Unbalanced'}
                  </p>
                )}
              </div>
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Capacity & Feed Row */}
      <div className="w-full min-w-0 overflow-hidden">
        <ProjectPulseChart projectId={projectId} />
      </div>
    </div>
  );
};

export const ProjectOverviewDev: React.FC<ProjectOverviewDevProps> = ({
  projectId,
  tasks,
  buckets,
  onDropTask,
  onUpdateTask
}) => {
  const { user } = useAuth();
  const { activities } = useDashboard(projectId);
  const { stats } = useUserProjectStats(projectId);

  const myUserId = user?.db_user?.id;

  // Find which tasks are in which buckets based on state
  const getTasksByBucketState = (state: string, assignedOnly = true) => {
    const bucketIds = buckets.filter(b => b.state === state).map(b => String(b.id));
    return tasks.filter(t => {
      const isInBucket = bucketIds.includes(String(t.bucket_id));
      if (!isInBucket) return false;
      if (assignedOnly) return String(t.lead_assignee_id) === String(myUserId);
      return !t.lead_assignee_id || String(t.lead_assignee_id) === String(myUserId);
    });
  };

  const activeTask = getTasksByBucketState('ONGOING')[0];
  const myReviewTasks = getTasksByBucketState('ON_REVIEW');

  // Show TODO, PENDING, and DRAFT tasks in the queue (including unassigned)
  const myQueueTasks = [
    ...getTasksByBucketState('TODO', false),
    ...getTasksByBucketState('PENDING', false),
    ...getTasksByBucketState('DRAFT', false)
  ].filter(t => !activeTask || t.id !== activeTask.id).slice(0, 5);

  const handleStartWork = async (taskId: string | number) => {
    const ongoingBucket = buckets.find(b => b.state === 'ONGOING');
    if (!ongoingBucket) return;

    // Auto-assign to me if not already assigned
    await onUpdateTask(taskId, { lead_assignee_id: myUserId });
    await onDropTask(taskId, ongoingBucket.id!);
  };


  const getTimeAgo = (dateStr: string) => {
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-300">
      <div className="lg:col-span-8 space-y-6">
        {activeTask ? (
          <SurfaceCard className="p-6 sm:p-8">
            <Badge variant="accent" className="mb-3">In Flow • Active Now</Badge>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-2">{activeTask.title}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed mb-5">
              {activeTask.description || "Project task currently under development. Work in progress."}
            </p>
            <div className="flex items-center gap-2.5 bg-card border border-border px-3.5 py-2 rounded-lg w-fit mb-6 shadow-xs">
              <GitPullRequest className="text-primary" size={15} />
              <span className="text-xs text-foreground font-medium">{activeTask.branch_name || 'no-branch'}</span>
              <div className="w-px h-4 bg-border mx-1" />
              <Clock className="text-muted-foreground" size={13} />
              <span className="text-xs text-muted-foreground">Started {activeTask.last_activity_at ? getTimeAgo(String(activeTask.last_activity_at)) : 'Recently'}</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button variant="success" size="md" onClick={() => handleStartWork(activeTask.id!)}><GitBranch size={15} /> <span>Ready to Code</span></Button>
              <Button variant="outline" size="md" className="text-destructive hover:bg-destructive/10"><AlertCircle size={15} /> <span>Report Blocker</span></Button>
            </div>
          </SurfaceCard>
        ) : (
          <SurfaceCard className="p-10 border border-dashed border-border flex flex-col items-center justify-center text-center">
            <Zap className="text-muted-foreground mb-3" size={40} />
            <h3 className="text-foreground font-semibold text-base">Ready to commence work?</h3>
            <p className="text-muted-foreground text-xs mt-1 mb-5">You do not currently have an active sprint task.</p>
            {myQueueTasks.length > 0 && (
              <Button variant="primary" size="md" onClick={() => handleStartWork(myQueueTasks[0].id!)}>Ready to code: {myQueueTasks[0].title}</Button>
            )}
            {myQueueTasks.length === 0 && (
              <p className="text-muted-foreground text-xs">No tasks assigned in queue.</p>
            )}
          </SurfaceCard>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SurfaceCard title="PR Status" subtitle="In Review" icon={GitPullRequest}>
            <div className="space-y-2.5">
              {myReviewTasks.map(task => (
                <div key={task.id!} className="bg-card border border-border p-3 rounded-lg flex justify-between items-center shadow-xs">
                  <div className="min-w-0 flex-1">
                    <Badge variant="accent" className="!text-[9px] mb-1">Open PR</Badge>
                    <p className="text-foreground text-xs font-semibold truncate">{task.title}</p>
                  </div>
                  <Badge variant="success" className="text-[9px] shrink-0 ml-2">Active</Badge>
                </div>
              ))}
              {myReviewTasks.length === 0 && <div className="text-muted-foreground text-xs text-center py-6">No PRs in review.</div>}
            </div>
          </SurfaceCard>
          <SurfaceCard title="Team Pulse" subtitle="Recent Activity" icon={TrendingDown}>
            <div className="space-y-3">
              {activities.slice(0, 3).map((act: { id?: string | number; user_name?: string; action?: string; target?: string }) => (
                <div key={act.id!} className="flex items-start gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                  <div className="text-muted-foreground text-xs min-w-0 flex-1">
                    <span className="text-foreground font-medium truncate block">{act.user_name}</span>
                    <span className="text-[11px] block mt-0.5">{act.action} <span className="text-primary font-medium">{act.target}</span></span>
                  </div>
                </div>
              ))}
              {activities.length === 0 && <div className="text-muted-foreground text-xs text-center py-6">No recent activity.</div>}
            </div>
          </SurfaceCard>
        </div>
      </div>

      <div className="lg:col-span-4 space-y-6">
        <SurfaceCard title="My Velocity" subtitle="Sprint Contribution" icon={Zap}>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-3xl font-bold text-foreground leading-none">{stats?.points_completed || 0}</span>
            <span className="text-xs text-muted-foreground font-medium pb-0.5">Points Done</span>
          </div>
          <ProgressBar value={stats?.velocity_percentile || 0} label="" colorClass="bg-emerald-500" />
          <p className="text-right text-xs text-emerald-500 font-semibold mt-2">Top {100 - (stats?.velocity_percentile || 0)}% in squad</p>
        </SurfaceCard>

        <SurfaceCard title="My Queue" subtitle="Up Next" icon={Target} rightElement={<Badge variant="accent">{myQueueTasks.length} Pending</Badge>}>
          <div className="space-y-2.5">
            {myQueueTasks.map((t) => (
              <div
                key={t.id!}
                className="p-3 rounded-lg bg-card border border-border shadow-xs flex flex-col gap-1 hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => handleStartWork(t.id!)}
              >
                <div className="flex justify-between items-center">
                  <Badge variant={t.weight > 5 ? 'warning' : 'neutral'} className="!py-0 !px-1.5 !text-[9px]">{t.type}</Badge>
                  <span className="text-xs text-muted-foreground font-medium"><Clock size={11} className="inline mr-1" />{t.weight} pts</span>
                </div>
                <h5 className="text-foreground text-xs font-semibold mt-1 truncate">{t.title}</h5>
                <div className="text-[11px] text-muted-foreground mt-2 flex justify-between items-center">
                  <span>{t.bucket_id ? buckets.find(b => String(b.id) === String(t.bucket_id))?.state : 'TODO'}</span>
                  <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-[9px] font-bold">ME</div>
                </div>
              </div>
            ))}
            {myQueueTasks.length === 0 && <div className="text-muted-foreground text-xs text-center py-6">Queue is empty.</div>}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
