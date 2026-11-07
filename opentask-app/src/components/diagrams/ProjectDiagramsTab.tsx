import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Network,
  Plus,
  Trash2,
  Save,
  Download,
  Link2,
  Search,
  Columns,
  Maximize2,
  Code2,
  FileImage,
  FileText,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { MermaidViewer } from "./MermaidViewer";
import { MermaidEditor, MERMAID_TEMPLATES } from "./MermaidEditor";
import { TaskLinkModal } from "./TaskLinkModal";
import { ConfirmModal } from "../modals/ConfirmModal";
import { diagramService } from "../../services/diagramService";
import {
  exportDiagramAsPng,
  exportDiagramAsJpg,
  exportDiagramAsPdf,
} from "../../utils/diagramExport";
import { useToast } from "../../design-system/Toast";
import { useTheme } from "../../context/themeContext";
import type { ProjectDiagram, Task } from "../../models";
import { cn } from "@/lib/utils";

interface ProjectDiagramsTabProps {
  projectId: string | number;
  tasks?: Task[];
  isManager?: boolean;
}

export const ProjectDiagramsTab: React.FC<ProjectDiagramsTabProps> = ({
  projectId,
  tasks = [],
}) => {
  const { showToast } = useToast();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [diagrams, setDiagrams] = useState<ProjectDiagram[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);

  // Active diagram working state
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);

  // View & Export state
  const [viewMode, setViewMode] = useState<"split" | "canvas" | "code">("split");
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState<SVGElement | null>(null);

  // Modals
  const [diagramToDelete, setDiagramToDelete] = useState<ProjectDiagram | null>(null);
  const [isTaskLinkModalOpen, setIsTaskLinkModalOpen] = useState(false);
  const [linkedTaskIds, setLinkedTaskIds] = useState<Set<string>>(new Set());

  // Search filter
  const [search, setSearch] = useState("");

  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    if (isExportMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExportMenuOpen]);

  // Load project diagrams
  const fetchDiagrams = useCallback(async () => {
    try {
      setLoading(true);
      const list = await diagramService.getProjectDiagrams(projectId);
      setDiagrams(list);

      // Select first diagram if none selected
      if (list.length > 0) {
        setSelectedDiagramId((prev) => {
          if (prev && list.some((d) => String(d.id) === String(prev))) return prev;
          return String(list[0].id);
        });
      } else {
        setSelectedDiagramId(null);
      }
    } catch (err: any) {
      console.error("Failed to load project diagrams:", err);
      showToast("Failed to load diagrams", "error");
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    fetchDiagrams();
  }, [fetchDiagrams]);

  // Track the ID of the diagram currently loaded in working state to avoid overwriting edits
  const lastPopulatedIdRef = useRef<string | null>(null);

  // When selected diagram changes, populate working state
  useEffect(() => {
    if (!selectedDiagramId) {
      setTitle("");
      setCode("");
      setDescription("");
      setIsDirty(false);
      setLinkedTaskIds(new Set());
      lastPopulatedIdRef.current = null;
      return;
    }

    // Only overwrite working state when the selected diagram actually changes
    if (lastPopulatedIdRef.current !== selectedDiagramId) {
      const current = diagrams.find((d) => String(d.id) === String(selectedDiagramId));
      if (current) {
        setTitle(current.title || "Untitled Diagram");
        setCode(current.code || MERMAID_TEMPLATES[0].code);
        setDescription(current.description || "");
        setIsDirty(false);
        lastPopulatedIdRef.current = selectedDiagramId;

        // Fetch linked tasks
        diagramService
          .getDiagramTasks(projectId, current.id)
          .then((linkedTasks) => {
            setLinkedTaskIds(new Set(linkedTasks.map((t) => String(t.id))));
          })
          .catch((err) => {
            console.warn("Failed to load diagram tasks:", err);
          });
      }
    }
  }, [selectedDiagramId, diagrams, projectId]);

  // Code change
  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsDirty(true);
  };

  // Title change
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setIsDirty(true);
  };

  // Create new diagram
  const handleCreateDiagram = async (preset?: (typeof MERMAID_TEMPLATES)[0]) => {
    try {
      const template = preset || MERMAID_TEMPLATES[0];
      const newDiagram = await diagramService.createDiagram(projectId, {
        title: `New Diagram #${diagrams.length + 1}`,
        code: template.code,
        description: "",
      });

      lastPopulatedIdRef.current = null;
      setDiagrams((prev) => [newDiagram, ...prev]);
      setSelectedDiagramId(String(newDiagram.id));
      showToast("New diagram created", "success");
    } catch (err: any) {
      console.error("Failed to create diagram:", err);
      showToast(err?.message || "Failed to create diagram", "error");
    }
  };

  // Save changes
  const handleSaveDiagram = async () => {
    if (!selectedDiagramId) return;
    setIsSaving(true);
    try {
      const updated = await diagramService.updateDiagram(projectId, selectedDiagramId, {
        title: title.trim() || "Untitled Diagram",
        code,
        description,
      });

      lastPopulatedIdRef.current = selectedDiagramId;
      setDiagrams((prev) =>
        prev.map((d) => (String(d.id) === String(selectedDiagramId) ? updated : d)),
      );
      setIsDirty(false);
      showToast("Diagram saved successfully", "success");
    } catch (err: any) {
      console.error("Failed to save diagram:", err);
      showToast(err?.message || "Failed to save diagram", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !isSaving && selectedDiagramId) {
          handleSaveDiagram();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, isSaving, selectedDiagramId, title, code, description, projectId]);

  // Delete diagram
  const handleDeleteDiagram = async () => {
    if (!diagramToDelete) return;
    try {
      await diagramService.deleteDiagram(projectId, diagramToDelete.id);
      setDiagrams((prev) => prev.filter((d) => String(d.id) !== String(diagramToDelete.id)));
      if (selectedDiagramId === String(diagramToDelete.id)) {
        lastPopulatedIdRef.current = null;
        const remaining = diagrams.filter((d) => String(d.id) !== String(diagramToDelete.id));
        setSelectedDiagramId(remaining.length > 0 ? String(remaining[0].id) : null);
      }
      showToast("Diagram deleted", "info");
    } catch (err: any) {
      console.error("Failed to delete diagram:", err);
      showToast(err?.message || "Failed to delete diagram", "error");
    } finally {
      setDiagramToDelete(null);
    }
  };

  // Toggle task link
  const handleToggleTaskLink = async (taskId: string, shouldLink: boolean) => {
    if (!selectedDiagramId) return;
    if (shouldLink) {
      await diagramService.linkTask(projectId, selectedDiagramId, taskId);
      setLinkedTaskIds((prev) => new Set([...prev, taskId]));
      showToast("Task attached to diagram", "success");
    } else {
      await diagramService.unlinkTask(projectId, selectedDiagramId, taskId);
      setLinkedTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      showToast("Task detached from diagram", "info");
    }
  };

  const getActiveSvg = (): SVGElement | null => {
    if (renderedSvg && renderedSvg.isConnected) return renderedSvg;
    return (
      document.querySelector(".mermaid-viewer svg") ||
      document.querySelector("svg[id^='mermaid-']") ||
      document.querySelector(".mermaid-canvas-viewport svg")
    );
  };

  // Export handlers
  const handleExportPng = async () => {
    const targetSvg = getActiveSvg();
    if (!targetSvg) {
      showToast("No rendered graph available to export", "warning");
      return;
    }
    setIsExporting(true);
    setIsExportMenuOpen(false);
    try {
      await exportDiagramAsPng(targetSvg, title || "diagram", isDark);
      showToast("Exported PNG successfully", "success");
    } catch (err: any) {
      console.error("Failed to export PNG:", err);
      showToast(err?.message || "Failed to export PNG", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJpg = async () => {
    const targetSvg = getActiveSvg();
    if (!targetSvg) {
      showToast("No rendered graph available to export", "warning");
      return;
    }
    setIsExporting(true);
    setIsExportMenuOpen(false);
    try {
      await exportDiagramAsJpg(targetSvg, title || "diagram", isDark);
      showToast("Exported JPG successfully", "success");
    } catch (err: any) {
      console.error("Failed to export JPG:", err);
      showToast(err?.message || "Failed to export JPG", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    const targetSvg = getActiveSvg();
    if (!targetSvg) {
      showToast("No rendered graph available to export", "warning");
      return;
    }
    setIsExporting(true);
    setIsExportMenuOpen(false);
    try {
      await exportDiagramAsPdf(targetSvg, title || "diagram", isDark);
      showToast("Exported PDF successfully", "success");
    } catch (err: any) {
      console.error("Failed to export PDF:", err);
      showToast(err?.message || "Failed to export PDF", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const filteredDiagrams = diagrams.filter((d) => {
    if (!search.trim()) return true;
    return d.title.toLowerCase().includes(search.toLowerCase());
  });

  const activeDiagram = diagrams.find((d) => String(d.id) === String(selectedDiagramId));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background text-foreground animate-in fade-in duration-200">
      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 border border-border rounded-xl bg-card overflow-hidden shadow-xs">
        {/* Left: Diagram Sidebar List */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border flex flex-col bg-muted/20 shrink-0">
          {/* Sidebar Header */}
          <div className="p-3 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Network size={16} className="text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Diagrams
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground border border-border">
                {diagrams.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleCreateDiagram()}
              title="Create new diagram"
              className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground font-semibold text-xs rounded-md shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search diagrams…"
                className="w-full pl-8 pr-3 py-1 text-xs bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Diagram Item List */}
          <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-xs gap-2">
                <Loader2 size={15} className="animate-spin text-primary" />
                <span>Loading diagrams…</span>
              </div>
            ) : filteredDiagrams.length === 0 ? (
              <div className="text-center py-8 px-2 text-muted-foreground">
                <p className="text-xs font-medium">No diagrams found</p>
                <p className="text-[11px] mt-1">Click &quot;New&quot; to start drawing.</p>
              </div>
            ) : (
              filteredDiagrams.map((diag) => {
                const isSelected = String(diag.id) === String(selectedDiagramId);
                return (
                  <div
                    key={String(diag.id)}
                    onClick={() => setSelectedDiagramId(String(diag.id))}
                    className={cn(
                      "group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                        : "bg-card hover:bg-muted/60 border-border text-foreground",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate">{diag.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                        <Clock size={10} className="shrink-0 opacity-70" />
                        <span className="truncate opacity-70 font-mono">
                          {diag.updated_at
                            ? new Date(diag.updated_at).toLocaleDateString()
                            : "Draft"}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDiagramToDelete(diag);
                      }}
                      title="Delete diagram"
                      className={cn(
                        "w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ml-1 cursor-pointer shrink-0",
                        isSelected
                          ? "hover:bg-primary-foreground/20 text-primary-foreground"
                          : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive",
                      )}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right: Diagram Workspace */}
        <main className="flex-1 flex flex-col min-h-0 bg-background">
          {selectedDiagramId && activeDiagram ? (
            <>
              {/* Workspace Top Toolbar */}
              <div className="px-4 py-2.5 bg-muted/20 border-b border-border flex items-center justify-between flex-wrap gap-2.5">
                {/* Title Input */}
                <div className="flex items-center gap-2 min-w-0 flex-1 max-w-md">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Diagram title…"
                    className="w-full text-sm font-bold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1 py-0.5 transition-colors"
                  />
                  {isDirty && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-md shrink-0">
                      Unsaved
                    </span>
                  )}
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* View Mode Switcher */}
                  <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setViewMode("split")}
                      title="Split View (Editor & Canvas)"
                      className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer",
                        viewMode === "split"
                          ? "bg-card text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Columns size={12} />
                      <span className="hidden sm:inline">Split</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("canvas")}
                      title="Canvas Only (Full Viewer)"
                      className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer",
                        viewMode === "canvas"
                          ? "bg-card text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Maximize2 size={12} />
                      <span className="hidden sm:inline">Canvas</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("code")}
                      title="Code Editor Only"
                      className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer",
                        viewMode === "code"
                          ? "bg-card text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Code2 size={12} />
                      <span className="hidden sm:inline">Code</span>
                    </button>
                  </div>

                  {/* Linked Tasks Button */}
                  <button
                    type="button"
                    onClick={() => setIsTaskLinkModalOpen(true)}
                    title="Attach or detach tasks"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border text-foreground hover:bg-muted text-xs font-medium transition-colors cursor-pointer shadow-xs"
                  >
                    <Link2 size={13} className="text-primary" />
                    <span>Tasks</span>
                    {linkedTaskIds.size > 0 && (
                      <span className="text-[10px] font-mono px-1 py-0.2 bg-primary/20 text-foreground font-bold rounded-sm">
                        {linkedTaskIds.size}
                      </span>
                    )}
                  </button>

                  {/* Export Dropdown */}
                  <div className="relative" ref={exportMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsExportMenuOpen((o) => !o)}
                      disabled={isExporting || !renderedSvg}
                      title="Export diagram to PNG, JPG, or PDF"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border text-foreground hover:bg-muted text-xs font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {isExporting ? (
                        <Loader2 size={13} className="animate-spin text-primary" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>Export</span>
                    </button>

                    {isExportMenuOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl z-40 p-1 animate-in fade-in zoom-in-95 duration-100">
                        <button
                          type="button"
                          onClick={handleExportPng}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-xs transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <FileImage size={13} className="text-primary" />
                          <span>Export as PNG</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportJpg}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-xs transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <FileImage size={13} className="text-amber-500" />
                          <span>Export as JPG</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportPdf}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-xs transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <FileText size={13} className="text-emerald-500" />
                          <span>Export as PDF</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Save Button */}
                  <button
                    type="button"
                    onClick={handleSaveDiagram}
                    disabled={isSaving || !isDirty}
                    title="Save diagram changes"
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-primary-foreground font-semibold text-xs shadow-xs hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Save size={13} />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>

              {/* Workspace Content Area */}
              <div className="flex-1 flex min-h-0 relative p-3 gap-3 overflow-hidden">
                {/* Code Editor Panel */}
                {(viewMode === "split" || viewMode === "code") && (
                  <div
                    className={cn(
                      "h-full min-h-0 transition-all",
                      viewMode === "split" ? "w-full md:w-1/2" : "w-full",
                    )}
                  >
                    <MermaidEditor
                      code={code}
                      onChange={handleCodeChange}
                      error={syntaxError}
                    />
                  </div>
                )}

                {/* Graph Canvas Panel */}
                {(viewMode === "split" || viewMode === "canvas") && (
                  <div
                    className={cn(
                      "h-full min-h-0 transition-all",
                      viewMode === "split" ? "w-full md:w-1/2" : "w-full",
                    )}
                  >
                    <MermaidViewer
                      key={selectedDiagramId || "new"}
                      code={code}
                      title={title}
                      onSvgRendered={setRenderedSvg}
                      onErrorChange={setSyntaxError}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4 shadow-sm">
                <Network size={28} />
              </div>
              <h3 className="text-base font-bold text-foreground mb-1">
                Project Architecture & Diagrams
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mb-6">
                Design system architectures, sequence flows, ER diagrams, and state charts with live Mermaid.js.
              </p>
              <button
                type="button"
                onClick={() => handleCreateDiagram()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Sparkles size={14} />
                <span>Create First Diagram</span>
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Delete Confirmation Modal */}
      {diagramToDelete && (
        <ConfirmModal
          title="Delete Diagram"
          message={`Are you sure you want to permanently delete "${diagramToDelete.title}"? Any task links will be removed.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDeleteDiagram}
          onCancel={() => setDiagramToDelete(null)}
        />
      )}

      {/* Task Linker Modal */}
      {activeDiagram && (
        <TaskLinkModal
          isOpen={isTaskLinkModalOpen}
          onClose={() => setIsTaskLinkModalOpen(false)}
          diagram={activeDiagram}
          tasks={tasks}
          linkedTaskIds={linkedTaskIds}
          onToggleLink={handleToggleTaskLink}
        />
      )}
    </div>
  );
};
