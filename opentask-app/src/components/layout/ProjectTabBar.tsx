import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectTabs, type ProjectTab } from '../../context/projectTabsContext';
import { useProjects } from '../../controllers/useProjects';
import {
  FolderGit2,
  X,
  Plus,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TabContextMenuState {
  x: number;
  y: number;
  tab: ProjectTab;
}

export const ProjectTabBar: React.FC = () => {
  const { tabs, activeProjectId, closeTab, closeOtherTabs, closeAllTabs } = useProjectTabs();
  const { projects } = useProjects();
  const navigate = useNavigate();

  const [isNewTabOpen, setIsNewTabOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  const newTabRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (newTabRef.current && !newTabRef.current.contains(e.target as Node)) {
        setIsNewTabOpen(false);
      }
      setContextMenu(null);
    };

    if (isNewTabOpen || contextMenu) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNewTabOpen, contextMenu]);

  if (tabs.length === 0 && !activeProjectId) {
    return null;
  }

  const handleTabContextMenu = (e: React.MouseEvent, tab: ProjectTab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 150),
      tab,
    });
  };

  const handleCopyProjectLink = (tab: ProjectTab) => {
    const url = `${window.location.origin}/projects/${tab.id}`;
    navigator.clipboard.writeText(url);
    setContextMenu(null);
  };

  return (
    <>
      <div className="w-full bg-muted/30 border-b border-border flex items-center justify-between py-1 px-4 sm:px-6 select-none">
        {/* Left: Scrollable Tabs */}
        <div
          ref={tabsScrollRef}
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0"
        >
          {tabs.map((tab) => {
            const isActive = String(tab.id) === String(activeProjectId);
            return (
              <div
                key={tab.id}
                onClick={() => navigate(`/projects/${tab.id}`)}
                onContextMenu={(e) => handleTabContextMenu(e, tab)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                title={`${tab.name} (#${tab.id})\nRight-click for options, Middle-click to close`}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer max-w-[220px]',
                  isActive
                    ? 'bg-card text-foreground border border-border shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <FolderGit2
                  size={14}
                  className={isActive ? 'text-primary' : 'text-muted-foreground'}
                />

                <span className="truncate max-w-[140px] leading-none">
                  {tab.name || `Project #${tab.id.slice(-4)}`}
                </span>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={(e) => closeTab(tab.id, e)}
                  title="Close Tab"
                  className="w-4 h-4 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center transition-colors cursor-pointer ml-0.5"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}

          {/* New Tab Button */}
          <div className="relative shrink-0" ref={newTabRef}>
            <button
              onClick={() => {
                navigate('/workspaces');
              }}
              title="Open project in new tab"
              className="h-7 w-7 rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
            >
              <Plus size={14} />
            </button>

            {/* Quick Project Select Dropdown */}
            {isNewTabOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl z-50 p-3 animate-in fade-in zoom-in-95 duration-100">
                <div className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                  <span>Open project</span>
                  <span className="text-muted-foreground text-[10px]">{projects.length} available</span>
                </div>
                <div className="mt-2 pt-2 border-t border-border flex justify-between items-center text-xs">
                  <button
                    onClick={() => {
                      navigate('/workspaces');
                      setIsNewTabOpen(false);
                    }}
                    className="text-primary hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>Browse workspaces</span>
                    <ExternalLink size={11} />
                  </button>
                  <span className="text-muted-foreground text-[11px]">{tabs.length} tabs open</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-44 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-1 text-xs animate-in fade-in duration-75"
        >
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-b border-border/70 truncate mb-1">
            {contextMenu.tab.name}
          </div>
          <button
            onClick={() => {
              closeTab(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer flex items-center justify-between"
          >
            <span>Close tab</span>
            <X size={12} />
          </button>
          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Close other tabs
          </button>
          <button
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
          >
            Close all tabs
          </button>
          <div className="my-1 border-t border-border/70" />
          <button
            onClick={() => handleCopyProjectLink(contextMenu.tab)}
            className="w-full text-left px-2 py-1.5 rounded-md text-foreground hover:bg-muted transition-colors cursor-pointer flex items-center justify-between"
          >
            <span>Copy link</span>
            <ExternalLink size={12} />
          </button>
        </div>
      )}
    </>
  );
};
