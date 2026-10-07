import { useState, useEffect, useCallback, useRef } from "react";
import type { Alert } from "../models";
import { alertService } from "../services/alertService";

interface UseAlertsOptions {
  userId?: string | number;
  projectId?: string | number;
  includeResolved?: boolean;
  pageSize?: number;
}

export const notifyAlertsUpdated = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("opentask:alerts-updated"));
    try {
      const channel = new BroadcastChannel("opentask:alerts-channel");
      channel.postMessage("updated");
      channel.close();
    } catch {
      // Ignore if BroadcastChannel is not supported
    }
  }
};

export const useAlerts = (
  projectIdOrOptions?: string | number | UseAlertsOptions,
) => {
  // Support both legacy useAlerts(projectId) and new useAlerts({ userId, projectId, includeResolved, pageSize })
  const options: UseAlertsOptions =
    typeof projectIdOrOptions === "object" &&
    projectIdOrOptions !== null &&
    !Array.isArray(projectIdOrOptions)
      ? projectIdOrOptions
      : { projectId: projectIdOrOptions as string | number | undefined };

  const { userId, projectId, includeResolved = false, pageSize = 20 } = options;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const alertsCountRef = useRef(0);
  alertsCountRef.current = alerts.length;

  const fetchAlerts = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);

        let data: Alert[];
        if (includeResolved) {
          // Comprehensive path: fetches full alert entities with pagination
          data = await alertService.getMyAlerts(userId, pageSize, 0);
          setHasMore(data.length >= pageSize);
        } else if (userId) {
          // Strict data-contract path: only unresolved, user-scoped
          data = await alertService.getAlertsForUser(userId);
          setHasMore(false);
        } else {
          // Legacy fallback
          data = await alertService.getMyAlerts(undefined, pageSize, 0);
          setHasMore(data.length >= pageSize);
        }

        const filtered = projectId
          ? data.filter((a) => String(a.project_id) === String(projectId))
          : data;

        setAlerts(filtered);
        setError(null);
      } catch {
        setError("Failed to fetch alerts");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [userId, projectId, includeResolved, pageSize],
  );

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const currentOffset = alertsCountRef.current;
      const nextBatch = await alertService.getMyAlerts(userId, pageSize, currentOffset);

      if (!nextBatch || nextBatch.length === 0) {
        setHasMore(false);
        return;
      }

      if (nextBatch.length < pageSize) {
        setHasMore(false);
      }

      const filtered = projectId
        ? nextBatch.filter((a) => String(a.project_id) === String(projectId))
        : nextBatch;

      setAlerts((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const uniqueNext = filtered.filter((a) => !existingIds.has(a.id));
        return [...prev, ...uniqueNext];
      });
    } catch (err) {
      console.error("Failed to load more alerts:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, hasMore, userId, pageSize, projectId]);

  useEffect(() => {
    fetchAlerts();

    const handleUpdate = () => {
      fetchAlerts(true);
    };

    window.addEventListener("opentask:alerts-updated", handleUpdate);
    window.addEventListener("focus", handleUpdate);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("opentask:alerts-channel");
      channel.onmessage = () => {
        fetchAlerts(true);
      };
    } catch {
      // Ignore
    }

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "OPENTASK_PUSH_RECEIVED") {
        fetchAlerts(true);
      }
    };
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleSwMessage);
    }

    // 15-second auto-update interval for background alert synchronization
    const intervalId = setInterval(() => {
      fetchAlerts(true);
    }, 15000);

    return () => {
      window.removeEventListener("opentask:alerts-updated", handleUpdate);
      window.removeEventListener("focus", handleUpdate);
      if (channel) {
        channel.close();
      }
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      }
      clearInterval(intervalId);
    };
  }, [fetchAlerts]);

  const resolveAlert = useCallback(async (id: number | string) => {
    await alertService.resolveAlert(id);
    setAlerts((prev) =>
      includeResolved
        ? prev.map((a) => (a.id === id ? { ...a, is_resolved: true } : a))
        : prev.filter((a) => a.id !== id),
    );
    notifyAlertsUpdated();
  }, [includeResolved]);

  // When includeResolved is true, return full array so the caller can filter.
  // For other callers, preserve existing active-only behavior (filter out resolved alerts).
  const activeAlerts = includeResolved
    ? alerts
    : alerts.filter((a) => !a.is_resolved);

  return {
    alerts: activeAlerts,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    resolveAlert,
    refetch: fetchAlerts,
  };
};
