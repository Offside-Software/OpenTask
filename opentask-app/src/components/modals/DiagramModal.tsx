import React, { useState, useEffect, useRef } from "react";
import {
  Network,
  Save,
  Download,
  Code2,
  Maximize2,
  FileImage,
  FileText,
  Loader2,
  Clock,
} from "lucide-react";
import { MermaidViewer } from "../diagrams/MermaidViewer";
import { MermaidEditor } from "../diagrams/MermaidEditor";
import { CloseButton } from "../../design-system/CloseButton";
import { Button } from "../../design-system/Button";
import { useToast } from "../../design-system/Toast";
import { diagramService } from "../../services/diagramService";
import {
  exportDiagramAsPng,
  exportDiagramAsJpg,
  exportDiagramAsPdf,
} from "../../utils/diagramExport";
import type { ProjectDiagram } from "../../models";
import { cn } from "@/lib/utils";

interface DiagramModalProps {
  diagramId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onDiagramUpdated?: (diagram: ProjectDiagram) => void;
  readOnly?: boolean;
}

export const DiagramModal: React.FC<DiagramModalProps> = ({
  diagramId,
  isOpen,
  onClose,
  onDiagramUpdated,
  readOnly = false,
}) => {
  const { showToast } = useToast();
  const [diagram, setDiagram] = useState<ProjectDiagram | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState<SVGElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setIsExportMenuOpen(false);
      }
    };
    if (isExportMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExportMenuOpen]);

  // Load diagram details when diagramId changes or modal opens
  useEffect(() => {
    if (!isOpen || !diagramId) {
      setDiagram(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    diagramService
      .getDiagram(diagramId)
      .then((d: ProjectDiagram) => {
        if (!isMounted) return;
        setDiagram(d);
        setTitle(d.title);
        setCode(d.code);
        setDescription(d.description || "");
        setIsDirty(false);
        setMode("view");
      })
      .catch((err: any) => {
        if (!isMounted) return;
        console.error("Failed to load diagram in modal:", err);
        showToast("Failed to load diagram", "error");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, diagramId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!diagram || !diagram.id || !title.trim()) return;

    setIsSaving(true);
    try {
      const updated = await diagramService.updateDiagram(diagram.id, {
        title: title.trim(),
        code,
        description: description.trim() || undefined,
      });

      setDiagram(updated);
      setIsDirty(false);
      showToast("Diagram saved successfully", "success");
      onDiagramUpdated?.(updated);
    } catch (err: any) {
      console.error("Failed to save diagram:", err);
      showToast(err.message || "Failed to save diagram", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Ctrl+S / Cmd+S to save in edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !isSaving && !readOnly && mode === "edit") {
          handleSave();
        }
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDirty, isSaving, readOnly, mode, title, code, description, diagram]);

  const getActiveSvg = (): SVGElement | null => {
    if (renderedSvg && renderedSvg.isConnected) return renderedSvg;
    return (
      document.querySelector(".mermaid-viewer svg") ||
      document.querySelector("svg[id^='mermaid-']")
    );
  };

  const handleExport = async (format: "png" | "jpg" | "pdf") => {
    const targetSvg = getActiveSvg();
    if (!targetSvg) {
      showToast("Wait for diagram to finish rendering before exporting", "warning");
      return;
    }

    setIsExporting(true);
    setIsExportMenuOpen(false);
    try {
      const exportName = title.trim() || "diagram";
      if (format === "png") {
        await exportDiagramAsPng(targetSvg, { filename: `${exportName}.png` });
        showToast("Exported as PNG (Retina 2x)", "success");
      } else if (format === "jpg") {
        await exportDiagramAsJpg(targetSvg, { filename: `${exportName}.jpg` });
        showToast("Exported as JPG", "success");
      } else if (format === "pdf") {
        await exportDiagramAsPdf(targetSvg, { filename: `${exportName}.pdf` });
        showToast("Exported as PDF", "success");
      }
    } catch (err: any) {
      console.error("Export error:", err);
      showToast(err.message || "Failed to export diagram", "error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-6xl h-[92vh] max-h-[950px] bg-card border-2 border-border rounded-xl shadow-[4px_4px_0px_0px_#000000] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Network size={20} />
            </div>

            <div className="min-w-0 flex-1">
              {mode === "edit" && !readOnly ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="Diagram title..."
                  className="w-full text-base font-bold bg-background border border-input rounded-md px-2.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-foreground truncate">
                    {title || (loading ? "Loading diagram..." : "Untitled Diagram")}
                  </h2>
                  {isDirty && (
                    <span className="text-[11px] font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full shrink-0">
                      Unsaved
                    </span>
                  )}
                </div>
              )}

              {diagram?.updated_at && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                  <Clock size={11} />
                  <span>
                    Updated {new Date(diagram.updated_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Toggle */}
            {!readOnly && (
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer",
                    mode === "view"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Maximize2 size={13} />
                  <span className="hidden sm:inline">Canvas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer",
                    mode === "edit"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Code2 size={13} />
                  <span className="hidden sm:inline">Edit Code</span>
                </button>
              </div>
            )}

            {/* Save Button (when editing) */}
            {mode === "edit" && !readOnly && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || isSaving || !title.trim()}
                className="gap-1.5"
              >
                {isSaving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} />
                )}
                <span>Save</span>
              </Button>
            )}

            {/* Export Menu */}
            <div className="relative" ref={exportMenuRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                disabled={isExporting || loading || !code.trim()}
                className="gap-1.5"
              >
                {isExporting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                <span className="hidden sm:inline">Export</span>
              </Button>

              {isExportMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-card border border-border rounded-xl shadow-[3px_3px_0px_0px_#000000] p-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => handleExport("png")}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-foreground hover:bg-muted rounded-lg flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <FileImage size={14} className="text-primary" />
                    <span>Export PNG (Retina 2x)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("jpg")}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-foreground hover:bg-muted rounded-lg flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <FileImage size={14} className="text-amber-500" />
                    <span>Export JPG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-foreground hover:bg-muted rounded-lg flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <FileText size={14} className="text-rose-500" />
                    <span>Export PDF</span>
                  </button>
                </div>
              )}
            </div>

            <CloseButton onClick={onClose} />
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 bg-background flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span>Loading diagram content...</span>
            </div>
          ) : mode === "view" ? (
            /* Full Canvas View with Pan & Zoom */
            <div className="flex-1 h-full min-h-0 relative">
              <MermaidViewer
                code={code}
                title={title}
                className="h-full border-none rounded-none"
                onSvgRendered={setRenderedSvg}
                onErrorChange={setSyntaxError}
              />
            </div>
          ) : (
            /* Split View: Editor + Live Canvas */
            <div className="flex-1 h-full min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
              <div className="h-full flex flex-col min-h-0 p-3 sm:p-4 bg-muted/10">
                <div className="mb-2">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    Mermaid Definition
                  </label>
                  <MermaidEditor
                    code={code}
                    onChange={(val) => {
                      setCode(val);
                      setIsDirty(true);
                    }}
                    error={syntaxError}
                    className="flex-1 min-h-[380px] h-[calc(100%-24px)]"
                  />
                </div>
              </div>

              <div className="h-full min-h-0 flex flex-col p-3 sm:p-4 bg-background">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                  Live Visual Preview
                </label>
                <div className="flex-1 min-h-0 relative border border-border rounded-xl overflow-hidden shadow-inner">
                  <MermaidViewer
                    code={code}
                    title={title}
                    className="h-full border-none rounded-none"
                    onSvgRendered={setRenderedSvg}
                    onErrorChange={setSyntaxError}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between gap-3 text-xs text-muted-foreground shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {syntaxError ? (
              <span className="text-destructive font-medium flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                Syntax warning: check code structure
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Render healthy • Pan with click-and-drag • Zoom with wheel or controls
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
