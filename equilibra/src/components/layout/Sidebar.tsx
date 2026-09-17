import { useState } from 'react';
import { LayoutDashboard, Briefcase, Bell, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { getDisplayName } from '../../auth/displayName';
import logo from '../../assets/logo.png';
import { useAlerts } from '../../controllers/useAlerts';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../modals/ConfirmModal';

const NAV_ITEMS = [
  { id: 'dashboard', shortLabel: 'DASH', fullLabel: 'DASHBOARD', icon: LayoutDashboard },
  { id: 'workspaces', shortLabel: 'WORK', fullLabel: 'WORKSPACES', icon: Briefcase },
  { id: 'notifications', shortLabel: 'ALRT', fullLabel: 'NOTIFICATIONS', icon: Bell },
];

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { alerts } = useAlerts();

  const [isHovered, setIsHovered] = useState(false);
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);

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
      <div className="w-[84px] flex-shrink-0 relative z-40 select-none">
        <aside
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`absolute inset-y-0 left-0 border-r-2 border-black flex flex-col py-5 bg-[#0C0D0E] z-40 transition-all duration-200 ease-in-out overflow-hidden shadow-[4px_0px_0px_0px_rgba(0,0,0,0.4)] ${
            isHovered ? 'w-60 items-start px-3' : 'w-[84px] items-center px-2.5'
          }`}
        >
          {/* Brutalist Brand Badge */}
          <div
            className={`flex items-center gap-3 mb-7 cursor-pointer ${
              isHovered ? 'w-full px-1' : 'justify-center'
            }`}
            onClick={() => navigate('/dashboard')}
            title="OpenTask Root"
          >
            <div className="w-11 h-11 rounded-none border-2 border-black bg-[#FFE600] flex items-center justify-center shrink-0 shadow-[3px_3px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform">
              <img src={logo} alt="OpenTask Logo" className="w-7 h-7 object-contain" />
            </div>
            {isHovered && (
              <div className="min-w-0 animate-in fade-in duration-150">
                <span className="text-white font-mono font-black text-[15px] uppercase tracking-wider block leading-tight">
                  OPENTASK
                </span>
                <span className="text-neutral-400 font-mono text-[9px] uppercase tracking-widest block">
                  // COMMAND ROOT
                </span>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-3 w-full">
            {NAV_ITEMS.map(({ id, shortLabel, fullLabel, icon: Icon }) => {
              const isActive = currentPage === id || (id === 'workspaces' && currentPage === 'projects');
              const hasUnread = id === 'notifications' && alerts.length > 0;
              return (
                <Link
                  key={id}
                  to={`/${id}`}
                  title={fullLabel}
                  className={`rounded-none border-2 transition-all duration-75 relative flex items-center ${
                    isHovered
                      ? 'px-3.5 py-2.5 gap-3 justify-start'
                      : 'p-2.5 flex-col justify-center items-center'
                  } ${
                    isActive
                      ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                      : 'bg-[#141619] text-neutral-400 border-neutral-800 hover:border-white hover:text-white hover:shadow-[2px_2px_0px_0px_#000000]'
                  }`}
                >
                  <div className="relative shrink-0 flex items-center justify-center">
                    <Icon size={isHovered ? 18 : 20} strokeWidth={2.5} />
                    {hasUnread && (
                      <div className="absolute -top-2 -right-2 min-w-[17px] h-[17px] bg-[#FF3333] text-white border-2 border-black rounded-none flex items-center justify-center text-[8px] font-mono font-black px-0.5 shadow-[1px_1px_0px_0px_#000000]">
                        {alerts.length > 99 ? '99+' : alerts.length}
                      </div>
                    )}
                  </div>
                  {isHovered ? (
                    <span className="text-[11px] font-mono font-black tracking-wider uppercase truncate animate-in fade-in duration-100">
                      {fullLabel}
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono font-bold mt-1 tracking-wider uppercase">
                      {shortLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="mt-auto w-full flex flex-col gap-2.5">
            <button
              onClick={onOpenSettings}
              title="System Settings"
              className={`rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center ${
                isHovered ? 'w-full px-3.5 py-2.5 gap-3 justify-start' : 'w-10 h-10 justify-center mx-auto'
              }`}
            >
              <Settings size={18} strokeWidth={2.5} className="shrink-0" />
              {isHovered && (
                <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300">
                  SETTINGS
                </span>
              )}
            </button>

            <button
              onClick={() => setIsSignOutModalOpen(true)}
              title={`Sign out (${displayName})`}
              className={`rounded-none bg-[#1E2227] border-2 border-black text-white hover:bg-[#FF3333] hover:text-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center ${
                isHovered ? 'w-full px-3.5 py-2.5 gap-3 justify-start' : 'w-10 h-10 justify-center mx-auto'
              }`}
            >
              <div className="w-5 h-5 rounded-none bg-black/40 border border-neutral-700 flex items-center justify-center font-mono text-[10px] font-black shrink-0">
                {initials || <LogOut size={12} />}
              </div>
              {isHovered && (
                <div className="min-w-0 text-left animate-in fade-in duration-100">
                  <span className="text-[11px] font-mono font-black uppercase tracking-wider truncate block leading-tight">
                    {displayName}
                  </span>
                  <span className="text-[9px] font-mono text-neutral-400 uppercase tracking-wider block">
                    // SIGN OUT
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
