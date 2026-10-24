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

  // Close new tab dropdown on click outside
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

  // Don't render tab bar if no tabs are open and user is on a non-project page
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
      <div className="w-full bg-[#0E1012] border-b-2 border-black flex items-center justify-between py-2 px-8 select-none shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
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
                  // Middle click closes tab
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                title={`${tab.name} (#${tab.id})\nRight-click for options, Middle-click to close`}
                className={`flex items-center gap-2 border p-2 rounded-none border border-2 shadow-[2px_2px_0px_0px_#000000] text-[11px] font-mono font-bold tracking-wider uppercase transition-all cursor-pointer max-w-[220px] ${isActive
                  ? 'bg-[#FFE600] text-black border-black'
                  : 'bg-[#141619] text-neutral-400 border-neutral-800 hover:border-neutral-500 hover:text-white hover:bg-[#1A1D21]'
                  }`}
              >
                <FolderGit2
                  size={14}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={isActive ? 'text-black' : 'text-neutral-500 group-hover:text-neutral-300'}
                />

                <span className="truncate max-w-[140px] font-mono font-medium leading-none">
                  {tab.name || `Project #${tab.id.slice(-4)}`}
                </span>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={(e) => closeTab(tab.id, e)}
                  title="Close Project Tab"
                  className={`w-4 h-4 rounded-none flex items-center justify-center transition-all cursor-pointer ml-1 ${isActive
                    ? 'text-black hover:bg-black hover:text-[#FFE600]'
                    : 'text-neutral-500 hover:bg-[#FF3333] hover:text-white'
                    }`}
                >
                  <X size={11} strokeWidth={2.5} />
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
              title="Open Project in New Tab"
              className="h-7 w-7 rounded-none bg-[#141619] border border-neutral-700 hover:border-white text-neutral-400 hover:text-[#FFE600] flex items-center justify-center shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer"
            >
              <Plus size={14} strokeWidth={3} />
            </button>

            {/* Quick Project Select Dropdown */}
            {isNewTabOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-[#121417] border-2 border-black shadow-[5px_5px_0px_0px_#000000] z-50 p-2 font-mono animate-in fade-in zoom-in-95 duration-100">
                <div className="text-[10px] font-black text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-800 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>// OPEN PROJECT TAB</span>
                  <span className="text-neutral-400 text-[9px]">{projects.length} AVAILABLE</span>
                </div>
                {/* Footer link to Workspaces */}
                <div className="mt-2 pt-2 border-t border-neutral-800 flex justify-between items-center text-[10px]">
                  <button
                    onClick={() => {
                      navigate('/workspaces');
                      setIsNewTabOpen(false);
                    }}
                    className="text-[#FFE600] hover:underline flex items-center gap-1 font-bold"
                  >
                    <span>BROWSE WORKSPACES</span>
                    <ExternalLink size={10} />
                  </button>
                  <span className="text-neutral-500">{tabs.length} tabs open</span>
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
          className="fixed z-50 w-44 bg-[#121417] border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-1 font-mono text-[11px] animate-in fade-in duration-75"
        >
          <div className="px-2 py-1 text-[12px] font-black text-neutral-400 border-b border-neutral-800 truncate mb-1">
            // {contextMenu.tab.name}
          </div>
          <button
            onClick={() => {
              closeTab(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 text-neutral-300 hover:bg-[#FF3333] hover:text-white transition-colors cursor-pointer flex items-center justify-between"
          >
            <span>Close Tab</span>
            <X size={11} />
          </button>
          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 text-neutral-300 hover:bg-[#FFE600] hover:text-black transition-colors cursor-pointer"
          >
            Close Other Tabs
          </button>
          <button
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1.5 text-neutral-300 hover:bg-[#FF3333] hover:text-white transition-colors cursor-pointer"
          >
            Close All Tabs
          </button>
          <div className="my-1 border-t border-neutral-800" />
          <button
            onClick={() => handleCopyProjectLink(contextMenu.tab)}
            className="w-full text-left px-2 py-1.5 text-neutral-300 hover:bg-[#FFE600] hover:text-black transition-colors cursor-pointer flex items-center justify-between"
          >
            <span>Copy Link</span>
            <ExternalLink size={10} />
          </button>
        </div>
      )}
    </>
  );
};
