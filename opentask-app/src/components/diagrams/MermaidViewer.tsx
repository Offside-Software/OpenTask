import React, { useEffect, useRef, useState, useCallback } from "react";
import mermaid from "mermaid";
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Move, AlertTriangle } from "lucide-react";
import { useTheme } from "../../context/themeContext";
import { cn } from "@/lib/utils";

interface MermaidViewerProps {
  code: string;
  title?: string;
  className?: string;
  onSvgRendered?: (svgElement: SVGElement | null) => void;
  onErrorChange?: (error: string | null) => void;
  showControls?: boolean;
}

const DARK_THEME_CSS = `
  * {
    filter: none !important;
  }

  /* State Diagrams */
  g.stateGroup rect {
    fill: #121824 !important;
    stroke: #FFE600 !important;
    stroke-width: 1.5px !important;
  }
  g.stateGroup .state-title,
  g.stateGroup text,
  g.stateGroup tspan {
    fill: #FFFFFF !important;
    color: #FFFFFF !important;
    font-weight: 600 !important;
  }
  .transition {
    stroke: #94A3B8 !important;
    stroke-width: 1.5px !important;
  }

  /* Class Diagrams */
  g.classGroup rect {
    fill: #121824 !important;
    stroke: #38BDF8 !important;
    stroke-width: 1.5px !important;
  }
  g.classGroup text,
  g.classGroup tspan,
  g.classGroup .title {
    fill: #FFFFFF !important;
    color: #FFFFFF !important;
  }
  g.classGroup line {
    stroke: #242F45 !important;
  }
  .relation {
    stroke: #94A3B8 !important;
    stroke-width: 1.5px !important;
  }
  .cardinality text,
  .classLabel text,
  .classLabel span,
  .classLabel tspan {
    fill: #F8FAFC !important;
    color: #F8FAFC !important;
  }

  /* Mindmap Diagrams */
  .mindmap-node text,
  .mindmap-node tspan,
  [class*="section-"] text,
  [class*="section-"] tspan,
  [class*="section-"] span {
    fill: #FFFFFF !important;
    color: #FFFFFF !important;
    font-weight: 600 !important;
  }
  .mindmap-node line {
    stroke-width: 2.5px !important;
  }

  /* Flowchart Nodes */
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: #121824 !important;
    stroke: #FFE600 !important;
    stroke-width: 1.5px !important;
  }
  .node .label text,
  .node .label tspan,
  .node .label span {
    fill: #FFFFFF !important;
    color: #FFFFFF !important;
    font-weight: 500 !important;
  }

  /* Transition & Edge Labels across all diagrams */
  .edgeLabel rect,
  .stateLabel rect,
  .labelBox {
    fill: #1A2234 !important;
    stroke: #242F45 !important;
    opacity: 0.95 !important;
  }
  .edgeLabel text,
  .stateLabel text,
  .edgeLabel span,
  .stateLabel span,
  .labelText {
    fill: #F8FAFC !important;
    color: #F8FAFC !important;
    font-weight: 500 !important;
  }

  /* Sequence Diagram */
  rect.actor {
    fill: #121824 !important;
    stroke: #FFE600 !important;
    stroke-width: 1.5px !important;
  }
  text.actor {
    fill: #FFFFFF !important;
    font-weight: bold !important;
  }
  text.messageText {
    fill: #F8FAFC !important;
  }
  line.messageLine0, line.messageLine1 {
    stroke: #94A3B8 !important;
  }

  /* Entity Relationship (ER) */
  .entityBox {
    fill: #121824 !important;
    stroke: #FFE600 !important;
    stroke-width: 1.5px !important;
  }
  .entityLabel text,
  .attributeBoxOdd text,
  .attributeBoxEven text {
    fill: #FFFFFF !important;
    color: #FFFFFF !important;
  }
  .attributeBoxOdd {
    fill: #161F30 !important;
  }
  .attributeBoxEven {
    fill: #121824 !important;
  }
`;

const LIGHT_THEME_CSS = `
  * {
    filter: none !important;
  }

  /* State Diagrams */
  g.stateGroup rect {
    fill: #FFFFFF !important;
    stroke: #000000 !important;
    stroke-width: 1.5px !important;
  }
  g.stateGroup .state-title,
  g.stateGroup text,
  g.stateGroup tspan {
    fill: #000000 !important;
    color: #000000 !important;
    font-weight: 600 !important;
  }
  .transition {
    stroke: #475569 !important;
    stroke-width: 1.5px !important;
  }

  /* Class Diagrams */
  g.classGroup rect {
    fill: #FFFFFF !important;
    stroke: #000000 !important;
    stroke-width: 1.5px !important;
  }
  g.classGroup text,
  g.classGroup tspan,
  g.classGroup .title {
    fill: #000000 !important;
    color: #000000 !important;
  }
  g.classGroup line {
    stroke: #CBD5E1 !important;
  }
  .relation {
    stroke: #475569 !important;
    stroke-width: 1.5px !important;
  }
  .cardinality text,
  .classLabel text,
  .classLabel span,
  .classLabel tspan {
    fill: #0F172A !important;
    color: #0F172A !important;
  }

  /* Mindmap Diagrams */
  .mindmap-node text,
  .mindmap-node tspan,
  [class*="section-"] text,
  [class*="section-"] tspan,
  [class*="section-"] span {
    fill: #000000 !important;
    color: #000000 !important;
    font-weight: 600 !important;
  }

  /* Flowchart Nodes */
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: #FFFFFF !important;
    stroke: #000000 !important;
    stroke-width: 1.5px !important;
  }
  .node .label text,
  .node .label tspan,
  .node .label span {
    fill: #000000 !important;
    color: #000000 !important;
    font-weight: 500 !important;
  }

  /* Edge Labels */
  .edgeLabel rect,
  .stateLabel rect,
  .labelBox {
    fill: #F1F5F9 !important;
    stroke: #CBD5E1 !important;
    opacity: 0.95 !important;
  }
  .edgeLabel text,
  .stateLabel text,
  .edgeLabel span,
  .stateLabel span,
  .labelText {
    fill: #0F172A !important;
    color: #0F172A !important;
    font-weight: 500 !important;
  }
`;

export const MermaidViewer: React.FC<MermaidViewerProps> = ({
  code,
  className,
  onSvgRendered,
  onErrorChange,
  showControls = true,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderSandboxRef = useRef<HTMLDivElement>(null);

  const [svgHtml, setSvgHtml] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  // Pan & Zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track the diagram type/header to auto-reset pan/zoom when switching diagram types
  const lastDiagramHeaderRef = useRef<string>("");

  // Clean up any stray error elements Mermaid might have appended to document.body
  const cleanUpMermaidErrorElements = useCallback(() => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll(".error-icon, #dmermaid-error, svg.error-icon")
      .forEach((el) => {
        el.remove();
      });
  }, []);

  // Initialize Mermaid configuration with theme-specific variables and CSS
  useEffect(() => {
    try {
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        securityLevel: "loose",
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
        mindmap: {
          useMaxWidth: true,
          padding: 16,
        },
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        theme: isDark ? "dark" : "default",
        themeCSS: isDark ? DARK_THEME_CSS : LIGHT_THEME_CSS,
        themeVariables: isDark
          ? {
              darkMode: true,
              background: "#0A0D14",
              primaryColor: "#121824",
              primaryTextColor: "#FFFFFF",
              primaryBorderColor: "#FFE600",
              lineColor: "#94A3B8",
              secondaryColor: "#161F30",
              tertiaryColor: "#1A2234",
              textColor: "#FFFFFF",
              mainBkg: "#121824",
              nodeBorder: "#FFE600",
              nodeTextColor: "#FFFFFF",
              classText: "#FFFFFF",
              stateLabelColor: "#FFFFFF",
              stateBkg: "#121824",
              labelTextColor: "#FFFFFF",
              scaleLabelColor: "#FFFFFF",
              cScaleLabel0: "#FFFFFF",
              cScaleLabel1: "#FFFFFF",
              cScaleLabel2: "#FFFFFF",
              cScaleLabel3: "#FFFFFF",
              cScaleLabel4: "#FFFFFF",
              cScaleLabel5: "#FFFFFF",
              cScaleLabel6: "#FFFFFF",
              cScaleLabel7: "#FFFFFF",
              cScaleLabel8: "#FFFFFF",
              cScaleLabel9: "#FFFFFF",
              cScaleLabel10: "#FFFFFF",
              cScaleLabel11: "#FFFFFF",
              gitBranchLabel0: "#FFFFFF",
              gitBranchLabel1: "#FFFFFF",
              gitBranchLabel2: "#FFFFFF",
              gitBranchLabel3: "#FFFFFF",
              gitBranchLabel4: "#FFFFFF",
              gitBranchLabel5: "#FFFFFF",
              git0: "#2563EB",
              git1: "#7C3AED",
              git2: "#059669",
              git3: "#D97706",
              git4: "#DC2626",
              git5: "#0891B2",
              cScale0: "#1E3A8A",
              cScale1: "#581C87",
              cScale2: "#064E3B",
              cScale3: "#78350F",
              cScale4: "#7F1D1D",
              cScale5: "#164E63",
              dropShadow: "none",
              useMaxWidth: true,
            }
          : {
              darkMode: false,
              background: "#FFFFFF",
              primaryColor: "#FFFFFF",
              primaryTextColor: "#000000",
              primaryBorderColor: "#000000",
              lineColor: "#475569",
              secondaryColor: "#F1F5F9",
              tertiaryColor: "#F8FAFC",
              textColor: "#000000",
              mainBkg: "#FFFFFF",
              nodeBorder: "#000000",
              nodeTextColor: "#000000",
              classText: "#000000",
              stateLabelColor: "#000000",
              stateBkg: "#FFFFFF",
              labelTextColor: "#000000",
              scaleLabelColor: "#000000",
              dropShadow: "none",
              useMaxWidth: true,
            },
      });
    } catch (e) {
      console.warn("Mermaid initialization warning:", e);
    }
  }, [isDark]);

  // Render diagram on code or theme change with debouncing
  useEffect(() => {
    let isCancelled = false;
    const cleanCode = code?.trim();

    if (!cleanCode) {
      setSvgHtml("");
      setRenderError(null);
      onErrorChange?.(null);
      onSvgRendered?.(null);
      lastDiagramHeaderRef.current = "";
      return;
    }

    // Extract first line of diagram to detect diagram type switch
    const currentHeader = cleanCode
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("%%")) || "";

    if (lastDiagramHeaderRef.current && currentHeader && lastDiagramHeaderRef.current !== currentHeader) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
    lastDiagramHeaderRef.current = currentHeader;

    setIsRendering(true);

    const debounceTimer = setTimeout(async () => {
      if (isCancelled) return;

      // 1. Pre-validate syntax with parse() so invalid syntax never touches render() or document.body
      try {
        await mermaid.parse(cleanCode, { suppressErrors: true });
      } catch (parseErr: any) {
        if (!isCancelled) {
          const errMsg = parseErr?.message || "Invalid Mermaid syntax";
          setRenderError(errMsg);
          onErrorChange?.(errMsg);
          setIsRendering(false);
        }
        cleanUpMermaidErrorElements();
        return;
      }

      // 2. Syntax is valid, render safely into dedicated offscreen measuring sandbox
      const renderId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      try {
        const sandbox = renderSandboxRef.current ?? undefined;
        const { svg } = await mermaid.render(renderId, cleanCode, sandbox);
        if (!isCancelled) {
          setSvgHtml(svg);
          setRenderError(null);
          onErrorChange?.(null);
        }
      } catch (renderErr: any) {
        if (!isCancelled) {
          const errMsg = renderErr?.message || "Render failed";
          setRenderError(errMsg);
          onErrorChange?.(errMsg);
        }
      } finally {
        cleanUpMermaidErrorElements();
        if (!isCancelled) {
          setIsRendering(false);
        }
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(debounceTimer);
      cleanUpMermaidErrorElements();
    };
  }, [code, isDark, onErrorChange, cleanUpMermaidErrorElements]);

  // Notify parent of SVG element reference whenever rendered SVG changes
  useEffect(() => {
    if (viewportRef.current) {
      const svg = viewportRef.current.querySelector("svg");
      onSvgRendered?.(svg);
    }
  }, [svgHtml, onSvgRendered]);

  // Pointer Drag (Pan) Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Mouse Wheel Zoom Handler
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.min(Math.max(prev * zoomFactor, 0.2), 4));
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z * 0.8, 0.2));
  const handleReset = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleFitToView = useCallback(() => {
    if (!containerRef.current || !viewportRef.current) return;
    const svg = viewportRef.current.querySelector("svg");
    if (!svg) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const viewBox = svg.getAttribute("viewBox");

    let naturalWidth = 0;
    let naturalHeight = 0;

    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        naturalWidth = parts[2];
        naturalHeight = parts[3];
      }
    }

    if (!naturalWidth || !naturalHeight) {
      const svgRect = svg.getBoundingClientRect();
      naturalWidth = svgRect.width / zoom;
      naturalHeight = svgRect.height / zoom;
    }

    if (naturalWidth > 0 && naturalHeight > 0) {
      const padding = 60;
      const scaleX = (containerRect.width - padding) / naturalWidth;
      const scaleY = (containerRect.height - padding) / naturalHeight;
      const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 2.5);

      setZoom(fitZoom);
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full min-h-[320px] overflow-hidden select-none border border-border rounded-xl flex items-center justify-center transition-all",
        isDark ? "bg-[#0A0D14]" : "bg-[#F8F9FA]",
        isFullscreen ? "fixed inset-0 z-50 rounded-none border-none" : "",
        className,
      )}
      style={{
        backgroundImage: isDark
          ? "radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px)"
          : "radial-gradient(rgba(0, 0, 0, 0.12) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Offscreen sandbox container for Mermaid layout and measurement */}
      <div
        ref={renderSandboxRef}
        style={{
          position: "fixed",
          top: -99999,
          left: -99999,
          width: 1920,
          height: 1080,
          visibility: "hidden",
          opacity: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: -9999,
        }}
        aria-hidden="true"
      />

      {/* Moveable Graph Viewport */}
      <div
        ref={viewportRef}
        className={cn(
          "w-full h-full flex items-center justify-center transition-transform duration-75 ease-out [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:h-auto",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />

      {/* Syntax Error Banner */}
      {renderError && (
        <div className="absolute top-4 left-4 right-4 max-w-md mx-auto p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-xs flex items-start gap-2 shadow-lg backdrop-blur-xs z-20">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold block mb-0.5">Mermaid Syntax Error</span>
            <span className="font-mono text-[11px] block truncate">{renderError}</span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!code?.trim() && !isRendering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-muted-foreground p-6 text-center">
          <Move size={28} className="mb-2 opacity-40 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            No diagram code provided
          </p>
          <p className="text-[11px] mt-1 max-w-xs">
            Enter Mermaid syntax in the editor to render and move the graph.
          </p>
        </div>
      )}

      {/* Floating Control Toolbar */}
      {showControls && (
        <div
          className="absolute bottom-4 right-4 z-20 flex items-center gap-1 bg-card/90 border border-border rounded-lg p-1 shadow-md backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In"
            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out"
            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <ZoomOut size={14} />
          </button>

          <div className="h-4 w-px bg-border mx-0.5" />

          <button
            type="button"
            onClick={handleReset}
            title="Reset Pan & Zoom (100%)"
            className="px-2 h-7 rounded text-[11px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer flex items-center gap-1"
          >
            <RotateCcw size={12} />
            <span>{Math.round(zoom * 100)}%</span>
          </button>

          <button
            type="button"
            onClick={handleFitToView}
            title="Fit Diagram to View"
            className="px-2 h-7 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Fit
          </button>

          <div className="h-4 w-px bg-border mx-0.5" />

          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      )}

      {/* Pan hint chip */}
      {showControls && (
        <div className="absolute bottom-4 left-4 z-10 hidden sm:flex items-center gap-1.5 px-2 py-1 bg-card/60 border border-border/40 rounded-md text-[10px] text-muted-foreground backdrop-blur-xs pointer-events-none">
          <Move size={11} className="text-primary" />
          <span>Click & drag to move graph • Scroll to zoom</span>
        </div>
      )}
    </div>
  );
};
