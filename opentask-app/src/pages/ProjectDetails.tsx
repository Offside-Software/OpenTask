import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useBoard } from '../controllers/useBoard';
import { useTasks } from '../controllers/useTasks';
import { useMeetings } from '../controllers/useMeetings';
import { useBuckets } from '../controllers/useBuckets';
import { useDashboard } from '../controllers/useDashboard';
import { useAsyncReorderQueue } from '../controllers/useAsyncReorderQueue';
import { useDragAutoScroll } from '../controllers/useDragAutoScroll';
import { LayoutDashboard, Briefcase, Video, Settings, ChevronLeft, Plus, Loader2, RefreshCw, Sparkles, Search, X, Cpu, Filter, Expand, Shrink, Network } from 'lucide-react';
import { ProjectOverviewPM, ProjectOverviewDev } from '../components/dashboard/ProjectOverviews';
import { ProjectSettingsTab } from '../components/dashboard/ProjectSettingsTab';
import { MeetingIntelligenceTab } from '../components/dashboard/MeetingIntelligenceTab';
import { ProjectDiagramsTab } from '../components/diagrams/ProjectDiagramsTab';
import { KanbanCard } from '../components/kanban/KanbanCard';
import { KanbanColumn } from '../components/kanban/KanbanColumn';
import { TaskContextMenu, type ContextMenuState } from '../components/kanban/TaskContextMenu';
import { TaskDetailModal } from '../components/modals/TaskDetailModal';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { BucketSettingsModal } from '../components/modals/BucketSettingsModal';
import { McpConfigModal } from '../components/modals/McpConfigModal';
import { TaskFormModal } from '../components/modals/TaskFormModal';
import { MeetingFormModal } from '../components/modals/MeetingFormModal';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { Button } from '../design-system/Button';
import { useToast } from '../design-system/Toast';
import { useAuth } from '../auth/useAuth';
import { useCurrentUserRole } from '../controllers/useCurrentUserRole';
import { useProjectMembers } from '../controllers/useProjectMembers';
import { useProjectRealtime, type ProjectEvent } from '../controllers/useProjectRealtime';
import { projectService } from '../services/projectService';
import { prReviewService } from '../services/prReviewService';
import { taskService } from '../services/taskService';
import { deleteAllTaskAttachments } from '../services/supabaseStorage';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NotFoundPage } from './NotFound';

import type { TaskType, Project, Task, Bucket, BucketState } from '../models';

interface ProjectDetailsProps {
    projectId: string | number;
    onProjectLoaded?: (project: Project) => void;
}

const STATUS_COLORS: Record<BucketState, string> = {
    'DRAFT': 'bg-slate-500',
    'PENDING': 'bg-[#F59E0B]',
    'TODO': 'bg-[#3B82F6]',
    'ONGOING': 'bg-[#16A34A]',
    'ON_REVIEW': 'bg-[#8B5CF6]',
    'COMPLETED': 'bg-slate-400',
};

const tabToKey = (t: string) => {
    switch (t.toLowerCase()) {
        case 'overview': return 'overview';
        case 'tasks': return 'tasks';
        case 'diagrams':
        case 'diagram':
            return 'diagrams';
        case 'mom & meetings':
        case 'meetings':
        case 'mom':
            return 'meetings';
        case 'settings': return 'settings';
        default: return 'overview';
    }
};

const keyToTab = (k: string) => {
    switch (k.toLowerCase()) {
        case 'overview': return 'Overview';
        case 'tasks': return 'Tasks';
        case 'diagrams':
        case 'diagram':
            return 'Diagrams';
        case 'mom & meetings':
        case 'meetings':
        case 'mom':
            return 'MoM & Meetings';
        case 'settings': return 'Settings';
        default: return 'Overview';
    }
};

export const ProjectDetailsPage: React.FC<ProjectDetailsProps> = ({ projectId, onProjectLoaded }) => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const taskIdParam = searchParams.get('taskId');
    const [activeTab, setActiveTabState] = useState(() => {
        const param = searchParams.get('tab') || searchParams.get('tabs');
        if (param) {
            return keyToTab(param);
        }
        return taskIdParam ? 'Tasks' : 'Overview';
    });

    const setActiveTab = (tab: string) => {
        setActiveTabState(tab);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('tab', tabToKey(tab));
            return next;
        }, { replace: true });
    };

    useEffect(() => {
        const param = searchParams.get('tab') || searchParams.get('tabs');
        if (param) {
            const resolved = keyToTab(param);
            if (resolved !== activeTab) {
                setActiveTabState(resolved);
            }
        }
    }, [searchParams, activeTab]);
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [selectedTaskForEdit, setSelectedTaskForEdit] = useState<Task | null>(null);
    const [selectedBucketTarget, setSelectedBucketTarget] = useState<number | string | undefined>(undefined);
    const [bucketToDelete, setBucketToDelete] = useState<number | string | null>(null);
    const [showMeetingModal, setShowMeetingModal] = useState(false);
    const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
    const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState<string>('ALL');
    const [project, setProject] = useState<Project | null>(null);
    const [selectedBucketForEdit, setSelectedBucketForEdit] = useState<Bucket | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [isRefreshingTasks, setIsRefreshingTasks] = useState(false);
    const [projectNotFound, setProjectNotFound] = useState(false);
    const [meetingEventKey, setMeetingEventKey] = useState(0);
    const meetingJobParam = searchParams.get('meetingJob');
    const { showToast } = useToast();

    React.useEffect(() => {
        projectService.getProjectById(projectId)
            .then(p => {
                if (!p) {
                    setProjectNotFound(true);
                } else {
                    setProject(p);
                    setProjectNotFound(false);
                    onProjectLoaded?.(p);
                }
            })
            .catch(err => {
                console.error("Failed to fetch project:", err);
                setProjectNotFound(true);
            });
    }, [projectId]);

    const handleRefreshTasksOnly = async () => {
        setIsRefreshingTasks(true);
        try {
            await refreshBoard(false);
            showToast('Task list synchronized', 'info');
        } catch (err) {
            console.error('Failed to refresh tasks:', err);
            showToast('Failed to refresh tasks', 'error');
        } finally {
            setIsRefreshingTasks(false);
        }
    };

    const [isSyncingPrs, setIsSyncingPrs] = useState(false);

    const handleSyncAndReviewPrs = async () => {
        setIsSyncingPrs(true);
        try {
            const res = await prReviewService.syncProjectPrs(projectId);
            if (res.reviews_triggered > 0) {
                showToast(`AI Code Review triggered for ${res.reviews_triggered} PR(s)!`, 'success');
            } else {
                showToast('Scanned repos: no unreviewed PRs found', 'info');
            }
            await refreshBoard(false);
        } catch (err: any) {
            console.error('Failed to sync PRs:', err);
            showToast(err?.message || 'Failed to sync PRs', 'error');
        } finally {
            setIsSyncingPrs(false);
        }
    };

    const { user } = useAuth();
    const dbUserId = user?.db_user?.id;
    const { role, loading: roleLoading } = useCurrentUserRole(projectId, dbUserId);
    const isManager = role?.toUpperCase() === 'MANAGER' || role?.toUpperCase() === 'OWNER';
    const { members, refreshMembers } = useProjectMembers(projectId);

    // useBoard: single request for both buckets and tasks (strict data contract) + optimistic helpers
    const {
        buckets,
        tasks,
        loading: boardLoading,
        loadingBuckets,
        loadMoreBucketTasks,
        refreshBoard,
        setTasksOptimistically,
        setBucketsOptimistically,
        addBucketLocally,
        removeBucketLocally,
        updateTaskLocally,
        updateBucketLocally,
        addTaskLocally,
        removeTaskLocally,
        updatingTaskIds,
        markTaskUpdating,
        unmarkTaskUpdating,
    } = useBoard(projectId);

    const handleMemberRemoved = useCallback((userId: string | number) => {
        setTasksOptimistically(prevTasks =>
            prevTasks.map(task => ({
                ...task,
                lead_assignee_id:
                    String(task.lead_assignee_id) === String(userId)
                        ? null
                        : task.lead_assignee_id,
                suggested_assignee_id:
                    String(task.suggested_assignee_id) === String(userId)
                        ? null
                        : task.suggested_assignee_id,
            })),
        );
        setSelectedTaskForEdit(currentTask => {
            if (!currentTask) return currentTask;
            return {
                ...currentTask,
                lead_assignee_id:
                    String(currentTask.lead_assignee_id) === String(userId)
                        ? null
                        : currentTask.lead_assignee_id,
                suggested_assignee_id:
                    String(currentTask.suggested_assignee_id) === String(userId)
                        ? null
                        : currentTask.suggested_assignee_id,
            };
        });
    }, [setTasksOptimistically]);
    const { refreshDashboard } = useDashboard(projectId);

    const notifyActivityUpdated = useCallback(() => {
        window.dispatchEvent(new CustomEvent('opentask:activity-updated', { detail: { projectId } }));
    }, [projectId]);

    // Seamless asynchronous reorder queue (debounced + silent retries, zero-latency UI)
    const { queueTaskReorder, queueBucketReorder, cancelTaskFromQueue, hasPendingReorders } = useAsyncReorderQueue({
        projectId,
        onTasksSynced: (syncedTaskIds) => {
            if (syncedTaskIds && syncedTaskIds.length > 0) {
                syncedTaskIds.forEach(id => unmarkTaskUpdating(id));
            }
            refreshDashboard(true);
            void refreshBoard(true);
            notifyActivityUpdated();
        },
        onTasksFailed: (failedTaskIds) => {
            if (failedTaskIds && failedTaskIds.length > 0) {
                failedTaskIds.forEach(id => unmarkTaskUpdating(id));
            }
            void refreshBoard(true);
        },
        onBucketsSynced: () => refreshDashboard(true),
        debounceMs: 50,
    });

    const { meetings, loading: meetingsLoading, createMeeting, deleteMeeting, refreshMeetings, refreshMeeting, removeMeetingLocally } = useMeetings(projectId);

    const handleProjectEvent = useCallback((event: ProjectEvent) => {
        if (event.entity === 'task' || event.entity === 'bucket') {
            setMeetingEventKey(k => k + 1);
            if (hasPendingReorders()) {
                // Skip board reload while optimistic moves or network syncs are pending/in flight
                return;
            }
            if (event.entity === 'task' && event.entity_id && updatingTaskIds.has(String(event.entity_id))) {
                // Skip board reload if this task is actively being updated locally
                return;
            }
            void refreshBoard(true);
            void refreshDashboard(true);
        } else if (event.entity === 'member') {
            void refreshMembers();
            void refreshDashboard(true);
        } else if (event.entity === 'project') {
            projectService.getProjectById(projectId)
                .then(setProject)
                .catch(error => console.error('Failed to refresh project after realtime event:', error));
        } else if (event.entity === 'meeting') {
            // Swap the one meeting in place so open meeting cards keep their state.
            if (event.action === 'deleted' && event.entity_id) removeMeetingLocally(event.entity_id);
            else if (event.entity_id) void refreshMeeting(event.entity_id);
            else void refreshMeetings();
            setMeetingEventKey(k => k + 1);
        } else if (event.entity === 'meeting_job') {
            setMeetingEventKey(k => k + 1);
        }
    }, [projectId, refreshBoard, refreshDashboard, refreshMembers, hasPendingReorders, refreshMeeting, refreshMeetings, removeMeetingLocally, updatingTaskIds]);

    useProjectRealtime(projectId, { onEvent: handleProjectEvent });

    // Mutation hooks
    const { createBucket, updateBucket, deleteBucket } = useBuckets(projectId);
    const { createTask, updateTask, deleteTask } = useTasks(projectId);

    // Auto-scrolling during drag operations (vertical on <main>, horizontal on board)
    const boardScrollRef = React.useRef<HTMLDivElement>(null);
    useDragAutoScroll({ boardRef: boardScrollRef });

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
    const [taskToDelete, setTaskToDelete] = useState<string | number | null>(null);

    const [focusBucket, setFocusBucket] = useState(false);
    const [selectedBucketFocus, setSelectedBucketFocus] = useState<string | 'ALL'>('ALL');
    const [columnDensity, setColumnDensity] = useState<'normal' | 'wide'>('normal');

    // Reset expand/focus when switching away from Tasks tab
    useEffect(() => {
        if (activeTab !== 'Tasks') {
            setFocusBucket(false);
            setSelectedBucketFocus('ALL');
        }
    }, [activeTab]);

    // Keyboard listener to collapse expanded view with Escape key
    useEffect(() => {
        if (!focusBucket) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!selectedTaskForEdit && !showTaskModal && !selectedBucketForEdit && !bucketToDelete && !taskToDelete && !isMcpModalOpen) {
                    setFocusBucket(false);
                    setSelectedBucketFocus('ALL');
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusBucket, selectedTaskForEdit, showTaskModal, selectedBucketForEdit, bucketToDelete, taskToDelete, isMcpModalOpen]);

    // Open / Close task modal with URL query param synchronization
    const closedTaskIdRef = useRef<string | null>(null);
    const autoOpenedTaskIdRef = useRef<string | null>(null);

    const handleOpenTask = (task: Task) => {
        closedTaskIdRef.current = null;
        if (task?.id) {
            autoOpenedTaskIdRef.current = String(task.id);
            setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                next.set('taskId', String(task.id));
                return next;
            }, { replace: true });
        }
        setSelectedTaskForEdit(task);
    };

    const handleCloseTask = () => {
        const currentId = selectedTaskForEdit?.id ? String(selectedTaskForEdit.id) : (taskIdParam || null);
        closedTaskIdRef.current = currentId;
        autoOpenedTaskIdRef.current = currentId;
        setSelectedTaskForEdit(null);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('taskId');
            return next;
        }, { replace: true });
    };

    // Auto-open task if ?taskId=... query param is present on mount or navigation
    React.useEffect(() => {
        if (!taskIdParam) {
            closedTaskIdRef.current = null;
            autoOpenedTaskIdRef.current = null;
            return;
        }

        // If the task was explicitly closed or already auto-opened, prevent re-opening on background task/board updates
        if (closedTaskIdRef.current === taskIdParam || autoOpenedTaskIdRef.current === taskIdParam) {
            return;
        }

        const found = tasks.find(t => String(t.id) === String(taskIdParam));
        if (found) {
            autoOpenedTaskIdRef.current = taskIdParam;
            setSelectedTaskForEdit(found);
            setActiveTab('Tasks');
        } else if (!boardLoading) {
            taskService.getTaskById(taskIdParam)
                .then(t => {
                    if (t && String(t.project_id) === String(projectId)) {
                        autoOpenedTaskIdRef.current = taskIdParam;
                        setSelectedTaskForEdit(t);
                        setActiveTab('Tasks');
                    }
                })
                .catch(err => {
                    console.warn("Could not find task for taskId query parameter:", taskIdParam, err);
                });
        }
    }, [taskIdParam, tasks, boardLoading, projectId]);

    // Task Search State & Real-time Matching
    const [taskSearchQuery, setTaskSearchQuery] = useState('');
    const [isSearchingBackend, setIsSearchingBackend] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const matchingTasks = useMemo(() => {
        let result = tasks;

        // Filter by selected assignee dropdown
        if (selectedAssigneeFilter === 'UNASSIGNED') {
            result = result.filter(t => (!t.assignee_ids || t.assignee_ids.length === 0) && !t.lead_assignee_id);
        } else if (selectedAssigneeFilter !== 'ALL') {
            const targetMember = members.find(m => String(m.user_id) === String(selectedAssigneeFilter) || String(m.id) === String(selectedAssigneeFilter));
            const targetIds = new Set<string>();
            targetIds.add(String(selectedAssigneeFilter));
            if (targetMember) {
                if (targetMember.user_id) targetIds.add(String(targetMember.user_id));
                if (targetMember.id) targetIds.add(String(targetMember.id));
            }

            result = result.filter(t => {
                const inAssigneeIds = t.assignee_ids && t.assignee_ids.some(id => targetIds.has(String(id)));
                const inLead = t.lead_assignee_id && targetIds.has(String(t.lead_assignee_id));
                return Boolean(inAssigneeIds || inLead);
            });
        }

        const q = taskSearchQuery.trim().toLowerCase();
        if (!q) return result;

        const rawDigits = q.replace(/^#/, '');

        return result.filter(t => {
            // 1. Match task ID (Snowflake ID substring)
            if (rawDigits && String(t.id).includes(rawDigits)) {
                return true;
            }
            // 2. Match title
            if (t.title && t.title.toLowerCase().includes(q)) {
                return true;
            }
            // 3. Match description
            if (t.description && t.description.toLowerCase().includes(q)) {
                return true;
            }
            // 4. Match type
            if (t.type && t.type.toLowerCase().includes(q)) {
                return true;
            }
            // 5. Match branch
            if (t.branch_name && t.branch_name.toLowerCase().includes(q)) {
                return true;
            }
            // 6. Match all assigned members' names or GitHub usernames
            const allAssigneeIds = (t.assignee_ids && t.assignee_ids.length > 0)
                ? t.assignee_ids.map(String)
                : (t.lead_assignee_id ? [String(t.lead_assignee_id)] : []);
            for (const uid of allAssigneeIds) {
                const assignedMember = members.find(m => String(m.user_id) === uid || String(m.id) === uid);
                if (assignedMember) {
                    if (assignedMember.gh_username && assignedMember.gh_username.toLowerCase().includes(q)) return true;
                    if (assignedMember.display_name && assignedMember.display_name.toLowerCase().includes(q)) return true;
                }
            }
            return false;
        });
    }, [tasks, selectedAssigneeFilter, taskSearchQuery, members]);

    // Active buckets to display on board (allows focusing on a single bucket in expanded view)
    const displayBuckets = useMemo(() => {
        if (!focusBucket || selectedBucketFocus === 'ALL') {
            return buckets;
        }
        return buckets.filter(b => String(b.id) === String(selectedBucketFocus));
    }, [buckets, focusBucket, selectedBucketFocus]);

    // Debounced backend backlog search for tasks not yet in local DOM
    useEffect(() => {
        const q = taskSearchQuery.trim();
        if (q.length < 2) return;

        const timer = setTimeout(() => {
            setIsSearchingBackend(true);
            taskService.searchTasks(projectId, q)
                .then(res => {
                    if (res?.tasks?.length) {
                        setTasksOptimistically((prev: Task[]) => {
                            const existingIds = new Set(prev.map((t: Task) => String(t.id)));
                            const newOnes = res.tasks.filter((t: Task) => !existingIds.has(String(t.id)));
                            if (newOnes.length > 0) {
                                return [...prev, ...newOnes];
                            }
                            return prev;
                        });
                    }
                })
                .catch(err => console.warn("Backend task search error:", err))
                .finally(() => setIsSearchingBackend(false));
        }, 350);

        return () => clearTimeout(timer);
    }, [taskSearchQuery, projectId, setTasksOptimistically]);

    // Keyboard shortcut: Press '/' to focus task search, 'Escape' to clear
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '/' && activeTab === 'Tasks') {
                const activeTag = document.activeElement?.tagName.toLowerCase();
                if (activeTag !== 'input' && activeTag !== 'textarea') {
                    e.preventDefault();
                    searchInputRef.current?.focus();
                }
            } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
                setTaskSearchQuery('');
                searchInputRef.current?.blur();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab]);

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            if (matchingTasks.length === 1) {
                handleOpenTask(matchingTasks[0]);
            } else if (taskSearchQuery.trim()) {
                const q = taskSearchQuery.trim().replace(/^#/, '');
                const exactMatch = matchingTasks.find(t => String(t.id) === q || String(t.id).endsWith(q));
                if (exactMatch) {
                    handleOpenTask(exactMatch);
                }
            }
        }
    };

    // Listen for cross-task reference navigation from Markdown links (e.g. #123)
    useEffect(() => {
        const handleNavigateTask = (e: Event) => {
            const detail = (e as CustomEvent)?.detail;
            if (detail?.taskId) {
                const targetId = String(detail.taskId);
                if (targetId.startsWith('diagram-')) return;
                const found = tasks.find(t => String(t.id) === targetId);
                if (found) {
                    handleOpenTask(found);
                } else {
                    taskService.getTaskById(targetId)
                        .then(t => {
                            if (t) handleOpenTask(t);
                        })
                        .catch(err => console.warn("Failed to open referenced task:", err));
                }
            }
        };
        window.addEventListener('opentask:navigate-task', handleNavigateTask);
        return () => window.removeEventListener('opentask:navigate-task', handleNavigateTask);
    }, [tasks]);

    const handleCreateTask = async (data: { project_id: number | string; title: string; type: TaskType; weight: number; bucket_id?: number | string }) => {
        setIsCreatingTask(true);
        setCreatingTaskBucketId(data.bucket_id);
        setCreatingTaskTitle(data.title);
        try {
            const created = await createTask({ ...data, order_idx: 0 });
            if (created) {
                addTaskLocally(created, true);
            }
            // Immediately disable the indicator as soon as task is created
            setIsCreatingTask(false);
            setCreatingTaskBucketId(undefined);
            setCreatingTaskTitle('');

            // Background sync without blocking indicator dismissal
            refreshDashboard(true);
            refreshBoard(true);
            notifyActivityUpdated();
        } catch (err) {
            console.error('Failed to create task', err);
            setIsCreatingTask(false);
            setCreatingTaskBucketId(undefined);
            setCreatingTaskTitle('');
        }
    };

    const handleDuplicateTask = async (task: Task) => {
        if (!task.id) return;
        const dupTitle = `${task.title} (Copy)`;
        const payload = {
            project_id: projectId,
            title: dupTitle,
            description: task.description || undefined,
            type: task.type || 'TASK',
            weight: task.weight ?? 1,
            bucket_id: task.bucket_id,
            assignee_ids: task.assignee_ids,
            lead_assignee_id: task.lead_assignee_id,
            branch_name: task.branch_name,
            repo_url: task.repo_url,
            attachments: task.attachments,
            diagram_ids: task.diagram_ids,
            start_date: task.start_date,
            target_date: task.target_date,
            order_idx: 0,
        };
        try {
            const created = await createTask(payload as any);
            if (created) {
                addTaskLocally(created, true);
                showToast(`Task duplicated: "${dupTitle}"`, 'success');
                refreshDashboard(true);
                refreshBoard(true);
                notifyActivityUpdated();
            }
        } catch (err: any) {
            console.error("Failed to duplicate task:", err);
            showToast(err?.message || "Failed to duplicate task", "error");
        }
    };

    const handleDeleteTask = async (taskId: number | string) => {
        setDeletingTaskIds(prev => new Set(prev).add(taskId));
        // Remove from any debounced reorder queues immediately to avoid deadlocks
        cancelTaskFromQueue(taskId);

        const taskToDelete = tasks.find(t => String(t.id) === String(taskId));

        try {
            // 1. Delete all attachments associated with this task from Supabase Storage
            try {
                await deleteAllTaskAttachments(taskId, taskToDelete?.attachments);
            } catch (storageErr) {
                console.warn("Failed to delete attachments from storage:", storageErr);
            }

            // 2. Delete task from database
            await deleteTask(taskId);
            removeTaskLocally(taskId);
            await Promise.all([refreshBoard(true), refreshDashboard(true)]);
            notifyActivityUpdated();
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
        markTaskUpdating(taskId);
        // 1. Write optimistic patch to state + cache immediately (no delay)
        updateTaskLocally(taskId, data);
        setSelectedTaskForEdit(prev => (prev && String(prev.id) === String(taskId) ? { ...prev, ...data } : prev));
        // 2. Fire API in background
        try {
            const confirmed = await updateTask(taskId, data);
            // 3. Write server-confirmed result back to cache to prevent stale reload
            if (confirmed?.id) {
                updateTaskLocally(confirmed.id, confirmed);
                setSelectedTaskForEdit(prev => (prev && String(prev.id) === String(confirmed.id) ? { ...prev, ...confirmed } : prev));
            }
            refreshDashboard(true);
            await refreshBoard(true);
            notifyActivityUpdated();
        } catch (err) {
            console.error("Failed to update task:", err);
            // 4. On failure, rollback by pulling fresh data
            await refreshBoard(true);
        } finally {
            unmarkTaskUpdating(taskId);
        }
    };

    const handleToggleTaskComplete = async (taskId: number | string, completed: boolean) => {
        const task = tasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        let targetBucket: Bucket | undefined;
        if (completed) {
            targetBucket = buckets.find(b => b.state === 'COMPLETED');
            if (!targetBucket) {
                try {
                    const newBucket = await createBucket('Completed', 'COMPLETED');
                    if (newBucket) {
                        addBucketLocally(newBucket);
                        targetBucket = newBucket;
                    }
                } catch (err) {
                    console.error('Failed to create completed bucket', err);
                }
            }
        } else {
            targetBucket = buckets.find(b => b.state === 'TODO') || buckets.find(b => b.state === 'ONGOING') || buckets.find(b => b.state !== 'COMPLETED');
        }

        if (targetBucket && targetBucket.id) {
            const completedAt = completed ? new Date().toISOString() : null;
            updateTaskLocally(taskId, { bucket_id: targetBucket.id, completed_at: completedAt });
            handleUpdateTask(taskId, { bucket_id: targetBucket.id, completed_at: completedAt });
            showToast(completed ? "Task marked as complete" : "Task marked as incomplete", "success");
        } else {
            showToast("No suitable column found", "error");
        }
    };

    const handleMoveTaskToBucket = (taskId: string | number, targetBucketId: string | number) => {
        const task = tasks.find(t => String(t.id) === String(taskId));
        if (!task || String(task.bucket_id) === String(targetBucketId)) return;

        const targetBucketTasks = tasks.filter(t => String(t.bucket_id) === String(targetBucketId));
        const newOrderIdx = targetBucketTasks.length;

        handleUpdateTask(taskId, { bucket_id: targetBucketId, order_idx: newOrderIdx });
        const targetBucket = buckets.find(b => String(b.id) === String(targetBucketId));
        showToast(`Moved to ${targetBucket?.name || 'column'}`, "success");
    };

    const handleDropTask = async (taskId: number | string, newBucketId: number | string, targetTaskId?: number | string) => {
        markTaskUpdating(taskId);
        // Determine the task order within the target bucket based on where it was dropped
        const bucketTasks = tasks.filter(t => String(t.bucket_id) === String(newBucketId)).sort((a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0));
        const draggedTask = tasks.find(t => String(t.id) === String(taskId));
        if (!draggedTask) {
            unmarkTaskUpdating(taskId);
            return;
        }

        const sourceBucketId = draggedTask.bucket_id;
        const isCrossBucket = sourceBucketId && String(sourceBucketId) !== String(newBucketId);

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

        // Automatic completion date sync
        const targetBucket = buckets.find(b => String(b.id) === String(newBucketId));
        const isCompletedBucket = targetBucket?.state === 'COMPLETED';
        const completedAt = isCompletedBucket
            ? (draggedTask.completed_at || new Date().toISOString())
            : null;

        // Insert into new array
        const updatedDraggedTask: Task = {
            ...draggedTask,
            bucket_id: newBucketId,
            completed_at: completedAt,
        };
        filteredTasks.splice(newIndex, 0, updatedDraggedTask);

        // Build reordered IDs
        const taskIds = filteredTasks.map(t => t.id!);

        // OPTIMISTIC UPDATE: Update UI instantaneously (0ms)
        let reorderedSourceTasks: Task[] = [];
        if (isCrossBucket) {
            const remainingSourceTasks = tasks
                .filter(t => String(t.bucket_id) === String(sourceBucketId) && String(t.id) !== String(taskId))
                .sort((a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0));
            reorderedSourceTasks = remainingSourceTasks.map((t, idx) => ({ ...t, order_idx: idx }));
            const sourceTaskIds = reorderedSourceTasks.map(t => t.id!);
            queueTaskReorder(sourceBucketId, sourceTaskIds);
        }

        const otherTasks = tasks.filter(
            t => String(t.bucket_id) !== String(newBucketId) &&
                (!isCrossBucket || String(t.bucket_id) !== String(sourceBucketId)) &&
                String(t.id) !== String(taskId)
        );
        const reorderedBucketTasks = filteredTasks.map((t, idx) => ({ ...t, order_idx: idx, bucket_id: newBucketId }));
        const nextTasks = [...otherTasks, ...reorderedSourceTasks, ...reorderedBucketTasks];
        setTasksOptimistically(nextTasks);

        // Asynchronous debounced background sync to database with silent retries
        queueTaskReorder(newBucketId, taskIds);
    };

    const handleSaveBucketSettings = async (bucketId: string | number, data: { name: string; description?: string; state?: BucketState }) => {
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
        e.dataTransfer.effectAllowed = 'move';
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

    const tabs = ['Overview', 'Tasks', 'Diagrams', 'MoM & Meetings', 'Settings'];

    if (projectNotFound) {
        return (
            <NotFoundPage
                type="project"
                resourceId={projectId}
                onRetry={() => {
                    setProjectNotFound(false);
                    projectService.getProjectById(projectId)
                        .then(p => {
                            if (p) setProject(p);
                            else setProjectNotFound(true);
                        })
                        .catch(() => setProjectNotFound(true));
                }}
            />
        );
    }

    const isLoading = (roleLoading || boardLoading || meetingsLoading) && buckets.length === 0 && !project;

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-10rem)] w-full">
                <LoadingScreen
                    fullscreen={false}
                    message="SYNCING PERMISSIONS & DATA…"
                    subtext="VERIFYING RBAC & SYNCHRONIZING BOARD ENGINE"
                />
            </div>
        );
    }

    return (
        <div className={`animate-in fade-in duration-200 flex flex-col max-w-[1600px] mx-auto w-full select-none ${(activeTab === 'Tasks' || activeTab === 'Diagrams') ? 'flex-1 min-h-0' : 'h-full'}`}>
            {/* Header */}
            <div className="flex items-center gap-3.5 mb-4 shrink-0">
                <button
                    onClick={() => navigate(-1)}
                    className="w-9 h-9 rounded-md bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shadow-xs"
                >
                    <ChevronLeft size={18} />
                </button>
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-none">
                        {project ? project.name : 'Loading project...'}
                    </h1>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-4 bg-muted/40 p-1 rounded-lg border border-border w-fit flex-wrap shrink-0">
                {tabs.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 cursor-pointer transition-colors ${activeTab === tab
                            ? 'bg-background text-foreground shadow-xs font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                    >
                        {tab === 'Overview' && <LayoutDashboard size={14} />}
                        {tab === 'Tasks' && <Briefcase size={14} />}
                        {tab === 'Diagrams' && <Network size={14} />}
                        {tab === 'MoM & Meetings' && <Video size={14} />}
                        {tab === 'Settings' && <Settings size={14} />}
                        {tab}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className={`min-h-0 ${(activeTab === 'Tasks' || activeTab === 'Diagrams') ? 'flex-1 flex flex-col' : ''}`}>
                {/* Overview */}
                {activeTab === 'Overview' && (
                    roleLoading ? <div className="text-muted-foreground text-xs py-10 text-center">Resolving permissions...</div> :
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
                    <div
                        className={
                            focusBucket
                                ? "fixed inset-x-0 bottom-0 z-[45] bg-background p-3 flex flex-col min-h-0 overflow-hidden select-none animate-in fade-in duration-150"
                                : "bg-card border border-border rounded-xl p-3 flex flex-col flex-1 min-h-0 shadow-xs"
                        }
                        style={focusBucket ? { top: 'var(--titlebar-height, 0px)' } : undefined}
                    >
                        <div className="flex justify-between items-center mb-3 pb-3 border-b border-border flex-wrap gap-2 shrink-0">
                            <div className="flex w-full gap-2 justify-space-between">
                                { /* Left SIDE */}
                                <div className="flex items-center gap-3 flex-1 min-w-[260px] flex-wrap">
                                    <div className="relative flex-1 min-w-[220px] max-w-[410px]">
                                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted-foreground">
                                            <Search size={14} />
                                        </div>
                                        <input
                                            ref={searchInputRef}
                                            type="text"
                                            value={taskSearchQuery}
                                            onChange={(e) => setTaskSearchQuery(e.target.value)}
                                            onKeyDown={handleSearchKeyDown}
                                            placeholder="Search tasks (title, #id, tag, assignee)... [/]"
                                            className="w-full bg-background border border-input rounded-md pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                                        />
                                        {taskSearchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setTaskSearchQuery('')}
                                                className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
                                                title="Clear search (Esc)"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Assignee Filter Dropdown */}
                                    <div className="flex items-center gap-1.5 bg-background border border-input rounded-md px-2.5 py-1.5 shadow-xs">
                                        <Filter size={13} className="text-primary shrink-0" />
                                        <span className="text-xs font-medium text-muted-foreground shrink-0">Assignee:</span>
                                        <select
                                            value={selectedAssigneeFilter}
                                            onChange={(e) => setSelectedAssigneeFilter(e.target.value)}
                                            className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer"
                                        >
                                            <option value="ALL" className="bg-card text-foreground">All Assignees ({tasks.length})</option>
                                            <option value="UNASSIGNED" className="bg-card text-foreground">
                                                Unassigned ({tasks.filter(t => (!t.assignee_ids || t.assignee_ids.length === 0) && !t.lead_assignee_id).length})
                                            </option>
                                            {members.map(m => {
                                                const uid = String(m.user_id);
                                                const targetIds = new Set<string>([uid]);
                                                if (m.id) targetIds.add(String(m.id));

                                                const count = tasks.filter(t =>
                                                    (t.assignee_ids && t.assignee_ids.some(id => targetIds.has(String(id)))) ||
                                                    (t.lead_assignee_id && targetIds.has(String(t.lead_assignee_id)))
                                                ).length;
                                                return (
                                                    <option key={uid} value={uid} className="bg-card text-foreground">
                                                        @{m.gh_username || m.display_name || `Member #${uid}`} ({count})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>

                                    {/* Bucket Focus Dropdown */}
                                    <div className="flex items-center gap-1.5 bg-background border border-input rounded-md px-2.5 py-1.5 shadow-xs">
                                        <Filter size={13} className="text-primary shrink-0" />
                                        <span className="text-xs font-medium text-muted-foreground shrink-0">Column:</span>
                                        <select
                                            value={selectedBucketFocus}
                                            onChange={(e) => setSelectedBucketFocus(e.target.value)}
                                            className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer"
                                        >
                                            <option value="ALL" className="bg-card text-foreground">
                                                All Columns ({buckets.length})
                                            </option>
                                            {buckets.map(b => {
                                                const bTasksCount = matchingTasks.filter(t => String(t.bucket_id) === String(b.id)).length;
                                                return (
                                                    <option key={b.id} value={String(b.id)} className="bg-card text-foreground">
                                                        {b.name || b.state} ({bTasksCount})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>

                                    {(taskSearchQuery.trim() || selectedAssigneeFilter !== 'ALL' || selectedBucketFocus !== 'ALL') && (
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 bg-muted text-muted-foreground border border-border rounded-md text-xs font-medium">
                                                <span className="text-primary font-semibold mr-1">{matchingTasks.length}</span>
                                                of {tasks.length} matching
                                            </span>
                                            {isSearchingBackend && (
                                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <Loader2 size={12} className="animate-spin text-primary" />
                                                    Searching backlog...
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setTaskSearchQuery('');
                                                    setSelectedAssigneeFilter('ALL');
                                                    setSelectedBucketFocus('ALL');
                                                }}
                                                className="p-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border text-xs cursor-pointer transition-colors"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                { /* Right SIDE */}
                                <div className='flex items-center gap-3'>
                                    { /* Standard / Wide Mode */}
                                    <div className="flex items-center border border-border bg-muted/40 p-0.5 rounded-lg">
                                        <button
                                            type="button"
                                            onClick={() => setColumnDensity('normal')}
                                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${columnDensity === 'normal'
                                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                                : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                            title="Standard column width (316px)"
                                        >
                                            Standard
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setColumnDensity('wide')}
                                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${columnDensity === 'wide'
                                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                                : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                            title="Wide column width (420px)"
                                        >
                                            Wide
                                        </button>
                                    </div>

                                    { /* AI MCP */}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setIsMcpModalOpen(true)}
                                        title="Configure IDE Model Context Protocol (MCP) server endpoints"
                                    >
                                        <Cpu size={13} />
                                        <span>AI MCP</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleSyncAndReviewPrs}
                                        disabled={isSyncingPrs}
                                        title="Scan connected repositories and immediately run Gemini AI Code Review on open PRs"
                                    >
                                        <Sparkles size={13} className={isSyncingPrs ? 'animate-spin' : ''} />
                                        <span>{isSyncingPrs ? 'Reviewing PRs...' : 'Sync & Review PRs'}</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleRefreshTasksOnly}
                                        disabled={isRefreshingTasks}
                                        title="Refresh tasks without reloading the web page"
                                    >
                                        <RefreshCw size={13} className={isRefreshingTasks ? 'animate-spin' : ''} />
                                    </Button>
                                    {focusBucket ? (
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => {
                                                setFocusBucket(false);
                                                setSelectedBucketFocus('ALL');
                                            }}
                                            title="Exit expanded view (Esc)"
                                        >
                                            <Shrink size={13} />
                                            <kbd className="hidden sm:inline bg-primary-foreground/20 text-primary-foreground px-1 py-0.2 text-[9px] rounded font-mono">ESC</kbd>
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setFocusBucket(true)}
                                            title="Expand bucket and board workspace"
                                        >
                                            <Expand size={13} />
                                        </Button>
                                    )}
                                </div>

                            </div>
                        </div>
                        {tasksLoading || bucketsLoading ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500 text-[14px]">Loading board state...</div>
                        ) : (
                            <div ref={boardScrollRef} className="flex gap-3 overflow-x-auto pb-2 flex-1 min-h-0 items-stretch">
                                {displayBuckets.map(bucket => {
                                    const isFiltered = Boolean(taskSearchQuery.trim() || selectedAssigneeFilter !== 'ALL');
                                    const colTasks = matchingTasks.filter(t => String(t.bucket_id) === String(bucket.id));
                                    return (
                                        <KanbanColumn
                                            key={bucket.id}
                                            id={bucket.id!}
                                            name={bucket.name || bucket.state}
                                            description={bucket.description}
                                            colorClass={STATUS_COLORS[bucket.state] || 'bg-slate-500'}
                                            taskCount={colTasks.length}
                                            totalTasks={isFiltered ? colTasks.length : bucket.task_count}
                                            isLoadingMore={!!loadingBuckets[String(bucket.id)]}
                                            onLoadMore={loadMoreBucketTasks}
                                            onDropTask={handleDropTask}
                                            onDragStartColumn={handleDragStartColumn}
                                            onDropColumn={handleDropColumn}
                                            onAddTask={(bId) => { setSelectedBucketTarget(bId); setShowTaskModal(true); }}
                                            onDeleteBucket={(bId) => setBucketToDelete(bId)}
                                            onEditBucket={() => setSelectedBucketForEdit(bucket)}
                                            onFocusBucket={(bId) => {
                                                setFocusBucket(true);
                                                setSelectedBucketFocus(String(bId));
                                            }}
                                            widthClass={
                                                selectedBucketFocus !== 'ALL'
                                                    ? 'min-w-[420px] max-w-4xl flex-1'
                                                    : columnDensity === 'wide'
                                                        ? 'min-w-[420px] w-[512px]'
                                                        : 'min-w-[316px] w-[360px]'
                                            }
                                        >
                                            <div className="flex flex-col gap-3">
                                                <button
                                                    onClick={() => { setSelectedBucketTarget(bucket.id); setShowTaskModal(true); }}
                                                    className="w-full py-2 flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/50 hover:bg-muted/40 rounded-lg transition-colors text-xs font-medium cursor-pointer"
                                                >
                                                    <Plus size={14} /> Add Task
                                                </button>

                                                {/* In-flight new task creation ghost card */}
                                                {isCreatingTask && String(creatingTaskBucketId) === String(bucket.id) && (
                                                    <div className="border border-dashed border-primary/40 bg-primary/5 rounded-lg p-3 animate-pulse">
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <Loader2 size={13} className="animate-spin text-primary" />
                                                            <span className="text-xs text-primary font-medium">Creating task...</span>
                                                        </div>
                                                        <div className="text-xs text-foreground font-medium truncate">
                                                            {creatingTaskTitle || 'New task'}
                                                        </div>
                                                    </div>
                                                )}

                                                {colTasks.map(task => {
                                                    const isDeleting = deletingTaskIds.has(task.id!);
                                                    if (isDeleting) {
                                                        return (
                                                            <div
                                                                key={task.id}
                                                                className="border border-dashed border-destructive/40 bg-destructive/5 rounded-lg p-3 animate-pulse select-none"
                                                            >
                                                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                                                    <div className="flex items-center gap-2">
                                                                        <Loader2 size={13} className="animate-spin text-destructive" />
                                                                        <span className="text-xs text-destructive font-medium">
                                                                            Removing task...
                                                                        </span>
                                                                    </div>
                                                                    <span className="text-xs text-muted-foreground font-mono">
                                                                        #{String(task.id).slice(-4)}
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-muted-foreground truncate line-through">
                                                                    {task.title}
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    const isTaskCompleted = bucket.state === 'COMPLETED' || task.status === 'COMPLETED';
                                                    const rawAssigneeIds = (task.assignee_ids && task.assignee_ids.length > 0)
                                                        ? task.assignee_ids.map(String)
                                                        : (task.lead_assignee_id ? [String(task.lead_assignee_id)] : []);
                                                    const cardAssignees = rawAssigneeIds.map(uid => {
                                                        const m = members.find(mem => String(mem.user_id) === uid);
                                                        return {
                                                            userId: uid,
                                                            name: m?.gh_username || m?.display_name || `Member #${uid}`,
                                                            avatarUrl: m?.avatar_url || (m?.gh_username ? `https://github.com/${m.gh_username}.png?size=64` : undefined),
                                                        };
                                                    });

                                                    const assignedMember = task.lead_assignee_id ? members.find(m => String(m.user_id) === String(task.lead_assignee_id)) : undefined;
                                                    const assigneeName = assignedMember?.gh_username || assignedMember?.display_name || (task.lead_assignee_id ? `User #${task.lead_assignee_id}` : undefined);
                                                    const assigneeAvatar = assignedMember?.avatar_url || (assignedMember?.gh_username ? `https://github.com/${assignedMember.gh_username}.png?size=64` : undefined);

                                                    return (
                                                         <KanbanCard
                                                             key={task.id}
                                                             id={task.id!}
                                                             title={task.title}
                                                             type={task.type}
                                                             weight={task.weight}
                                                             assignee={assigneeName}
                                                             assigneeAvatar={assigneeAvatar}
                                                             assignees={cardAssignees}
                                                             pr={!!task.prUrl}
                                                             repoUrl={task.repo_url}
                                                             description={task.description}
                                                             warnStagnant={task.warnStagnant}
                                                             isSuggested={task.isSuggested}
                                                             isCompleted={isTaskCompleted}
                                                             isUpdating={updatingTaskIds.has(String(task.id))}
                                                             start_date={task.start_date}
                                                             target_date={task.target_date}
                                                             completed_at={task.completed_at}
                                                             onToggleComplete={(completed) => handleToggleTaskComplete(task.id!, completed)}
                                                             onContextMenu={(e) => setContextMenu({ task, x: e.clientX, y: e.clientY })}
                                                             onClick={() => handleOpenTask(task)}
                                                             onDelete={() => setTaskToDelete(task.id!)}
                                                             onDropTask={(draggedTaskId, targetTaskId) => handleDropTask(draggedTaskId, bucket.id!, targetTaskId)}
                                                         />
                                                    );
                                                })}
                                            </div>
                                        </KanbanColumn>

                                    );
                                })}

                                {/* In-Flight Creating Column Indicator */}
                                {isCreatingBucketSubmitting && (
                                    <div className="min-w-[316px] w-[316px] shrink-0 border border-dashed border-primary/40 bg-primary/5 p-5 rounded-xl flex flex-col justify-center items-center shadow-xs animate-pulse h-full">
                                        <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase mb-2">
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>Creating column...</span>
                                        </div>
                                        <div className="text-sm text-foreground font-semibold truncate max-w-[260px] text-center">
                                            {newBucketName || 'New column'}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1.5">
                                            State: {newBucketState}
                                        </div>
                                    </div>
                                )}

                                {/* Add New Bucket Column */}
                                {selectedBucketFocus === 'ALL' && (
                                    <div className="min-w-[280px] w-[280px] shrink-0">
                                        {!isCreatingBucket ? (
                                            <button
                                                onClick={() => setIsCreatingBucket(true)}
                                                className="w-full h-11 border border-dashed border-border bg-card/50 hover:bg-muted/50 rounded-xl flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-xs font-medium cursor-pointer"
                                            >
                                                <Plus size={15} /> Add Column
                                            </button>
                                        ) : (
                                            <div className="border border-border rounded-xl bg-card p-4 space-y-3 shadow-xs">
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
                                                    placeholder="Column name"
                                                    className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
                                                />
                                                <div className="space-y-1">
                                                    <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Behavior State</label>
                                                    <select
                                                        value={newBucketState}
                                                        disabled={isCreatingBucketSubmitting}
                                                        onChange={(e) => setNewBucketState(e.target.value as BucketState)}
                                                        className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50 cursor-pointer"
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
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={handleCreateBucket}
                                                        disabled={!newBucketName.trim() || isCreatingBucketSubmitting}
                                                        className="flex-1"
                                                    >
                                                        {isCreatingBucketSubmitting ? (
                                                            <>
                                                                <Loader2 size={13} className="animate-spin" />
                                                                <span>Creating...</span>
                                                            </>
                                                        ) : (
                                                            'Save'
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={isCreatingBucketSubmitting}
                                                        onClick={() => { setIsCreatingBucket(false); setNewBucketName(''); setNewBucketState('TODO'); }}
                                                        className="flex-1"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}


                    </div>
                )}

                {/* Diagrams */}
                {activeTab === 'Diagrams' && (
                    <ProjectDiagramsTab
                        projectId={projectId}
                        tasks={tasks}
                        isManager={isManager}
                    />
                )}

                {/* MoM & Meetings */}
                {activeTab === 'MoM & Meetings' && (
                    <div className="space-y-6">
                        <MeetingIntelligenceTab
                            projectId={projectId}
                            members={members}
                            buckets={buckets}
                            refreshKey={meetingEventKey}
                            initialJobId={meetingJobParam}
                            onReviewClosed={() => setSearchParams(prev => {
                                const next = new URLSearchParams(prev);
                                next.delete('meetingJob');
                                return next;
                            }, { replace: true })}
                            meetings={meetings}
                            meetingsLoading={meetingsLoading}
                            onMeetingChanged={refreshMeeting}
                            onMeetingsChanged={refreshMeetings}
                            onDeleteMeeting={deleteMeeting}
                        />
                    </div>
                )}

                {/* Settings */}
                {activeTab === 'Settings' && (
                    <ProjectSettingsTab
                        projectId={projectId}
                        onProjectUpdated={(updated) => setProject(updated)}
                        onMembersChanged={refreshMembers}
                        onMemberRemoved={handleMemberRemoved}
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
                    projectRepoUrls={project?.gh_repo_url || []}
                    allTasks={tasks}
                    onClose={handleCloseTask}
                    onUpdate={handleUpdateTask}
                    onDuplicate={handleDuplicateTask}
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

            <McpConfigModal
                isOpen={isMcpModalOpen}
                onClose={() => setIsMcpModalOpen(false)}
                projectId={projectId}
                projectName={project?.name}
            />

            <TaskContextMenu
                contextMenu={contextMenu}
                buckets={buckets}
                onClose={() => setContextMenu(null)}
                onEdit={(t) => handleOpenTask(t)}
                onToggleComplete={(tId, completed) => handleToggleTaskComplete(tId, completed)}
                onMoveToBucket={handleMoveTaskToBucket}
                onDuplicate={handleDuplicateTask}
                onDelete={(tId) => setTaskToDelete(tId)}
            />

            {taskToDelete && (
                <ConfirmModal
                    title="DELETE TASK"
                    message="Are sure want to permanently delete this task? This record will be permanently purged from data base."
                    confirmLabel="DELETE TASK"
                    cancelLabel="CANCEL"
                    variant="danger"
                    onConfirm={() => {
                        if (taskToDelete) {
                            handleDeleteTask(taskToDelete);
                            setTaskToDelete(null);
                        }
                    }}
                    onCancel={() => setTaskToDelete(null)}
                />
            )}
        </div>
    );
};
