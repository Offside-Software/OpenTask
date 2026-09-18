import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, CheckSquare, RotateCcw, FolderInput, ChevronRight, Trash2 } from 'lucide-react';
import type { Task, Bucket } from '../../models';

const STATUS_COLORS: Record<string, string> = {
  'DRAFT': 'bg-[#FFE600]',
  'PENDING': 'bg-[#F97316]',
  'TODO': 'bg-[#3B82F6]',
  'ONGOING': 'bg-[#16A34A]',
  'ON_REVIEW': 'bg-[#8B5CF6]',
  'COMPLETED': 'bg-slate-400',
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

  // Click outside and escape listeners
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

  // Synchronously compute position directly from the current mouse coordinates
  const menuWidth = 210;
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

  const submenuWidth = 200;
  const submenuOnLeft = typeof window !== 'undefined' && (posX + menuWidth + submenuWidth > window.innerWidth - padding);

  return createPortal(
    <div
      key={`${contextMenu.x}_${contextMenu.y}_${contextMenu.task.id}`}
      ref={menuRef}
      style={{ top: `${posY}px`, left: `${posX}px` }}
      className="fixed z-[9999] min-w-[210px] bg-[#121417] border-2 border-black shadow-[4px_4px_0px_0px_#000000] rounded-none py-1.5 font-mono text-[11px] font-bold uppercase select-none"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Task ID Header */}
      <div className="px-3 py-1.5 border-b border-neutral-800 text-[10px] text-neutral-500 flex items-center justify-between">
        <span className="truncate max-w-[140px] text-neutral-400 font-bold">
          #{String(task.id).slice(-6)}
        </span>
        <span className="text-[9px] text-[#FFE600]">// TASK</span>
      </div>

      <div className="py-1">
        {/* 1. Edit (full edit) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onEdit(task);
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-neutral-200 hover:text-black hover:bg-[#FFE600] transition-colors cursor-pointer"
        >
          <Edit3 size={13} strokeWidth={2.5} />
          <span>Edit (Full Edit)</span>
        </button>

        {/* 2. Mark As Complete */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onToggleComplete(task.id!, !isCompleted);
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
            isCompleted
              ? 'text-neutral-300 hover:text-black hover:bg-[#FFE600]'
              : 'text-[#00FF66] hover:text-black hover:bg-[#00FF66]'
          }`}
        >
          {isCompleted ? (
            <>
              <RotateCcw size={13} strokeWidth={2.5} />
              <span>Mark As Incomplete</span>
            </>
          ) : (
            <>
              <CheckSquare size={13} strokeWidth={2.5} />
              <span>Mark As Complete</span>
            </>
          )}
        </button>

        {/* 3. Move To > Buckets > List Of Buckets */}
        <div
          className="relative"
          onMouseEnter={() => setShowSubmenu(true)}
          onMouseLeave={() => setShowSubmenu(false)}
        >
          <button
            type="button"
            onClick={() => setShowSubmenu((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2 text-left text-neutral-200 hover:text-black hover:bg-[#FFE600] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <FolderInput size={13} strokeWidth={2.5} />
              <span>Move To</span>
            </div>
            <ChevronRight size={12} strokeWidth={3} />
          </button>

          {/* Submenu: Buckets */}
          {showSubmenu && (
            <div
              className={`absolute top-0 ${
                submenuOnLeft ? 'right-full mr-1' : 'left-full ml-1'
              } min-w-[200px] bg-[#121417] border-2 border-black shadow-[4px_4px_0px_0px_#000000] rounded-none py-1.5 z-[10000]`}
            >
              <div className="px-3 py-1 text-[9px] text-neutral-500 font-mono font-bold tracking-widest border-b border-neutral-800 mb-1">
                // BUCKETS
              </div>
              <div className="max-h-[220px] overflow-y-auto no-scrollbar">
                {buckets.map((b) => {
                  const isCurrent = String(b.id) === String(task.bucket_id);
                  const color = STATUS_COLORS[b.state] || 'bg-slate-400';
                  return (
                    <button
                      key={String(b.id)}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => {
                        onClose();
                        onMoveToBucket(task.id!, b.id!);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors ${
                        isCurrent
                          ? 'opacity-40 cursor-not-allowed text-neutral-500'
                          : 'text-neutral-200 hover:text-black hover:bg-[#FFE600] cursor-pointer'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-none border border-black shrink-0 ${color}`} />
                      <span className="truncate flex-1">{b.name || b.state}</span>
                      {isCurrent && <span className="text-[9px] text-neutral-500">[CURRENT]</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="my-1 border-t border-neutral-800" />

        {/* 4. Delete */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onDelete(task.id!);
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[#EF4444] hover:text-white hover:bg-[#EF4444] transition-colors cursor-pointer"
        >
          <Trash2 size={13} strokeWidth={2.5} />
          <span>Delete</span>
        </button>
      </div>
    </div>,
    document.body
  );
};
