import React from 'react';
import { CheckCircle2, Plus, Settings2 } from 'lucide-react';
import { Badge } from '../../design-system/Badge';
import { TrashButton } from '../../design-system/TrashButton';

interface KanbanColumnProps {
  id: number | string;
  name: string;
  description?: string;
  colorClass: string;
  statusText: string;
  taskCount: number;
  onDropTask: (taskId: number | string, newBucketId: number | string, targetTaskId?: number | string) => void;
  onDragStartColumn?: (e: React.DragEvent<HTMLDivElement>, columnId: number | string) => void;
  onDropColumn?: (e: React.DragEvent<HTMLDivElement>, targetColumnId: number | string) => void;
  onAddTask?: (bucketId: number | string) => void;
  onDeleteBucket?: (bucketId: number | string) => void;
  onEditBucket?: (bucketId: number | string) => void;
  children: React.ReactNode;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  name,
  description,
  colorClass,
  statusText,
  taskCount,
  onDropTask,
  onDragStartColumn,
  onDropColumn,
  onAddTask,
  onDeleteBucket,
  onEditBucket,
  children
}) => {
  const [isOver, setIsOver] = React.useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIsOver(false);
    const taskIdString = e.dataTransfer.getData('taskId');
    const columnIdString = e.dataTransfer.getData('columnId');

    if (taskIdString) {
      e.preventDefault();
      e.stopPropagation();
      onDropTask(taskIdString, id);
    } else if (columnIdString && onDropColumn) {
      e.preventDefault();
      e.stopPropagation();
      onDropColumn(e, id);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (onDragStartColumn) {
      onDragStartColumn(e, id);
    }
  };

  return (
    <div
      draggable={!!onDragStartColumn}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group min-w-[316px] w-[316px] border-2 rounded-none flex flex-col max-h-full transition-all duration-75 shadow-[4px_4px_0px_0px_#000000] ${
        isOver 
          ? 'bg-[#1E2227] border-[#FFE600] ring-2 ring-[#FFE600]' 
          : 'bg-[#0E1012] border-neutral-700'
      }`}
    >
      {/* Column Header */}
      <div className="p-3.5 border-b-2 border-neutral-700 bg-[#141619] select-none">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className={`w-2.5 h-2.5 rounded-none border border-black shrink-0 ${colorClass}`} />
            <h3 className="text-white font-mono font-black text-[13px] uppercase tracking-wider truncate" title={name}>
              <span className="text-[#FFE600] mr-1">//</span>{name}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="px-1.5 py-0.5 rounded-none bg-black text-[#FFE600] border border-neutral-700 font-mono text-[10px] font-black">
              {String(taskCount).padStart(2, '0')}
            </span>
            {onEditBucket && (
              <button
                onClick={() => onEditBucket(id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-none hover:bg-[#FFE600] hover:text-black text-neutral-400 border border-transparent hover:border-black transition-all cursor-pointer"
                title="Column settings"
              >
                <Settings2 size={13} />
              </button>
            )}
            {onDeleteBucket && (
              <TrashButton 
                onClick={() => {
                  onDeleteBucket(id)
                }}
                ></TrashButton>
            )}
          </div>
        </div>

        {description && (
          <p className="text-[11px] font-mono text-neutral-400 line-clamp-1 mb-2">
            {description}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Badge 
            variant={statusText === 'RUNNING' ? 'success' : statusText === 'PAUSED' ? 'warning' : 'default'} 
            className="!text-[9px] !py-0.5"
          >
            <CheckCircle2 size={10} strokeWidth={2.5} /> {statusText}
          </Badge>
        </div>
      </div>

      {/* Task List */}
      <div className="p-3 overflow-y-auto space-y-3 no-scrollbar flex-1 relative min-h-[140px]">
        {children}
        <button
          onClick={() => onAddTask && onAddTask(id)}
          className="w-full py-2.5 flex items-center justify-center gap-1.5 text-neutral-400 hover:text-black border-2 border-dashed border-neutral-700 hover:border-black hover:bg-[#FFE600] rounded-none transition-all duration-75 font-mono text-[11px] font-bold uppercase tracking-wider cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
        >
          <Plus size={14} strokeWidth={3} /> Add Task
        </button>
      </div>
    </div>
  );
};
