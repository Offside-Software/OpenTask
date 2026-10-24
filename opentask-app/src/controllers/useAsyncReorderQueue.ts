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
 * - Debounces and coalesces rapid consecutive moves (including cross-bucket moves) into a single atomic request.
 * - Silently retries transient network errors in the background instead of abruptly snapping cards back.
 */
export const useAsyncReorderQueue = ({
  projectId,
  onTasksSynced,
  onBucketsSynced,
  debounceMs = 60,
}: UseAsyncReorderQueueOptions) => {
  const { showToast } = useToast();

  // Map of bucketId -> latest ordered task IDs
  const pendingTasks = useRef<Map<string, (string | number)[]>>(new Map());
  const taskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending bucket order
  const pendingBuckets = useRef<(string | number)[] | null>(null);
  const bucketTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Counter of active HTTP reorder calls currently in-flight
  const activeSyncCount = useRef<number>(0);

  // Helper for retrying an async action up to maxRetries with backoff
  const executeWithRetry = async (
    action: () => Promise<unknown>,
    retries = 2,
    delayMs = 400,
  ): Promise<boolean> => {
    activeSyncCount.current++;
    try {
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
    } finally {
      activeSyncCount.current = Math.max(0, activeSyncCount.current - 1);
    }
  };

  /**
   * Queue task reorder for a bucket. Coalesces intra-bucket and cross-bucket moves within debounceMs
   * into a single atomic batch request so the backend commits and broadcasts a single realtime event.
   */
  const queueTaskReorder = useCallback(
    (bucketId: string | number, taskIds: (string | number)[]) => {
      const bKey = String(bucketId);
      pendingTasks.current.set(bKey, taskIds);

      if (taskTimer.current) {
        clearTimeout(taskTimer.current);
      }

      taskTimer.current = setTimeout(async () => {
        taskTimer.current = null;
        if (pendingTasks.current.size === 0 || !projectId) return;

        // Snapshot current pending entries
        const snapshot = new Map(pendingTasks.current);
        const batchItems: { id: string | number; order_idx: number; bucket_id: string }[] = [];
        let primaryBucketId: string | null = null;

        snapshot.forEach((ids, bId) => {
          if (!primaryBucketId || ids.length > 0) {
            primaryBucketId = bId;
          }
          ids.forEach((id, idx) => {
            batchItems.push({
              id: String(id),
              order_idx: idx,
              bucket_id: bId,
            });
          });
        });

        if (!primaryBucketId || batchItems.length === 0) {
          snapshot.forEach((_, bId) => {
            if (pendingTasks.current.get(bId) === snapshot.get(bId)) {
              pendingTasks.current.delete(bId);
            }
          });
          return;
        }

        const targetBucket = primaryBucketId;
        const success = await executeWithRetry(() =>
          snapshot.size === 1
            ? taskService.reorderTasks(projectId, targetBucket, snapshot.get(targetBucket) ?? [])
            : taskService.reorderTasksBatch(projectId, targetBucket, batchItems),
        );

        if (success) {
          snapshot.forEach((ids, bId) => {
            if (pendingTasks.current.get(bId) === ids) {
              pendingTasks.current.delete(bId);
            }
          });
          onTasksSynced?.();
        } else {
          showToast("Sync warning: Some task moves could not be saved to server", "error");
        }
      }, debounceMs);
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
      if (taskTimer.current) {
        clearTimeout(taskTimer.current);
        taskTimer.current = null;
      }
      if (bucketTimer.current) {
        clearTimeout(bucketTimer.current);
        bucketTimer.current = null;
      }
    };
  }, []);

  const hasPendingReorders = useCallback(() => {
    return (
      pendingTasks.current.size > 0 ||
      taskTimer.current !== null ||
      activeSyncCount.current > 0 ||
      pendingBuckets.current !== null ||
      bucketTimer.current !== null
    );
  }, []);

  return {
    queueTaskReorder,
    queueBucketReorder,
    cancelTaskFromQueue,
    hasPendingReorders,
  };
};
