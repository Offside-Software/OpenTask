import React, { useState, useEffect, useRef } from 'react';
import { CheckSquare, AlignLeft, Tag, GitPullRequest, Activity, Check, Plus, GitBranch, ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Loader2, Sparkles, RotateCcw, Users } from 'lucide-react';
import type { Task, Bucket, ProjectMember, PrReview, ExtractedTask } from '../../models';
import { getAllTaskTypes, saveCustomTaskType, parseTaskTypes, serializeTaskTypes, getTaskTypeVariant } from '../../utils/taskTypes';
import { CloseButton } from '../../design-system/CloseButton';
import { useToast } from '../../design-system/Toast';
import { Badge } from '../../design-system/Badge';
import { MarkdownRenderer } from '../../design-system/MarkdownRenderer';
import { prReviewService } from '../../services/prReviewService';
import { ConfirmModal } from './ConfirmModal';
import { ReviewTaskExtractionModal } from './ReviewTaskExtractionModal';

interface TaskDetailModalProps {
    task: Task;
    buckets: Bucket[];
    members: ProjectMember[];
    projectRepoUrls?: string[];
    onClose: () => void;
    onUpdate: (taskId: string | number, data: Partial<Task>) => Promise<void>;
}

const TASK_WEIGHTS = [1, 2, 3, 5, 8]; // Fibonacci sequence for story points

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
    task, buckets, members, projectRepoUrls = [], onClose, onUpdate
}) => {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || '');
    const [repoUrl, setRepoUrl] = useState(task.repo_url || '');
    const [prUrl, setPrUrl] = useState(task.prUrl || '');
    const [reviews, setReviews] = useState<PrReview[]>([]);
    const [loadingReviews, setLoadingReviews] = useState(false);
    const [reviewsError, setReviewsError] = useState<string | null>(null);
    const [expandedReviewId, setExpandedReviewId] = useState<string | number | null>(null);
    const [extractingReviewId, setExtractingReviewId] = useState<string | number | null>(null);
    const [showExtractionModal, setShowExtractionModal] = useState(false);
    const [extractionData, setExtractionData] = useState<{
        review: PrReview;
        tasks: ExtractedTask[];
    } | null>(null);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(() => {
        const parsed = parseTaskTypes(task.type);
        return parsed.length > 0 ? parsed : ['CODE'];
    });
    const [weight, setWeight] = useState<number>(task.weight);
    const [bucketId, setBucketId] = useState<string | undefined>(task.bucket_id ? String(task.bucket_id) : undefined);
    const [assigneeIds, setAssigneeIds] = useState<string[]>(() => {
        if (task.assignee_ids && task.assignee_ids.length > 0) {
            return task.assignee_ids.map(String);
        }
        return task.lead_assignee_id ? [String(task.lead_assignee_id)] : [];
    });
    const [leadAssigneeId, setLeadAssigneeId] = useState<string | undefined>(task.lead_assignee_id ? String(task.lead_assignee_id) : undefined);
    const [availableTypes, setAvailableTypes] = useState<string[]>(() => getAllTaskTypes([task.type]));
    const [isAddingType, setIsAddingType] = useState(false);
    const [customTypeInput, setCustomTypeInput] = useState('');
    const { showToast } = useToast();
    const previousTaskId = useRef<string | number | undefined>(task.id);

    const handleToggleAssignee = (userId: string) => {
        setAssigneeIds(prev => {
            const next = prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId];
            setLeadAssigneeId(next.length > 0 ? next[0] : undefined);
            return next;
        });
    };

    const handleRemoveAssignee = (userId: string) => {
        setAssigneeIds(prev => {
            const next = prev.filter(id => id !== userId);
            setLeadAssigneeId(next.length > 0 ? next[0] : undefined);
            return next;
        });
    };

    const handleToggleType = (t: string) => {
        setSelectedTypes(prev => {
            if (prev.includes(t)) {
                if (prev.length === 1) return prev; // Keep at least 1 type
                return prev.filter(item => item !== t);
            } else {
                return [...prev, t];
            }
        });
    };

    const handleAddCustomType = () => {
        const trimmed = customTypeInput.trim().toUpperCase();
        if (!trimmed) return;
        saveCustomTaskType(trimmed);
        setAvailableTypes(getAllTaskTypes([trimmed]));
        setSelectedTypes(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
        setCustomTypeInput('');
        setIsAddingType(false);
    };

    const [branchName, setBranchName] = useState(task.branch_name || '');
    const [saving, setSaving] = useState(false);

    const currentBucket = buckets.find(b => String(b.id) === String(bucketId));
    const isCompleted = currentBucket?.state === 'COMPLETED';

    const [previousBucketId, setPreviousBucketId] = useState<string | undefined>(() => {
        if (currentBucket && currentBucket.state !== 'COMPLETED') {
            return String(currentBucket.id);
        }
        const fallback = buckets.find(b => b.state === 'TODO') || buckets.find(b => b.state === 'ONGOING') || buckets.find(b => b.state !== 'COMPLETED');
        return fallback ? String(fallback.id) : undefined;
    });

    const handleToggleComplete = (markComplete: boolean) => {
        if (markComplete) {
            if (currentBucket && currentBucket.state !== 'COMPLETED') {
                setPreviousBucketId(String(currentBucket.id));
            }
            const compBucket = buckets.find(b => b.state === 'COMPLETED');
            if (compBucket) {
                setBucketId(String(compBucket.id));
            }
        } else {
            const fallback = (previousBucketId && buckets.some(b => String(b.id) === String(previousBucketId) && b.state !== 'COMPLETED'))
                ? previousBucketId
                : (buckets.find(b => b.state === 'TODO') || buckets.find(b => b.state === 'ONGOING') || buckets.find(b => b.state !== 'COMPLETED'))?.id;
            if (fallback) {
                setBucketId(String(fallback));
            }
        }
    };

    const loadReviews = async () => {
        if (!task.id) return;
        setLoadingReviews(true);
        setReviewsError(null);
        try {
            const data = await prReviewService.getTaskReviews(task.id);
            const list = data || [];
            setReviews(list);
            if (list.length > 0) {
                // Automatically expand the latest review so feedback is immediately visible
                setExpandedReviewId(prev => prev ?? list[0].id);
            }
        } catch (err: any) {
            console.error("Failed to load task PR reviews", err);
            setReviewsError(err?.message || "Failed to load PR reviews.");
        } finally {
            setLoadingReviews(false);
        }
    };

    useEffect(() => {
        loadReviews();
    }, [task.id]);

    const [triggeringReview, setTriggeringReview] = useState(false);
    const [triggerError, setTriggerError] = useState<string | null>(null);

    const handleTriggerReview = async () => {
        const pId = task.project_id;
        if (!pId || !task.id) return;
        const selectedRepo = repoUrl
            .trim()
            .replace(/^https?:\/\/github\.com\//i, '')
            .replace(/\/+$/, '')
            .replace(/\.git$/i, '');
        setTriggeringReview(true);
        setTriggerError(null);
        try {
            const review = await prReviewService.triggerReview(pId, {
                task_id: task.id,
                repo_full_name: selectedRepo || undefined,
                pr_url: prUrl.trim() || undefined,
            });
            const queuedRepo = review.repo_full_name.toLowerCase();
            const queuedPr = Number(review.pr_number);
            const updated = await prReviewService.getTaskReviews(task.id);
            setReviews(updated);
            const completedReview = updated.find(r =>
                r.repo_full_name.toLowerCase() === queuedRepo && Number(r.pr_number) === queuedPr,
            );
            if (completedReview) {
                setExpandedReviewId(completedReview.id);
                showToast(
                    `AI Code Review completed for ${review.repo_full_name}#${review.pr_number}: ${completedReview.verdict}`,
                    completedReview.verdict === 'PASS' ? 'success' : 'error',
                );
            } else {
                if (updated.length > 0) {
                    setExpandedReviewId(updated[0].id);
                }
                showToast(`AI Code Review finished for ${review.repo_full_name}#${review.pr_number}`, 'info');
            }
        } catch (err: any) {
            console.error("Failed to trigger review", err);
            const msg = err?.message || "Failed to trigger review. Ensure repo has open PR or branch matches.";
            setTriggerError(msg);
            showToast("Failed to run AI Code Review", "error");
        } finally {
            setTriggeringReview(false);
        }
    };

    const handleExtractTasks = async (rev: PrReview) => {
        const pId = task.project_id;
        if (!pId || !rev.id) return;
        setExtractingReviewId(rev.id);
        try {
            const extracted = await prReviewService.extractTasks(pId, rev.id, rev.feedback);
            if (!extracted || extracted.length === 0) {
                showToast("No actionable issues or suggestions detected in this review", "info");
                return;
            }
            setExtractionData({
                review: rev,
                tasks: extracted,
            });
            setShowExtractionModal(true);
        } catch (err: any) {
            console.error("Failed to extract tasks from review", err);
            showToast(err?.message || "Failed to extract tasks from review", "error");
        } finally {
            setExtractingReviewId(null);
        }
    };

    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

    const initialAssigneeIds = (task.assignee_ids && task.assignee_ids.length > 0)
        ? task.assignee_ids.map(String)
        : (task.lead_assignee_id ? [String(task.lead_assignee_id)] : []);

    const isDirty = Boolean(
        title !== task.title ||
        description !== (task.description || '') ||
        repoUrl !== (task.repo_url || '') ||
        prUrl !== (task.prUrl || '') ||
        branchName !== (task.branch_name || '') ||
        weight !== task.weight ||
        bucketId !== (task.bucket_id ? String(task.bucket_id) : undefined) ||
        leadAssigneeId !== (task.lead_assignee_id ? String(task.lead_assignee_id) : undefined) ||
        JSON.stringify([...assigneeIds].sort()) !== JSON.stringify([...initialAssigneeIds].sort()) ||
        JSON.stringify([...selectedTypes].sort()) !== JSON.stringify([...parseTaskTypes(task.type)].sort())
    );

    useEffect(() => {
        const taskChanged = String(previousTaskId.current) !== String(task.id);
        previousTaskId.current = task.id;

        // Realtime board updates replace the task object while this modal is
        // open. Never overwrite a draft unless the user switched tasks.
        if (!taskChanged && isDirty) return;

        setTitle(task.title);
        setDescription(task.description || '');
        const parsed = parseTaskTypes(task.type);
        setSelectedTypes(parsed.length > 0 ? parsed : ['CODE']);
        setWeight(task.weight);
        setBucketId(task.bucket_id ? String(task.bucket_id) : undefined);
        const currentTaskAssigneeIds = (task.assignee_ids && task.assignee_ids.length > 0)
            ? task.assignee_ids.map(String)
            : (task.lead_assignee_id ? [String(task.lead_assignee_id)] : []);
        setAssigneeIds(currentTaskAssigneeIds);
        setLeadAssigneeId(task.lead_assignee_id ? String(task.lead_assignee_id) : (currentTaskAssigneeIds[0] || undefined));
        setBranchName(task.branch_name || '');
        setRepoUrl(task.repo_url || '');
        setPrUrl(task.prUrl || '');
        setAvailableTypes(getAllTaskTypes([task.type]));
    }, [task, isDirty]);

    useEffect(() => {
        if (!isDirty) return;
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    const handleAttemptClose = () => {
        if (isDirty) {
            setShowDiscardConfirm(true);
        } else {
            onClose();
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !task.id) return;

        setSaving(true);
        const finalType = serializeTaskTypes(selectedTypes) || 'OTHER';
        const updatePayload: Partial<Task> = {
            title: title.trim(),
            description: description.trim() || undefined,
            type: finalType,
            weight: Number(weight),
            bucket_id: bucketId || undefined,
            assignee_ids: assigneeIds,
            lead_assignee_id: assigneeIds.length > 0 ? assigneeIds[0] : null,
            branch_name: branchName.trim() || undefined,
            repo_url: repoUrl.trim() || undefined,
        };
        try {
            await onUpdate(task.id, updatePayload);
            onClose();
        } catch (err) {
            console.error("Failed to update task", err);
        } finally {
            setSaving(false);
        }
    };

    const handleCopyIdToClipboard = async(taskId: string) => {
        try {
            await navigator.clipboard.writeText(taskId);
            showToast(`Task ID '${taskId}' Copied to Clipboard`, 'success');
        }
        catch {
            showToast("Task ID Copied to Clipboard", 'warning');
        }
    }

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none">
            <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-5xl shadow-[8px_8px_0px_0px_#000000] flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-start flex-col gap-3 p-6 border-b-2 border-black bg-[#181B20]">
                    <div className="flex items-center gap-3 w-full">
                        <div className={`p-2 rounded-none ${isCompleted ? 'bg-[#00FF66]' : 'bg-[#FFE600]'} text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] shrink-0 transition-colors`}>
                            <CheckSquare size={18} strokeWidth={2.5} />
                        </div>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="TASK TITLE"
                            className={`bg-transparent ${isCompleted ? 'text-neutral-400 line-through' : 'text-white'} font-mono font-black uppercase text-lg w-full focus:outline-none focus:border-b-2 focus:border-[#FFE600] rounded-none px-2 py-1 -ml-2 transition-all`}
                        />
                        {isDirty && (
                            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#FFE600] text-black border border-black font-mono text-[10px] font-black uppercase tracking-wider shrink-0 shadow-[1px_1px_0px_0px_#000000]">
                                <span className="w-1.5 h-1.5 bg-black rounded-full animate-ping"></span>
                                UNSAVED
                            </span>
                        )}
                        <CloseButton onClick={handleAttemptClose} size='md'/>
                    </div>
                    <div className="flex items-center justify-between w-full flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400 uppercase">
                            <span>// PROJECT PIPELINE</span>
                            <span className="w-1.5 h-1.5 bg-[#FFE600]"></span>
                            <button type='button' onClick={(e) => {
                                    e.stopPropagation();
                                    const clipboardStr = `[${title}](#${String(task.id)})`
                                    handleCopyIdToClipboard(clipboardStr);
                                }}
                                className="font-mono text-[13px] px-2 text-neutral-500 font-bold hover:bg-[#00FF66] hover:text-black hover:border-black hover:border hover:shadow-[1.5px_1.5px_0px_0px_#000000]">
                                TASK ID: #{String(task.id)}
                            </button>
                        </div>

                        {/* Mark as Complete Checkbox in Header */}
                        <button
                            type="button"
                            onClick={() => handleToggleComplete(!isCompleted)}
                            className={`flex items-center gap-2 cursor-pointer select-none px-3 py-1 border-2 transition-all active:translate-x-[1px] active:translate-y-[1px] ${
                                isCompleted
                                    ? 'bg-[#00FF66] hover:bg-[#FF3333] border-black shadow-[2px_2px_0px_0px_#000000]'
                                    : 'hover:bg-[#00FF66] border-black shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className={`w-4 h-4 rounded-none border-2 flex items-center justify-center transition-all ${
                                isCompleted
                                    ? 'bg-transparent border-black text-black shadow-[1px_1px_0px_0px_#000000]'
                                    : 'bg-[#16191D] border-neutral-600'
                            }`}>
                                {isCompleted && <Check size={11} strokeWidth={3.5} />}
                            </div>
                            <span className={`text-[11px] font-mono font-black tracking-wider uppercase ${
                                isCompleted ? 'text-black' : 'text-neutral-300 hover:text-black'
                            }`}>
                                {isCompleted ? 'COMPLETED' : 'MARK AS COMPLETE'}
                            </span>
                        </button>
                    </div>
                </div>

                {/* Form Body - Scrollable */}
                <form id="task-detail-form" onSubmit={handleSave} className="p-6 flex-1 overflow-y-auto flex flex-col md:flex-row gap-8 font-mono">

                    {/* Main Content (Left) */}
                    <div className="flex-1 space-y-6">
                        {/* Description */}
                        <div>
                            <div className="flex items-center gap-2 mb-2 text-white font-black text-[12px] uppercase">
                                <AlignLeft size={14} />
                                <h3>// DESCRIPTION</h3>
                            </div>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="ENTER TECHNICAL SPECIFICATIONS OR REQUIREMENTS..."
                                className="w-full h-64 bg-[#0B0E14] border-2 border-black rounded-none px-4 py-3 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-all resize-y"
                            />
                        </div>

                        {/* Git Branch / PR */}
                        <div>
                            <div className="flex items-center gap-2 mb-2 text-white font-black text-[12px] uppercase">
                                <GitPullRequest size={14} />
                                <h3>// DEVELOPMENT PIPELINE</h3>
                            </div>
                            <div className="bg-[#0B0E14] border-2 border-black rounded-none p-4 space-y-3 shadow-[2px_2px_0px_0px_#000000]">
                                {/* Target Repository */}
                                <div>
                                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                        <GitBranch size={11} /> TARGET REPOSITORY
                                    </label>
                                    <select
                                        value={repoUrl}
                                        onChange={(e) => setRepoUrl(e.target.value)}
                                        className="w-full bg-[#121417] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono text-white focus:outline-none focus:border-[#FFE600] transition-all"
                                    >
                                        <option value="">[UNASSIGNED - GENERAL TASK]</option>
                                        {projectRepoUrls && projectRepoUrls.map(url => {
                                            const repoName = url.replace('https://github.com/', '');
                                            return (
                                                <option key={url} value={url}>{repoName}</option>
                                            );
                                        })}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">BRANCH NAME</label>
                                    <input
                                        value={branchName}
                                        onChange={(e) => setBranchName(e.target.value)}
                                        placeholder="feature/auth-roles"
                                        className="w-full bg-[#121417] border-2 border-black rounded-none px-3 py-2 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">PULL REQUEST URL</label>
                                    <input
                                        value={prUrl}
                                        onChange={(e) => setPrUrl(e.target.value)}
                                        placeholder="https://github.com/OWNER/REPO/pull/123"
                                        className="w-full bg-[#121417] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] transition-all"
                                    />
                                </div>
                                {prUrl && (
                                    <div className="text-[11px] font-mono">
                                        <span className="text-neutral-400 uppercase">PULL REQUEST: </span>
                                        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-[#FFE600] hover:underline font-bold">{prUrl}</a>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Gemini AI PR Reviews & Verdicts */}
                        <div>
                            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <div className="flex items-center gap-2 text-white font-black text-[12px] uppercase">
                                    <ShieldCheck size={14} className="text-[#00FF66]" />
                                    <h3>// AI CODE REVIEWS</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    {reviews.length > 0 && (
                                        <span className="font-mono text-[10px] text-neutral-400 uppercase">
                                            {reviews.length} REVIEW{reviews.length !== 1 ? 'S' : ''}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={loadReviews}
                                        disabled={loadingReviews}
                                        title="Reload reviews"
                                        className="p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        <RotateCcw size={11} className={loadingReviews ? 'animate-spin' : ''} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleTriggerReview}
                                        disabled={triggeringReview}
                                        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black font-mono uppercase bg-[#FFE600] text-black border-2 border-black hover:bg-yellow-300 disabled:opacity-50 transition-all shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                                        title="Immediately spawn Gemini Code Review for this task"
                                    >
                                        {triggeringReview ? (
                                            <>
                                                <Loader2 size={11} className="animate-spin" />
                                                <span>EVALUATING...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={11} />
                                                <span>RUN AI REVIEW</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {triggerError && (
                                <div className="mb-2 p-2 bg-red-950/40 border-2 border-red-700 text-red-300 font-mono text-[11px]">
                                    ⚠ {triggerError}
                                </div>
                            )}

                            <div className="bg-[#0B0E14] border-2 border-black rounded-none p-4 space-y-3 shadow-[2px_2px_0px_0px_#000000]">
                                {loadingReviews ? (
                                    <div className="flex items-center gap-2 text-neutral-500 font-mono text-[11px] uppercase py-3 justify-center">
                                        <Loader2 size={13} className="animate-spin text-[#FFE600]" />
                                        <span>RETRIEVING AI VERDICTS...</span>
                                    </div>
                                ) : reviewsError ? (
                                    <div className="text-center py-4 space-y-2">
                                        <div className="text-red-400 font-mono text-[11px] uppercase">
                                            ⚠ {reviewsError}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={loadReviews}
                                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black font-mono uppercase bg-neutral-800 text-white border-2 border-black hover:bg-neutral-700 transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000]"
                                        >
                                            <RotateCcw size={12} />
                                            <span>RETRY LOADING REVIEWS</span>
                                        </button>
                                    </div>
                                ) : reviews.length === 0 ? (
                                    <div className="text-center py-4 space-y-2">
                                        <div className="text-neutral-500 font-mono text-[11px] uppercase">
                                            // NO AI CODE REVIEWS YET.
                                        </div>
                                        <p className="text-[11px] font-mono text-neutral-400 max-w-sm mx-auto">
                                            Open a Pull Request on GitHub, or trigger immediate AI evaluation using the button below.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleTriggerReview}
                                            disabled={triggeringReview}
                                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black font-mono uppercase bg-[#FFE600] text-black border-2 border-black hover:bg-yellow-300 disabled:opacity-50 transition-all shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                                        >
                                            {triggeringReview ? (
                                                <>
                                                    <Loader2 size={12} className="animate-spin" />
                                                    <span>RUNNING REVIEW...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles size={12} />
                                                    <span>RUN AI CODE REVIEW NOW</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-2.5">
                                        {reviews.map((rev) => {
                                            const isPass = rev.verdict === 'PASS';
                                            const isExpanded = expandedReviewId === rev.id;
                                            return (
                                                <div
                                                    key={String(rev.id)}
                                                    className="border-2 border-black p-3 bg-[#121417] transition-all shadow-[2px_2px_0px_0px_#000000]"
                                                >
                                                    <div
                                                        className="flex items-center justify-between gap-2 cursor-pointer select-none"
                                                        onClick={() => setExpandedReviewId(isExpanded ? null : rev.id)}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`px-2 py-0.5 text-[10px] font-mono font-black border border-black uppercase shadow-[1px_1px_0px_0px_#000000] ${
                                                                isPass ? 'bg-[#00FF66] text-black' : 'bg-[#EF4444] text-white'
                                                            }`}>
                                                                {isPass ? '✓ PASS' : '✕ FAIL'}
                                                            </span>
                                                            <span className="text-[12px] font-bold font-mono text-white truncate">
                                                                PR #{rev.pr_number}{rev.pr_title ? `: ${rev.pr_title}` : ''}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {rev.completeness_score !== undefined && rev.completeness_score > 0 && (
                                                                <span className="text-[10px] font-mono font-bold text-[#FFE600] px-1.5 py-0.5 bg-black border border-neutral-700">
                                                                    {rev.completeness_score}% SPEC
                                                                </span>
                                                            )}
                                                            {rev.pr_url && (
                                                                <a
                                                                    href={rev.pr_url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="p-1 hover:text-[#FFE600] text-neutral-400 transition-colors"
                                                                    title="View Pull Request"
                                                                >
                                                                    <ExternalLink size={12} />
                                                                </a>
                                                            )}
                                                            <div className="p-1 text-neutral-400 hover:text-white transition-colors">
                                                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Expanded Feedback in Markdown */}
                                                    {isExpanded && rev.feedback && (
                                                        <div className="mt-3 pt-3 border-t border-neutral-800 bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#F9F9F6] p-3 border border-neutral-800 dark:border-neutral-800 light:border-neutral-300">
                                                            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-neutral-800 dark:border-neutral-800 light:border-neutral-300 flex-wrap gap-2">
                                                                <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-400 light:text-neutral-600">
                                                                    // AI REVIEW FEEDBACK
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleExtractTasks(rev)}
                                                                    disabled={extractingReviewId === rev.id}
                                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black font-mono uppercase bg-[#FFE600] text-black border-2 border-black hover:bg-yellow-300 transition-all shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer disabled:opacity-50"
                                                                    title="Extract actionable suggestions and issues into new project tasks"
                                                                >
                                                                    {extractingReviewId === rev.id ? (
                                                                        <>
                                                                            <Loader2 size={11} className="animate-spin" />
                                                                            <span>EXTRACTING...</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Sparkles size={11} />
                                                                            <span>EXTRACT TASKS FROM REVIEW</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            </div>
                                                            <MarkdownRenderer content={rev.feedback} />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar (Right) */}
                    <div className="w-full md:w-64 space-y-5 shrink-0">
                        {/* Bucket (State) */}
                        <div>
                            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Activity size={13} /> STATE GROUP</label>
                            <select
                                value={bucketId || ''}
                                onChange={(e) => setBucketId(e.target.value || undefined)}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                            >
                                <option value="" disabled>Select Bucket...</option>
                                {buckets.map(b => (
                                    <option key={String(b.id)} value={String(b.id)}>{b.name} ({b.state})</option>
                                ))}
                            </select>
                        </div>

                        {/* Type */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-black text-neutral-400 uppercase tracking-wider flex items-center gap-1.5"><Tag size={13} /> TASK TYPES / TAGS</label>
                                {!isAddingType && (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingType(true)}
                                        className="text-[10px] font-mono font-bold text-white hover:underline flex items-center gap-1 cursor-pointer"
                                    >
                                        <Plus size={11}/>NEW
                                    </button>
                                )}
                            </div>

                            {/* Selected Type Badges */}
                            <div className="flex flex-wrap gap-1.5 min-h-[28px] mb-2 p-1.5 bg-[#0B0E14] border-2 border-black">
                                {selectedTypes.map(t => (
                                    <Badge key={t} variant={getTaskTypeVariant(t)} className="!py-0.5 !px-1.5 !text-[11px]">
                                        {t}
                                        {selectedTypes.length > 1 && (
                                            <button
                                            type="button"
                                            onClick={() => handleToggleType(t)}
                                            className="hover:text-[#FF3333] cursor-pointer ml-0.5"
                                            title={`Remove ${t}`}
                                            >✕
                                            </button>
                                        )}
                                    </Badge>
                                ))}
                            </div>

                            {isAddingType ? (
                                <div className="flex gap-1.5">
                                    <input
                                        type="text"
                                        placeholder="CUSTOM TAG..."
                                        value={customTypeInput}
                                        onChange={(e) => setCustomTypeInput(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddCustomType();
                                            } else if (e.key === 'Escape') {
                                                setIsAddingType(false);
                                            }
                                        }}
                                        className="flex-1 min-w-0 bg-[#0B0E14] border-2 border-[#FFE600] rounded-none px-2 py-1.5 text-[11px] font-mono uppercase text-white focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddCustomType}
                                        disabled={!customTypeInput.trim()}
                                        className="px-2 py-1.5 bg-[#FFE600] text-black font-black text-[10px] rounded-none border border-black disabled:opacity-50 cursor-pointer shrink-0"
                                    >
                                        ADD
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingType(false)}
                                        className="px-2 py-1.5 bg-[#1E2227] text-neutral-400 hover:text-white text-[10px] rounded-none border border-neutral-700 cursor-pointer shrink-0"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ) : (
                                <select
                                    value=""
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '__ADD_NEW__') {
                                            setIsAddingType(true);
                                        } else if (val) {
                                            handleToggleType(val);
                                        }
                                    }}
                                    className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                                >
                                    <option value="">+ APPEND / TOGGLE TYPE...</option>
                                    {availableTypes.map(t => (
                                        <option key={t} value={t}>
                                            {selectedTypes.includes(t) ? `✓ ${t}` : `+ ${t}`}
                                        </option>
                                    ))}
                                    <option value="__ADD_NEW__">+ ADD CUSTOM TYPE...</option>
                                </select>
                            )}
                        </div>

                        {/* Weight */}
                        <div>
                            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">WEIGHT / FIBONACCI</label>
                            <select
                                value={weight}
                                onChange={(e) => setWeight(Number(e.target.value))}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                            >
                                {TASK_WEIGHTS.map(w => <option key={w} value={w}>{w} POINTS</option>)}
                            </select>
                        </div>

                        {/* Assignees */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-black text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Users size={13} /> ASSIGNEES ({assigneeIds.length})
                                </label>
                            </div>

                            {/* Selected Assignees Badges */}
                            <div className="flex flex-wrap gap-1.5 min-h-[32px] mb-2 p-1.5 bg-[#0B0E14] border-2 border-black">
                                {assigneeIds.length === 0 ? (
                                    <span className="text-[11px] font-mono text-neutral-500 uppercase px-1 py-0.5">
                                        [NO ASSIGNEES SELECTED]
                                    </span>
                                ) : (
                                    assigneeIds.map((uid, index) => {
                                        const member = members.find(m => String(m.user_id) === uid);
                                        const username = member?.gh_username || member?.display_name || `Member #${uid}`;
                                        const avatar = member?.avatar_url || (member?.gh_username ? `https://github.com/${member.gh_username}.png?size=64` : undefined);
                                        return (
                                            <div
                                                key={uid}
                                                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#16191D] border border-black font-mono text-[11px] text-white shadow-[1px_1px_0px_0px_#000000]"
                                            >
                                                {avatar ? (
                                                    <img
                                                        src={avatar}
                                                        alt={username}
                                                        className="w-3.5 h-3.5 rounded-none border border-black object-cover shrink-0"
                                                    />
                                                ) : null}
                                                <span className="font-bold truncate max-w-[110px]">{username}</span>
                                                {index === 0 && (
                                                    <span className="text-[9px] bg-[#FFE600] text-black font-black px-1 uppercase">
                                                        LEAD
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAssignee(uid)}
                                                    className="hover:text-[#FF3333] cursor-pointer text-neutral-400 font-bold ml-0.5"
                                                    title="Remove assignee"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Add / Toggle Assignee Dropdown */}
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value) {
                                        handleToggleAssignee(e.target.value);
                                    }
                                }}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                            >
                                <option value="">+ ASSIGN / TOGGLE MEMBER...</option>
                                {members.map(m => {
                                    const uid = String(m.user_id);
                                    const isAssigned = assigneeIds.includes(uid);
                                    return (
                                        <option key={uid} value={uid}>
                                            {isAssigned ? `✓ ${m.gh_username || `Member #${uid}`}` : `+ ${m.gh_username || `Member #${uid}`}`}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                    </div>
                </form>

                {/* Footer */}
                <div className="p-4 border-t-2 border-black flex justify-end gap-3 bg-[#0E1012] rounded-none">
                    <button 
                        type="button" 
                        onClick={handleAttemptClose} 
                        className="px-5 py-2.5 rounded-none border-2 border-black bg-[#1E2227] text-neutral-300 font-mono text-[12px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="task-detail-form"
                        disabled={saving || !title.trim()}
                        className="px-6 py-2.5 rounded-none border-2 border-black bg-[#FFE600] text-black font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-50 cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        {saving ? 'SAVING...' : 'SAVE CHANGES'}
                    </button>
                </div>

            </div>

            {/* Confirm Discard Modal */}
            {showDiscardConfirm && (
                <ConfirmModal
                    title="DISCARD UNSAVED CHANGES?"
                    message="You have unsaved changes on this task. Are you sure you want to close and lose your edits?"
                    confirmLabel="DISCARD & CLOSE"
                    cancelLabel="KEEP EDITING"
                    variant="warning"
                    onConfirm={() => {
                        setShowDiscardConfirm(false);
                        onClose();
                    }}
                    onCancel={() => setShowDiscardConfirm(false)}
                />
            )}

            {/* Review Task Extraction Modal */}
            {showExtractionModal && extractionData && (
                <ReviewTaskExtractionModal
                    isOpen={showExtractionModal}
                    onClose={() => {
                        setShowExtractionModal(false);
                        setExtractionData(null);
                    }}
                    projectId={task.project_id!}
                    defaultBucketId={bucketId || task.bucket_id}
                    defaultAssigneeId={leadAssigneeId || task.lead_assignee_id}
                    reviewTitle={`PR #${extractionData.review.pr_number}${extractionData.review.pr_title ? `: ${extractionData.review.pr_title}` : ''}`}
                    extractedTasks={extractionData.tasks}
                    buckets={buckets}
                    members={members}
                    onSuccess={() => {
                        if (task.id) {
                            onUpdate(task.id, {});
                        }
                    }}
                />
            )}
        </div>
    );
};
