import { useState, useEffect, useCallback } from "react";
import type { TimelineData, TimelineBucket } from "../models";
import { apiFetch } from "../services/apiClient";
import { getCached, setCached, removeCached } from "../utils/cache";

export type TimelineInterval = "1d" | "3d" | "7d" | "1m" | "3m" | "6m" | "12m" | "5y";

export const useTimeline = (projectId: string | number, defaultInterval: TimelineInterval = "7d") => {
  const [interval, setIntervalState] = useState<TimelineInterval>(defaultInterval);
  const cacheKey = projectId ? `opentask_timeline_${projectId}_${interval}` : null;
  const initialCache = cacheKey ? getCached<TimelineData>(cacheKey) : null;

  const [data, setData] = useState<TimelineData | null>(initialCache);
  const [loading, setLoading] = useState<boolean>(!initialCache);
  const [error, setError] = useState<string | null>(null);
  const [hoveredBucket, setHoveredBucket] = useState<TimelineBucket | null>(null);

  const fetchTimeline = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      try {
        if (!silent) {
          setLoading(true);
        }
        const res = await apiFetch<TimelineData>(
          `/projects/${projectId}/activities/timeline?interval=${interval}`
        );
        setData(res);
        setCached(`opentask_timeline_${projectId}_${interval}`, res);
        setError(null);
      } catch (err) {
        console.error("useTimeline fetch error:", err);
        setError("Failed to load timeline data");
        removeCached(`opentask_timeline_${projectId}_${interval}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId, interval]
  );

  useEffect(() => {
    const hasCache = !!getCached<TimelineData>(`opentask_timeline_${projectId}_${interval}`);
    fetchTimeline(hasCache);
  }, [fetchTimeline, projectId, interval]);

  useEffect(() => {
    const handleActivityUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ projectId?: string | number }>;
      if (!customEvent.detail?.projectId || String(customEvent.detail.projectId) === String(projectId)) {
        removeCached(`opentask_timeline_${projectId}_${interval}`);
        fetchTimeline(true);
      }
    };

    window.addEventListener("opentask:activity-updated", handleActivityUpdate);
    return () => {
      window.removeEventListener("opentask:activity-updated", handleActivityUpdate);
    };
  }, [fetchTimeline, projectId, interval]);

  const setInterval = (newInterval: TimelineInterval) => {
    setIntervalState(newInterval);
    setHoveredBucket(null);
  };

  return {
    interval,
    setInterval,
    data,
    loading,
    error,
    hoveredBucket,
    setHoveredBucket,
    refreshTimeline: fetchTimeline,
  };
};
