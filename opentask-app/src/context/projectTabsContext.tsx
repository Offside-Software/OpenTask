import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProjects } from '../controllers/useProjects';

export interface ProjectTab {
  id: string; // 64-bit Snowflake SafeId as string
  name: string;
}

interface ProjectTabsContextType {
  tabs: ProjectTab[];
  activeProjectId: string | null;
  openTab: (project: { id: string | number; name?: string }, shouldNavigate?: boolean) => void;
  closeTab: (projectId: string | number, e?: React.MouseEvent) => void;
  closeOtherTabs: (projectId: string | number) => void;
  closeAllTabs: () => void;
  updateTabName: (projectId: string | number, name: string) => void;
}

const ProjectTabsContext = createContext<ProjectTabsContextType | undefined>(undefined);

const STORAGE_KEY = 'opentask:project:tabs';

export const ProjectTabsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { projects } = useProjects();

  // Load persisted tabs or default to empty
  const [tabs, setTabs] = useState<ProjectTab[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter(t => t && t.id && typeof t.id === 'string');
        }
      }
    } catch (e) {
      console.warn('Failed to parse persisted project tabs:', e);
    }
    return [];
  });

  // Extract active project ID from route `/projects/:projectId`
  const activeProjectId = useMemo(() => {
    const match = location.pathname.match(/^\/projects\/([^/?#]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Persist tabs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.warn('Failed to persist project tabs:', e);
    }
  }, [tabs]);

  // When projects load or update, refresh tab names if they were fallbacks
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    setTabs(prevTabs => {
      let changed = false;
      const nextTabs = prevTabs.map(tab => {
        const match = projects.find(p => String(p.id) === String(tab.id));
        if (match && match.name && match.name !== tab.name) {
          changed = true;
          return { ...tab, name: match.name };
        }
        return tab;
      });
      return changed ? nextTabs : prevTabs;
    });
  }, [projects]);

  // Open or activate a tab
  const openTab = useCallback(
    (project: { id: string | number; name?: string }, shouldNavigate = true) => {
      const idStr = String(project.id);
      if (!idStr) return;

      setTabs(prev => {
        const existingIndex = prev.findIndex(t => String(t.id) === idStr);
        let resolvedName = project.name;
        if (!resolvedName) {
          const match = projects.find(p => String(p.id) === idStr);
          resolvedName = match?.name || `Project #${idStr.slice(-4)}`;
        }

        if (existingIndex >= 0) {
          // Tab already exists; update its name if more descriptive
          if (project.name && prev[existingIndex].name !== project.name) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], name: project.name };
            return next;
          }
          return prev;
        }

        // Add new tab
        return [...prev, { id: idStr, name: resolvedName }];
      });

      if (shouldNavigate && activeProjectId !== idStr) {
        navigate(`/projects/${idStr}`);
      }
    },
    [projects, activeProjectId, navigate]
  );

  // Sync route change: if URL points to a project, ensure it's in the tab bar
  useEffect(() => {
    if (activeProjectId) {
      const match = projects.find(p => String(p.id) === String(activeProjectId));
      const defaultName = match?.name;
      openTab({ id: activeProjectId, name: defaultName }, false);
    }
  }, [activeProjectId, projects, openTab]);

  // Close a tab
  const closeTab = useCallback(
    (projectId: string | number, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const idStr = String(projectId);

      setTabs(prev => {
        const tabIndex = prev.findIndex(t => String(t.id) === idStr);
        if (tabIndex === -1) return prev;

        const nextTabs = prev.filter(t => String(t.id) !== idStr);

        // If the closed tab was the active one, navigate to adjacent tab or workspaces
        if (activeProjectId === idStr) {
          if (nextTabs.length > 0) {
            const nextActiveIndex = Math.max(0, tabIndex - 1);
            const nextTarget = nextTabs[nextActiveIndex] || nextTabs[0];
            navigate(`/projects/${nextTarget.id}`);
          } else {
            navigate('/workspaces');
          }
        }

        return nextTabs;
      });
    },
    [activeProjectId, navigate]
  );

  // Close other tabs
  const closeOtherTabs = useCallback(
    (projectId: string | number) => {
      const idStr = String(projectId);
      setTabs(prev => prev.filter(t => String(t.id) === idStr));
      if (activeProjectId !== idStr) {
        navigate(`/projects/${idStr}`);
      }
    },
    [activeProjectId, navigate]
  );

  // Close all tabs
  const closeAllTabs = useCallback(() => {
    setTabs([]);
    navigate('/workspaces');
  }, [navigate]);

  // Update tab name
  const updateTabName = useCallback((projectId: string | number, name: string) => {
    if (!name) return;
    const idStr = String(projectId);
    setTabs(prev =>
      prev.map(tab => (String(tab.id) === idStr ? { ...tab, name } : tab))
    );
  }, []);

  const value = useMemo(
    () => ({
      tabs,
      activeProjectId,
      openTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      updateTabName,
    }),
    [tabs, activeProjectId, openTab, closeTab, closeOtherTabs, closeAllTabs, updateTabName]
  );

  return <ProjectTabsContext.Provider value={value}>{children}</ProjectTabsContext.Provider>;
};

export const useProjectTabs = (): ProjectTabsContextType => {
  const context = useContext(ProjectTabsContext);
  if (!context) {
    throw new Error('useProjectTabs must be used within a ProjectTabsProvider');
  }
  return context;
};
