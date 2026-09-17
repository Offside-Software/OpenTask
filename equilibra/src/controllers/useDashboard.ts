import { useState, useEffect, useCallback } from "react";
import type { ProjectMember, ProjectMetric, Activity } from "../models";
import { apiFetch } from "../services/apiClient";
import { getCached, setCached } from "../utils/cache";

interface DashboardData {
  members: ProjectMember[];
  metrics: ProjectMetric[];
  activity: Activity[];
}

export const useDashboard = (projectId: string | number) => {
  const cacheKey = projectId ? `opentask_dashboard_${projectId}` : null;
  const initialCache = cacheKey ? getCached<DashboardData>(cacheKey) : null;

  const [members, setMembers] = useState<ProjectMember[]>(initialCache?.members ?? []);
  const [metrics, setMetrics] = useState<ProjectMetric[]>(initialCache?.metrics ?? []);
  const [activity, setActivity] = useState<Activity[]>(initialCache?.activity ?? []);
  const [loading, setLoading] = useState<boolean>(!initialCache);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      try {
        if (!silent && !getCached<DashboardData>(`opentask_dashboard_${projectId}`)) {
          setLoading(true);
        }
        const data = await apiFetch<DashboardData>(
          `/projects/${projectId}/dashboard`,
        );
        setMembers(data.members ?? []);
        setMetrics(data.metrics ?? []);
        setActivity(data.activity ?? []);
        setCached(`opentask_dashboard_${projectId}`, data);
        setError(null);
      } catch (err) {
        console.error("useDashboard fetch error:", err);
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const hasCache = !!getCached<DashboardData>(`opentask_dashboard_${projectId}`);
    fetchDashboard(hasCache);
  }, [fetchDashboard, projectId]);

  return {
    members,
    metrics,
    activity,
    loading,
    error,
    refreshDashboard: fetchDashboard,
  };
};
