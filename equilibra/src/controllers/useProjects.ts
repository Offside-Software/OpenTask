import { useState, useEffect, useCallback } from "react";
import type { Project, ProjectMember } from "../models";
import { projectService } from "../services/projectService";
import { userService } from "../services/userService";
import { useToast } from "../design-system/Toast";
import { useAuth } from "../auth/useAuth";
import { getCached, setCached } from "../utils/cache";

export const useProjects = () => {
  const { user, isLoading } = useAuth();
  const { showToast } = useToast();
  const userId = user?.db_user?.id;

  const [projects, setProjects] = useState<Project[]>(() => {
    if (!userId) return [];
    return getCached<Project[]>(`opentask_projects_${userId}`) || [];
  });
  const [memberships, setMemberships] = useState<ProjectMember[]>(() => {
    if (!userId) return [];
    return getCached<ProjectMember[]>(`opentask_memberships_${userId}`) || [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!userId) return true;
    const hasCache = !!getCached<Project[]>(`opentask_projects_${userId}`);
    return !hasCache;
  });
  const [error, setError] = useState<string | null>(null);

  // Sync cache if userId wasn't ready during initial state setup
  useEffect(() => {
    if (!userId) return;
    const cachedP = getCached<Project[]>(`opentask_projects_${userId}`);
    const cachedM = getCached<ProjectMember[]>(`opentask_memberships_${userId}`);
    if (cachedP && cachedP.length > 0) {
      setProjects(cachedP);
      setLoading(false);
    }
    if (cachedM && cachedM.length > 0) {
      setMemberships(cachedM);
    }
  }, [userId]);

  const fetchProjects = useCallback(async () => {
    if (!userId) return;

    try {
      const [data, mems] = await Promise.all([
        projectService.getMyProjects(),
        userService.getMembershipsForUser(),
      ]);
      setProjects(data);
      setMemberships(mems);
      setCached(`opentask_projects_${userId}`, data);
      setCached(`opentask_memberships_${userId}`, mems);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch projects");
      showToast("Error loading projects", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, userId]);

  useEffect(() => {
    if (isLoading) return;
    fetchProjects();
  }, [fetchProjects, isLoading]);

  const createProject = useCallback(
    async (
      data: Pick<Project, "name" | "gh_repo_url"> & { description?: string },
    ) => {
      try {
        const ownerId = user?.db_user?.id;
        const created = await projectService.createProjectWithOwner(
          data as Project,
          ownerId,
        );
        setProjects((prev) => [created, ...prev]);

        // add local membership for UI immediately
        setMemberships((prev) => [
          ...prev,
          {
            project_id: created.id!,
            user_id: ownerId || 1,
            role: "MANAGER",
            kpi_score: 100,
            max_capacity: 100,
            current_load: 0,
          },
        ]);

        showToast("Project created successfully!", "success");
        return created;
      } catch (err) {
        console.error(err);
        showToast("Failed to create project", "error");
        throw err;
      }
    },
    [showToast, user?.db_user?.id],
  );

  const updateProject = useCallback(
    async (id: number, data: Partial<Project>) => {
      // Backend update not fully implemented, but updating local state for UI
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...data } : p)),
      );
      return projects.find((p) => p.id === id)!;
    },
    [projects],
  );

  const deleteProject = useCallback(
    async (id: number | string) => {
      try {
        await projectService.deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        showToast("Project deleted", "info");
      } catch (err) {
        console.error(err);
        showToast("Failed to delete project", "error");
      }
    },
    [showToast],
  );

  // Filter based on memberships
  const myProjects = projects.filter((p) =>
    memberships.some((m) => m.project_id === p.id),
  );
  const leadProjects = myProjects.filter(
    (p) => memberships.find((m) => m.project_id === p.id)?.role === "MANAGER",
  );
  const collaboratingProjects = myProjects.filter(
    (p) => memberships.find((m) => m.project_id === p.id)?.role !== "MANAGER",
  );

  return {
    projects,
    leadProjects,
    collaboratingProjects,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
  };
};
