import React from 'react';
import {
  AlertCircle,
  ChevronRight,
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
  const { alerts, loading: alertsLoading } = useAlerts(projectId);
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

  const criticalInsights = alerts.filter(a => a.severity === 'critical').slice(0, 3);
  const tasksAtRisk = tasks.filter(t => t.warnStagnant || t.status === 'ON_REVIEW').slice(0, 3);

  const isLoading = alertsLoading || dashboardLoading || tasksLoading;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Dynamic Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        {isLoading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="lg:col-span-4">
              <SurfaceCard className="h-full border-2 border-black bg-[#141619] shadow-[3px_3px_0px_0px_#000000]">
                <div className="flex items-center gap-3 mb-4">
                  <Skeleton width={20} height={20} />
                  <Skeleton width="60%" height={16} />
                </div>
                <div className="space-y-2 mb-6">
                  <Skeleton width="100%" height={12} />
                  <Skeleton width="80%" height={12} />
                </div>
                <Skeleton width="30%" height={10} />
              </SurfaceCard>
            </div>
          ))
        ) : (
          criticalInsights.map((alert) => (
            <div key={alert.id!} className="lg:col-span-4">
              <SurfaceCard className={`h-full border-2 border-black shadow-[4px_4px_0px_0px_#000000] ${alert.severity === 'critical' ? 'bg-[#181111]' : 'bg-[#181611]'}`}>
                <div className={`flex items-center gap-2 mb-2 font-mono ${alert.severity === 'critical' ? 'text-[#EF4444]' : 'text-[#FFE600]'}`}>
                  <AlertCircle size={18} strokeWidth={2.5} />
                  <span className="text-[10px] font-black uppercase tracking-wider">
                    // {alert.severity === 'critical' ? 'CRITICAL DISPATCH' : 'SYSTEM WARNING'}
                  </span>
                </div>
                <h4 className="font-mono font-black text-white text-[14px] uppercase tracking-wide mb-2">
                  {alert.title}
                </h4>
                <p className="text-neutral-300 font-mono text-[12px] leading-relaxed mb-4 line-clamp-2">
                  {alert.description}
                </p>
                <button className={`text-[11px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:underline ${alert.severity === 'critical' ? 'text-[#EF4444]' : 'text-[#FFE600]'}`}>
                  INSPECT INCIDENT <ChevronRight size={14} strokeWidth={3} />
                </button>
              </SurfaceCard>
            </div>
          ))
        )}
        {!isLoading && criticalInsights.length === 0 && (
          <div className="lg:col-span-12 text-neutral-400 font-mono text-[12px] uppercase tracking-wider py-8 text-center border-2 border-dashed border-neutral-700 rounded-none bg-[#121417] shadow-[3px_3px_0px_0px_#000000]">
            // NO CRITICAL INSIGHTS DETECTED • ALL SYSTEMS NORMAL
          </div>
        )}
      </div>

      {/* Main Metrics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        <div className="lg:col-span-4">
          <SurfaceCard title="Tasks at Risk" subtitle="Detect tasks to nudge" rightElement={isLoading ? <Skeleton width={40} height={18} /> : <Badge variant="primary">{tasksAtRisk.length} Detected</Badge>} className="h-full">
            <div className="space-y-3 flex-1 overflow-y-auto no-scrollbar max-h-[300px] pr-1">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-1 p-3 rounded-none bg-[#141619] border-2 border-transparent">
                    <Skeleton width={12} height={12} />
                    <div className="flex-1">
                      <Skeleton width="80%" height={12} className="mb-1" />
                      <Skeleton width="40%" height={8} />
                    </div>
                  </div>
                ))
              ) : (
                tasksAtRisk.map((task) => (
                  <div key={task.id!} className="flex items-center gap-3 p-3 rounded-none bg-[#141619] border-2 border-black shadow-[2px_2px_0px_0px_#000000] cursor-pointer hover:border-[#FFE600] transition-colors">
                    <div className={`w-3 h-3 rounded-none border-2 border-black ${task.warnStagnant ? 'bg-[#EF4444]' : 'bg-[#F59E0B]'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-mono text-[12px] font-bold uppercase truncate">{task.title}</p>
                      <p className="text-neutral-400 font-mono text-[10px] uppercase">// {task.type}</p>
                    </div>
                  </div>
                ))
              )}
              {!isLoading && tasksAtRisk.length === 0 && <p className="text-neutral-500 font-mono text-[11px] text-center py-4">// ALL TASKS ON TRACK.</p>}
            </div>
            {!isLoading && tasksAtRisk.length > 0 && <Button variant="outline" className="w-full mt-4 !text-[11px] !py-2">NUDGE SELECTED</Button>}
          </SurfaceCard>
        </div>
        <div className="lg:col-span-8">
          <SurfaceCard title="Stagnation Radar" subtitle="Granular Bottleneck Analysis" icon={TrendingDown} className="h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8 mt-2">
              {isLoading ? (
                [1, 2, 3, 4].map(i => (
                  <div key={i}>
                    <div className="flex justify-between items-center mb-2">
                      <Skeleton width="40%" height={12} />
                      <Skeleton width="15%" height={14} />
                    </div>
                    <Skeleton width="30%" height={32} className="mb-2" />
                    <Skeleton width="100%" height={8} className="mb-2" />
                    <Skeleton width="50%" height={10} />
                  </div>
                ))
              ) : (
                metrics.map(m => (
                  <div key={m.id!}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white font-mono text-[12px] font-bold uppercase tracking-wider">{m.label}</span>
                      <Badge variant={m.status as "success" | "warning" | "critical" | "primary" | "default" | "outline"} className="!text-[8px] uppercase">{m.status}</Badge>
                    </div>
                    <div className="flex items-end gap-2 mb-2">
                      <span className="text-[32px] text-white font-mono font-black leading-none">{m.value.replace(/[^0-9]/g, '')}<span className="text-[14px] text-neutral-500 font-mono font-bold ml-1">{m.value.replace(/[0-9]/g, '')}</span></span>
                    </div>
                    <ProgressBar value={m.progress} colorClass={m.status === 'critical' ? 'bg-[#EF4444]' : m.status === 'warning' ? 'bg-[#FFE600]' : 'bg-[#22C55E]'} label="" />
                    <p className="text-neutral-400 font-mono text-[10px] mt-1 font-bold uppercase">// {m.target_label}</p>
                  </div>
                ))
              )}
              {!isLoading && metrics.length === 0 && <div className="col-span-2 text-slate-500 text-[12px] text-center py-8">No metrics available.</div>}
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Capacity & Feed Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        <div className="lg:col-span-5">
          <SurfaceCard title="Workload Distribution" subtitle="Team Capacity" icon={Users} className="h-full">
            <div className="flex items-end justify-between min-h-40 mt-6 gap-3">
              {isLoading ? (
                [1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    <Skeleton width="100%" height={50 + (i * 10) % 40} className="rounded-none" />
                    <Skeleton width="60%" height={8} className="mt-2 rounded-none" />
                    <Skeleton width="40%" height={8} className="mt-1 rounded-none" />
                  </div>
                ))
              ) : (
                memberWorkloads.map((m, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center group min-w-0">
                    <div
                      className="w-full bg-[#141619] border-2 border-black rounded-none h-32 relative overflow-hidden shadow-[2px_2px_0px_0px_#000000]"
                      title={`${m.ghUsername}${m.displayName && m.displayName !== m.ghUsername ? ` (${m.displayName})` : ''}: ${m.calculatedLoad}% (${m.taskCount} tasks, ${m.taskPoints} pts)`}
                    >
                      <div
                        className={`absolute bottom-0 left-0 right-0 ${m.calculatedLoad > 100 ? 'bg-[#EF4444]' : m.calculatedLoad >= 80 ? 'bg-[#FFE600]' : 'bg-[#22C55E]'} transition-all`}
                        style={{ height: `${Math.min(100, Math.max(m.calculatedLoad, m.taskCount > 0 ? 6 : 0))}%` }}
                      />
                    </div>
                    
                    {/* User profile picture + GitHub username */}
                    <div
                      className="flex items-center justify-center gap-1.5 mt-2.5 max-w-full px-1"
                      title={m.displayName && m.displayName !== m.ghUsername ? `${m.ghUsername} (${m.displayName})` : m.ghUsername}
                    >
                      {m.avatarUrl ? (
                        <img
                          src={m.avatarUrl}
                          alt={m.ghUsername}
                          className="w-4 h-4 rounded-none border border-black object-cover shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling;
                            if (fallback) fallback.classList.remove('hidden');
                          }}
                        />
                      ) : null}
                      <span
                        className={`w-4 h-4 rounded-none bg-black text-[#00E5FF] font-mono text-[8px] font-black flex items-center justify-center shrink-0 border border-black ${
                          m.avatarUrl ? 'hidden' : ''
                        }`}
                      >
                        {getInitials(m.ghUsername)}
                      </span>
                      <span className="text-[10px] font-bold font-mono text-neutral-300 uppercase tracking-wider truncate">
                        {m.ghUsername}
                      </span>
                    </div>

                    <span className={`text-[10px] font-black font-mono mt-0.5 ${m.calculatedLoad > 100 ? 'text-[#EF4444]' : m.calculatedLoad >= 80 ? 'text-[#FFE600]' : 'text-white'}`}>
                      {m.calculatedLoad}%
                    </span>
                    <span className="text-[9px] font-mono text-neutral-500 font-bold uppercase mt-0.5">
                      {m.taskCount} {m.taskCount === 1 ? 'TASK' : 'TASKS'}
                    </span>
                  </div>
                ))
              )}
              {!isLoading && memberWorkloads.length === 0 && (
                <div className="w-full text-center py-8 text-neutral-500 font-mono text-[11px]">
                  // NO TEAM MEMBERS ASSIGNED.
                </div>
              )}
            </div>
            <div className="mt-6 pt-4 border-t-2 border-black flex justify-between">
              <div className="text-center">
                <p className="text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-widest mb-1">// AVG LOAD</p>
                {isLoading ? <Skeleton width={40} height={20} /> : (
                  <p className="text-white font-mono font-black text-[15px]">
                    {avgLoad}%
                  </p>
                )}
              </div>
              <div className="text-center">
                <p className="text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-widest mb-1">// OVERLOADED</p>
                {isLoading ? <Skeleton width={40} height={20} /> : (
                  <p className="text-[#EF4444] font-mono font-black text-[15px]">
                    {overloadedCount} <span className="text-[10px] text-neutral-500 font-bold">{overloadedCount === 1 ? 'MEMBER' : 'MEMBERS'}</span>
                  </p>
                )}
              </div>
              <div className="text-center">
                <p className="text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-widest mb-1">// BALANCE</p>
                {isLoading ? <Skeleton width={40} height={20} /> : (
                  <p className={`${isBalanced ? 'text-[#22C55E]' : overloadedCount > 0 ? 'text-[#EF4444]' : 'text-[#FFE600]'} font-mono font-black text-[15px]`}>
                    {isBalanced ? 'OPTIMAL' : 'UNBALANCED'}
                  </p>
                )}
              </div>
            </div>
          </SurfaceCard>
        </div>
        <div className="lg:col-span-7">
          <ProjectPulseChart projectId={projectId} />
        </div>
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
          <SurfaceCard className="p-8">
            <Badge variant="primary" className="mb-4 font-mono uppercase">// IN FLOW • ACTIVE NOW</Badge>
            <h2 className="text-[26px] font-mono font-black uppercase text-white mb-3">{activeTask.title}</h2>
            <p className="text-[13px] font-mono text-neutral-300 leading-relaxed mb-6">
              {activeTask.description || "Project task currently under development. Work in progress."}
            </p>
            <div className="flex items-center gap-3 bg-[#0E1012] border-2 border-black px-4 py-2.5 rounded-none w-fit mb-8 shadow-[2px_2px_0px_0px_#000000]">
              <GitPullRequest className="text-[#FFE600]" size={16} strokeWidth={2.5} />
              <span className="text-[12px] text-white font-mono font-bold uppercase">{activeTask.branch_name || 'no-branch'}</span>
              <div className="w-0.5 h-4 bg-neutral-700 mx-2" />
              <Clock className="text-neutral-400" size={14} />
              <span className="text-[11px] text-neutral-400 font-mono uppercase">Started {activeTask.last_activity_at ? getTimeAgo(String(activeTask.last_activity_at)) : 'Recently'}</span>
            </div>
            <div className="flex gap-4 flex-wrap">
              <Button variant="success" onClick={() => handleStartWork(activeTask.id!)}><GitBranch size={16} strokeWidth={2.5} /> READY TO CODE</Button>
              <Button variant="outline" className="text-[#EF4444] border-black hover:bg-[#EF4444] hover:text-white"><AlertCircle size={16} /> REPORT BLOCKER</Button>
            </div>
          </SurfaceCard>
        ) : (
          <SurfaceCard className="p-12 border-2 border-dashed border-black flex flex-col items-center justify-center text-center">
            <Zap className="text-neutral-600 mb-4" size={48} />
            <h3 className="text-white font-mono font-black text-[18px] uppercase">// READY TO COMMENCE WORK?</h3>
            <p className="text-neutral-400 font-mono text-[12px] mt-2 mb-6 uppercase">YOU DO NOT CURRENTLY HAVE AN ACTIVE SPRINT TASK.</p>
            {myQueueTasks.length > 0 && (
              <Button variant="primary" onClick={() => handleStartWork(myQueueTasks[0].id!)}>READY TO CODE: {myQueueTasks[0].title}</Button>
            )}
            {myQueueTasks.length === 0 && (
              <p className="text-neutral-500 font-mono text-[12px]">// NO TASKS ASSIGNED IN QUEUE.</p>
            )}
          </SurfaceCard>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SurfaceCard title="PR Status" subtitle="In Review" icon={GitPullRequest}>
            <div className="space-y-3">
              {myReviewTasks.map(task => (
                <div key={task.id!} className="bg-[#141619] border-2 border-black p-3 rounded-none flex justify-between items-center shadow-[2px_2px_0px_0px_#000000]">
                  <div className="min-w-0 flex-1">
                    <Badge variant="primary" className="!text-[8px] mb-1 font-mono uppercase">OPEN PR</Badge>
                    <p className="text-white text-[11px] font-mono font-bold truncate uppercase">{task.title}</p>
                  </div>
                  <span className="text-[10px] text-[#FFE600] font-mono font-black uppercase flex-shrink-0 ml-2">// ACTIVE</span>
                </div>
              ))}
              {myReviewTasks.length === 0 && <div className="text-neutral-500 font-mono text-[11px] text-center py-8">// NO PRS IN REVIEW.</div>}
            </div>
          </SurfaceCard>
          <SurfaceCard title="Team Pulse" subtitle="Recent Activity" icon={TrendingDown}>
            <div className="space-y-4">
              {activities.slice(0, 3).map((act: { id?: string | number; user_name?: string; action?: string; target?: string }) => (
                <div key={act.id!} className="flex items-start gap-3 font-mono">
                  <div className="w-1.5 h-1.5 rounded-none bg-[#FFE600] mt-1.5 flex-shrink-0" />
                  <div className="text-neutral-400 text-[11px] min-w-0 flex-1">
                    <span className="text-white font-bold truncate block uppercase">{act.user_name}</span>
                    <span className="text-[11px] block mt-0.5 uppercase">{act.action} <span className="text-[#FFE600] font-bold">{act.target}</span></span>
                  </div>
                </div>
              ))}
              {activities.length === 0 && <div className="text-neutral-500 font-mono text-[11px] text-center py-8">// NO RECENT ACTIVITY.</div>}
            </div>
          </SurfaceCard>
        </div>
      </div>

      <div className="lg:col-span-4 space-y-6">
        <SurfaceCard title="My Velocity" subtitle="Sprint Contribution" icon={Zap}>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-[32px] font-black font-mono text-white leading-none">{stats?.points_completed || 0}</span>
            <span className="text-[11px] font-mono text-neutral-400 font-bold uppercase pb-1">POINTS DONE</span>
          </div>
          <ProgressBar value={stats?.velocity_percentile || 0} label="" colorClass="bg-[#22C55E]" />
          <p className="text-right text-[10px] font-mono text-[#22C55E] font-black mt-2 uppercase">TOP {100 - (stats?.velocity_percentile || 0)}% IN SQUAD</p>
        </SurfaceCard>

        <SurfaceCard title="My Queue" subtitle="Up Next" icon={Target} rightElement={<Badge>{myQueueTasks.length} Pending</Badge>}>
          <div className="space-y-3">
            {myQueueTasks.map((t) => (
              <div
                key={t.id!}
                className="p-3 rounded-none bg-[#141619] border-2 border-black shadow-[2px_2px_0px_0px_#000000] flex flex-col gap-1 hover:border-[#FFE600] transition-colors cursor-pointer"
                onClick={() => handleStartWork(t.id!)}
              >
                <div className="flex justify-between items-center">
                  <Badge variant={t.weight > 5 ? 'warning' : 'default'} className="!py-0 !px-1.5 !text-[8px] font-mono">{t.type}</Badge>
                  <span className="text-[10px] font-mono text-neutral-400 font-bold"><Clock size={10} className="inline mr-1" />{t.weight} PTS</span>
                </div>
                <h5 className="text-white font-mono text-[12px] font-bold mt-1 uppercase truncate">{t.title}</h5>
                <div className="text-[10px] font-mono text-neutral-400 uppercase font-bold tracking-wider mt-2 flex justify-between items-center">
                  <span>{t.bucket_id ? buckets.find(b => String(b.id) === String(t.bucket_id))?.state : 'TODO'}</span>
                  <div className="w-5 h-5 rounded-none bg-black border border-neutral-700 text-[#FFE600] flex items-center justify-center text-[8px] font-black">ME</div>
                </div>
              </div>
            ))}
            {myQueueTasks.length === 0 && <div className="text-neutral-500 font-mono text-[11px] text-center py-8">// QUEUE IS EMPTY.</div>}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
