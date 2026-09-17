import React, { useState } from 'react';
import { useBoard } from '../controllers/useBoard';
import { useTasks } from '../controllers/useTasks';
import { useMeetings } from '../controllers/useMeetings';
import { useBuckets } from '../controllers/useBuckets';
import { useDashboard } from '../controllers/useDashboard';
import { useAsyncReorderQueue } from '../controllers/useAsyncReorderQueue';
import { LayoutDashboard, Briefcase, Video, Settings, ChevronLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import { ProjectOverviewPM, ProjectOverviewDev } from '../components/dashboard/ProjectOverviews';
import { ProjectSettingsTab } from '../components/dashboard/ProjectSettingsTab';
import { MeetingAccordion } from '../components/dashboard/MeetingAccordion';
import { MeetingIntelligenceTab } from '../components/dashboard/MeetingIntelligenceTab';
import { KanbanCard } from '../components/kanban/KanbanCard';
import { KanbanColumn } from '../components/kanban/KanbanColumn';
import { TaskDetailModal } from '../components/modals/TaskDetailModal';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { BucketSettingsModal } from '../components/modals/BucketSettingsModal';
import { SurfaceCard } from '../design-system/SurfaceCard';
import { TaskFormModal } from '../components/modals/TaskFormModal';
import { MeetingFormModal } from '../components/modals/MeetingFormModal';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { useToast } from '../design-system/Toast';
import { useAuth } from '../auth/useAuth';
import { useCurrentUserRole } from '../controllers/useCurrentUserRole';
import { useProjectMembers } from '../controllers/useProjectMembers';
import { projectService } from '../services/projectService';
import { useNavigate } from 'react-router-dom';

import type { TaskType, Project, Task, Bucket, BucketState } from '../models';

interface ProjectDetailsProps {
  projectId: string | number;
}

const STATUS_COLORS: Record<BucketState, string> = {
  'DRAFT': 'bg-slate-500',
  'PENDING': 'bg-[#F59E0B]',
  'TODO': 'bg-[#3B82F6]',
  'ONGOING': 'bg-[#16A34A]',
  'ON_REVIEW': 'bg-[#8B5CF6]',
  'COMPLETED': 'bg-slate-400',
};

export const ProjectDetailsPage: React.FC<ProjectDetailsProps> = ({ projectId }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Overview');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTaskForEdit, setSelectedTaskForEdit] = useState<Task | null>(null);
  const [selectedBucketTarget, setSelectedBucketTarget] = useState<number | string | undefined>(undefined);
  const [bucketToDelete, setBucketToDelete] = useState<number | string | null>(null);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedBucketForEdit, setSelectedBucketForEdit] = useState<Bucket | null>(null);
  const { showToast } = useToast();

  React.useEffect(() => {
    projectService.getProjectById(projectId).then(p => setProject(p || null));
  }, [projectId]);

  const { user } = useAuth();
  const dbUserId = user?.db_user?.id;

  const { role, loading: roleLoading } = useCurrentUserRole(projectId, dbUserId);

  const isManager = role?.toUpperCase() === 'MANAGER' || role?.toUpperCase() === 'OWNER';
  const { members } = useProjectMembers(projectId);
  // useBoard: single request for both buckets and tasks (strict data contract) + optimistic helpers
  const {
    buckets,
    tasks,
    loading: boardLoading,
    refreshBoard,
    setTasksOptimistically,
    setBucketsOptimistically,
    addBucketLocally,
    removeBucketLocally,
    updateTaskLocally,
    updateBucketLocally,
    addTaskLocally,
    removeTaskLocally,
  } = useBoard(projectId);
  const { refreshDashboard } = useDashboard(projectId);
  // Mutation hooks
  const { createBucket, updateBucket, deleteBucket } = useBuckets(projectId);
  const { createTask, updateTask, deleteTask } = useTasks(projectId);
  const { meetings, loading: meetingsLoading, createMeeting, deleteMeeting } = useMeetings(projectId);

  // Seamless asynchronous reorder queue (debounced + silent retries, zero-latency UI)
  const { queueTaskReorder, queueBucketReorder, cancelTaskFromQueue } = useAsyncReorderQueue({
    projectId,
    onTasksSynced: () => refreshDashboard(true),
    onBucketsSynced: () => refreshDashboard(true),
    debounceMs: 250,
  });

  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string | number>>(new Set());

  const bucketsLoading = boardLoading;
  const tasksLoading = boardLoading;

  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketState, setNewBucketState] = useState<BucketState>('TODO');
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);
  const [isCreatingBucketSubmitting, setIsCreatingBucketSubmitting] = useState(false);

  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [creatingTaskBucketId, setCreatingTaskBucketId] = useState<string | number | undefined>(undefined);
  const [creatingTaskTitle, setCreatingTaskTitle] = useState('');

  const handleCreateTask = async (data: { project_id: number | string; title: string; type: TaskType; weight: number; bucket_id?: number | string }) => {
    setIsCreatingTask(true);
    setCreatingTaskBucketId(data.bucket_id);
    setCreatingTaskTitle(data.title);
    try {
      const created = await createTask(data);
      if (created) {
        addTaskLocally(created);
      }
      // Immediately disable the indicator as soon as task is created
      setIsCreatingTask(false);
      setCreatingTaskBucketId(undefined);
      setCreatingTaskTitle('');

      // Background sync without blocking indicator dismissal
      refreshDashboard(true);
      refreshBoard(true);
    } catch (err) {
      console.error('Failed to create task', err);
      setIsCreatingTask(false);
      setCreatingTaskBucketId(undefined);
      setCreatingTaskTitle('');
    }
  };

  const handleDeleteTask = async (taskId: number | string) => {
    setDeletingTaskIds(prev => new Set(prev).add(taskId));
    // Remove from any debounced reorder queues immediately to avoid deadlocks
    cancelTaskFromQueue(taskId);
    try {
      await deleteTask(taskId);
      removeTaskLocally(taskId);
      await Promise.all([refreshBoard(true), refreshDashboard(true)]);
    } catch (err) {
      console.error("Failed to delete task", err);
      showToast("Failed to delete task", "error");
      await refreshBoard(true);
    } finally {
      setDeletingTaskIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleUpdateTask = async (taskId: number | string, data: Partial<Task>) => {
    // 1. Write optimistic patch to state + cache immediately (no delay)
    updateTaskLocally(taskId, data);
    // 2. Fire API in background
    updateTask(taskId, data)
      .then((confirmed) => {
        // 3. Write server-confirmed result back to cache to prevent stale reload
        if (confirmed?.id) {
          updateTaskLocally(confirmed.id, confirmed);
        }
        refreshDashboard(true);
        refreshBoard(true);
      })
      .catch((err) => {
        console.error("Failed to update task:", err);
        // 4. On failure, rollback by pulling fresh data
        refreshBoard(true);
      });
  };

  const handleDropTask = async (taskId: number | string, newBucketId: number | string, targetTaskId?: number | string) => {
    // Determine the task order within the target bucket based on where it was dropped
    const bucketTasks = tasks.filter(t => String(t.bucket_id) === String(newBucketId)).sort((a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0));
    const draggedTask = tasks.find(t => String(t.id) === String(taskId));
    if (!draggedTask) return;

    // Filter out the dragged task to avoid self-collision
    const filteredTasks = bucketTasks.filter(t => String(t.id) !== String(taskId));

    // Calculate new position
    let newIndex = filteredTasks.length; // Default to end
    if (targetTaskId) {
      const targetIndex = filteredTasks.findIndex(t => String(t.id) === String(targetTaskId));
      if (targetIndex !== -1) {
        newIndex = targetIndex;
      }
    }

    // Insert into new array
    const updatedDraggedTask = { ...draggedTask, bucket_id: newBucketId };
    filteredTasks.splice(newIndex, 0, updatedDraggedTask);

    // Build reordered IDs
    const taskIds = filteredTasks.map(t => t.id!);

    // OPTIMISTIC UPDATE: Update UI instantaneously (0ms)
    const otherTasks = tasks.filter(t => String(t.bucket_id) !== String(newBucketId) && String(t.id) !== String(taskId));
    const reorderedBucketTasks = filteredTasks.map((t, idx) => ({ ...t, order_idx: idx, bucket_id: newBucketId }));
    const nextTasks = [...otherTasks, ...reorderedBucketTasks];
    setTasksOptimistically(nextTasks);

    // Asynchronous debounced background sync to database with silent retries
    queueTaskReorder(newBucketId, taskIds);
  };

  const handleSaveBucketSettings = async (bucketId: string | number, data: { name: string; description?: string }) => {
    updateBucketLocally(bucketId, data);
    try {
      await updateBucket(bucketId, data);
      showToast("Column settings saved", "success");
      refreshBoard(true);
    } catch (err) {
      console.error("Failed to update bucket", err);
      showToast("Failed to save column settings", "error");
      refreshBoard(true);
    }
  };

  const handleCreateMeeting = async (data: { project_id: number | string; title: string; date: string; time: string; duration?: string }) => {
    await createMeeting(data);
  };

  const handleCreateBucket = async () => {
    const trimmedName = newBucketName.trim();
    if (!trimmedName || isCreatingBucketSubmitting) return;

    setIsCreatingBucketSubmitting(true);
    try {
      const createdBucket = await createBucket(trimmedName, newBucketState);
      if (createdBucket) {
        addBucketLocally(createdBucket);
      }
      setNewBucketName('');
      setNewBucketState('TODO');
      setIsCreatingBucket(false);
      showToast('Column created successfully', 'success');
      refreshDashboard(true);
    } catch (e) {
      console.error(e);
      showToast('Failed to create bucket', 'error');
    } finally {
      setIsCreatingBucketSubmitting(false);
    }
  };

  const handleDragStartColumn = (e: React.DragEvent<HTMLDivElement>, columnId: string | number) => {
    e.dataTransfer.setData('columnId', columnId.toString());
  };

  const handleDropColumn = (e: React.DragEvent<HTMLDivElement>, targetColumnId: string | number) => {
    e.stopPropagation();
    const draggedColumnId = e.dataTransfer.getData('columnId');
    if (!draggedColumnId || String(draggedColumnId) === String(targetColumnId)) return;

    const oldIndex = buckets.findIndex(b => String(b.id) === String(draggedColumnId));
    const newIndex = buckets.findIndex(b => String(b.id) === String(targetColumnId));

    if (oldIndex === -1 || newIndex === -1) return;

    const newBuckets = [...buckets];
    const [removed] = newBuckets.splice(oldIndex, 1);
    newBuckets.splice(newIndex, 0, removed);
    const reorderedBuckets = newBuckets.map((b, idx) => ({ ...b, order_idx: idx }));

    // 1. Instant optimistic UI swap (0ms)
    setBucketsOptimistically(reorderedBuckets);

    // 2. Asynchronous debounced background sync to database with silent retries
    queueBucketReorder(reorderedBuckets.map(b => b.id!));
  };

  const tabs = isManager
    ? ['Overview', 'Tasks', 'MoM & Meetings', 'Settings']
    : ['Overview', 'Tasks', 'MoM & Meetings'];

  const isLoading = (roleLoading || boardLoading || meetingsLoading) && buckets.length === 0 && !project;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[420px]">
        <LoadingScreen
          fullscreen={false}
          message="SYNCING PERMISSIONS & DATA…"
          subtext="// VERIFYING RBAC & SYNCHRONIZING BOARD ENGINE"
        />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-200 flex flex-col h-full max-w-[1600px] mx-auto w-full select-none">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-none bg-[#141619] border-2 border-black flex items-center justify-center text-neutral-300 hover:text-black hover:bg-[#FFE600] hover:border-black transition-all shadow-[2px_2px_0px_0px_#000000] cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
        >
          <ChevronLeft size={20} strokeWidth={3} />
        </button>
        <div>
          <span className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700 font-mono text-[10px] font-black uppercase tracking-wider mb-1 inline-block">
            // PROJECT PIPELINE CONTROL
          </span>
          <h1 className="text-[26px] sm:text-[30px] font-black text-white uppercase tracking-tight font-mono leading-none">
            {project ? project.name : 'LOADING PROJECT...'}
          </h1>
          <p className="text-[11px] font-mono text-neutral-400 mt-1 uppercase tracking-wider">
            {project ? project.issue || "SYSTEM PIPELINE NOMINAL." : '...'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-[#0E1012] p-1.5 rounded-none border-2 border-black w-fit shadow-[3px_3px_0px_0px_#000000] flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-2 text-[11px] font-mono font-black uppercase tracking-wider rounded-none transition-all duration-75 flex items-center gap-2 cursor-pointer ${
              activeTab === tab 
                ? 'bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px]' 
                : 'bg-[#141619] text-neutral-400 border border-neutral-800 hover:border-white hover:text-white'
            }`}
          >
            {tab === 'Overview' && <LayoutDashboard size={14} strokeWidth={2.5} />}
            {tab === 'Tasks' && <Briefcase size={14} strokeWidth={2.5} />}
            {tab === 'MoM & Meetings' && <Video size={14} strokeWidth={2.5} />}
            {tab === 'Settings' && <Settings size={14} strokeWidth={2.5} />}
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0">
        {/* Overview */}
        {activeTab === 'Overview' && (
          roleLoading ? <div className="text-neutral-500 font-mono text-[12px] py-10 text-center">// RESOLVING PERMISSIONS...</div> :
            isManager ? <ProjectOverviewPM projectId={projectId} /> : (
              <ProjectOverviewDev
                projectId={projectId}
                tasks={tasks}
                buckets={buckets}
                onDropTask={handleDropTask}
                onUpdateTask={handleUpdateTask}
              />
            )
        )}

        {/* Tasks — Kanban */}
        {activeTab === 'Tasks' && (
          <div className="bg-[#0C0D0E] border-2 border-black rounded-none p-5 flex flex-col min-h-[600px] shadow-[6px_6px_0px_0px_#000000]">
            <div className="flex justify-between items-start mb-5 pb-3 border-b-2 border-neutral-800">
              <div>
                <h2 className="text-[16px] font-mono font-black text-white uppercase tracking-wider">
                  <span className="text-[#FFE600] mr-2">//</span>TASK FLOW PIPELINE
                </h2>
                <p className="text-[11px] font-mono text-neutral-400 mt-0.5 uppercase tracking-wider">
                  6-STAGE STACK ARCHITECTURE • DRAFT → COMPLETED
                </p>
              </div>
            </div>

            {tasksLoading || bucketsLoading ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-[14px]">Loading board state...</div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-4 flex-1 no-scrollbar items-start">
                {buckets.map(bucket => {
                  const colTasks = tasks.filter(t => String(t.bucket_id) === String(bucket.id));
                  return (
                    <KanbanColumn
                      key={bucket.id}
                      id={bucket.id!}
                      name={bucket.name || bucket.state}
                      description={bucket.description}
                      colorClass={STATUS_COLORS[bucket.state] || 'bg-slate-500'}
                      statusText="ACTIVE"
                      taskCount={colTasks.length}
                      onDropTask={handleDropTask}
                      onDragStartColumn={handleDragStartColumn}
                      onDropColumn={handleDropColumn}
                      onAddTask={(bId) => { setSelectedBucketTarget(bId); setShowTaskModal(true); }}
                      onDeleteBucket={(bId) => setBucketToDelete(bId)}
                      onEditBucket={() => setSelectedBucketForEdit(bucket)}
                    >
                      {colTasks.map(task => {
                        const isDeleting = deletingTaskIds.has(task.id!);
                        if (isDeleting) {
                          return (
                            <div
                              key={task.id}
                              className="border-2 border-dashed border-[#EF4444] bg-[#161214] rounded-none p-3.5 animate-pulse select-none"
                            >
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <Loader2 size={13} className="animate-spin text-[#EF4444]" />
                                  <span className="font-mono text-[10px] text-[#EF4444] font-black uppercase tracking-wider">
                                    REMOVING TASK...
                                  </span>
                                </div>
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">
                                  #{String(task.id).slice(-4)}
                                </span>
                              </div>
                              <div className="font-mono text-[12px] text-neutral-400 font-bold uppercase truncate line-through">
                                {task.title}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <KanbanCard
                            key={task.id}
                            id={task.id!}
                            title={task.title}
                            type={task.type}
                            weight={task.weight}
                            assignee={task.lead_assignee_id ? 'JD' : undefined}
                            pr={!!task.prUrl}
                            description={task.description}
                            warnStagnant={task.warnStagnant}
                            isSuggested={task.isSuggested}
                            onClick={() => setSelectedTaskForEdit(task)}
                            onDelete={() => handleDeleteTask(task.id!)}
                            onDropTask={(draggedTaskId, targetTaskId) => handleDropTask(draggedTaskId, bucket.id!, targetTaskId)}
                          />
                        );
                      })}

                      {/* In-flight new task creation ghost card */}
                      {isCreatingTask && String(creatingTaskBucketId) === String(bucket.id) && (
                        <div className="border-2 border-dashed border-[#FFE600] bg-[#141619] rounded-none p-3 animate-pulse">
                          <div className="flex items-center gap-2 mb-2">
                            <Loader2 size={13} className="animate-spin text-[#FFE600]" />
                            <span className="font-mono text-[10px] text-[#FFE600] font-black uppercase tracking-wider">CREATING TASK...</span>
                          </div>
                          <div className="font-mono text-[12px] text-white font-bold uppercase truncate">
                            {creatingTaskTitle || '// NEW TASK'}
                          </div>
                        </div>
                      )}
                    </KanbanColumn>

                  );
                })}

                {/* In-Flight Creating Column Indicator */}
                {isCreatingBucketSubmitting && (
                  <div className="min-w-[300px] w-[300px] border-2 border-dashed border-[#FFE600] bg-[#141619] p-5 rounded-none flex flex-col justify-center items-center shadow-[4px_4px_0px_0px_#000000] animate-pulse">
                    <div className="flex items-center gap-2 text-[#FFE600] font-mono text-[12px] font-black uppercase mb-2">
                      <Loader2 size={16} className="animate-spin text-[#FFE600]" />
                      <span>CREATING COLUMN...</span>
                    </div>
                    <div className="font-mono text-[13px] text-white font-bold uppercase truncate max-w-[260px] text-center">
                      <span className="text-[#FFE600] mr-1">//</span>{newBucketName || 'NEW COLUMN'}
                    </div>
                    <div className="font-mono text-[10px] text-neutral-400 mt-2">
                      // PROVISIONING STATE: {newBucketState}
                    </div>
                  </div>
                )}

                {/* Add New Bucket Column */}
                <div className="min-w-[280px] w-[280px]">
                  {!isCreatingBucket ? (
                    <button
                      onClick={() => setIsCreatingBucket(true)}
                      className="w-full h-12 border-2 border-dashed border-black bg-[#121417] rounded-none flex items-center justify-center gap-2 text-neutral-400 hover:text-black hover:bg-[#FFE600] hover:border-black transition-all font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] cursor-pointer"
                    >
                      <Plus size={16} strokeWidth={3} /> ADD COLUMN
                    </button>
                  ) : (
                    <div className="border-2 border-black rounded-none bg-[#121417] p-4 space-y-3 font-mono shadow-[4px_4px_0px_0px_#000000]">
                      <input
                        type="text"
                        autoFocus
                        disabled={isCreatingBucketSubmitting}
                        value={newBucketName}
                        onChange={e => setNewBucketName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleCreateBucket();
                          if (e.key === 'Escape' && !isCreatingBucketSubmitting) {
                            setIsCreatingBucket(false);
                            setNewBucketName('');
                            setNewBucketState('TODO');
                          }
                        }}
                        placeholder="COLUMN NAME"
                        className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono text-white placeholder:text-neutral-600 focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000] disabled:opacity-50"
                      />
                      <div className="space-y-1">
                        <label className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">// BEHAVIOR STATE</label>
                        <select
                          value={newBucketState}
                          disabled={isCreatingBucketSubmitting}
                          onChange={(e) => setNewBucketState(e.target.value as BucketState)}
                          className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono text-white focus:border-[#FFE600] focus:outline-none appearance-none shadow-[2px_2px_0px_0px_#000000] disabled:opacity-50"
                        >
                          <option value="DRAFT">DRAFT (AI Suggestions)</option>
                          <option value="PENDING">PENDING (Approval Needed)</option>
                          <option value="TODO">TODO (Task Queue)</option>
                          <option value="ONGOING">ONGOING (Active Work)</option>
                          <option value="ON_REVIEW">ON_REVIEW (Testing/QA)</option>
                          <option value="COMPLETED">COMPLETED (Finished)</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={handleCreateBucket}
                          disabled={!newBucketName.trim() || isCreatingBucketSubmitting}
                          className="flex-1 bg-[#FFE600] text-black border-2 border-black text-[11px] font-black uppercase py-2 rounded-none hover:translate-x-[-1px] hover:translate-y-[-1px] shadow-[2px_2px_0px_0px_#000000] disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {isCreatingBucketSubmitting ? (
                            <>
                              <Loader2 size={13} className="animate-spin" />
                              <span>CREATING...</span>
                            </>
                          ) : (
                            'Save'
                          )}
                        </button>
                        <button
                          disabled={isCreatingBucketSubmitting}
                          onClick={() => { setIsCreatingBucket(false); setNewBucketName(''); setNewBucketState('TODO'); }}
                          className="flex-1 bg-[#1E2227] text-neutral-300 border-2 border-black text-[11px] font-black uppercase py-2 rounded-none hover:bg-white hover:text-black shadow-[2px_2px_0px_0px_#000000] disabled:opacity-50 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* MoM & Meetings */}
        {activeTab === 'MoM & Meetings' && (
          <div className="space-y-6">
            <MeetingIntelligenceTab
              projectId={projectId}
              onMeetingCreated={createMeeting}
            />

            <SurfaceCard
              title="Historical Meetings"
              subtitle={`${meetings.length} Past Sessions`}
              icon={Video}
              rightElement={null}
            >
              {meetingsLoading ? (
                <div className="text-slate-500 text-[13px] text-center py-8">Loading meetings...</div>
              ) : meetings.length === 0 ? (
                <div className="text-slate-500 text-[13px] text-center py-12 border border-dashed border-[#374151] rounded-xl">
                  No meeting history.
                </div>
              ) : (
                <div className="space-y-4">
                  {meetings.map((mtg, idx) => (
                    <div key={mtg.id} className="relative group/mtg">
                      <MeetingAccordion meeting={mtg} isDefaultExpanded={idx === 0} />
                      <button
                        onClick={() => deleteMeeting(mtg.id!)}
                        className="absolute top-3 right-10 opacity-0 group-hover/mtg:opacity-100 p-1.5 rounded-none bg-black border border-neutral-700 text-neutral-400 hover:text-white hover:bg-[#EF4444] hover:border-black transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000]"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </div>
        )}

        {/* Settings */}
        {activeTab === 'Settings' && (
          <ProjectSettingsTab
            projectId={projectId}
            onProjectUpdated={(updated) => setProject(updated)}
          />
        )}
      </div>

      {/* Modals */}
      {showTaskModal && (
        <TaskFormModal
          projectId={projectId}
          title="New Task"
          initial={{ bucket_id: selectedBucketTarget }}
          onClose={() => { setShowTaskModal(false); setSelectedBucketTarget(undefined); }}
          onSubmit={handleCreateTask}
        />
      )}
      {showMeetingModal && (
        <MeetingFormModal
          projectId={projectId}
          onClose={() => setShowMeetingModal(false)}
          onSubmit={handleCreateMeeting}
        />
      )}
      {selectedTaskForEdit && (
        <TaskDetailModal
          task={selectedTaskForEdit}
          buckets={buckets}
          members={members}
          onClose={() => setSelectedTaskForEdit(null)}
          onUpdate={handleUpdateTask}
        />
      )}

      {selectedBucketForEdit && (
        <BucketSettingsModal
          bucket={selectedBucketForEdit}
          isOpen={!!selectedBucketForEdit}
          onClose={() => setSelectedBucketForEdit(null)}
          onSave={handleSaveBucketSettings}
        />
      )}

      {bucketToDelete && (
        <ConfirmModal
          title="Delete Column"
          message="Are you sure you want to delete this column? This action cannot be undone and only works if the column is empty."
          confirmLabel="Delete Column"
          onConfirm={async () => {
            const targetId = bucketToDelete;
            setBucketToDelete(null);
            removeBucketLocally(targetId);
            try {
              await deleteBucket(targetId);
              refreshDashboard(true);
            } catch (err) {
              console.error("Failed to delete bucket", err);
              showToast("Failed to delete column. Reverting...", "error");
              refreshBoard(true);
            }
          }}
          onCancel={() => setBucketToDelete(null)}
          variant="danger"
        />
      )}
    </div>
  );
};
