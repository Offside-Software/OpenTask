import { useRef, useEffect, useCallback } from "react";
import { taskService } from "../services/taskService";
import { bucketService } from "../services/bucketService";
import { useToast } from "../design-system/Toast";

interface UseAsyncReorderQueueOptions {
  projectId: string | number;
  onTasksSynced?: () => void;
  onBucketsSynced?: () => void;
  debounceMs?: number;
}

/**
 * Modern asynchronous reorder queue.
 * - Updates UI immediately in memory (0ms latency, seamless drag-and-drop).
 * - Debounces and coalesces rapid consecutive moves so only the final resting state is synced.
 * - Silently retries transient network errors in the background instead of abruptly snapping cards back.
 */
export const useAsyncReorderQueue = ({
  projectId,
  onTasksSynced,
  onBucketsSynced,
  debounceMs = 250,
}: UseAsyncReorderQueueOptions) => {
  const { showToast } = useToast();

  // Map of bucketId -> latest ordered task IDs
  const pendingTasks = useRef<Map<string, (string | number)[]>>(new Map());
  const taskTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Pending bucket order
  const pendingBuckets = useRef<(string | number)[] | null>(null);
  const bucketTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper for retrying an async action up to maxRetries with backoff
  const executeWithRetry = async (
    action: () => Promise<unknown>,
    retries = 2,
    delayMs = 400,
  ): Promise<boolean> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await action();
        return true;
      } catch (err) {
        if (attempt < retries) {
          await new Promise((res) => setTimeout(res, delayMs * (attempt + 1)));
        } else {
          console.error("[ReorderQueue] Sync failed after retries:", err);
          return false;
        }
      }
    }
    return false;
  };

  /**
   * Queue task reorder for a bucket. Coalesces moves within debounceMs.
   */
  const queueTaskReorder = useCallback(
    (bucketId: string | number, taskIds: (string | number)[]) => {
      const bKey = String(bucketId);
      pendingTasks.current.set(bKey, taskIds);

      // Clear previous pending timer for this bucket
      const existingTimer = taskTimers.current.get(bKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        taskTimers.current.delete(bKey);
        const latestTaskIds = pendingTasks.current.get(bKey);
        if (!latestTaskIds || !projectId) return;

        const success = await executeWithRetry(() =>
          taskService.reorderTasks(projectId, bucketId, latestTaskIds),
        );

        if (success) {
          pendingTasks.current.delete(bKey);
          onTasksSynced?.();
        } else {
          showToast("Sync warning: Some task moves could not be saved to server", "error");
        }
      }, debounceMs);

      taskTimers.current.set(bKey, timer);
    },
    [projectId, debounceMs, onTasksSynced, showToast],
  );

  /**
   * Queue bucket/column reorder. Coalesces moves within debounceMs.
   */
  const queueBucketReorder = useCallback(
    (bucketIds: (string | number)[]) => {
      pendingBuckets.current = bucketIds;

      if (bucketTimer.current) {
        clearTimeout(bucketTimer.current);
      }

      bucketTimer.current = setTimeout(async () => {
        bucketTimer.current = null;
        const latestBucketIds = pendingBuckets.current;
        if (!latestBucketIds || !projectId) return;

        const success = await executeWithRetry(() =>
          bucketService.reorderBuckets(projectId, latestBucketIds),
        );

        if (success) {
          pendingBuckets.current = null;
          onBucketsSynced?.();
        } else {
          showToast("Sync warning: Column order could not be saved to server", "error");
        }
      }, debounceMs);
    },
    [projectId, debounceMs, onBucketsSynced, showToast],
  );

  /**
   * Cancel or strip a task ID from any pending reorder queues (e.g. when deleted)
   */
  const cancelTaskFromQueue = useCallback((taskId: string | number) => {
    const tStr = String(taskId);
    pendingTasks.current.forEach((taskIds, bKey) => {
      const filtered = taskIds.filter((id) => String(id) !== tStr);
      if (filtered.length !== taskIds.length) {
        pendingTasks.current.set(bKey, filtered);
      }
    });
  }, []);

  // Clean up all pending timers on unmount
  useEffect(() => {
    return () => {
      taskTimers.current.forEach((t) => clearTimeout(t));
      taskTimers.current.clear();
      if (bucketTimer.current) {
        clearTimeout(bucketTimer.current);
      }
    };
  }, []);

  return {
    queueTaskReorder,
    queueBucketReorder,
    cancelTaskFromQueue,
  };
};
