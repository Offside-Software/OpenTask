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
  PanelLeftClose
} from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { useTheme } from '../../context/themeContext';
import { getDisplayName } from '../../auth/displayName';
import logo from '../../assets/logo.svg';
import { useAlerts } from '../../controllers/useAlerts';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../modals/ConfirmModal';

const NAV_ITEMS = [
  { id: 'dashboard', fullLabel: 'DASHBOARD', icon: LayoutDashboard },
  { id: 'workspaces', fullLabel: 'WORKSPACES', icon: Briefcase },
  { id: 'notifications', fullLabel: 'NOTIFICATIONS', icon: Bell },
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

  // Persist collapsed state to localStorage (default is collapsed on compact screens, or user preference)
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

  const displayName = user ? getDisplayName(user) : 'USER';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <div
        className={`${isCollapsed ? 'w-[68px]' : 'w-60'
          } flex-shrink-0 relative z-40 select-none transition-all duration-200 ease-in-out`}
      >
        <aside
          className={`absolute inset-y-0 left-0 border-r-2 border-black flex flex-col py-5 px-3 bg-[#0C0D0E] z-40 transition-all duration-200 ease-in-out overflow-hidden shadow-[4px_0px_0px_0px_rgba(0,0,0,0.4)] ${isCollapsed ? 'w-[68px]' : 'w-60'
            }`}
        >
          {/* Brutalist Brand Header & Collapse Toggle */}
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 mb-6 w-full">
              <div
                className="flex items-center gap-3 cursor-pointer min-w-0"
                onClick={() => navigate('/dashboard')}
                title="OpenTask Root"
              >
                <div className="w-11 h-11 rounded-none border-2 border-black bg-[#FFE600] flex items-center justify-center shrink-0 shadow-[3px_3px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform">
                  <img src={logo} alt="OpenTask Logo" className="w-7 h-7 object-contain" />
                </div>
                <div className="min-w-0 overflow-hidden">
                  <span className="text-white font-mono font-black text-[15px] uppercase tracking-wider block leading-tight truncate">
                    OPENTASK
                  </span>
                  <span className="text-neutral-400 font-mono text-[9px] uppercase tracking-widest block truncate">
                    // COMMAND ROOT
                  </span>
                </div>
              </div>

              {/* Collapse Button */}
              <button
                type="button"
                onClick={toggleSidebar}
                title="Collapse Sidebar"
                aria-label="Collapse Sidebar"
                className="w-8 h-8 rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer flex items-center justify-center shrink-0"
              >
                <PanelLeftClose size={16} strokeWidth={2.5} />
              </button>

            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 mb-6 w-full">
              <div
                className="w-11 h-11 rounded-none border-2 border-black bg-[#FFE600] flex items-center justify-center shrink-0 shadow-[3px_3px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform cursor-pointer"
                onClick={toggleSidebar}
                title="OpenTask Root"
              >
                <img src={logo} alt="OpenTask Logo" className="w-7 h-7 object-contain" />
              </div>
            </div>
          )}

          {/* Nav */}
          <nav className="flex flex-col gap-3 w-full">
            {NAV_ITEMS.map(({ id, fullLabel, icon: Icon }) => {
              const isActive = currentPage === id || (id === 'workspaces' && currentPage === 'projects');
              const hasUnread = id === 'notifications' && alerts.length > 0;
              return (
                <Link
                  key={id}
                  to={`/${id}`}
                  title={fullLabel}
                  className={`h-11 rounded-none border-2 transition-all duration-75 relative flex items-center overflow-hidden ${isActive
                    ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                    : 'bg-[#141619] text-neutral-400 border-neutral-800 hover:border-white hover:text-white hover:shadow-[2px_2px_0px_0px_#000000]'
                    }`}
                >
                  <div className="w-10 h-full flex items-center justify-center shrink-0 relative">
                    <Icon size={19} strokeWidth={2.5} />
                    {hasUnread && (
                      <div className="absolute top-1 right-0.5 min-w-[16px] h-[16px] bg-[#FF3333] text-white border-2 border-black rounded-none flex items-center justify-center text-[11px] font-mono font-black shadow-[1px_1px_0px_0px_#000000]">
                        {alerts.length > 99 ? '99+' : alerts.length}
                      </div>
                    )}
                  </div>
                  <div
                    className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                      }`}
                  >
                    <span className="text-[11px] font-mono font-black tracking-wider uppercase whitespace-nowrap block">
                      {fullLabel}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="mt-auto w-full flex flex-col gap-2.5">
            {/* Quick Theme Toggle */}
            <button
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              className="h-11 w-full rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all cursor-pointer hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                {theme === 'dark' ? (
                  <Sun size={18} strokeWidth={2.5} className="text-[#FFE600]" />
                ) : (
                  <Moon size={18} strokeWidth={2.5} className="text-black" />
                )}
              </div>
              <div
                className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                  }`}
              >
                <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300 whitespace-nowrap block">
                  {theme === 'dark' ? 'LIGHT THEME' : 'DARK THEME'}
                </span>
              </div>
            </button>

            {/* User Feedback & Report */}
            <button
              onClick={onOpenFeedback}
              title="User Feedback & Bug Report (Alpha Release)"
              className="h-11 w-full rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-[#FFE600] hover:border-[#FFE600] transition-all cursor-pointer hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden group"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <MessageSquarePlus size={18} strokeWidth={2.5} className="group-hover:text-[#FFE600] text-[#FFE600]" />
              </div>
              <div
                className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                  }`}
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300 group-hover:text-[#FFE600] block">
                    FEEDBACK
                  </span>
                  <span className="text-[8px] font-mono font-black bg-[#FFE600] text-black px-1 py-0.5 border border-black leading-none">
                    ALPHA
                  </span>
                </div>
              </div>
            </button>

            {/* GitHub Open Source Repo */}
            <a
              href="https://github.com/Offside-Software/OpenTask/"
              target="_blank"
              rel="noopener noreferrer"
              title="OpenTask Source Code on GitHub (Open Source)"
              className="h-11 w-full rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all cursor-pointer hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden group"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <Github size={18} strokeWidth={2.2} />
              </div>
              <div
                className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                  }`}
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300 group-hover:text-white block">
                    SOURCE CODE
                  </span>
                  <ExternalLink size={10} className="text-neutral-500 group-hover:text-neutral-300" />
                </div>
              </div>
            </a>

            <button
              onClick={onOpenSettings}
              title="System Settings"
              className="h-11 w-full rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all cursor-pointer hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <Settings size={18} strokeWidth={2.5} />
              </div>
              <div
                className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                  }`}
              >
                <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300 whitespace-nowrap block">
                  SETTINGS
                </span>
              </div>
            </button>

            <button
              onClick={() => setIsSignOutModalOpen(true)}
              title={`Sign out (${displayName})`}
              className="h-11 w-full rounded-none bg-[#1E2227] border-2 border-black text-white hover:bg-[#FF3333] hover:text-white transition-all cursor-pointer hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <div className="w-6 h-6 rounded-none bg-black/40 border border-neutral-700 flex items-center justify-center font-mono text-[10px] font-black shrink-0">
                  {initials || <LogOut size={12} />}
                </div>
              </div>
              <div
                className={`overflow-hidden transition-all duration-200 pl-1.5 ${!isCollapsed ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'
                  }`}
              >
                <div className="min-w-0 text-left whitespace-nowrap">
                  <span className="text-[11px] font-mono font-black uppercase tracking-wider truncate block leading-tight">
                    {displayName}
                  </span>
                  <span className="text-[9px] font-mono text-neutral-400 uppercase tracking-wider block">
                    // SIGN OUT
                  </span>
                </div>
              </div>
            </button>
          </div>
        </aside>
      </div>

      {/* Sign Out Confirmation Modal */}
      {isSignOutModalOpen && (
        <ConfirmModal
          title="CONFIRM SIGN OUT"
          message={`Are you sure you want to end your current session for ${displayName}? You will need to re-authenticate with GitHub to access your workspaces.`}
          confirmLabel="SIGN OUT"
          cancelLabel="CANCEL"
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
