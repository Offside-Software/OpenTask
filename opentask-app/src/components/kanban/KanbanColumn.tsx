import React from 'react';
import { Plus, Settings2, ChevronDown, Loader2, Expand } from 'lucide-react';
import { TrashButton } from '../../design-system/TrashButton';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  id: number | string;
  name: string;
  description?: string;
  colorClass: string;
  taskCount: number;
  totalTasks?: number;
  hasMoreTasks?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: (bucketId: number | string) => void;
  onDropTask: (taskId: number | string, newBucketId: number | string, targetTaskId?: number | string) => void;
  onDragStartColumn?: (e: React.DragEvent<HTMLDivElement>, columnId: number | string) => void;
  onDropColumn?: (e: React.DragEvent<HTMLDivElement>, targetColumnId: number | string) => void;
  onAddTask?: (bucketId: number | string) => void;
  onDeleteBucket?: (bucketId: number | string) => void;
  onEditBucket?: (bucketId: number | string) => void;
  onFocusBucket?: (bucketId: number | string) => void;
  widthClass?: string;
  children: React.ReactNode;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  name,
  description,
  colorClass,
  taskCount,
  totalTasks,
  hasMoreTasks,
  isLoadingMore,
  onLoadMore,
  onDropTask,
  onDragStartColumn,
  onDropColumn,
  onAddTask,
  onDeleteBucket,
  onEditBucket,
  onFocusBucket,
  widthClass,
  children
}) => {
  const [isOver, setIsOver] = React.useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
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

  const handleHeaderDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // Only allow drag if not clicking buttons or interactive elements inside header
    if ((e.target as HTMLElement).closest('button')) {
      e.preventDefault();
      return;
    }
    if (onDragStartColumn) {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      onDragStartColumn(e, id);
    }
  };

  const hasRemainingByTotal = totalTasks != null && totalTasks > taskCount;
  const canLoadMore = taskCount > 0 && (hasMoreTasks ?? hasRemainingByTotal);
  const remainingTasks = totalTasks != null ? Math.max(0, totalTasks - taskCount) : 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'group shrink-0 rounded-xl border flex flex-col h-full max-h-full transition-all duration-150 shadow-xs',
        widthClass || 'min-w-[320px] w-[320px]',
        isOver
          ? 'bg-primary/5 border-primary ring-1 ring-primary/40'
          : 'bg-muted/30 border-border/70'
      )}
    >
      {/* Column Header (Restricted drag handle for bucket moves) */}
      <div
        data-column-header="true"
        draggable={!!onDragStartColumn}
        onDragStart={handleHeaderDragStart}
        className={cn(
          "px-3.5 py-2 border-b border-border/60 bg-card/60 rounded-t-xl select-none shrink-0 backdrop-blur-xs",
          onDragStartColumn ? "cursor-grab active:cursor-grabbing" : ""
        )}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', colorClass)} />
            <h3 className="text-foreground font-semibold text-sm truncate" title={name}>
              {name}
            </h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span
              className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono text-[10px] font-semibold"
              title={hasRemainingByTotal ? `Loaded ${taskCount} of ${totalTasks} tasks` : `${taskCount} tasks`}
            >
              {hasRemainingByTotal
                ? `${taskCount}/${totalTasks}`
                : String(taskCount).padStart(2, '0')}
            </span>
            <button
              type="button"
              onClick={() => onAddTask && onAddTask(id)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
            >
              <Plus size={12} />
            </button>
            {onFocusBucket && (
              <button
                type="button"
                onClick={() => onFocusBucket(id)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                title="Focus bucket"
              >
                <Expand size={13} />
              </button>
            )}
            {onEditBucket && (
              <button
                type="button"
                onClick={() => onEditBucket(id)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                title="Column settings"
              >
                <Settings2 size={13} />
              </button>
            )}
            {onDeleteBucket && (
              <TrashButton
                onClick={() => {
                  onDeleteBucket(id);
                }}
              />
            )}
          </div>
        </div>

        {description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
            {description}
          </p>
        )}
      </div>

      {/* Task List */}
      <div className="flex flex-col gap-2.5 p-3 overflow-y-auto flex-1 min-h-0 relative">
        <div className="flex flex-col gap-2.5">
          {children}
        </div>

        {canLoadMore && (
          <button
            type="button"
            onClick={() => onLoadMore && onLoadMore(id)}
            disabled={isLoadingMore}
            className="w-full py-2 flex items-center justify-center gap-1.5 bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors text-xs font-medium cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
            title="Load more tasks for this column"
          >
            {isLoadingMore ? (
              <>
                <Loader2 size={13} className="animate-spin text-current" />
                <span>Loading tasks…</span>
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                <span>Load more {remainingTasks > 0 ? `(${remainingTasks} more)` : '(+20)'}</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
