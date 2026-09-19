import { useState, useEffect, useCallback } from "react";
import type { Bucket, Task } from "../models";
import { apiFetch } from "../services/apiClient";
import { taskService } from "../services/taskService";
import { useToast } from "../design-system/Toast";
import { removeCached } from "../utils/cache";

interface BoardData {
  buckets: Bucket[];
  tasks: Task[];
}

export const useBoard = (projectId: string | number) => {
  const { showToast } = useToast();

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Clear any legacy cached board data to prevent stale tasks/descriptions
  useEffect(() => {
    if (projectId) {
      removeCached(`opentask_board_${projectId}`);
    }
  }, [projectId]);

  const fetchBoard = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      try {
        if (!silent) {
          setLoading(true);
        }
        const data = await apiFetch<BoardData>(`/projects/${projectId}/board`);
        const sortedBuckets = [...(data.buckets ?? [])].sort(
          (a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0),
        );
        const sortedTasks = [...(data.tasks ?? [])].sort(
          (a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0),
        );
        setBuckets(sortedBuckets);
        setTasks(sortedTasks);
        setError(null);
      } catch (err) {
        console.error("useBoard fetch error:", err);
        setError("Failed to load board data");
        if (!silent) showToast("Error loading board", "error");
      } finally {
        setLoading(false);
      }
    },
    [projectId, showToast],
  );

  useEffect(() => {
    fetchBoard();

    // 5-minute auto-update interval for background task/board synchronization
    const intervalId = setInterval(() => {
      fetchBoard(true);
    }, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [fetchBoard]);

  /**
   * Optimistically update full tasks array (used for drag and drop)
   */
  const setTasksOptimistically = useCallback(
    (newTasks: Task[] | ((prev: Task[]) => Task[])) => {
      setTasks(newTasks);
    },
    [],
  );

  /**
   * Optimistically update a task's bucket_id in local state
   */
  const moveTaskLocally = useCallback(
    (taskId: number | string, newBucketId: number | string) => {
      setTasks((prev) =>
        prev.map((t) =>
          String(t.id) === String(taskId)
            ? { ...t, bucket_id: newBucketId }
            : t,
        ),
      );
    },
    [],
  );

  /**
   * Optimistically apply a partial update to a task in local state.
   */
  const updateTaskLocally = useCallback(
    (taskId: number | string, patch: Partial<Task>) => {
      setTasks((prev) =>
        prev.map((t) =>
          String(t.id) === String(taskId) ? { ...t, ...patch } : t,
        ),
      );
    },
    [],
  );

  /**
   * Optimistically update a bucket in local state
   */
  const updateBucketLocally = useCallback(
    (bucketId: number | string, patch: Partial<Bucket>) => {
      setBuckets((prev) =>
        prev.map((b) =>
          String(b.id) === String(bucketId) ? { ...b, ...patch } : b,
        ),
      );
    },
    [],
  );

  /**
   * Optimistically set full buckets array (e.g. for column reordering)
   */
  const setBucketsOptimistically = useCallback(
    (newBuckets: Bucket[]) => {
      setBuckets(newBuckets);
    },
    [],
  );

  /**
   * Optimistically add a bucket to local state
   */
  const addBucketLocally = useCallback(
    (newBucket: Bucket) => {
      setBuckets((prev) => [...prev, newBucket]);
    },
    [],
  );

  /**
   * Optimistically remove a bucket from local state
   */
  const removeBucketLocally = useCallback(
    (bucketId: number | string) => {
      setBuckets((prev) => prev.filter((b) => String(b.id) !== String(bucketId)));
    },
    [],
  );

  /**
   * Optimistically add a task to local state
   */
  const addTaskLocally = useCallback((newTask: Task) => {
    setTasks((prev) => {
      if (prev.some((t) => String(t.id) === String(newTask.id))) {
        return prev;
      }
      return [...prev, newTask];
    });
  }, []);

  /**
   * Optimistically remove a task from local state
   */
  const removeTaskLocally = useCallback((taskId: number | string) => {
    setTasks((prev) => prev.filter((t) => String(t.id) !== String(taskId)));
  }, []);

  const [loadingBuckets, setLoadingBuckets] = useState<Record<string, boolean>>({});

  /**
   * Fetch next batch of 20 tasks for a specific bucket on demand
   */
  const loadMoreBucketTasks = useCallback(
    async (bucketId: number | string) => {
      const bIdStr = String(bucketId);
      if (loadingBuckets[bIdStr]) return;

      setLoadingBuckets((prev) => ({ ...prev, [bIdStr]: true }));
      try {
        const currentBucketTasks = tasks.filter((t) => String(t.bucket_id) === bIdStr);
        const offset = currentBucketTasks.length;
        const res = await taskService.getBucketTasks(projectId, bucketId, 20, offset);

        if (res.tasks && res.tasks.length > 0) {
          setTasks((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newTasks = res.tasks.filter((t) => !existingIds.has(t.id));
            return [...prev, ...newTasks];
          });
        }

        if (res.total !== undefined) {
          setBuckets((prev) =>
            prev.map((b) => (String(b.id) === bIdStr ? { ...b, task_count: res.total } : b))
          );
        }
      } catch (err) {
        console.error(`Failed to load more tasks for bucket ${bucketId}:`, err);
        showToast("Failed to load more tasks", "error");
      } finally {
        setLoadingBuckets((prev) => ({ ...prev, [bIdStr]: false }));
      }
    },
    [projectId, tasks, loadingBuckets, showToast]
  );

  return {
    buckets,
    tasks,
    loading,
    loadingBuckets,
    loadMoreBucketTasks,
    error,
    refreshBoard: fetchBoard,
    moveTaskLocally,
    updateTaskLocally,
    updateBucketLocally,
    setTasksOptimistically,
    setBucketsOptimistically,
    addBucketLocally,
    removeBucketLocally,
    addTaskLocally,
    removeTaskLocally,
  };
};
