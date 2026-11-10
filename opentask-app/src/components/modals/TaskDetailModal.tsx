import React, { useState, useEffect, useRef } from 'react';
import {
  CheckSquare, AlignLeft, Tag, GitPullRequest, Activity, Check, Plus, Minus, Code,
  GitBranch, ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Loader2, Sparkles,
  RotateCcw, Users, Paperclip, UploadCloud, FileText, Download, Trash2, Image as ImageIcon,
  Eye, Network, Calendar, AtSign, Hash, Copy
} from 'lucide-react';
import type { Task, Bucket, ProjectMember, PrReview, ExtractedTask, TaskAttachment, ProjectDiagram } from '../../models';
import { getAllTaskTypes, saveCustomTaskType, parseTaskTypes, serializeTaskTypes, getTaskTypeVariant } from '../../utils/taskTypes';
import { CloseButton } from '../../design-system/CloseButton';
import { useToast } from '../../design-system/Toast';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { MarkdownRenderer, hasMarkdownSyntax } from '../../design-system/MarkdownRenderer';
import { prReviewService } from '../../services/prReviewService';
import { taskService } from '../../services/taskService';
import { diagramService } from '../../services/diagramService';
import { uploadTaskAttachment, deleteTaskAttachment, formatFileSize, isImageFile, MAX_FILE_SIZE_BYTES } from '../../services/supabaseStorage';
import { ConfirmModal } from './ConfirmModal';
import { ReviewTaskExtractionModal } from './ReviewTaskExtractionModal';
import { DiagramModal } from './DiagramModal';
import { cn } from '@/lib/utils';

interface TaskDetailModalProps {
  task: Task;
  buckets: Bucket[];
  members: ProjectMember[];
  projectRepoUrls?: string[];
  allTasks?: Task[];
  onClose: () => void;
  onUpdate: (taskId: string | number, data: Partial<Task>) => Promise<void>;
  onDuplicate?: (task: Task) => void;
}

const isPdfFile = (type?: string, name?: string): boolean => {
  if (type === 'application/pdf') return true;
  if (name && name.toLowerCase().endsWith('.pdf')) return true;
  return false;
};

const TASK_WEIGHTS = [1, 2, 3, 5, 8];

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task, buckets, members, projectRepoUrls = [], allTasks = [], onClose, onUpdate, onDuplicate
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
  const [startDate, setStartDate] = useState<string>(() => {
    return task.start_date ? task.start_date.split('T')[0] : '';
  });
  const [targetDate, setTargetDate] = useState<string>(() => {
    return task.target_date ? task.target_date.split('T')[0] : '';
  });
  const [completedAt, setCompletedAt] = useState<string | null>(() => {
    return task.completed_at || null;
  });

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
  const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionMenu, setMentionMenu] = useState<'member' | 'task' | 'diagram' | 'file' | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  interface AutocompleteState {
    active: boolean;
    type: 'user' | 'task';
    query: string;
    startIndex: number;
  }
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>({
    active: false,
    type: 'user',
    query: '',
    startIndex: -1,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
        setMentionMenu(null);
      }
    };
    if (mentionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mentionMenu]);

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDescription(val);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf('@');
    const lastHash = textBeforeCursor.lastIndexOf('#');
    const lastTrigger = Math.max(lastAt, lastHash);

    if (lastTrigger !== -1) {
      const char = textBeforeCursor[lastTrigger];
      const query = textBeforeCursor.slice(lastTrigger + 1);
      const charBefore = lastTrigger > 0 ? textBeforeCursor[lastTrigger - 1] : ' ';
      if ((charBefore === ' ' || charBefore === '\n') && !query.includes(' ') && !query.includes('\n')) {
        setAutocomplete({
          active: true,
          type: char === '@' ? 'user' : 'task',
          query: query.toLowerCase(),
          startIndex: lastTrigger,
        });
        return;
      }
    }
    setAutocomplete({ active: false, type: 'user', query: '', startIndex: -1 });
  };

  const insertMention = (replacement: string, fromAutocomplete = false) => {
    if (fromAutocomplete && autocomplete.startIndex !== -1) {
      const before = description.slice(0, autocomplete.startIndex);
      const after = description.slice(autocomplete.startIndex + autocomplete.query.length + 1);
      const nextVal = `${before}${replacement} ${after}`;
      setDescription(nextVal);
      setAutocomplete({ active: false, type: 'user', query: '', startIndex: -1 });
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const pos = before.length + replacement.length + 1;
          textareaRef.current.setSelectionRange(pos, pos);
        }
      }, 0);
    } else {
      if (textareaRef.current) {
        const start = textareaRef.current.selectionStart || description.length;
        const end = textareaRef.current.selectionEnd || description.length;
        const before = description.substring(0, start);
        const after = description.substring(end);
        const nextVal = `${before}${before.endsWith(' ') || before.length === 0 ? '' : ' '}${replacement} ${after}`;
        setDescription(nextVal);
        setMentionMenu(null);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const pos = start + replacement.length + 2;
            textareaRef.current.setSelectionRange(pos, pos);
          }
        }, 0);
      } else {
        setDescription(prev => `${prev} ${replacement}`);
        setMentionMenu(null);
      }
    }
  };

  const { showToast } = useToast();

  const [diagramIds, setDiagramIds] = useState<string[]>(() => {
    if (task.diagram_ids && Array.isArray(task.diagram_ids)) {
      return task.diagram_ids.map(String);
    }
    return [];
  });
  const [projectDiagrams, setProjectDiagrams] = useState<ProjectDiagram[]>([]);
  const [loadingDiagrams, setLoadingDiagrams] = useState(false);
  const [isAttachDiagramOpen, setIsAttachDiagramOpen] = useState(false);
  const [viewingDiagramId, setViewingDiagramId] = useState<string | null>(null);
  const [isLinkingDiagram, setIsLinkingDiagram] = useState(false);
  const attachDiagramRef = useRef<HTMLDivElement>(null);

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
        if (prev.length === 1) return prev;
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
      setCompletedAt(new Date().toISOString());
    } else {
      const fallback = (previousBucketId && buckets.some(b => String(b.id) === String(previousBucketId) && b.state !== 'COMPLETED'))
        ? previousBucketId
        : (buckets.find(b => b.state === 'TODO') || buckets.find(b => b.state === 'ONGOING') || buckets.find(b => b.state !== 'COMPLETED'))?.id;
      if (fallback) {
        setBucketId(String(fallback));
      }
      setCompletedAt(null);
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
    void loadReviews();
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

  const initialDiagramIds = (task.diagram_ids || []).map(String);

  const isDirty = Boolean(
    title.trim() !== (task.title || '').trim() ||
    description.trim() !== (task.description || '').trim() ||
    repoUrl.trim() !== (task.repo_url || '').trim() ||
    prUrl.trim() !== (task.prUrl || (task as any).pr_url || '').trim() ||
    branchName.trim() !== (task.branch_name || '').trim() ||
    Number(weight) !== Number(task.weight ?? 1) ||
    bucketId !== (task.bucket_id ? String(task.bucket_id) : undefined) ||
    startDate !== (task.start_date ? task.start_date.split('T')[0] : '') ||
    targetDate !== (task.target_date ? task.target_date.split('T')[0] : '') ||
    completedAt !== (task.completed_at || null) ||
    JSON.stringify(attachments) !== JSON.stringify(task.attachments || []) ||
    JSON.stringify([...assigneeIds].sort()) !== JSON.stringify([...initialAssigneeIds].sort()) ||
    JSON.stringify([...selectedTypes].sort()) !== JSON.stringify([...initialTypes].sort()) ||
    JSON.stringify([...diagramIds].sort()) !== JSON.stringify([...initialDiagramIds].sort())
  );

  useEffect(() => {
    if (!task.project_id) return;
    let active = true;
    setLoadingDiagrams(true);
    diagramService.getProjectDiagrams(task.project_id)
      .then((list) => {
        if (active) setProjectDiagrams(list);
      })
      .catch((err) => console.warn("Failed to load project diagrams for task:", err))
      .finally(() => {
        if (active) setLoadingDiagrams(false);
      });
    return () => {
      active = false;
    };
  }, [task.project_id]);

  useEffect(() => {
    const handleOpenDiagram = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.diagramId) {
        setViewingDiagramId(String(detail.diagramId));
      }
    };
    window.addEventListener('opentask:open-diagram', handleOpenDiagram);
    return () => window.removeEventListener('opentask:open-diagram', handleOpenDiagram);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachDiagramRef.current && !attachDiagramRef.current.contains(e.target as Node)) {
        setIsAttachDiagramOpen(false);
      }
    };
    if (isAttachDiagramOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAttachDiagramOpen]);

  const handleLinkDiagram = async (diagramId: string) => {
    if (diagramIds.includes(diagramId)) return;
    setIsLinkingDiagram(true);
    try {
      if (task.id) {
        await diagramService.linkDiagramToTask(diagramId, task.id);
      }
      const next = [...diagramIds, diagramId];
      setDiagramIds(next);
      task.diagram_ids = next;
      setIsAttachDiagramOpen(false);
      showToast("Diagram linked to task", "success");
    } catch (err: any) {
      console.error("Failed to link diagram:", err);
      showToast(err.message || "Failed to link diagram", "error");
    } finally {
      setIsLinkingDiagram(false);
    }
  };

  const handleUnlinkDiagram = async (diagramId: string) => {
    try {
      if (task.id) {
        await diagramService.unlinkDiagramFromTask(diagramId, task.id);
      }
      const next = diagramIds.filter((id) => id !== diagramId);
      setDiagramIds(next);
      task.diagram_ids = next;
      showToast("Diagram unlinked from task", "info");
    } catch (err: any) {
      console.error("Failed to unlink diagram:", err);
      showToast(err.message || "Failed to unlink diagram", "error");
    }
  };

  const handleCreateAndLinkDiagram = async () => {
    if (!task.project_id) return;
    setIsLinkingDiagram(true);
    try {
      const newDiagram = await diagramService.createDiagram(task.project_id, {
        title: `${task.title} Architecture`,
        description: `Diagram created for task #${task.id}`,
      });
      setProjectDiagrams((prev) => [newDiagram, ...prev]);
      if (task.id) {
        await diagramService.linkDiagramToTask(newDiagram.id, task.id);
      }
      const next = [...diagramIds, newDiagram.id];
      setDiagramIds(next);
      task.diagram_ids = next;
      setIsAttachDiagramOpen(false);
      setViewingDiagramId(newDiagram.id);
      showToast("Created new diagram for task", "success");
    } catch (err: any) {
      console.error("Failed to create diagram:", err);
      showToast(err.message || "Failed to create diagram", "error");
    } finally {
      setIsLinkingDiagram(false);
    }
  };

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
        if (fresh.diagram_ids && Array.isArray(fresh.diagram_ids)) {
          const freshIds = fresh.diagram_ids.map(String);
          setDiagramIds(freshIds);
          task.diagram_ids = freshIds;
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
        console.warn("Could not reload task details:", err);
      });
    return () => {
      active = false;
    };
  }, [task.id]);

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
      diagram_ids: diagramIds,
      start_date: startDate ? new Date(startDate).toISOString() : null,
      target_date: targetDate ? new Date(targetDate).toISOString() : null,
      completed_at: completedAt,
    };

    onClose();

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
      task.diagram_ids = updatePayload.diagram_ids;
      task.start_date = updatePayload.start_date;
      task.target_date = updatePayload.target_date;
      task.completed_at = updatePayload.completed_at;
    } catch (err) {
      console.error("Failed to update task", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyIdToClipboard = async (taskId: string) => {
    try {
      await navigator.clipboard.writeText(taskId);
      showToast(`Task reference copied`, 'success');
    } catch {
      showToast('Task reference copied', 'warning');
    }
  };

  const attachedDiagrams = projectDiagrams.filter((d) => diagramIds.includes(d.id));
  const unattachedDiagrams = projectDiagrams.filter((d) => !diagramIds.includes(d.id));

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 select-none overflow-hidden animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-7xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start flex-col gap-2.5 sm:gap-3 p-4 sm:p-5 border-b border-border bg-muted/30 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 w-full min-w-0">
            <div className={cn(
              "p-2 rounded-lg shrink-0 transition-colors flex items-center justify-center",
              isCompleted ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-primary/15 text-primary"
            )}>
              <CheckSquare size={18} />
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className={cn(
                "bg-transparent font-semibold text-base sm:text-lg flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-ring rounded-md px-2 py-1 transition-all",
                isCompleted ? "text-muted-foreground line-through" : "text-foreground"
              )}
            />
            {isDirty && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-full text-xs font-medium shrink-0">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping" />
                Unsaved
              </span>
            )}
            <CloseButton onClick={handleAttemptClose} size="md" />
          </div>

          <div className="flex items-center justify-between w-full flex-wrap gap-2 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap min-w-0">
              <span className="font-medium">Project Pipeline</span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyIdToClipboard(`[${title}](#${String(task.id)})`);
                }}
                className="font-mono text-xs px-2 py-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors truncate max-w-full"
                title="Click to copy markdown task link"
              >
                Task #{String(task.id)}
              </button>
            </div>

            {/* Action Bar Right */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {onDuplicate && (
                <button
                  type="button"
                  onClick={() => {
                    onDuplicate({
                      ...task,
                      title: title.trim(),
                      description: description.trim() || undefined,
                      type: serializeTaskTypes(selectedTypes) || task.type,
                      weight: Number(weight),
                      bucket_id: bucketId,
                      assignee_ids: assigneeIds,
                      lead_assignee_id: assigneeIds.length > 0 ? assigneeIds[0] : null,
                      branch_name: branchName.trim() || undefined,
                      repo_url: repoUrl.trim() || undefined,
                      attachments,
                      diagram_ids: diagramIds,
                      start_date: startDate ? new Date(startDate).toISOString() : null,
                      target_date: targetDate ? new Date(targetDate).toISOString() : null,
                    });
                    onClose();
                  }}
                  className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-medium transition-colors shadow-xs"
                  title="Duplicate this task"
                >
                  <Copy size={12} className="text-primary" />
                  <span>Duplicate</span>
                </button>
              )}

              {/* Mark as Complete Button */}
              <button
                type="button"
                onClick={() => handleToggleComplete(!isCompleted)}
                className={cn(
                  "flex items-center gap-2 cursor-pointer select-none px-3 py-1 rounded-lg border text-xs font-medium transition-colors shadow-xs",
                  isCompleted
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
                    : "bg-background border-border text-foreground hover:bg-muted"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-md border flex items-center justify-center transition-colors",
                  isCompleted
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "border-muted-foreground/50"
                )}>
                  {isCompleted && <Check size={11} strokeWidth={2.5} />}
                </div>
                <span>
                  {isCompleted ? 'Completed' : 'Mark as complete'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form
          id="task-detail-form"
          onSubmit={handleSave}
          className="p-4 sm:p-6 flex-1 overflow-y-auto overflow-x-hidden flex flex-col lg:flex-row gap-6 lg:gap-8 min-w-0 max-w-full"
        >
          {/* Main Content (Left) */}
          <div className="flex-1 min-w-0 space-y-6 max-w-full">
            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-tight">
                  <AlignLeft size={14} className="text-primary" />
                  <span>Description</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Font Size Adjuster */}
                  <div className="flex items-center border border-border bg-background rounded-lg p-0.5 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setDescriptionFontSize(prev => Math.max(11, prev - 1))}
                      disabled={descriptionFontSize <= 11}
                      className="px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-30 transition-colors cursor-pointer"
                      title="Decrease font size"
                    >
                      <Minus size={11} />
                    </button>
                    <span
                      className="px-2 py-0.5 font-mono text-xs font-medium text-foreground select-none cursor-pointer"
                      title="Reset font size"
                      onClick={() => setDescriptionFontSize(13)}
                    >
                      {descriptionFontSize}px
                    </span>
                    <button
                      type="button"
                      onClick={() => setDescriptionFontSize(prev => Math.min(22, prev + 1))}
                      disabled={descriptionFontSize >= 22}
                      className="px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-30 transition-colors cursor-pointer"
                      title="Increase font size"
                    >
                      <Plus size={11} />
                    </button>
                  </div>

                  {/* View Mode Switch */}
                  <div className="flex items-center border border-border bg-muted/40 rounded-lg p-0.5 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setDescriptionViewMode('raw')}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer",
                        descriptionViewMode === 'raw'
                          ? "bg-card text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Code size={12} />
                      <span>Raw</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDescriptionViewMode('markdown')}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer",
                        descriptionViewMode === 'markdown'
                          ? "bg-card text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Eye size={12} />
                      <span>Markdown</span>
                    </button>
                  </div>
                </div>
              </div>

              {descriptionViewMode === 'raw' ? (
                <div className="relative">
                  {/* Mention Toolbar */}
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap border-b border-border pb-1.5 text-xs">
                    <span className="text-[11px] text-muted-foreground font-medium mr-1">Insert:</span>
                    <div className="relative" ref={mentionMenu === 'member' ? mentionMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setMentionMenu(prev => prev === 'member' ? null : 'member')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs transition-colors cursor-pointer"
                        title="Mention member"
                      >
                        <AtSign size={12} className="text-primary" />
                        <span>Member</span>
                      </button>
                      {mentionMenu === 'member' && (
                        <div className="absolute left-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-lg p-1.5 z-30 max-h-48 overflow-y-auto">
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Project Members</div>
                          {members.length === 0 ? (
                            <div className="text-xs text-muted-foreground px-2 py-1">No members found</div>
                          ) : (
                            members.map(m => {
                              const handle = m.gh_username || m.display_name || `user_${m.user_id}`;
                              return (
                                <button
                                  key={String(m.user_id)}
                                  type="button"
                                  onClick={() => insertMention(`@${handle}`)}
                                  className="w-full text-left px-2 py-1 rounded hover:bg-muted text-xs flex items-center gap-2 truncate cursor-pointer"
                                >
                                  <AtSign size={11} className="text-primary shrink-0" />
                                  <span className="truncate">{handle}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    <div className="relative" ref={mentionMenu === 'task' ? mentionMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setMentionMenu(prev => prev === 'task' ? null : 'task')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs transition-colors cursor-pointer"
                        title="Link task"
                      >
                        <Hash size={12} className="text-primary" />
                        <span>Task</span>
                      </button>
                      {mentionMenu === 'task' && (
                        <div className="absolute left-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-lg p-1.5 z-30 max-h-48 overflow-y-auto">
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Project Tasks</div>
                          {allTasks.filter(t => String(t.id) !== String(task.id)).length === 0 ? (
                            <div className="text-xs text-muted-foreground px-2 py-1">No other tasks found</div>
                          ) : (
                            allTasks.filter(t => String(t.id) !== String(task.id)).map(t => (
                              <button
                                key={String(t.id)}
                                type="button"
                                onClick={() => insertMention(`[#${t.id}: ${t.title}](#${t.id})`)}
                                className="w-full text-left px-2 py-1 rounded hover:bg-muted text-xs flex items-center gap-1.5 truncate cursor-pointer"
                              >
                                <Hash size={11} className="text-primary shrink-0" />
                                <span className="font-mono text-[11px] shrink-0">#{t.id}</span>
                                <span className="truncate text-muted-foreground">{t.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="relative" ref={mentionMenu === 'diagram' ? mentionMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setMentionMenu(prev => prev === 'diagram' ? null : 'diagram')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs transition-colors cursor-pointer"
                        title="Link diagram"
                      >
                        <Network size={12} className="text-primary" />
                        <span>Diagram</span>
                      </button>
                      {mentionMenu === 'diagram' && (
                        <div className="absolute left-0 top-full mt-1 w-60 bg-card border border-border rounded-lg shadow-lg p-1.5 z-30 max-h-48 overflow-y-auto">
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Diagrams</div>
                          {projectDiagrams.length === 0 ? (
                            <div className="text-xs text-muted-foreground px-2 py-1">No diagrams found</div>
                          ) : (
                            projectDiagrams.map(d => (
                              <button
                                key={String(d.id)}
                                type="button"
                                onClick={() => insertMention(`[Diagram: ${d.title}](#diagram-${d.id})`)}
                                className="w-full text-left px-2 py-1 rounded hover:bg-muted text-xs flex items-center gap-1.5 truncate cursor-pointer"
                              >
                                <Network size={11} className="text-primary shrink-0" />
                                <span className="truncate">{d.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="relative" ref={mentionMenu === 'file' ? mentionMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setMentionMenu(prev => prev === 'file' ? null : 'file')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs transition-colors cursor-pointer"
                        title="Link attachment"
                      >
                        <Paperclip size={12} className="text-primary" />
                        <span>File</span>
                      </button>
                      {mentionMenu === 'file' && (
                        <div className="absolute left-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-lg p-1.5 z-30 max-h-48 overflow-y-auto">
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Attached Files</div>
                          {attachments.length === 0 ? (
                            <div className="text-xs text-muted-foreground px-2 py-1">No attachments on this task</div>
                          ) : (
                            attachments.map(att => (
                              <button
                                key={att.id}
                                type="button"
                                onClick={() => insertMention(`[${att.name}](${att.url})`)}
                                className="w-full text-left px-2 py-1 rounded hover:bg-muted text-xs flex items-center gap-1.5 truncate cursor-pointer"
                              >
                                <Paperclip size={11} className="text-primary shrink-0" />
                                <span className="truncate">{att.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder="Enter task description or requirements (Markdown, @mentions, #task-links supported)..."
                    style={{ fontSize: `${descriptionFontSize}px` }}
                    className="w-full h-96 bg-background border border-input rounded-xl px-4 py-3 font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-all resize-y leading-relaxed"
                  />

                  {/* Autocomplete Popup */}
                  {autocomplete.active && (
                    <div className="absolute left-4 bottom-4 w-64 bg-card border border-border rounded-xl shadow-[3px_3px_0px_0px_#000000] p-1.5 z-40 max-h-52 overflow-y-auto">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">
                        {autocomplete.type === 'user' ? 'Mention Member' : 'Reference Task'}
                      </div>
                      {autocomplete.type === 'user' ? (
                        members
                          .filter(m => {
                            const name = (m.gh_username || m.display_name || '').toLowerCase();
                            return name.includes(autocomplete.query);
                          })
                          .slice(0, 8)
                          .map(m => {
                            const handle = m.gh_username || m.display_name || `user_${m.user_id}`;
                            return (
                              <button
                                key={String(m.user_id)}
                                type="button"
                                onClick={() => insertMention(`@${handle}`, true)}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center gap-2 truncate cursor-pointer"
                              >
                                <AtSign size={12} className="text-primary shrink-0" />
                                <span className="truncate">{handle}</span>
                              </button>
                            );
                          })
                      ) : (
                        allTasks
                          .filter(t =>
                            String(t.id) !== String(task.id) &&
                            (t.title.toLowerCase().includes(autocomplete.query) || String(t.id).includes(autocomplete.query))
                          )
                          .slice(0, 8)
                          .map(t => (
                            <button
                              key={String(t.id)}
                              type="button"
                              onClick={() => insertMention(`[#${t.id}: ${t.title}](#${t.id})`, true)}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center gap-1.5 truncate cursor-pointer"
                            >
                              <Hash size={12} className="text-primary shrink-0" />
                              <span className="font-mono text-[11px] shrink-0">#{t.id}</span>
                              <span className="truncate text-muted-foreground">{t.title}</span>
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{ fontSize: `${descriptionFontSize}px` }}
                  className="w-full h-96 overflow-y-auto border border-border bg-muted/15 rounded-xl px-4 py-3 font-sans text-foreground shadow-xs transition-all resize-y leading-relaxed"
                >
                  {description.trim() ? (
                    <MarkdownRenderer
                      content={description}
                      isSans
                      style={{ fontSize: `${descriptionFontSize}px` }}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center py-16">
                      <p className="text-sm font-medium mb-1">No description entered</p>
                      <p className="text-xs">Switch to Raw view to write specifications or notes.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-tight">
                  <Paperclip size={14} className="text-primary" />
                  <span>Attachments & Specifications</span>
                </div>
                <div className="flex items-center gap-2">
                  {attachments.length > 0 && (
                    <Badge variant="primary">
                      {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    Max 10 MB per file
                  </span>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-xs">
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
                  className={cn(
                    'border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all select-none',
                    isDragging
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40'
                  )}
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
                    <div className="flex items-center justify-center gap-2 text-primary text-xs font-medium py-2">
                      <Loader2 size={16} className="animate-spin text-primary" />
                      <span>Uploading to Supabase Storage…</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 py-1 text-center px-2">
                      <div className="flex items-center justify-center gap-2 text-foreground text-xs font-medium flex-wrap text-center">
                        <UploadCloud size={16} className="text-primary shrink-0" />
                        <span>Drag & drop files or screenshots here</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        Or click to browse from your computer
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
                          className="group flex items-center justify-between gap-2.5 bg-muted/30 border border-border rounded-lg p-2.5 shadow-xs hover:border-primary/40 transition-all min-w-0"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {isImg ? (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewAttachment(att);
                                }}
                                className="w-10 h-10 rounded-md bg-muted border border-border shrink-0 overflow-hidden relative cursor-pointer group/thumb hover:border-primary transition-colors"
                                title="Preview image"
                              >
                                <img
                                  src={att.url}
                                  alt={att.name}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-background/50 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                                  <Eye size={14} className="text-foreground" />
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewAttachment(att);
                                }}
                                className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 text-primary cursor-pointer hover:border-primary transition-colors"
                                title={isPdfFile(att.type, att.name) ? "Preview PDF" : "View file"}
                              >
                                <FileText size={18} />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <p
                                className="text-xs font-medium text-foreground truncate min-w-0"
                                title={att.name}
                              >
                                {att.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                                <span>{formatFileSize(att.size)}</span>
                                <span>•</span>
                                <span className="uppercase">{att.name.split('.').pop() || 'FILE'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                              title="Open in new tab"
                            >
                              <ExternalLink size={13} />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(att)}
                              className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
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

            {/* Architecture & Diagrams */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-tight">
                  <Network size={14} className="text-primary" />
                  <span>Architecture & Diagrams</span>
                </div>
                <div className="flex items-center gap-2">
                  {diagramIds.length > 0 && (
                    <Badge variant="primary">
                      {diagramIds.length} {diagramIds.length === 1 ? 'diagram' : 'diagrams'}
                    </Badge>
                  )}

                  {/* Attach Diagram Popover Button */}
                  <div className="relative" ref={attachDiagramRef}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAttachDiagramOpen((prev) => !prev)}
                      className="gap-1.5 h-7 text-xs"
                    >
                      <Plus size={12} />
                      <span>Attach Diagram</span>
                    </Button>

                    {isAttachDiagramOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-72 bg-card border border-border rounded-xl shadow-[3px_3px_0px_0px_#000000] p-2 z-50 animate-in fade-in duration-100">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 mb-1">
                          Link Project Diagram
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-1">
                          {loadingDiagrams ? (
                            <div className="py-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 size={13} className="animate-spin text-primary" />
                              <span>Loading diagrams...</span>
                            </div>
                          ) : unattachedDiagrams.length === 0 ? (
                            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                              No other diagrams in this project yet.
                            </div>
                          ) : (
                            unattachedDiagrams.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => handleLinkDiagram(d.id)}
                                disabled={isLinkingDiagram}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted/60 transition-colors flex items-center justify-between gap-2 cursor-pointer group"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium text-foreground truncate group-hover:text-primary">
                                    {d.title}
                                  </div>
                                  {d.description && (
                                    <div className="text-[10px] text-muted-foreground truncate">
                                      {d.description}
                                    </div>
                                  )}
                                </div>
                                <Plus size={12} className="text-muted-foreground group-hover:text-primary shrink-0" />
                              </button>
                            ))
                          )}
                        </div>

                        <div className="border-t border-border mt-1.5 pt-1.5">
                          <button
                            type="button"
                            onClick={handleCreateAndLinkDiagram}
                            disabled={isLinkingDiagram}
                            className="w-full text-left px-2.5 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <Plus size={13} />
                            <span>+ Create New Architecture Diagram</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-2.5 shadow-xs">
                {attachedDiagrams.length === 0 ? (
                  <div className="text-center py-4 space-y-1.5 text-muted-foreground">
                    <Network size={22} className="mx-auto text-muted-foreground/60" />
                    <p className="text-xs font-medium">No diagrams attached to this task</p>
                    <p className="text-[11px] max-w-xs mx-auto">
                      Attach architecture diagrams, sequence flows, or data models to give context to this task.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 min-w-0">
                    {attachedDiagrams.map((d) => (
                      <div
                        key={d.id}
                        className="group flex items-center justify-between gap-2.5 bg-muted/30 border border-border rounded-lg p-2.5 shadow-xs hover:border-primary/40 transition-all min-w-0"
                      >
                        <div
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                          onClick={() => setViewingDiagramId(d.id)}
                        >
                          <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                            <Network size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors" title={d.title}>
                              {d.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {d.description || "Interactive Mermaid graph"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setViewingDiagramId(d.id)}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                            title="View / Edit Diagram"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUnlinkDiagram(d.id)}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                            title="Unlink diagram from task"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Development Pipeline */}
            <div>
              <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-xs tracking-tight">
                <GitPullRequest size={14} className="text-primary" />
                <span>Development Pipeline</span>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-3.5 shadow-xs">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <GitBranch size={12} /> Target Repository
                  </label>
                  <select
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                  >
                    <option value="">[General task - No repository]</option>
                    {projectRepoUrls && projectRepoUrls.map(url => {
                      const repoName = url.replace('https://github.com/', '');
                      return (
                        <option key={url} value={url}>{repoName}</option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Branch Name</label>
                  <input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="feature/auth-roles"
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Pull Request URL</label>
                  <input
                    value={prUrl}
                    onChange={(e) => setPrUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo/pull/123"
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors font-mono"
                  />
                </div>

                {prUrl && (
                  <div className="text-xs break-all min-w-0 flex items-center gap-1.5 pt-1">
                    <span className="text-muted-foreground">Pull Request:</span>
                    <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium break-all">
                      {prUrl}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* AI PR Reviews */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-tight">
                  <ShieldCheck size={14} className="text-emerald-500" />
                  <span>AI Code Reviews</span>
                </div>
                <div className="flex items-center gap-2">
                  {reviews.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {reviews.length} {reviews.length !== 1 ? 'reviews' : 'review'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={loadReviews}
                    disabled={loadingReviews}
                    title="Reload reviews"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw size={12} className={loadingReviews ? 'animate-spin' : ''} />
                  </button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleTriggerReview}
                    disabled={triggeringReview}
                  >
                    {triggeringReview ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        <span>Evaluating…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        <span>Run AI review</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {triggerError && (
                <div className="mb-2 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs">
                  {triggerError}
                </div>
              )}

              <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-xs">
                {loadingReviews ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs py-3 justify-center">
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span>Retrieving AI review verdicts…</span>
                  </div>
                ) : reviewsError ? (
                  <div className="text-center py-4 space-y-2">
                    <div className="text-destructive text-xs">
                      {reviewsError}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={loadReviews}
                    >
                      <RotateCcw size={12} />
                      <span>Retry</span>
                    </Button>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="text-center py-4 space-y-2">
                    <div className="text-muted-foreground text-xs font-medium">
                      No AI code reviews yet.
                    </div>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Link a GitHub Pull Request or run an immediate AI review.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTriggerReview}
                      disabled={triggeringReview}
                    >
                      {triggeringReview ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          <span>Running review…</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} />
                          <span>Run AI review now</span>
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {reviews.map((rev) => {
                      const isPass = rev.verdict === 'PASS';
                      const isExpanded = expandedReviewId === rev.id;
                      return (
                        <div
                          key={String(rev.id)}
                          className="border border-border rounded-lg p-3 bg-muted/20 transition-all shadow-xs"
                        >
                          <div
                            className="flex items-center justify-between gap-2 cursor-pointer select-none"
                            onClick={() => setExpandedReviewId(isExpanded ? null : rev.id)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={cn(
                                "px-2 py-0.5 text-[10px] font-semibold rounded-full border",
                                isPass
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                  : "bg-destructive/15 text-destructive border-destructive/30"
                              )}>
                                {isPass ? 'Pass' : 'Fail'}
                              </span>
                              <span className="text-xs font-medium text-foreground truncate">
                                PR #{rev.pr_number}{rev.pr_title ? `: ${rev.pr_title}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {rev.completeness_score !== undefined && rev.completeness_score > 0 && (
                                <span className="text-[10px] font-mono font-medium text-primary px-1.5 py-0.5 bg-primary/10 rounded-md">
                                  {rev.completeness_score}% Spec
                                </span>
                              )}
                              {rev.pr_url && (
                                <a
                                  href={rev.pr_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded-md hover:text-foreground text-muted-foreground transition-colors"
                                  title="View Pull Request"
                                >
                                  <ExternalLink size={12} />
                                </a>
                              )}
                              <div className="p-1 text-muted-foreground">
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </div>
                            </div>
                          </div>

                          {isExpanded && rev.feedback && (
                            <div className="mt-3 pt-3 border-t border-border bg-card p-3 rounded-lg border min-w-0 max-w-full">
                              <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-border flex-wrap gap-2">
                                <span className="text-xs font-medium text-muted-foreground">
                                  AI Review Feedback
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleExtractTasks(rev)}
                                  disabled={extractingReviewId === rev.id}
                                >
                                  {extractingReviewId === rev.id ? (
                                    <>
                                      <Loader2 size={11} className="animate-spin" />
                                      <span>Extracting…</span>
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles size={11} />
                                      <span>Extract tasks</span>
                                    </>
                                  )}
                                </Button>
                              </div>
                              <div className="min-w-0 max-w-full overflow-x-auto break-words text-xs">
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
          <div className="w-full lg:w-72 xl:w-80 space-y-4 shrink-0 min-w-0">
            {/* State Group */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Activity size={13} /> State Group
              </label>
              <select
                value={bucketId || ''}
                onChange={(e) => {
                  const newBucketId = e.target.value || undefined;
                  setBucketId(newBucketId);
                  const targetBucket = buckets.find(b => String(b.id) === String(newBucketId));
                  if (targetBucket?.state === 'COMPLETED') {
                    if (!completedAt) setCompletedAt(new Date().toISOString());
                  } else {
                    if (completedAt) setCompletedAt(null);
                  }
                }}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors shadow-xs"
              >
                <option value="" disabled>Select bucket…</option>
                {buckets.map(b => (
                  <option key={String(b.id)} value={String(b.id)}>{b.name} ({b.state})</option>
                ))}
              </select>
            </div>

            {/* Schedule & Dates */}
            <div className="bg-muted/20 border border-border rounded-xl p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Calendar size={13} className="text-primary" />
                <span>Schedule & Dates</span>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Target / Due Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Completed Date</label>
                {completedAt ? (
                  <div className="flex items-center justify-between gap-1 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="font-mono">{new Date(completedAt).toLocaleDateString()}</span>
                    <button
                      type="button"
                      onClick={() => setCompletedAt(null)}
                      className="text-[10px] hover:underline cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCompletedAt(new Date().toISOString())}
                    className="w-full text-xs h-7"
                  >
                    + Stamp completed now
                  </Button>
                )}
              </div>
            </div>

            {/* Task Types */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Tag size={13} /> Task Types & Tags
                </label>
                {!isAddingType && (
                  <button
                    type="button"
                    onClick={() => setIsAddingType(true)}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={11} /> New
                  </button>
                )}
              </div>

              {/* Selected Type Badges */}
              <div className="flex flex-wrap gap-1.5 min-h-[32px] mb-2 p-2 bg-muted/20 border border-border rounded-lg">
                {selectedTypes.map(t => (
                  <Badge key={t} variant={getTaskTypeVariant(t)} className="py-0.5 px-2 text-xs">
                    {t}
                    {selectedTypes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleToggleType(t)}
                        className="hover:text-destructive cursor-pointer ml-1"
                        title={`Remove ${t}`}
                      >
                        ✕
                      </button>
                    )}
                  </Badge>
                ))}
              </div>

              {isAddingType ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Custom tag…"
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
                    className="flex-1 min-w-0 bg-background border border-primary rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none uppercase font-mono"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleAddCustomType}
                    disabled={!customTypeInput.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddingType(false)}
                  >
                    ✕
                  </Button>
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
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors shadow-xs"
                >
                  <option value="">+ Toggle / add type…</option>
                  {availableTypes.map(t => (
                    <option key={t} value={t}>
                      {selectedTypes.includes(t) ? `✓ ${t}` : `+ ${t}`}
                    </option>
                  ))}
                  <option value="__ADD_NEW__">+ Add custom type…</option>
                </select>
              )}
            </div>

            {/* Weight */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Weight (Story Points)</label>
              <select
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors shadow-xs"
              >
                {TASK_WEIGHTS.map(w => <option key={w} value={w}>{w} Points</option>)}
              </select>
            </div>

            {/* Assignees */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Users size={13} /> Assignees ({assigneeIds.length})
                </label>
              </div>

              {/* Selected Assignees Badges */}
              <div className="flex flex-wrap gap-1.5 min-h-[36px] mb-2 p-2 bg-muted/20 border border-border rounded-lg min-w-0">
                {assigneeIds.length === 0 ? (
                  <span className="text-xs text-muted-foreground px-1 py-0.5">
                    No assignees selected
                  </span>
                ) : (
                  assigneeIds.map((uid, index) => {
                    const member = members.find(m => String(m.user_id) === uid);
                    const username = member?.gh_username || member?.display_name || `Member #${uid}`;
                    const avatar = member?.avatar_url || (member?.gh_username ? `https://github.com/${member.gh_username}.png?size=64` : undefined);
                    return (
                      <div
                        key={uid}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-card border border-border rounded-full text-xs text-foreground shadow-xs max-w-full min-w-0"
                      >
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={username}
                            className="w-4 h-4 rounded-full object-cover shrink-0"
                          />
                        ) : null}
                        <span className="font-medium truncate max-w-[120px]">{username}</span>
                        {index === 0 && (
                          <span className="text-[9px] bg-primary/10 text-primary font-semibold px-1.5 py-0.2 rounded-full uppercase shrink-0">
                            Lead
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveAssignee(uid)}
                          className="hover:text-destructive cursor-pointer text-muted-foreground font-semibold ml-0.5 shrink-0"
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
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors shadow-xs"
              >
                <option value="">+ Assign / toggle member…</option>
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
        <div className="p-3.5 sm:p-4 border-t border-border flex items-center justify-end gap-2.5 bg-muted/30">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleAttemptClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="task-detail-form"
            variant="primary"
            size="md"
            disabled={saving || !title.trim() || !isDirty}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Confirm Discard Modal */}
      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard unsaved changes?"
          message="You have unsaved changes on this task. Are you sure you want to close and lose your edits?"
          confirmLabel="Discard & close"
          cancelLabel="Keep editing"
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

      {/* Attachment Preview Modal (Images and PDFs) */}
      {previewAttachment && (
        <div
          className="fixed inset-0 bg-background/90 backdrop-blur-sm z-60 flex items-center justify-center p-2 sm:p-4 select-none"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-card border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-3 max-h-[92vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 min-w-0">
                {isImageFile(previewAttachment.type) || isImageFile(previewAttachment.name) ? (
                  <ImageIcon size={16} className="text-primary shrink-0" />
                ) : (
                  <FileText size={16} className="text-primary shrink-0" />
                )}
                <span className="text-xs font-semibold text-foreground truncate">
                  {previewAttachment.name}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  ({formatFileSize(previewAttachment.size)})
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewAttachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-xs font-medium border border-border bg-background hover:bg-muted text-foreground rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <ExternalLink size={12} />
                  <span>Open tab</span>
                </a>
                <a
                  href={previewAttachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={previewAttachment.name}
                  className="px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Download size={12} />
                  <span>Download</span>
                </a>
                <CloseButton onClick={() => setPreviewAttachment(null)} size="sm" />
              </div>
            </div>
            <div className="overflow-auto max-h-[75vh] flex items-center justify-center bg-muted/30 rounded-lg border border-border/70 p-2">
              {isImageFile(previewAttachment.type) || isImageFile(previewAttachment.name) ? (
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                  className="max-w-full max-h-[70vh] object-contain rounded-md"
                />
              ) : isPdfFile(previewAttachment.type, previewAttachment.name) ? (
                <iframe
                  src={previewAttachment.url}
                  title={previewAttachment.name}
                  className="w-full h-[70vh] rounded-md border border-border bg-white"
                />
              ) : (
                <div className="py-16 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <FileText size={32} className="text-primary" />
                  <p className="text-sm font-medium">Preview not supported for this file format</p>
                  <a
                    href={previewAttachment.url}
                    download={previewAttachment.name}
                    className="text-xs text-primary underline"
                  >
                    Click here to download
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diagram Viewer & Editor Modal */}
      {viewingDiagramId && (
        <DiagramModal
          diagramId={viewingDiagramId}
          isOpen={!!viewingDiagramId}
          onClose={() => setViewingDiagramId(null)}
          onDiagramUpdated={(updated) => {
            setProjectDiagrams((prev) =>
              prev.map((d) => (d.id === updated.id ? updated : d))
            );
          }}
        />
      )}
    </div>
  );
};
