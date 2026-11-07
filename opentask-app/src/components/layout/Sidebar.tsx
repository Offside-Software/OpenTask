import { useState } from 'react';
import {
  LayoutDashboard,
  Briefcase,
  Bell,
  Settings,
  LogOut,
  Sun,
  Moon,
  MessageSquarePlus,
  Github,
  ExternalLink,
  PanelLeftClose,
  PanelLeft,
  FolderGit2,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { useTheme } from '../../context/themeContext';
import { useProjectTabs } from '../../context/projectTabsContext';
import { getDisplayName } from '../../auth/displayName';
import logo from '../../assets/logo.svg';
import { useAlerts } from '../../controllers/useAlerts';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../modals/ConfirmModal';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { id: 'dashboard', fullLabel: 'Dashboard', icon: LayoutDashboard },
  { id: 'workspaces', fullLabel: 'Workspaces', icon: Briefcase },
  { id: 'notifications', fullLabel: 'Notifications', icon: Bell },
];

interface SidebarProps {
  onOpenSettings?: () => void;
  onOpenFeedback?: () => void;
}

export function Sidebar({ onOpenSettings, onOpenFeedback }: SidebarProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { alerts } = useAlerts({ userId: user?.db_user?.id });
  const { tabs, closeTab } = useProjectTabs();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('opentask:sidebar:collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('opentask:sidebar:collapsed', String(next));
      } catch { }
      return next;
    });
  };

  const currentPage = location.pathname.split('/')[1] || 'dashboard';

  const displayName = user ? getDisplayName(user) : 'User';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <div
        className={cn(
          isCollapsed ? 'w-16' : 'w-56',
          'shrink-0 relative z-40 select-none transition-all duration-200 ease-in-out'
        )}
      >
        <aside
          className={cn(
            'absolute inset-y-0 left-0 border-r border-sidebar-border flex flex-col py-4 px-2.5 bg-sidebar text-sidebar-foreground z-40 transition-all duration-200 ease-in-out overflow-hidden',
            isCollapsed ? 'w-16' : 'w-56'
          )}
        >
          {/* Brand Header */}
          <div className="flex items-center justify-between gap-2 mb-4 w-full px-1">
            <div
              className="flex items-center gap-2.5 cursor-pointer min-w-0"
              onClick={() => navigate('/dashboard')}
              title="OpenTask Dashboard"
            >
              <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-xs">
                <img src={logo} alt="OpenTask" className="w-5 h-5 object-contain" />
              </div>
              {!isCollapsed && (
                <div className="min-w-0 overflow-hidden">
                  <span className="text-foreground font-semibold text-sm tracking-tight block truncate">
                    OpenTask
                  </span>
                  <span className="text-muted-foreground text-[10px] block truncate">
                    Workspace Root
                  </span>
                </div>
              )}
            </div>

            {/* Collapse Button */}
            {!isCollapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors flex items-center justify-center shrink-0 cursor-pointer"
              >
                <PanelLeftClose size={15} />
              </button>
            )}
          </div>

          {isCollapsed && (
            <div className="flex justify-center mb-3">
              <button
                type="button"
                onClick={toggleSidebar}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors flex items-center justify-center cursor-pointer"
              >
                <PanelLeft size={15} />
              </button>
            </div>
          )}

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 w-full shrink-0">
            {NAV_ITEMS.map(({ id, fullLabel, icon: Icon }) => {
              const isActive = currentPage === id;
              const hasUnread = id === 'notifications' && alerts.length > 0;
              return (
                <Link
                  key={id}
                  to={`/${id}`}
                  title={fullLabel}
                  className={cn(
                    'h-9 rounded-lg transition-colors relative flex items-center px-2 text-xs font-medium',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                  )}
                >
                  <div className="w-6 h-full flex items-center justify-center shrink-0 relative">
                    <Icon size={16} />
                    {hasUnread && (
                      <span className="absolute -top-0.5 -right-1 min-w-[15px] h-[15px] px-1 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-[9px] font-bold">
                        {alerts.length > 99 ? '99+' : alerts.length}
                      </span>
                    )}
                  </div>
                  {!isCollapsed && (
                    <span className="ml-2.5 truncate">
                      {fullLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Open Projects Section */}
          {tabs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-sidebar-border/60 flex flex-col min-h-0 flex-1">
              {!isCollapsed ? (
                <>
                  <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase shrink-0">
                    <span className="flex items-center gap-1.5">
                      <FolderGit2 size={12} className="text-primary" />
                      <span>Open Projects</span>
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 bg-sidebar-accent text-sidebar-foreground/80 rounded-sm border border-sidebar-border font-semibold">
                      {tabs.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5 overflow-y-auto no-scrollbar flex-1 pr-0.5">
                    {tabs.map((tab) => {
                      const isProjectActive = location.pathname.startsWith(`/projects/${tab.id}`);
                      return (
                        <div
                          key={tab.id}
                          onClick={() => navigate(`/projects/${tab.id}`)}
                          title={`${tab.name || `Project #${tab.id.slice(-4)}`}\nID: ${tab.id}`}
                          className={cn(
                            'group h-8 rounded-lg transition-colors relative flex items-center justify-between px-2 text-xs font-medium cursor-pointer shrink-0',
                            isProjectActive
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <FolderGit2
                              size={13}
                              className={cn(
                                'shrink-0',
                                isProjectActive ? 'text-primary-foreground' : 'text-primary'
                              )}
                            />
                            <span className="truncate text-xs">
                              {tab.name || `Project #${tab.id.slice(-4)}`}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              closeTab(tab.id, e);
                            }}
                            title="Close project"
                            className={cn(
                              'w-5 h-5 rounded flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 shrink-0 ml-1 cursor-pointer',
                              isProjectActive
                                ? 'hover:bg-primary-foreground/20 text-primary-foreground'
                                : 'hover:bg-sidebar-border text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 overflow-y-auto no-scrollbar flex-1">
                  {tabs.map((tab) => {
                    const isProjectActive = location.pathname.startsWith(`/projects/${tab.id}`);
                    return (
                      <div
                        key={tab.id}
                        onClick={() => navigate(`/projects/${tab.id}`)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          closeTab(tab.id, e);
                        }}
                        title={`${tab.name || `Project #${tab.id.slice(-4)}`}\n(Click to open, right-click to close)`}
                        className={cn(
                          'w-8 h-8 rounded-lg transition-colors relative flex items-center justify-center cursor-pointer group shrink-0',
                          isProjectActive
                            ? 'bg-primary text-primary-foreground shadow-xs'
                            : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                        )}
                      >
                        <FolderGit2
                          size={15}
                          className={isProjectActive ? 'text-primary-foreground' : 'text-primary'}
                        />
                        {isProjectActive && (
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-foreground rounded-full border border-sidebar" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Bottom Actions */}
          <div className="mt-auto w-full flex flex-col gap-1 pt-3 border-t border-sidebar-border">
            {/* Quick Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              className="h-9 w-full rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer flex items-center px-2 text-xs font-medium"
            >
              <div className="w-6 h-full flex items-center justify-center shrink-0">
                {theme === 'dark' ? (
                  <Sun size={15} className="text-amber-400" />
                ) : (
                  <Moon size={15} className="text-foreground" />
                )}
              </div>
              {!isCollapsed && (
                <span className="ml-2.5 truncate">
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </span>
              )}
            </button>

            {/* User Feedback */}
            <button
              type="button"
              onClick={onOpenFeedback}
              title="Feedback & bug report"
              className="h-9 w-full rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer flex items-center px-2 text-xs font-medium"
            >
              <div className="w-6 h-full flex items-center justify-center shrink-0">
                <MessageSquarePlus size={15} />
              </div>
              {!isCollapsed && (
                <div className="ml-2.5 flex items-center gap-1.5 truncate">
                  <span>Feedback</span>
                  <span className="text-[9px] font-medium bg-primary/10 text-primary px-1.5 py-0.2 rounded-full">
                    Alpha
                  </span>
                </div>
              )}
            </button>

            {/* GitHub Open Source Repo */}
            <a
              href="https://github.com/Offside-Software/OpenTask/"
              target="_blank"
              rel="noopener noreferrer"
              title="OpenTask repository"
              className="h-9 w-full rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer flex items-center px-2 text-xs font-medium"
            >
              <div className="w-6 h-full flex items-center justify-center shrink-0">
                <Github size={15} />
              </div>
              {!isCollapsed && (
                <div className="ml-2.5 flex items-center gap-1.5 truncate">
                  <span>GitHub</span>
                  <ExternalLink size={10} className="text-muted-foreground" />
                </div>
              )}
            </a>

            {/* Settings */}
            <button
              type="button"
              onClick={onOpenSettings}
              title="System settings"
              className="h-9 w-full rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer flex items-center px-2 text-xs font-medium"
            >
              <div className="w-6 h-full flex items-center justify-center shrink-0">
                <Settings size={15} />
              </div>
              {!isCollapsed && (
                <span className="ml-2.5 truncate">
                  Settings
                </span>
              )}
            </button>

            {/* Sign Out / User Pill */}
            <button
              type="button"
              onClick={() => setIsSignOutModalOpen(true)}
              title={`Sign out (${displayName})`}
              className="h-9 w-full rounded-lg hover:bg-destructive/10 hover:text-destructive text-sidebar-foreground/80 transition-colors cursor-pointer flex items-center px-2 text-xs font-medium mt-1"
            >
              <div className="w-6 h-full flex items-center justify-center shrink-0">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[10px] shrink-0">
                  {initials || <LogOut size={12} />}
                </div>
              </div>
              {!isCollapsed && (
                <div className="ml-2.5 min-w-0 text-left truncate flex-1">
                  <span className="truncate block font-medium leading-tight">
                    {displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Sign out
                  </span>
                </div>
              )}
            </button>
          </div>
        </aside>
      </div>

      {/* Sign Out Confirmation Modal */}
      {isSignOutModalOpen && (
        <ConfirmModal
          title="Sign out confirmation"
          message={`Are you sure you want to end your current session for ${displayName}?`}
          confirmLabel="Sign out"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => {
            setIsSignOutModalOpen(false);
            logout();
          }}
          onCancel={() => setIsSignOutModalOpen(false)}
        />
      )}
    </>
  );
}
