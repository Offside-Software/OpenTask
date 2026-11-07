import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, CheckSquare, RotateCcw, FolderInput, ChevronRight, Trash2 } from 'lucide-react';
import type { Task, Bucket } from '../../models';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  'DRAFT': 'bg-amber-400',
  'PENDING': 'bg-orange-400',
  'TODO': 'bg-blue-400',
  'ONGOING': 'bg-emerald-400',
  'ON_REVIEW': 'bg-purple-400',
  'COMPLETED': 'bg-neutral-400',
};

export interface ContextMenuState {
  task: Task;
  x: number;
  y: number;
}

interface TaskContextMenuProps {
  contextMenu: ContextMenuState | null;
  buckets: Bucket[];
  onClose: () => void;
  onEdit: (task: Task) => void;
  onToggleComplete: (taskId: string | number, completed: boolean) => void;
  onMoveToBucket: (taskId: string | number, bucketId: string | number) => void;
  onDelete: (taskId: string | number) => void;
}

export const TaskContextMenu: React.FC<TaskContextMenuProps> = ({
  contextMenu,
  buckets,
  onClose,
  onEdit,
  onToggleComplete,
  onMoveToBucket,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showSubmenu, setShowSubmenu] = useState(false);

  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, onClose]);

  if (!contextMenu) return null;

  const { task } = contextMenu;
  const currentBucket = buckets.find(b => String(b.id) === String(task.bucket_id));
  const isCompleted = currentBucket?.state === 'COMPLETED' || task.status === 'COMPLETED';

  const menuWidth = 200;
  const menuHeight = 160;
  const padding = 12;

  let posX = contextMenu.x;
  let posY = contextMenu.y;

  if (typeof window !== 'undefined') {
    if (posX + menuWidth > window.innerWidth - padding) {
      posX = Math.max(padding, window.innerWidth - menuWidth - padding);
    }

    if (posY + menuHeight > window.innerHeight - padding) {
      posY = Math.max(padding, window.innerHeight - menuHeight - padding);
    }
  }

  const submenuWidth = 190;
  const submenuOnLeft = typeof window !== 'undefined' && (posX + menuWidth + submenuWidth > window.innerWidth - padding);

  return createPortal(
    <div
      key={`${contextMenu.x}_${contextMenu.y}_${contextMenu.task.id}`}
      ref={menuRef}
      style={{ top: `${posY}px`, left: `${posX}px` }}
      className="fixed z-[9999] min-w-[200px] bg-popover text-popover-foreground border border-border shadow-xl rounded-xl py-1 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Task ID Header */}
      <div className="px-3 py-1.5 border-b border-border/70 text-[11px] text-muted-foreground flex items-center justify-between">
        <span className="truncate max-w-[140px] font-mono font-medium">
          #{String(task.id).slice(-6)}
        </span>
        <span className="text-[10px] text-primary font-medium">Task</span>
      </div>

      <div className="py-1">
        {/* 1. Edit */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onEdit(task);
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <Edit3 size={13} />
          <span>Edit task</span>
        </button>

        {/* 2. Mark As Complete */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onToggleComplete(task.id!, !isCompleted);
          }}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors cursor-pointer",
            isCompleted
              ? "text-foreground hover:bg-muted"
              : "text-emerald-500 hover:bg-emerald-500/10"
          )}
        >
          {isCompleted ? (
            <>
              <RotateCcw size={13} />
              <span>Mark as incomplete</span>
            </>
          ) : (
            <>
              <CheckSquare size={13} />
              <span>Mark as complete</span>
            </>
          )}
        </button>

        {/* 3. Move To */}
        <div
          className="relative"
          onMouseEnter={() => setShowSubmenu(true)}
          onMouseLeave={() => setShowSubmenu(false)}
        >
          <button
            type="button"
            onClick={() => setShowSubmenu((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <FolderInput size={13} />
              <span>Move to</span>
            </div>
            <ChevronRight size={12} className="text-muted-foreground" />
          </button>

          {/* Submenu */}
          {showSubmenu && (
            <div
              className={cn(
                "absolute top-0 min-w-[190px] bg-popover text-popover-foreground border border-border shadow-xl rounded-xl py-1 z-[10000]",
                submenuOnLeft ? "right-full mr-1" : "left-full ml-1"
              )}
            >
              <div className="px-3 py-1 text-[10px] text-muted-foreground font-medium border-b border-border/70 mb-1">
                Buckets
              </div>
              <div className="max-h-[220px] overflow-y-auto no-scrollbar">
                {buckets.map((b) => {
                  const isCurrent = String(b.id) === String(task.bucket_id);
                  const color = STATUS_COLORS[b.state] || 'bg-neutral-400';
                  return (
                    <button
                      key={String(b.id)}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => {
                        onClose();
                        onMoveToBucket(task.id!, b.id!);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        isCurrent
                          ? "opacity-40 cursor-not-allowed text-muted-foreground"
                          : "text-foreground hover:bg-muted cursor-pointer"
                      )}
                    >
                      <div className={cn("w-2 h-2 rounded-full shrink-0", color)} />
                      <span className="truncate flex-1">{b.name || b.state}</span>
                      {isCurrent && <span className="text-[10px] text-muted-foreground">Current</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="my-1 border-t border-border/70" />

        {/* 4. Delete */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onDelete(task.id!);
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
          <span>Delete</span>
        </button>
      </div>
    </div>,
    document.body
  );
};
