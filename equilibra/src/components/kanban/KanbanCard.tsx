import React from 'react';
import { Badge } from '../../design-system/Badge';
import { Clock, GitPullRequest, MoreHorizontal, User } from 'lucide-react';
import type { TaskType } from '../../models';

interface KanbanCardProps {
  id: string | number;
  title: string;
  type: TaskType;
  weight: number;
  assignee?: string;
  status?: string;
  warnStagnant?: boolean;
  isSuggested?: boolean;
  pr?: boolean;
  onDropTask?: (draggedTaskId: string | number, targetTaskId?: string | number) => void;
  onClick?: () => void;
  description?: string;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  id,
  title,
  type,
  weight,
  assignee,
  warnStagnant,
  isSuggested,
  pr,
  onDropTask,
  onClick,
  description
}) => {
  const [isOver, setIsOver] = React.useState(false);

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

  return (
    <div
      draggable
      onClick={onClick}
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
          : 'border-black shadow-[3px_3px_0px_0px_#000000] hover:border-white hover:shadow-[4px_4px_0px_0px_#000000]'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <h4 className="text-white text-[13px] font-bold leading-tight flex-1">
          {title}
        </h4>
        <span className="font-mono text-[10px] text-neutral-500 font-bold">
          #{String(id).slice(-4)}
        </span>
      </div>

      {description && (
        <p className="text-[11px] font-mono text-neutral-400 line-clamp-2 leading-relaxed">
          {description}
        </p>
      )}

      {/* Tags & Weight */}
      <div className="flex gap-2 flex-wrap items-center mt-1">
        <Badge variant={type === 'CODE' ? 'primary' : 'default'} className="!py-0.5 !px-1.5 !text-[9px]">
          {type === 'CODE' ? 'CODE' : 'SPEC'}
        </Badge>
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-black border border-neutral-700 text-[#FFE600]">
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

      {/* Card Footer */}
      <div className="mt-2 pt-2 border-t-2 border-neutral-800 flex items-center justify-between">
        {assignee ? (
          <div className="px-1.5 py-0.5 rounded-none bg-[#00E5FF] text-black border border-black font-mono text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_0px_#000000]">
            <User size={10} strokeWidth={3} />
            {assignee.toUpperCase()}
          </div>
        ) : (
          <div className="font-mono text-[10px] text-neutral-500 font-semibold uppercase">
            [UNASSIGNED]
          </div>
        )}
        <MoreHorizontal size={14} className="text-neutral-500 group-hover:text-white transition-colors" />
      </div>
    </div>
  );
};
