import { useState, useEffect, useCallback } from "react";
import type { Alert } from "../models";
import { alertService } from "../services/alertService";

interface UseAlertsOptions {
  userId?: string | number;
  projectId?: string | number;
  includeResolved?: boolean;
}

export const useAlerts = (
  projectIdOrOptions?: string | number | UseAlertsOptions,
) => {
  // Support both legacy useAlerts(projectId) and new useAlerts({ userId, projectId, includeResolved })
  const options: UseAlertsOptions =
    typeof projectIdOrOptions === "object" &&
    projectIdOrOptions !== null &&
    !Array.isArray(projectIdOrOptions)
      ? projectIdOrOptions
      : { projectId: projectIdOrOptions as string | number | undefined };

  const { userId, projectId, includeResolved = false } = options;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);

        let data: Alert[];
        if (includeResolved) {
          // Comprehensive path: fetches full alert entities with user filter
          data = await alertService.getMyAlerts(userId);
        } else if (userId) {
          // Strict data-contract path: only unresolved, user-scoped
          data = await alertService.getAlertsForUser(userId);
        } else {
          // Legacy fallback: fetches all and filters client-side
          data = await alertService.getMyAlerts();
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
    [userId, projectId, includeResolved],
  );

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const resolveAlert = useCallback(async (id: number | string) => {
    await alertService.resolveAlert(id);
    setAlerts((prev) =>
      includeResolved
        ? prev.map((a) => (a.id === id ? { ...a, is_resolved: true } : a))
        : prev.filter((a) => a.id !== id),
    );
  }, [includeResolved]);

  // When includeResolved is true, return full array so the caller can filter.
  // For other callers, preserve existing active-only behavior.
  const activeAlerts = includeResolved
    ? alerts
    : userId
    ? alerts
    : alerts.filter((a) => !a.is_resolved);

  return { alerts: activeAlerts, loading, error, resolveAlert, refetch: fetchAlerts };
};
