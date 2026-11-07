import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { isTauriEnvironment } from "../../services/apiClient";
import { Button } from "../../design-system/Button";
import { CloseButton } from "../../design-system/CloseButton";
import { ProgressBar } from "../../design-system/ProgressBar";
import { Badge } from "../../design-system/Badge";
import { useToast } from "../../design-system/Toast";
import { Download, RefreshCw, Sparkles } from "lucide-react";

interface UpdateInfo {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall?: (onEvent: (event: any) => void) => Promise<void>;
  [key: string]: any;
}

interface UpdateContextType {
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isDownloading: boolean;
  progress: number | null;
  isDialogOpen: boolean;
  isTauri: boolean;
  setIsDialogOpen: (open: boolean) => void;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextType | null>(null);

let cachedAppVersion = "";

/**
 * Reads dynamic app version from Tauri binary, or fallback if on web.
 */
export async function getAppVersion(): Promise<string> {
  if (cachedAppVersion) return cachedAppVersion;
  if (!isTauriEnvironment()) return "web";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const v = await getVersion();
    if (v) {
      cachedAppVersion = v.startsWith("v") ? v : `v${v}`;
      return cachedAppVersion;
    }
  } catch (err) {
    console.warn("[Auto-Updater] Failed to read app version from Tauri:", err);
  }
  return "v0.1.0";
}

export function useUpdater() {
  const context = useContext(UpdateContext);
  if (!context) {
    return {
      currentVersion: "",
      updateInfo: null,
      isChecking: false,
      isDownloading: false,
      progress: null,
      isDialogOpen: false,
      isTauri: false,
      setIsDialogOpen: () => {},
      checkForUpdates: async () => {},
      installUpdate: async () => {},
    };
  }
  return context;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const isCheckingRef = useRef(false);
  const { showToast } = useToast();
  const isTauri = isTauriEnvironment();

  useEffect(() => {
    if (!isTauri) return;
    getAppVersion().then((v) => {
      if (v) setCurrentVersion(v);
    });
  }, [isTauri]);

  const checkForUpdates = useCallback(
    async (silent = false) => {
      if (!isTauriEnvironment()) {
        if (!silent) {
          showToast("Desktop auto-update is only available in the OpenTask desktop application.", "info");
        }
        return;
      }

      if (isCheckingRef.current) return;
      isCheckingRef.current = true;
      setIsChecking(true);
      const ver = cachedAppVersion || (await getAppVersion());
      const verSuffix = ver ? ` (${ver})` : "";

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();

        if (update?.available) {
          setUpdateInfo(update as unknown as UpdateInfo);
          setIsDialogOpen(true);
          if (!silent) {
            showToast(`New desktop update v${update.version} is available!`, "warning");
          }
        } else {
          setUpdateInfo(null);
          if (!silent) {
            showToast(`OpenTask is up to date${verSuffix}.`, "success");
          }
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err || "");
        const isNotFoundOrNoRelease =
          errMsg.includes("404") ||
          errMsg.toLowerCase().includes("not found") ||
          errMsg.includes("release JSON") ||
          errMsg.includes("valid release JSON");

        if (isNotFoundOrNoRelease) {
          setUpdateInfo(null);
          if (!silent) {
            showToast(`OpenTask is on the latest release${verSuffix}.`, "success");
          }
        } else {
          console.warn("[Auto-Updater] Error checking for updates:", err);
          if (!silent) {
            showToast("Failed to check for updates. Please check your internet connection.", "error");
          }
        }
      } finally {
        isCheckingRef.current = false;
        setIsChecking(false);
      }
    },
    [showToast]
  );

  // Background startup check after 3 seconds, plus periodic check
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const startupTimer = setTimeout(() => checkForUpdates(true), 3000);
    const interval = window.setInterval(() => checkForUpdates(true), 30 * 60 * 1000);

    const checkWhenActive = () => {
      if (document.visibilityState === "visible") checkForUpdates(true);
    };

    window.addEventListener("focus", checkWhenActive);
    document.addEventListener("visibilitychange", checkWhenActive);

    return () => {
      clearTimeout(startupTimer);
      clearInterval(interval);
      window.removeEventListener("focus", checkWhenActive);
      document.removeEventListener("visibilitychange", checkWhenActive);
    };
  }, [checkForUpdates]);

  const installUpdate = async () => {
    if (!updateInfo || !updateInfo.downloadAndInstall) return;

    setIsDownloading(true);
    setProgress(0);

    try {
      let downloaded = 0;
      let total = 0;

      await updateInfo.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });

      showToast("Update downloaded successfully. Restarting OpenTask...", "success");

      const { relaunch } = await import("@tauri-apps/plugin-process");
      setTimeout(async () => {
        await relaunch();
      }, 1500);
    } catch (err: any) {
      console.error("[Auto-Updater] Failed to install update:", err);
      const detail = err?.message || String(err) || "Unknown error";
      showToast(`Failed to install update: ${detail}`, "error");
      setIsDownloading(false);
      setProgress(null);
    }
  };

  return (
    <UpdateContext.Provider
      value={{
        currentVersion,
        updateInfo,
        isChecking,
        isDownloading,
        progress,
        isDialogOpen,
        isTauri,
        setIsDialogOpen,
        checkForUpdates,
        installUpdate,
      }}
    >
      {children}

      {/* Modern shadcn Update Notification Modal */}
      {updateInfo && isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-lg bg-card text-card-foreground border border-border rounded-xl shadow-xl p-6 relative flex flex-col gap-5"
            role="dialog"
            aria-modal="true"
          >
            {/* Top Close Button */}
            <div className="absolute top-4 right-4">
              <CloseButton
                onClick={() => !isDownloading && setIsDialogOpen(false)}
                disabled={isDownloading}
              />
            </div>

            {/* Header */}
            <div className="flex items-start gap-3 pr-10">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="primary">Desktop Update</Badge>
                  <Badge variant="warning">v{updateInfo.version}</Badge>
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  New Version Ready
                </h3>
              </div>
            </div>

            {/* Description & Release Notes */}
            <div className="bg-muted/30 border border-border rounded-lg p-3.5 max-h-48 overflow-y-auto no-scrollbar text-xs">
              <div className="text-muted-foreground font-medium text-[11px] mb-1.5 flex items-center justify-between">
                <span>Release Notes</span>
                {currentVersion && <span>Current: {currentVersion}</span>}
              </div>
              {updateInfo.body ? (
                <div className="text-foreground/90 whitespace-pre-line leading-relaxed">
                  {updateInfo.body}
                </div>
              ) : (
                <p className="text-muted-foreground italic">
                  A new release of OpenTask Desktop is ready to install with performance enhancements and updates.
                </p>
              )}
            </div>

            {/* Download Progress Bar */}
            {isDownloading && (
              <div className="space-y-2">
                <ProgressBar
                  value={progress ?? 10}
                  label={progress !== null ? "Downloading update..." : "Preparing installation..."}
                  colorClass="bg-primary"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
              {!isDownloading && (
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Later
                </Button>
              )}
              <Button
                variant="primary"
                size="md"
                disabled={isDownloading}
                onClick={installUpdate}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Installing...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Update & Restart</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </UpdateContext.Provider>
  );
}
