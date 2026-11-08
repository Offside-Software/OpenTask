import { apiFetch } from "./apiClient";
import type { ProjectDiagram, Task } from "../models";

export const diagramService = {
  getProjectDiagrams: async (
    projectId: string | number,
  ): Promise<ProjectDiagram[]> => {
    return await apiFetch<ProjectDiagram[]>(`/projects/${projectId}/diagrams`);
  },

  getDiagram: async (
    diagramId: string | number,
    projectId?: string | number,
  ): Promise<ProjectDiagram> => {
    if (projectId) {
      return await apiFetch<ProjectDiagram>(
        `/projects/${projectId}/diagrams/${diagramId}`,
      );
    }
    return await apiFetch<ProjectDiagram>(`/diagrams/${diagramId}`);
  },

  getDiagramById: async (
    projectId: string | number,
    diagramId: string | number,
  ): Promise<ProjectDiagram> => {
    return await apiFetch<ProjectDiagram>(
      `/projects/${projectId}/diagrams/${diagramId}`,
    );
  },

  createDiagram: async (
    projectId: string | number,
    data: { title: string; code?: string; description?: string },
  ): Promise<ProjectDiagram> => {
    const payload = {
      title: data.title,
      code:
        data.code ||
        `flowchart TD\n    Start([Start]) --> Process["Work in progress"]\n    Process --> Done([Done])`,
      description: data.description,
    };
    return await apiFetch<ProjectDiagram>(`/projects/${projectId}/diagrams`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateDiagram: async (
    arg1: string | number,
    arg2: any,
    arg3?: any,
  ): Promise<ProjectDiagram> => {
    // Unambiguously detect whether called as:
    // 1. updateDiagram(diagramId, data, projectId?) -> typeof arg2 === "object"
    // 2. updateDiagram(projectId, diagramId, data) -> typeof arg3 === "object"
    let projectId: string | number | undefined;
    let diagramId: string | number;
    let data: { title?: string; code?: string; description?: string };

    if (typeof arg2 === "object" && arg2 !== null) {
      diagramId = arg1;
      data = arg2;
      projectId = arg3;
    } else {
      projectId = arg1;
      diagramId = arg2;
      data = arg3 || {};
    }

    if (projectId) {
      return await apiFetch<ProjectDiagram>(
        `/projects/${projectId}/diagrams/${diagramId}`,
        {
          method: "PUT",
          body: JSON.stringify(data),
        },
      );
    }
    return await apiFetch<ProjectDiagram>(`/diagrams/${diagramId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  deleteDiagram: async (
    arg1: string | number,
    arg2?: string | number,
  ): Promise<void> => {
    // Supports deleteDiagram(projectId, diagramId) or deleteDiagram(diagramId)
    if (arg2 !== undefined) {
      await apiFetch(`/projects/${arg1}/diagrams/${arg2}`, {
        method: "DELETE",
      });
      return;
    }
    await apiFetch(`/diagrams/${arg1}`, {
      method: "DELETE",
    });
  },

  getDiagramTasks: async (
    projectId: string | number,
    diagramId: string | number,
  ): Promise<Task[]> => {
    return await apiFetch<Task[]>(
      `/projects/${projectId}/diagrams/${diagramId}/tasks`,
    );
  },

  linkDiagramToTask: async (
    diagramId: string | number,
    taskId: string | number,
    projectId?: string | number,
  ): Promise<void> => {
    const targetProject = projectId || "0";
    await apiFetch(
      `/projects/${targetProject}/diagrams/${diagramId}/tasks/${taskId}`,
      {
        method: "POST",
      },
    );
  },

  unlinkDiagramFromTask: async (
    diagramId: string | number,
    taskId: string | number,
    projectId?: string | number,
  ): Promise<void> => {
    const targetProject = projectId || "0";
    await apiFetch(
      `/projects/${targetProject}/diagrams/${diagramId}/tasks/${taskId}`,
      {
        method: "DELETE",
      },
    );
  },

  linkTask: async (
    projectId: string | number,
    diagramId: string | number,
    taskId: string | number,
  ): Promise<void> => {
    await apiFetch(
      `/projects/${projectId}/diagrams/${diagramId}/tasks/${taskId}`,
      {
        method: "POST",
      },
    );
  },

  unlinkTask: async (
    projectId: string | number,
    diagramId: string | number,
    taskId: string | number,
  ): Promise<void> => {
    await apiFetch(
      `/projects/${projectId}/diagrams/${diagramId}/tasks/${taskId}`,
      {
        method: "DELETE",
      },
    );
  },
};
