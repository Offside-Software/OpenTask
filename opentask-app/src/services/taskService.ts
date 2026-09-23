import { apiFetch } from "./apiClient";
import type { Task, Bucket } from "../models";
import JSONBig from "json-bigint";

export const taskService = {
  getTasksByProject: async (projectId: string | number): Promise<Task[]> => {
    const tasks = await apiFetch<Task[]>("/tasks");
    return tasks.filter((t) => String(t.project_id) === String(projectId));
  },

  getMyTasks: async (userId: number): Promise<Task[]> => {
    const tasks = await apiFetch<Task[]>("/tasks");
    return tasks.filter((t) => Boolean(t.lead_assignee_id) && String(t.lead_assignee_id) === String(userId));
  },

  createTask: async (data: Task): Promise<Task> => {
    return await apiFetch<Task>("/tasks", {
      method: "POST",
      body: JSONBig.stringify(data),
    });
  },

  updateTask: async (
    id: number | string,
    data: Partial<Task>,
  ): Promise<Task> => {
    // Only send valid task schema fields and clean up empty strings / undefined IDs
    const payload: Record<string, unknown> = {};
    
    const allowedKeys: (keyof Task)[] = [
      "title",
      "description",
      "bucket_id",
      "project_id",
      "lead_assignee_id",
      "suggested_assignee_id",
      "type",
      "weight",
      "branch_name",
      "repo_url",
      "order_idx",
    ];

    for (const key of allowedKeys) {
      if (key in data) {
        // Convert empty string or undefined IDs (e.g unassigned assignee) to null
        let val = data[key];
        if (
          (key === "lead_assignee_id" || key === "suggested_assignee_id" || key === "bucket_id") &&
          (val === "" || val === undefined)
        ) {
          val = null as any;
        }
        payload[key] = val;
      }
    }

    return await apiFetch<Task>(`/tasks/${id}`, {
      method: "PUT",
      body: JSONBig.stringify(payload),
    });
  },

  deleteTask: async (id: number | string): Promise<void> => {
    await apiFetch(`/tasks/${id}`, {
      method: "DELETE",
    });
  },

  reorderTasks: async (
    projectId: string | number,
    bucketId: number | string,
    taskIds: (number | string)[],
  ): Promise<{
    status: string;
    order: (number | string)[];
    bucket_id: number | string;
  }> => {
    return await apiFetch(
      `/projects/${projectId}/buckets/${bucketId}/tasks/reorder`,
      {
        method: "PUT",
        body: JSONBig.stringify(taskIds),
      },
    );
  },

  getBuckets: async (projectId: number | string): Promise<Bucket[]> => {
    return await apiFetch<Bucket[]>(`/projects/${projectId}/buckets`);
  },

  getTaskById: async (id: number | string): Promise<Task> => {
    return await apiFetch<Task>(`/tasks/${id}`);
  },

  getTaskRedirect: async (
    id: number | string
  ): Promise<{ task_id: string; project_id: string; title: string; url: string }> => {
    return await apiFetch<{ task_id: string; project_id: string; title: string; url: string }>(
      `/tasks/${id}/redirect`
    );
  },

  getBucketTasks: async (
    projectId: number | string,
    bucketId: number | string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{
    tasks: Task[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  }> => {
    return await apiFetch(
      `/projects/${projectId}/buckets/${bucketId}/tasks?limit=${limit}&offset=${offset}`
    );
  },

  searchTasks: async (
    projectId: number | string,
    query: string,
    limit: number = 25
  ): Promise<{ tasks: Task[]; count: number; query: string }> => {
    return await apiFetch(
      `/projects/${projectId}/tasks/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  },
};

