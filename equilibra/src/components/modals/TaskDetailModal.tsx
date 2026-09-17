import React, { useState, useEffect } from 'react';
import { X, CheckSquare, AlignLeft, Tag, GitPullRequest, Activity, Check, Plus } from 'lucide-react';
import type { Task, TaskType, Bucket, ProjectMember } from '../../models';
import { getAllTaskTypes, saveCustomTaskType } from '../../utils/taskTypes';

interface TaskDetailModalProps {
    task: Task;
    buckets: Bucket[];
    members: ProjectMember[];
    onClose: () => void;
    onUpdate: (taskId: string | number, data: Partial<Task>) => Promise<void>;
}

const TASK_WEIGHTS = [1, 2, 3, 5, 8]; // Fibonacci sequence for story points

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
    task, buckets, members, onClose, onUpdate
}) => {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || '');
    const [type, setType] = useState<TaskType>(task.type);
    const [weight, setWeight] = useState<number>(task.weight);
    const [bucketId, setBucketId] = useState<string | undefined>(task.bucket_id ? String(task.bucket_id) : undefined);
    const [leadAssigneeId, setLeadAssigneeId] = useState<string | undefined>(task.lead_assignee_id ? String(task.lead_assignee_id) : undefined);
    const [availableTypes, setAvailableTypes] = useState<string[]>(() => getAllTaskTypes([task.type]));
    const [isAddingType, setIsAddingType] = useState(false);
    const [customTypeInput, setCustomTypeInput] = useState('');

    const handleAddCustomType = () => {
        const trimmed = customTypeInput.trim().toUpperCase();
        if (!trimmed) return;
        saveCustomTaskType(trimmed);
        setAvailableTypes(getAllTaskTypes([trimmed]));
        setType(trimmed);
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

    useEffect(() => {
        setTitle(task.title);
        setDescription(task.description || '');
        setType(task.type);
        setWeight(task.weight);
        setBucketId(task.bucket_id ? String(task.bucket_id) : undefined);
        setLeadAssigneeId(task.lead_assignee_id ? String(task.lead_assignee_id) : undefined);
        setBranchName(task.branch_name || '');
        setAvailableTypes(getAllTaskTypes([task.type]));
    }, [task]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !task.id) return;

        setSaving(true);
        const updatePayload: Partial<Task> = {
            title: title.trim(),
            description: description.trim() || undefined,
            type,
            weight: Number(weight),
            bucket_id: bucketId || undefined,
            lead_assignee_id: leadAssigneeId || undefined,
            branch_name: branchName.trim() || undefined,
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

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 select-none" onClick={onClose}>
            <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-2xl shadow-[8px_8px_0px_0px_#000000] flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-start flex-col gap-3 p-6 border-b-2 border-black relative bg-[#181B20]">
                    <button 
                        onClick={onClose} 
                        className="absolute top-6 right-6 p-1.5 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer"
                    >
                        <X size={18} strokeWidth={3} />
                    </button>
                    <div className="flex items-center gap-3 w-full pr-12">
                        <div className={`p-2 rounded-none ${isCompleted ? 'bg-[#00FF66]' : 'bg-[#FFE600]'} text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] shrink-0 transition-colors`}>
                            <CheckSquare size={18} strokeWidth={2.5} />
                        </div>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="TASK TITLE"
                            className={`bg-transparent ${isCompleted ? 'text-neutral-400 line-through' : 'text-white'} font-mono font-black uppercase text-lg w-full focus:outline-none focus:border-b-2 focus:border-[#FFE600] rounded-none px-2 py-1 -ml-2 transition-all`}
                        />
                    </div>
                    <div className="flex items-center justify-between w-full pr-12 flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400 uppercase">
                            <span>// PROJECT PIPELINE</span>
                            <span className="w-1.5 h-1.5 bg-[#FFE600]"></span>
                            <span>TASK ID: #{String(task.id)}</span>
                        </div>

                        {/* Mark as Complete Checkbox in Header */}
                        <button
                            type="button"
                            onClick={() => handleToggleComplete(!isCompleted)}
                            className={`flex items-center gap-2 cursor-pointer select-none px-3 py-1 border-2 transition-all active:translate-x-[1px] active:translate-y-[1px] ${
                                isCompleted
                                    ? 'bg-[#00FF66]/15 border-[#00FF66] shadow-[2px_2px_0px_0px_#00FF66]'
                                    : 'bg-[#0E1012] border-black hover:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className={`w-4 h-4 rounded-none border-2 flex items-center justify-center transition-all ${
                                isCompleted
                                    ? 'bg-[#00FF66] border-black text-black shadow-[1px_1px_0px_0px_#000000]'
                                    : 'bg-[#16191D] border-neutral-600'
                            }`}>
                                {isCompleted && <Check size={11} strokeWidth={3.5} />}
                            </div>
                            <span className={`text-[11px] font-mono font-black tracking-wider uppercase ${
                                isCompleted ? 'text-[#00FF66]' : 'text-neutral-300'
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
                                className="w-full h-32 bg-[#0B0E14] border-2 border-black rounded-none px-4 py-3 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-all resize-y"
                            />
                        </div>

                        {/* Git Branch / PR */}
                        <div>
                            <div className="flex items-center gap-2 mb-2 text-white font-black text-[12px] uppercase">
                                <GitPullRequest size={14} />
                                <h3>// DEVELOPMENT PIPELINE</h3>
                            </div>
                            <div className="bg-[#0B0E14] border-2 border-black rounded-none p-4 space-y-3 shadow-[2px_2px_0px_0px_#000000]">
                                <div>
                                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">BRANCH NAME</label>
                                    <input
                                        value={branchName}
                                        onChange={(e) => setBranchName(e.target.value)}
                                        placeholder="feature/auth-roles"
                                        className="w-full bg-[#121417] border-2 border-black rounded-none px-3 py-2 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] transition-all"
                                    />
                                </div>
                                {task.prUrl && (
                                    <div className="text-[11px] font-mono">
                                        <span className="text-neutral-400 uppercase">PULL REQUEST: </span>
                                        <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="text-[#FFE600] hover:underline font-bold">{task.prUrl}</a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar (Right) */}
                    <div className="w-full md:w-64 space-y-5 shrink-0">

                        {/* Mark as Complete Sidebar Card */}
                        <div
                            onClick={() => handleToggleComplete(!isCompleted)}
                            className={`p-3 border-2 transition-all cursor-pointer select-none ${
                                isCompleted
                                    ? 'bg-[#00FF66]/10 border-[#00FF66] shadow-[2px_2px_0px_0px_#00FF66]'
                                    : 'bg-[#0B0E14] border-black hover:border-neutral-500 shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded-none border-2 flex items-center justify-center transition-all shrink-0 ${
                                    isCompleted
                                        ? 'bg-[#00FF66] border-black text-black shadow-[1.5px_1.5px_0px_0px_#000000]'
                                        : 'bg-[#121417] border-neutral-600'
                                }`}>
                                    {isCompleted && <Check size={13} strokeWidth={3.5} />}
                                </div>
                                <div>
                                    <div className={`text-[11px] font-mono font-black uppercase tracking-wider ${
                                        isCompleted ? 'text-[#00FF66]' : 'text-white'
                                    }`}>
                                        {isCompleted ? 'TASK COMPLETED' : 'MARK AS COMPLETE'}
                                    </div>
                                    <div className="text-[9px] font-mono text-neutral-400 mt-0.5">
                                        {isCompleted ? 'In Completed column' : 'Move to Completed column'}
                                    </div>
                                </div>
                            </div>
                        </div>

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
                                <label className="text-[10px] font-black text-neutral-400 uppercase tracking-wider flex items-center gap-1.5"><Tag size={13} /> TASK TYPE</label>
                                {!isAddingType && (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingType(true)}
                                        className="text-[10px] font-mono font-bold text-[#FFE600] hover:underline flex items-center gap-1 cursor-pointer"
                                    >
                                        <Plus size={11} /> NEW
                                    </button>
                                )}
                            </div>
                            {isAddingType ? (
                                <div className="flex gap-1.5">
                                    <input
                                        type="text"
                                        placeholder="CUSTOM TYPE..."
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
                                    value={type}
                                    onChange={(e) => {
                                        if (e.target.value === '__ADD_NEW__') {
                                            setIsAddingType(true);
                                        } else {
                                            setType(e.target.value as TaskType);
                                        }
                                    }}
                                    className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                                >
                                    {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
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

                        {/* Lead Assignee */}
                        <div>
                            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-1.5">LEAD ASSIGNEE</label>
                            <select
                                value={leadAssigneeId || ''}
                                onChange={(e) => setLeadAssigneeId(e.target.value || undefined)}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[12px] font-mono uppercase text-white focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors"
                            >
                                <option value="">UNASSIGNED</option>
                                {members.map(m => (
                                    <option key={String(m.user_id)} value={String(m.user_id)}>{m.gh_username || `Member #${m.user_id}`}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                </form>

                {/* Footer */}
                <div className="p-4 border-t-2 border-black flex justify-end gap-3 bg-[#0E1012] rounded-none">
                    <button 
                        type="button" 
                        onClick={onClose} 
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
        </div>
    );
};
