import React from 'react';
import { Badge } from '../../design-system/Badge';
import { MarkdownRenderer, hasMarkdownSyntax } from '../../design-system/MarkdownRenderer';
import { Clock, GitPullRequest, MoreHorizontal, Check, GitBranch } from 'lucide-react';
import type { TaskType } from '../../models';
import { getTaskTypeVariant, parseTaskTypes } from '../../utils/taskTypes';
import { TrashButton } from '../../design-system/TrashButton';
import { useToast } from '../../design-system/Toast';
import { cn } from '@/lib/utils';

export interface CardAssignee {
  userId?: string | number;
  name: string;
  avatarUrl?: string;
}

interface KanbanCardProps {
  id: string | number;
  title: string;
  type: TaskType;
  weight: number;
  assignee?: string;
  assigneeAvatar?: string;
  assignees?: CardAssignee[];
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
  assignees,
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

  const effectiveAssignees: CardAssignee[] = React.useMemo(() => {
    if (assignees && assignees.length > 0) return assignees;
    if (assignee) {
      return [{ name: assignee, avatarUrl: assigneeAvatar }];
    }
    return [];
  }, [assignees, assignee, assigneeAvatar]);

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

  const handleCopyIdToClipboard = async () => {
    try {
      const taskId = `[${title}](#${String(id)})`;
      await navigator.clipboard.writeText(taskId);
      showToast(`Task ID '${taskId}' copied to clipboard`, 'success');
    } catch {
      showToast('Task ID copied to clipboard', 'warning');
    }
  };

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
      className={cn(
        'p-3.5 rounded-lg bg-card text-card-foreground border group flex flex-col gap-2.5 transition-all duration-150 cursor-grab active:cursor-grabbing select-none shadow-xs',
        isOver
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40 shadow-sm'
          : warnStagnant
          ? 'border-destructive/40 bg-destructive/5'
          : isSuggested
          ? 'border-primary/40 bg-primary/5'
          : isCompleted
          ? 'border-border/60 opacity-70 hover:opacity-100 hover:border-border'
          : 'border-border hover:border-primary/50 hover:shadow-sm'
      )}
    >
      <div className="flex items-start gap-2.5">
        {onToggleComplete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(!isCompleted);
            }}
            className={cn(
              'shrink-0 mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center transition-colors cursor-pointer',
              isCompleted
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground/40 hover:border-primary text-transparent hover:text-muted-foreground'
            )}
            title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
            aria-label={isCompleted ? "Mark as incomplete" : "Mark as complete"}
          >
            <Check size={11} strokeWidth={2.5} className={isCompleted ? 'opacity-100' : 'opacity-0 hover:opacity-50'} />
          </button>
        )}
        <h4 className={cn(
          'text-xs font-semibold leading-snug flex-1 transition-colors',
          isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'
        )}>
          {title}
        </h4>
        <div className="flex items-center gap-1 shrink-0 -mt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyIdToClipboard();
            }}
            className="font-mono text-[11px] px-1.5 py-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Click to copy task reference"
          >
            #{String(id).slice(-4)}
          </button>

          {onDelete && (
            <TrashButton
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            />
          )}
        </div>
      </div>

      {description && (
        hasMarkdownSyntax(description) ? (
          <div className="text-xs text-muted-foreground line-clamp-3 leading-relaxed overflow-hidden">
            <MarkdownRenderer
              content={description}
              isSans
              compact
              className="text-xs"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {description}
          </p>
        )
      )}

      {/* Tags & Weight */}
      <div className="flex gap-1.5 flex-wrap items-center mt-0.5">
        {isCompleted && (
          <Badge variant="success" className="py-0.2 px-1.5 text-[10px]">
            Done
          </Badge>
        )}
        {parseTaskTypes(type).map((t) => (
          <Badge key={t} variant={getTaskTypeVariant(t)} className="py-0.2 px-1.5 text-[10px]">
            {t}
          </Badge>
        ))}
        <span className="font-mono text-[10px] font-medium px-1.5 py-0.2 rounded-md bg-muted text-muted-foreground">
          {weight} pts
        </span>
      </div>

      {/* Warnings & Badges */}
      {warnStagnant && (
        <div className="mt-0.5 text-destructive text-[11px] font-medium flex items-center gap-1.5 bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded-md">
          <Clock size={12} /> Stagnant &gt; 48h
        </div>
      )}

      {pr && (
        <div className="mt-0.5 text-primary text-[11px] font-medium flex items-center gap-1.5 bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
          <GitPullRequest size={12} /> PR linked
        </div>
      )}

      {repoUrl && (
        <div className="mt-0.5 text-muted-foreground font-mono text-[11px] flex items-center gap-1.5 bg-muted/50 border border-border/60 px-2 py-0.5 rounded-md truncate" title={repoUrl}>
          <GitBranch size={11} className="text-primary shrink-0" />
          <span className="truncate">{repoUrl.replace('https://github.com/', '')}</span>
        </div>
      )}

      {/* Card Footer */}
      <div className="mt-1.5 pt-2 border-t border-border/60 flex items-center justify-between">
        {effectiveAssignees.length > 0 ? (
          effectiveAssignees.length === 1 ? (
            <div
              className="px-2 py-0.5 rounded-full bg-muted/60 border border-border text-foreground text-[11px] font-medium flex items-center gap-1.5 max-w-[170px]"
              title={effectiveAssignees[0].name}
            >
              {effectiveAssignees[0].avatarUrl ? (
                <img
                  src={effectiveAssignees[0].avatarUrl}
                  alt={effectiveAssignees[0].name}
                  className="w-4 h-4 rounded-full object-cover shrink-0"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.nextElementSibling;
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : null}
              <span
                className={cn(
                  'w-4 h-4 rounded-full bg-primary/15 text-primary text-[8px] font-semibold flex items-center justify-center shrink-0',
                  effectiveAssignees[0].avatarUrl ? 'hidden' : ''
                )}
              >
                {getInitials(effectiveAssignees[0].name)}
              </span>
              <span className="truncate">{effectiveAssignees[0].name}</span>
            </div>
          ) : (
            <div
              className="flex items-center -space-x-1.5 py-0.5"
              title={effectiveAssignees.map((a) => a.name).join(', ')}
            >
              {effectiveAssignees.slice(0, 4).map((a, idx) => (
                <div key={idx} className="relative">
                  {a.avatarUrl ? (
                    <img
                      src={a.avatarUrl}
                      alt={a.name}
                      className="w-5 h-5 rounded-full border border-background object-cover bg-muted"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.nextElementSibling;
                        if (fallback) fallback.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      'w-5 h-5 rounded-full bg-primary/15 text-primary border border-background text-[8px] font-semibold flex items-center justify-center',
                      a.avatarUrl ? 'hidden' : ''
                    )}
                  >
                    {getInitials(a.name)}
                  </span>
                </div>
              ))}
              {effectiveAssignees.length > 4 && (
                <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground border border-background text-[8px] font-semibold flex items-center justify-center">
                  +{effectiveAssignees.length - 4}
                </span>
              )}
            </div>
          )
        ) : (
          <div className="text-[11px] text-muted-foreground font-medium">
            Unassigned
          </div>
        )}
        {onContextMenu ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
            className="p-1 -mr-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Task options"
            aria-label="Task options"
          >
            <MoreHorizontal size={14} />
          </button>
        ) : (
          <MoreHorizontal size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
      </div>
    </div>
  );
};
