import React, { useState } from "react";
import { Search, Check, Link2, X } from "lucide-react";
import { CloseButton } from "../../design-system/CloseButton";
import { Badge } from "../../design-system/Badge";
import type { Task, ProjectDiagram } from "../../models";

interface TaskLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagram: ProjectDiagram;
  tasks: Task[];
  linkedTaskIds: Set<string>;
  onToggleLink: (taskId: string, isLinked: boolean) => Promise<void>;
}

export const TaskLinkModal: React.FC<TaskLinkModalProps> = ({
  isOpen,
  onClose,
  diagram,
  tasks,
  linkedTaskIds,
  onToggleLink,
}) => {
  const [search, setSearch] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredTasks = tasks.filter((t) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(query) ||
      t.type?.toLowerCase().includes(query) ||
      String(t.id).includes(query)
    );
  });

  const handleToggle = async (taskId: string) => {
    const isCurrentlyLinked = linkedTaskIds.has(taskId);
    setBusyTaskId(taskId);
    try {
      await onToggleLink(taskId, !isCurrentlyLinked);
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-card border-2 border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Link2 size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground truncate">
                Link Tasks to Diagram
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                {diagram.title}
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title, type, or ID…"
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 no-scrollbar">
          {filteredTasks.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No matching tasks found.
            </div>
          ) : (
            filteredTasks.map((task) => {
              const taskIdStr = String(task.id);
              const isLinked = linkedTaskIds.has(taskIdStr);
              const isBusy = busyTaskId === taskIdStr;

              return (
                <div
                  key={taskIdStr}
                  onClick={() => !isBusy && handleToggle(taskIdStr)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isLinked
                      ? "bg-primary/10 border-primary text-foreground font-medium shadow-xs"
                      : "bg-card hover:bg-muted/50 border-border text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                        isLinked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-muted-foreground/40 bg-background"
                      }`}
                    >
                      {isLinked && <Check size={11} strokeWidth={3} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate">{task.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          #{taskIdStr.slice(-4)}
                        </span>
                        <Badge variant="neutral" className="text-[9px] uppercase px-1 py-0">
                          {task.type}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                    {isLinked ? "Attached" : "Click to attach"}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>{linkedTaskIds.size} task(s) attached</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-foreground text-background font-medium rounded-lg hover:opacity-90 transition-opacity cursor-pointer text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
