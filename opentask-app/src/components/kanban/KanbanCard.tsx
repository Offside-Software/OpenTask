import React from 'react';
import { Badge } from '../../design-system/Badge';
import { Clock, GitPullRequest, MoreHorizontal, Check, GitBranch } from 'lucide-react';
import type { TaskType } from '../../models';
import { getTaskTypeVariant, parseTaskTypes } from '../../utils/taskTypes';
import { TrashButton } from '../../design-system/TrashButton';
import { useToast } from '../../design-system/Toast';

interface KanbanCardProps {
  id: string | number;
  title: string;
  type: TaskType;
  weight: number;
  assignee?: string;
  assigneeAvatar?: string;
  status?: string;
  warnStagnant?: boolean;
  isSuggested?: boolean;
  pr?: boolean;
  repoUrl?: string;
  isCompleted?: boolean;
  onToggleComplete?: (completed: boolean) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDropTask?: (draggedTaskId: string | number, targetTaskId?: string | number) => void;
  onClick?: () => void;
  onDelete?: () => void;
  description?: string;
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

export const KanbanCard: React.FC<KanbanCardProps> = ({
  id,
  title,
  type,
  weight,
  assignee,
  assigneeAvatar,
  warnStagnant,
  isSuggested,
  pr,
  repoUrl,
  isCompleted = false,
  onToggleComplete,
  onContextMenu,
  onDropTask,
  onClick,
  onDelete,
  description
}) => {
  const [isOver, setIsOver] = React.useState(false);
  const { showToast } = useToast();

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('taskId', id.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);

    if (onDropTask) {
      const draggedId = e.dataTransfer.getData('taskId');
      if (draggedId) {
        onDropTask(draggedId, id);
      }
    }
  };

  const handleCopyIdToClipboard = async() => {
    try {
      const taskId = `#${String(id).slice(-4)}`;
      await navigator.clipboard.writeText(taskId);
      showToast(`Task ID '${taskId}' Copied to Clipboard`, 'success');
    }
    catch {
      showToast("Task ID Copied to Clipboard", 'warning');
    }
  }

  return (
    <div
      draggable
      onClick={onClick}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e);
        }
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`p-3.5 rounded-none bg-[#16191D] border-2 group flex flex-col gap-2.5 transition-all duration-75 cursor-grab active:cursor-grabbing select-none ${
        isOver
          ? 'border-[#FFE600] shadow-[4px_4px_0px_0px_#FFE600] bg-[#1E2227]'
          : warnStagnant
          ? 'border-[#FF3333] shadow-[3px_3px_0px_0px_#FF3333]'
          : isSuggested
          ? 'border-[#FFE600] shadow-[3px_3px_0px_0px_#FFE600]'
          : isCompleted
          ? 'border-neutral-800 opacity-80 hover:opacity-100 shadow-[3px_3px_0px_0px_#000000] hover:border-neutral-600'
          : 'border-black shadow-[3px_3px_0px_0px_#000000] hover:border-[#FFE600] hover:shadow-[4px_4px_0px_0px_#000000]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {onToggleComplete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(!isCompleted);
            }}
            className={`shrink-0 mt-0.5 w-4 h-4 rounded-none border-2 flex items-center justify-center transition-all cursor-pointer shadow-[1px_1px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] ${
              isCompleted
                ? 'bg-[#00FF66] border-black text-black'
                : 'bg-[#0E1012] border-neutral-600 hover:border-[#FFE600] text-transparent hover:text-neutral-500'
            }`}
            title={isCompleted ? "Mark as Incomplete" : "Mark as Complete"}
            aria-label={isCompleted ? "Mark as Incomplete" : "Mark as Complete"}
          >
            <Check size={11} strokeWidth={3.5} className={isCompleted ? 'opacity-100' : 'opacity-0 hover:opacity-50'} />
          </button>
        )}
        <h4 className={`text-[13px] font-bold leading-tight flex-1 transition-colors ${
          isCompleted ? 'line-through text-neutral-400' : 'text-white'
        }`}>
          {title}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0 -mt-0.5">
          <button type='button' onClick={(e) => {
              e.stopPropagation();
              handleCopyIdToClipboard();
            }} 
          className="font-mono text-[13px] px-2 text-neutral-500 font-bold hover:bg-[#00FF66] hover:text-black hover:border hover:shadow-[1.5px_1.5px_0px_0px_#000000]">
            #{String(id).slice(-4)}
          </button>

          {onDelete && (
            <TrashButton 
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}>
            </TrashButton>
          )}
        </div>
      </div>

      {description && (
        <p className="text-[11px] font-mono text-neutral-400 line-clamp-2 leading-relaxed">
          {description}
        </p>
      )}

      {/* Tags & Weight */}
      <div className="flex gap-1.5 flex-wrap items-center mt-1">
        {isCompleted && (
          <Badge variant="success" className="!py-0.5 !px-1.5 !text-[11px]">
            DONE
          </Badge>
        )}
        {parseTaskTypes(type).map((t) => (
          <Badge key={t} variant={getTaskTypeVariant(t)} className="!py-0.5 !px-1.5 !text-[11px]">
            {t}
          </Badge>
        ))}
        <span className="font-mono self-end text-[11px] font-bold px-1.5 py-0.5 bg-black border border-neutral-700 text-[#FFE600]">
          {weight} PTS
        </span>
      </div>

      {/* Warnings & Badges */}
      {warnStagnant && (
        <div className="mt-1 text-black font-mono text-[10px] font-black flex items-center gap-1.5 bg-[#FF3333] border border-black px-2 py-0.5 shadow-[1.5px_1.5px_0px_0px_#000000]">
          <Clock size={11} strokeWidth={3} /> STAGNANT &gt; 48H
        </div>
      )}

      {pr && (
        <div className="mt-1 text-black font-mono text-[10px] font-black flex items-center gap-1.5 bg-[#FFE600] border border-black px-2 py-0.5 shadow-[1.5px_1.5px_0px_0px_#000000]">
          <GitPullRequest size={11} strokeWidth={3} /> PR LINKED
        </div>
      )}

      {repoUrl && (
        <div className="mt-1 text-neutral-300 font-mono text-[10px] font-bold flex items-center gap-1.5 bg-[#0B0E14] border border-neutral-700 px-2 py-0.5 truncate" title={repoUrl}>
          <GitBranch size={10} strokeWidth={2.5} className="text-[#FFE600] shrink-0" />
          <span className="truncate">{repoUrl.replace('https://github.com/', '')}</span>
        </div>
      )}

      {/* Card Footer */}
      <div className="mt-2 pt-2 border-t-2 border-neutral-800 flex items-center justify-between">
        {assignee ? (
          <div className="px-1.5 py-0.5 rounded-none bg-[#00E5FF] text-black border border-black font-mono text-[11px] font-black flex items-center gap-1.5 shadow-[1px_1px_0px_0px_#000000] max-w-[170px]">
            {assigneeAvatar ? (
              <img
                src={assigneeAvatar}
                alt={assignee}
                className="w-3.5 h-3.5 rounded-none border border-black object-cover shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback) fallback.classList.remove('hidden');
                }}
              />
            ) : null}
            <span
              className={`w-3.5 h-3.5 rounded-none bg-black text-[#00E5FF] font-mono text-[8px] font-black flex items-center justify-center shrink-0 border border-black ${
                assigneeAvatar ? 'hidden' : ''
              }`}
            >
              {getInitials(assignee)}
            </span>
            <span className="truncate">{assignee.toUpperCase()}</span>
          </div>
        ) : (
          <div className="font-mono text-[11px] text-neutral-500 font-semibold uppercase">
            [UNASSIGNED]
          </div>
        )}
        {onContextMenu ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
            className="p-1 -mr-1 rounded-none hover:bg-black hover:text-[#FFE600] text-neutral-500 transition-colors cursor-pointer border border-transparent hover:border-neutral-700"
            title="Task options"
            aria-label="Task options"
          >
            <MoreHorizontal size={14} />
          </button>
        ) : (
          <MoreHorizontal size={14} className="text-neutral-500 group-hover:text-white transition-colors" />
        )}
      </div>
    </div>
  );
};
