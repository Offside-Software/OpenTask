import React, { useState, useEffect, useCallback } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { isTauriEnvironment } from "@/services/apiClient";
import logo from "@/assets/logo.svg";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface TitleBarProps {
  /**
   * Title text shown in center of bar. Defaults to empty.
   */
  title?: string;
  /**
   * Force displaying titlebar even outside Tauri (useful for testing/storybook).
   */
  forceShow?: boolean;
}

// Pre-initialize titlebar height CSS variable immediately if in Tauri
if (typeof document !== "undefined" && isTauriEnvironment()) {
  document.documentElement.style.setProperty("--titlebar-height", "2.25rem");
  document.documentElement.classList.add("has-custom-titlebar");
}

export const TitleBar: React.FC<TitleBarProps> = ({ title, forceShow = false }) => {
  const [isTauri, setIsTauri] = useState<boolean>(() => isTauriEnvironment() || forceShow);
  const [isMaximized, setIsMaximized] = useState(false);

  // Synchronize custom titlebar height and CSS helper class on root document
  useEffect(() => {
    if (isTauri || forceShow) {
      document.documentElement.style.setProperty("--titlebar-height", "2.25rem");
      document.documentElement.classList.add("has-custom-titlebar");
    } else {
      document.documentElement.style.setProperty("--titlebar-height", "0px");
      document.documentElement.classList.remove("has-custom-titlebar");
    }
    return () => {
      document.documentElement.style.setProperty("--titlebar-height", "0px");
      document.documentElement.classList.remove("has-custom-titlebar");
    };
  }, [isTauri, forceShow]);

  // Accurate platform detection (Windows vs macOS)
  const isMac =
    typeof navigator !== "undefined" &&
    (/Macintosh|Mac OS X/i.test(navigator.userAgent) || navigator.platform === "MacIntel");

  // Keep re-checking for Tauri environment on initial startup to handle asynchronous webview injection
  useEffect(() => {
    if (isTauri) return;

    const checkEnv = () => {
      if (isTauriEnvironment() || forceShow) {
        setIsTauri(true);
        return true;
      }
      return false;
    };

    if (checkEnv()) return;

    // Retry checking every 50ms for the first 2 seconds
    const interval = setInterval(() => {
      if (checkEnv()) {
        clearInterval(interval);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(interval), 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isTauri, forceShow]);

  // Synchronize maximized state from Tauri window
  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    let isMounted = true;

    const setupWindow = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized().catch(() => false);
        if (isMounted) setIsMaximized(max);

        unlisten = await appWindow.onResized(async () => {
          const currentlyMax = await appWindow.isMaximized().catch(() => false);
          if (isMounted) setIsMaximized(currentlyMax);
        });
      } catch (err) {
        console.warn("[TitleBar] Failed to query window state:", err);
      }
    };

    setupWindow();

    return () => {
      isMounted = false;
      if (unlisten) unlisten();
    };
  }, [isTauri]);

  const handleMinimize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("[TitleBar] Failed to minimize:", err);
    }
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const currentlyMax = await appWindow.isMaximized().catch(() => false);
      setIsMaximized(currentlyMax);
    } catch (err) {
      console.warn("[TitleBar] Failed to toggle maximize:", err);
    }
  }, []);

  const handleClose = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("[TitleBar] Failed to close:", err);
    }
  }, []);

  const handleResizeDrag = useCallback(
    async (e: React.MouseEvent, direction: ResizeDirection) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().startResizeDragging(direction);
      } catch (err) {
        console.warn("[TitleBar] Failed to start resize drag:", err);
      }
    },
    []
  );

  // If not inside Tauri desktop environment and not forced, do not render titlebar
  if (!isTauri && !forceShow) {
    return null;
  }

  return (
    <>
      {/* Frameless window resize handles (active only when not maximized) */}
      {!isMaximized && (
        <div className="pointer-events-auto select-none">
          <div
            className="fixed top-0 left-2 right-2 h-1.5 z-[9999] cursor-n-resize"
            onMouseDown={(e) => handleResizeDrag(e, "North")}
          />
          <div
            className="fixed bottom-0 left-2 right-2 h-1.5 z-[9999] cursor-s-resize"
            onMouseDown={(e) => handleResizeDrag(e, "South")}
          />
          <div
            className="fixed left-0 top-2 bottom-2 w-1.5 z-[9999] cursor-w-resize"
            onMouseDown={(e) => handleResizeDrag(e, "West")}
          />
          <div
            className="fixed right-0 top-2 bottom-2 w-1.5 z-[9999] cursor-e-resize"
            onMouseDown={(e) => handleResizeDrag(e, "East")}
          />
          <div
            className="fixed top-0 left-0 size-3 z-[9999] cursor-nw-resize"
            onMouseDown={(e) => handleResizeDrag(e, "NorthWest")}
          />
          <div
            className="fixed top-0 right-0 size-3 z-[9999] cursor-ne-resize"
            onMouseDown={(e) => handleResizeDrag(e, "NorthEast")}
          />
          <div
            className="fixed bottom-0 left-0 size-3 z-[9999] cursor-sw-resize"
            onMouseDown={(e) => handleResizeDrag(e, "SouthWest")}
          />
          <div
            className="fixed bottom-0 right-0 size-3 z-[9999] cursor-se-resize"
            onMouseDown={(e) => handleResizeDrag(e, "SouthEast")}
          />
        </div>
      )}

      {/* Main Title Bar */}
      <header
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="h-9 w-full bg-card border-b border-border flex items-center justify-between select-none shrink-0 relative z-[100] text-foreground transition-colors duration-150"
      >
        {/* Left branding area */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-2.5 px-3 h-full cursor-default"
        >
          {isMac && (
            <div className="flex items-center gap-2 mr-2 pointer-events-auto">
              <button
                type="button"
                onClick={handleClose}
                className="size-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:brightness-90 transition-all cursor-pointer flex items-center justify-center group"
                aria-label="Close"
                title="Close"
              >
                <X size={8} className="text-black/60 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                type="button"
                onClick={handleMinimize}
                className="size-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:brightness-90 transition-all cursor-pointer flex items-center justify-center group"
                aria-label="Minimize"
                title="Minimize"
              >
                <Minus size={8} className="text-black/60 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                type="button"
                onClick={handleToggleMaximize}
                className="size-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:brightness-90 transition-all cursor-pointer flex items-center justify-center group"
                aria-label="Toggle maximize"
                title="Maximize / Restore"
              >
                <Copy size={7} className="text-black/60 opacity-0 group-hover:opacity-100 transition-opacity rotate-90" />
              </button>
            </div>
          )}

          <img
            src={logo}
            alt="OpenTask Logo"
            className="w-4 h-4 object-contain pointer-events-none select-none"
          />

          <span className="font-mono text-xs font-bold tracking-wider pointer-events-none select-none text-foreground">
            OPENTASK
          </span>

          <span className="text-[10px] px-1.5 py-0.2 bg-primary/10 text-primary border border-primary/20 font-mono font-bold tracking-wider rounded-none pointer-events-none select-none">
            DESKTOP
          </span>
        </div>

        {/* Center draggable region */}
        <div
          data-tauri-drag-region
          className="flex-1 h-full flex items-center justify-center min-w-0 cursor-default px-4"
        >
          {title && (
            <span className="text-xs font-mono text-muted-foreground truncate pointer-events-none select-none">
              {title}
            </span>
          )}
        </div>

        {/* Right window controls (Windows / Linux) */}
        {!isMac && (
          <div className="flex items-center h-full pointer-events-auto shrink-0">
            <button
              type="button"
              onClick={handleMinimize}
              className="h-full px-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-none"
              aria-label="Minimize window"
              title="Minimize"
            >
              <Minus size={15} strokeWidth={2} />
            </button>

            <button
              type="button"
              onClick={handleToggleMaximize}
              className="h-full px-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-none"
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Copy size={13} strokeWidth={2} className="rotate-90" />
              ) : (
                <Square size={13} strokeWidth={2} />
              )}
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="h-full px-4 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-red-600 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-none"
              aria-label="Close window"
              title="Close"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </header>
    </>
  );
};
