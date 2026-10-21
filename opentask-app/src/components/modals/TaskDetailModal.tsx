import React, { useState, useEffect, useRef } from 'react';
import { CheckSquare, AlignLeft, Tag, GitPullRequest, Activity, Check, Plus, Minus, Code, GitBranch, ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Loader2, Sparkles, RotateCcw, Users, Paperclip, UploadCloud, FileText, Download, Trash2, Image as ImageIcon, Eye } from 'lucide-react';
import type { Task, Bucket, ProjectMember, PrReview, ExtractedTask, TaskAttachment } from '../../models';
import { getAllTaskTypes, saveCustomTaskType, parseTaskTypes, serializeTaskTypes, getTaskTypeVariant } from '../../utils/taskTypes';
import { CloseButton } from '../../design-system/CloseButton';
import { useToast } from '../../design-system/Toast';
import { Badge } from '../../design-system/Badge';
import { MarkdownRenderer, hasMarkdownSyntax } from '../../design-system/MarkdownRenderer';
import { prReviewService } from '../../services/prReviewService';
import { taskService } from '../../services/taskService';
import { uploadTaskAttachment, deleteTaskAttachment, formatFileSize, isImageFile, MAX_FILE_SIZE_BYTES } from '../../services/supabaseStorage';
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
    const [descriptionViewMode, setDescriptionViewMode] = useState<'raw' | 'markdown'>(() => {
        return hasMarkdownSyntax(task.description) ? 'markdown' : 'raw';
    });
    const [descriptionFontSize, setDescriptionFontSize] = useState<number>(13);

    useEffect(() => {
        if (task) {
            setDescription(task.description || '');
            if (hasMarkdownSyntax(task.description)) {
                setDescriptionViewMode('markdown');
            }
        }
    }, [task.id]);

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
    const [attachments, setAttachments] = useState<TaskAttachment[]>(task.attachments || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [previewImage, setPreviewImage] = useState<TaskAttachment | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    const handleUploadFiles = async (files: FileList | File[]) => {
        if (!files || files.length === 0 || !task.id) return;
        const fileList = Array.from(files);

        // Enforce 10 MB maximum file limit client-side before accepting the upload
        const oversized = fileList.filter(f => f.size > MAX_FILE_SIZE_BYTES);
        if (oversized.length > 0) {
            const names = oversized
                .map(f => `"${f.name}" (${(f.size / (1024 * 1024)).toFixed(1)} MB)`)
                .join(', ');
            showToast(`File size exceeds 10 MB limit: ${names}`, 'error');
            return;
        }

        setIsUploading(true);
        try {
            const uploadedList: TaskAttachment[] = [];
            for (const file of fileList) {
                const att = await uploadTaskAttachment(task.id, file);
                uploadedList.push(att);
            }
            const nextAttachments = [...attachments, ...uploadedList];
            setAttachments(nextAttachments);
            task.attachments = nextAttachments;
            await onUpdate(task.id, { attachments: nextAttachments });
            showToast(fileList.length === 1 ? `Attached ${fileList[0].name}` : `Attached ${fileList.length} files`, 'success');
        } catch (err: any) {
            console.error('Attachment upload failed:', err);
            showToast(err?.message || 'Failed to upload attachment', 'error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleRemoveAttachment = async (attachment: TaskAttachment) => {
        const nextAttachments = attachments.filter(a => a.id !== attachment.id);
        setAttachments(nextAttachments);
        task.attachments = nextAttachments;
        try {
            if (task.id) {
                await onUpdate(task.id, { attachments: nextAttachments });
            }
            if (attachment.path) {
                await deleteTaskAttachment(attachment.path);
            }
            showToast(`Removed "${attachment.name}"`, 'info');
        } catch (err) {
            console.error('Failed to remove attachment:', err);
            showToast('Failed to remove attachment file', 'warning');
        }
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

    const initialTypes = parseTaskTypes(task.type).length > 0
        ? parseTaskTypes(task.type)
        : ['CODE'];

    const isDirty = Boolean(
        title.trim() !== (task.title || '').trim() ||
        description.trim() !== (task.description || '').trim() ||
        repoUrl.trim() !== (task.repo_url || '').trim() ||
        prUrl.trim() !== (task.prUrl || (task as any).pr_url || '').trim() ||
        branchName.trim() !== (task.branch_name || '').trim() ||
        Number(weight) !== Number(task.weight ?? 1) ||
        bucketId !== (task.bucket_id ? String(task.bucket_id) : undefined) ||
        JSON.stringify(attachments) !== JSON.stringify(task.attachments || []) ||
        JSON.stringify([...assigneeIds].sort()) !== JSON.stringify([...initialAssigneeIds].sort()) ||
        JSON.stringify([...selectedTypes].sort()) !== JSON.stringify([...initialTypes].sort())
    );

    // Fetch latest fresh task details (including full attachments) on mount
    useEffect(() => {
        if (!task.id) return;
        let active = true;
        taskService.getTaskById(task.id)
            .then(fresh => {
                if (!active || !fresh) return;
                if (fresh.attachments && Array.isArray(fresh.attachments)) {
                    setAttachments(fresh.attachments);
                    task.attachments = fresh.attachments;
                }
                if (fresh.description !== undefined && !isDirty) {
                    setDescription(fresh.description || '');
                    task.description = fresh.description;
                }
                if (fresh.repo_url !== undefined && !isDirty) {
                    setRepoUrl(fresh.repo_url || '');
                    task.repo_url = fresh.repo_url;
                }
                if (fresh.branch_name !== undefined && !isDirty) {
                    setBranchName(fresh.branch_name || '');
                    task.branch_name = fresh.branch_name;
                }
            })
            .catch(err => {
                console.warn('Could not fetch fresh task details on modal mount:', err);
            });
        return () => {
            active = false;
        };
    }, [task.id]);

    useEffect(() => {
        const taskChanged = String(previousTaskId.current) !== String(task.id);
        previousTaskId.current = task.id;

        // Realtime board updates replace the task object while this modal is
        // open. Never overwrite a draft unless the user switched tasks.
        if (!taskChanged && isDirty) return;

        setTitle(task.title || '');
        setDescription(task.description || '');
        const parsed = parseTaskTypes(task.type);
        setSelectedTypes(parsed.length > 0 ? parsed : ['CODE']);
        setWeight(task.weight ?? 1);
        setBucketId(task.bucket_id ? String(task.bucket_id) : undefined);
        const currentTaskAssigneeIds = (task.assignee_ids && task.assignee_ids.length > 0)
            ? task.assignee_ids.map(String)
            : (task.lead_assignee_id ? [String(task.lead_assignee_id)] : []);
        setAssigneeIds(currentTaskAssigneeIds);
        setLeadAssigneeId(task.lead_assignee_id ? String(task.lead_assignee_id) : (currentTaskAssigneeIds[0] || undefined));
        setBranchName(task.branch_name || '');
        setRepoUrl(task.repo_url || '');
        setPrUrl(task.prUrl || (task as any).pr_url || '');
        if (task.attachments !== undefined && task.attachments !== null) {
            setAttachments(task.attachments);
        }
        setAvailableTypes(getAllTaskTypes([task.type]));
    }, [task.id]);

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
            attachments: attachments,
        };
        try {
            await onUpdate(task.id, updatePayload);
            task.title = updatePayload.title!;
            task.description = updatePayload.description;
            task.type = updatePayload.type!;
            task.weight = updatePayload.weight!;
            task.bucket_id = updatePayload.bucket_id;
            task.assignee_ids = updatePayload.assignee_ids;
            task.lead_assignee_id = updatePayload.lead_assignee_id;
            task.branch_name = updatePayload.branch_name;
            task.repo_url = updatePayload.repo_url;
            task.attachments = updatePayload.attachments;
            onClose();
        } catch (err) {
            console.error("Failed to update task", err);
        } finally {
            setSaving(false);
        }
    };

    const handleCopyIdToClipboard = async (taskId: string) => {
        try {
            await navigator.clipboard.writeText(taskId);
            showToast(`Task ID '${taskId}' Copied to Clipboard`, 'success');
        }
        catch {
            showToast("Task ID Copied to Clipboard", 'warning');
        }
    }

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 select-none overflow-hidden">
            <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-7xl shadow-[8px_8px_0px_0px_#000000] flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-start flex-col gap-2.5 sm:gap-3 p-4 sm:p-6 border-b-2 border-black bg-[#181B20] min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 w-full min-w-0">
                        <div className={`p-1.5 sm:p-2 rounded-none ${isCompleted ? 'bg-[#00FF66]' : 'bg-[#FFE600]'} text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] shrink-0 transition-colors`}>
                            <CheckSquare size={18} strokeWidth={2.5} />
                        </div>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="TASK TITLE"
                            className={`bg-transparent ${isCompleted ? 'text-neutral-400 line-through' : 'text-white'} font-mono font-black uppercase text-base sm:text-lg flex-1 min-w-0 focus:outline-none focus:border-b-2 focus:border-[#FFE600] rounded-none px-2 py-1 -ml-1 sm:-ml-2 transition-all`}
                        />
                        {isDirty && (
                            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#FFE600] text-black border border-black font-mono text-[10px] font-black uppercase tracking-wider shrink-0 shadow-[1px_1px_0px_0px_#000000]">
                                <span className="w-1.5 h-1.5 bg-black rounded-full animate-ping"></span>
                                UNSAVED
                            </span>
                        )}
                        <CloseButton onClick={handleAttemptClose} size='md' />
                    </div>
                    <div className="flex items-center justify-between w-full flex-wrap gap-2 min-w-0">
                        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-neutral-400 uppercase flex-wrap min-w-0">
                            <span>// PROJECT PIPELINE</span>
                            <span className="w-1.5 h-1.5 bg-[#FFE600] shrink-0"></span>
                            <button type='button' onClick={(e) => {
                                e.stopPropagation();
                                const clipboardStr = `[${title}](#${String(task.id)})`
                                handleCopyIdToClipboard(clipboardStr);
                            }}
                                className="font-mono text-[11px] sm:text-[13px] px-1.5 py-0.5 text-neutral-500 font-bold hover:bg-[#00FF66] hover:text-black hover:border-black hover:border hover:shadow-[1.5px_1.5px_0px_0px_#000000] truncate max-w-full">
                                TASK ID: #{String(task.id)}
                            </button>
                        </div>

                        {/* Mark as Complete Checkbox in Header */}
                        <button
                            type="button"
                            onClick={() => handleToggleComplete(!isCompleted)}
                            className={`flex items-center gap-2 cursor-pointer select-none px-2.5 sm:px-3 py-1 border-2 transition-all active:translate-x-[1px] active:translate-y-[1px] shrink-0 ${isCompleted
                                ? 'bg-[#00FF66] hover:bg-[#FF3333] border-black shadow-[2px_2px_0px_0px_#000000]'
                                : 'hover:bg-[#00FF66] border-black shadow-[2px_2px_0px_0px_#000000]'
                                }`}
                        >
                            <div className={`w-4 h-4 rounded-none border-2 flex items-center justify-center transition-all ${isCompleted
                                ? 'bg-transparent border-black text-black shadow-[1px_1px_0px_0px_#000000]'
                                : 'bg-[#16191D] border-neutral-600'
                                }`}>
                                {isCompleted && <Check size={11} strokeWidth={3.5} />}
                            </div>
                            <span className={`text-[10px] sm:text-[11px] font-mono font-black tracking-wider uppercase ${isCompleted ? 'text-black' : 'text-neutral-300 hover:text-black'
                                }`}>
                                {isCompleted ? 'COMPLETED' : 'MARK AS COMPLETE'}
                            </span>
                        </button>
                    </div>
                </div>

                {/* Form Body - Scrollable without horizontal overflow */}
                <form id="task-detail-form" onSubmit={handleSave} className="p-4 sm:p-6 flex-1 overflow-y-auto overflow-x-hidden flex flex-col lg:flex-row gap-6 lg:gap-8 font-mono min-w-0 max-w-full">

                    {/* Main Content (Left) */}
                    <div className="flex-1 min-w-0 space-y-5 sm:space-y-6 max-w-full">
                        {/* Description */}
                        <div>
                            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <div className="flex items-center gap-2 text-white font-black text-[12px] uppercase">
                                    <AlignLeft size={14} />
                                    <h3>// DESCRIPTION</h3>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                    {/* Font Size Adjuster (+ / -) */}
                                    <div className="flex items-center border-2 border-black bg-[#141619] shadow-[2px_2px_0px_0px_#000000]">
                                        <button
                                            type="button"
                                            onClick={() => setDescriptionFontSize(prev => Math.max(11, prev - 1))}
                                            disabled={descriptionFontSize <= 11}
                                            className="px-2 py-1 text-neutral-300 hover:text-black hover:bg-[#FFE600] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 font-mono text-[11px] font-black transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center"
                                            title="Decrease font size (-1px)"
                                        >
                                            <Minus size={12} strokeWidth={3} />
                                        </button>
                                        <span
                                            className="px-2 py-1 py-0.5 font-mono text-[12px] font-bold text-[#FFE600] select-none cursor-pointer hover:underline"
                                            title="Click to reset font size to 13px"
                                            onClick={() => setDescriptionFontSize(13)}
                                        >
                                            {descriptionFontSize}PX
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setDescriptionFontSize(prev => Math.min(22, prev + 1))}
                                            disabled={descriptionFontSize >= 22}
                                            className="px-2 py-1 text-neutral-300 hover:text-black hover:bg-[#FFE600] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 font-mono text-[11px] font-black transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center"
                                            title="Increase font size (+1px)"
                                        >
                                            <Plus size={12} strokeWidth={3} />
                                        </button>
                                    </div>

                                    {/* View Mode Switch (Raw / Markdown) */}
                                    <button
                                        type="button"
                                        onClick={() => setDescriptionViewMode('raw')}
                                        className={`px-2.5 py-1 font-mono text-[13px] font-black uppercase transition-all shadow-[2px_2px_0px_0px_#000000] cursor-pointer flex items-center gap-1.5 border-2 border-black ${descriptionViewMode === 'raw'
                                            ? 'bg-[#FFE600] text-black'
                                            : 'text-neutral-400 hover:text-white'
                                            }`}
                                        title="Raw text / editor"
                                    >
                                        <Code size={12} strokeWidth={2.5} />
                                        RAW
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDescriptionViewMode('markdown')}
                                        className={`px-2.5 py-1 font-mono text-[13px] font-black uppercase transition-all shadow-[2px_2px_0px_0px_#000000] cursor-pointer flex items-center gap-1.5 border-2 border-black ${descriptionViewMode === 'markdown'
                                            ? 'bg-[#FFE600] text-black shadow-[2px_2px_0px_0px_#000000]'
                                            : 'text-neutral-400 hover:text-white'
                                            }`}
                                        title="Rendered Markdown view"
                                    >
                                        <Eye size={12} strokeWidth={2.5} />
                                        MARKDOWN
                                    </button>
                                </div>
                            </div>

                            {descriptionViewMode === 'raw' ? (
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="ENTER TECHNICAL SPECIFICATIONS OR REQUIREMENTS (MARKDOWN SUPPORTED)..."
                                    style={{ fontSize: `${descriptionFontSize}px` }}
                                    className="w-full h-120 bg-[#0B0E14] border-2 border-black rounded-none px-4 py-3 font-sans font-medium text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-all resize-y leading-relaxed"
                                />
                            ) : (
                                <div
                                    style={{ fontSize: `${descriptionFontSize}px` }}
                                    className="w-full h-120 overflow-y-auto border-2 border-black rounded-none px-4 py-3 font-sans font-medium text-white shadow-[2px_2px_0px_0px_#000000] transition-all resize-y leading-relaxed"
                                >
                                    {description.trim() ? (
                                        <MarkdownRenderer
                                            content={description}
                                            isSans
                                            style={{ fontSize: `${descriptionFontSize}px` }}
                                            className="!font-sans !font-medium"
                                        />
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-neutral-500 font-sans font-medium text-center py-16">
                                            <p className="text-[13px] text-neutral-400 mb-1">// NO DESCRIPTION ENTERED</p>
                                            <p className="text-[12px] text-neutral-600">Switch to RAW view to write specifications or notes.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Attachments & Specifications */}
                        <div>
                            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <div className="flex items-center gap-2 text-white font-black text-[12px] uppercase">
                                    <Paperclip size={14} className="text-[#FFE600]" />
                                    <h3>// ATTACHMENTS & SPECIFICATIONS</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    {attachments.length > 0 && (
                                        <Badge variant="warning">
                                            {attachments.length} {attachments.length === 1 ? 'FILE' : 'FILES'}
                                        </Badge>
                                    )}
                                    <span className="text-[10px] font-mono text-neutral-400 uppercase">
                                        MAX 10 MB / FILE
                                    </span>
                                </div>
                            </div>

                            <div className="bg-[#0B0E14] border-2 border-black rounded-none p-4 space-y-3 shadow-[2px_2px_0px_0px_#000000]">
                                {/* Drag & Drop Upload Zone */}
                                <div
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDragging(true);
                                    }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                            handleUploadFiles(e.dataTransfer.files);
                                        }
                                    }}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-none p-4 text-center cursor-pointer transition-all select-none ${isDragging
                                        ? 'border-[#FFE600] bg-[#FFE600]/10 shadow-[2px_2px_0px_0px_#FFE600]'
                                        : 'border-neutral-700 hover:border-[#FFE600] bg-[#121417] hover:bg-[#181B20]'
                                        }`}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files.length > 0) {
                                                handleUploadFiles(e.target.files);
                                            }
                                        }}
                                    />
                                    {isUploading ? (
                                        <div className="flex items-center justify-center gap-2 text-[#FFE600] font-mono text-[11px] font-bold uppercase py-2">
                                            <Loader2 size={16} className="animate-spin text-[#FFE600]" />
                                            <span>UPLOADING TO SUPABASE STORAGE...</span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center gap-1.5 py-1 text-center px-2">
                                            <div className="flex items-center justify-center gap-2 text-neutral-200 font-mono text-[11px] sm:text-[12px] font-bold uppercase flex-wrap text-center">
                                                <UploadCloud size={16} className="text-[#FFE600] shrink-0" />
                                                <span className="break-words">DRAG & DROP SCREENSHOTS, BUG LOGS, OR FRD FILES HERE</span>
                                            </div>
                                            <p className="text-[10px] font-mono text-neutral-500 uppercase text-center break-words">
                                                OR CLICK TO BROWSE • AUTOMATIC CLIENT CHECK &lt; 10 MB
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Attachment Items List */}
                                {attachments.length > 0 && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 min-w-0">
                                        {attachments.map((att) => {
                                            const isImg = isImageFile(att.type) || isImageFile(att.name);
                                            return (
                                                <div
                                                    key={att.id}
                                                    className="group flex items-center justify-between gap-2.5 bg-[#121417] border-2 border-black p-2.5 shadow-[2px_2px_0px_0px_#000000] hover:border-neutral-600 transition-all min-w-0"
                                                >
                                                    {/* Thumbnail or Document Icon */}
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        {isImg ? (
                                                            <div
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setPreviewImage(att);
                                                                }}
                                                                className="w-11 h-11 sm:w-12 sm:h-12 bg-black border border-neutral-700 shrink-0 overflow-hidden relative cursor-pointer group/thumb hover:border-[#FFE600] transition-colors"
                                                                title="Click to preview image"
                                                            >
                                                                <img
                                                                    src={att.url}
                                                                    alt={att.name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                                                                    <Eye size={14} className="text-white" />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-black border border-neutral-700 flex items-center justify-center shrink-0 text-[#FFE600]">
                                                                <FileText size={20} />
                                                            </div>
                                                        )}

                                                        <div className="min-w-0 flex-1">
                                                            <p
                                                                className="text-[11px] sm:text-[12px] font-mono font-bold text-white truncate min-w-0"
                                                                title={att.name}
                                                            >
                                                                {att.name}
                                                            </p>
                                                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono text-neutral-400">
                                                                <span>{formatFileSize(att.size)}</span>
                                                                <span>•</span>
                                                                <span className="uppercase">{att.name.split('.').pop() || 'FILE'}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <a
                                                            href={att.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-1.5 text-neutral-400 hover:text-[#FFE600] transition-colors cursor-pointer"
                                                            title="Open in new tab"
                                                        >
                                                            <ExternalLink size={13} />
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveAttachment(att)}
                                                            className="p-1.5 text-neutral-400 hover:text-[#FF3333] transition-colors cursor-pointer"
                                                            title="Delete attachment"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
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
                                    <div className="text-[11px] font-mono break-all min-w-0">
                                        <span className="text-neutral-400 uppercase">PULL REQUEST: </span>
                                        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-[#FFE600] hover:underline font-bold break-all">{prUrl}</a>
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
                                                            <span className={`px-2 py-0.5 text-[10px] font-mono font-black border border-black uppercase shadow-[1px_1px_0px_0px_#000000] ${isPass ? 'bg-[#00FF66] text-black' : 'bg-[#EF4444] text-white'
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
                                                        <div className="mt-3 pt-3 border-t border-neutral-800 bg-[#0B0E14] dark:bg-[#0B0E14] light:bg-[#F9F9F6] p-3 border border-neutral-800 dark:border-neutral-800 light:border-neutral-300 min-w-0 max-w-full">
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
                                                            <div className="min-w-0 max-w-full overflow-x-auto break-words">
                                                                <MarkdownRenderer content={rev.feedback} />
                                                            </div>
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
                    <div className="w-full lg:w-72 xl:w-80 space-y-4 sm:space-y-5 shrink-0 min-w-0">
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
                                        <Plus size={11} />NEW
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
                            <div className="flex flex-wrap gap-1.5 min-h-[32px] mb-2 p-1.5 bg-[#0B0E14] border-2 border-black min-w-0">
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
                                                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#16191D] border border-black font-mono text-[11px] text-white shadow-[1px_1px_0px_0px_#000000] max-w-full min-w-0"
                                            >
                                                {avatar ? (
                                                    <img
                                                        src={avatar}
                                                        alt={username}
                                                        className="w-3.5 h-3.5 rounded-none border border-black object-cover shrink-0"
                                                    />
                                                ) : null}
                                                <span className="font-bold truncate max-w-[120px]">{username}</span>
                                                {index === 0 && (
                                                    <span className="text-[9px] bg-[#FFE600] text-black font-black px-1 uppercase shrink-0">
                                                        LEAD
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAssignee(uid)}
                                                    className="hover:text-[#FF3333] cursor-pointer text-neutral-400 font-bold ml-0.5 shrink-0"
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
                <div className="p-3 sm:p-4 border-t-2 border-black flex items-center justify-end gap-2.5 sm:gap-3 bg-[#0E1012] rounded-none flex-wrap min-w-0">
                    <button
                        type="button"
                        onClick={handleAttemptClose}
                        className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-none border-2 border-black bg-[#1E2227] text-neutral-300 font-mono text-[11px] sm:text-[12px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="task-detail-form"
                        disabled={saving || !title.trim() || !isDirty}
                        className="px-5 sm:px-6 py-2 sm:py-2.5 rounded-none border-2 border-black bg-[#FFE600] text-black font-mono text-[11px] sm:text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
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

            {/* Lightbox / Image Preview Modal */}
            {previewImage && (
                <div
                    className="fixed inset-0 bg-black/85 backdrop-blur-sm z-60 flex items-center justify-center p-2 sm:p-4 select-none"
                    onClick={() => setPreviewImage(null)}
                >
                    <div
                        className="relative max-w-4xl w-full bg-[#121417] border-3 border-black shadow-[8px_8px_0px_0px_#000000] p-3 sm:p-4 flex flex-col gap-3 max-h-[90vh] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b-2 border-black pb-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                                <ImageIcon size={16} className="text-[#FFE600] shrink-0" />
                                <span className="font-mono text-xs font-bold text-white truncate">
                                    {previewImage.name}
                                </span>
                                <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                                    ({formatFileSize(previewImage.size)})
                                </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <a
                                    href={previewImage.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={previewImage.name}
                                    className="px-2.5 py-1 text-[11px] font-mono font-bold bg-[#FFE600] text-black border-2 border-black hover:bg-yellow-300 transition-colors flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000]"
                                >
                                    <Download size={12} />
                                    <span>DOWNLOAD</span>
                                </a>
                                <CloseButton onClick={() => setPreviewImage(null)} size="sm" />
                            </div>
                        </div>
                        <div className="overflow-auto max-h-[75vh] flex items-center justify-center bg-black/60 border-2 border-neutral-800 p-2">
                            <img
                                src={previewImage.url}
                                alt={previewImage.name}
                                className="max-w-full max-h-[70vh] object-contain"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
