import { useState } from 'react';
import { LayoutDashboard, Briefcase, Bell, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { getDisplayName } from '../../auth/displayName';
import logo from '../../assets/logo.png';
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
      <div className="w-[68px] flex-shrink-0 relative z-40 select-none">
        <aside
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`absolute inset-y-0 left-0 border-r-2 border-black flex flex-col py-5 px-3 bg-[#0C0D0E] z-40 transition-all duration-200 ease-in-out overflow-hidden shadow-[4px_0px_0px_0px_rgba(0,0,0,0.4)] ${
            isHovered ? 'w-60' : 'w-[68px]'
          }`}
        >
          {/* Brutalist Brand Badge */}
          <div
            className="flex items-center gap-3 mb-7 cursor-pointer w-full"
            onClick={() => navigate('/dashboard')}
            title="OpenTask Root"
          >
            <div className="w-11 h-11 rounded-none border-2 border-black bg-[#FFE600] flex items-center justify-center shrink-0 shadow-[3px_3px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform">
              <img src={logo} alt="OpenTask Logo" className="w-7 h-7 object-contain" />
            </div>
            <div className={`min-w-0 overflow-hidden transition-all duration-200 ${isHovered ? 'opacity-100 max-w-[170px]' : 'opacity-0 max-w-0 pointer-events-none'}`}>
              <span className="text-white font-mono font-black text-[15px] uppercase tracking-wider block leading-tight whitespace-nowrap">
                OPENTASK
              </span>
              <span className="text-neutral-400 font-mono text-[9px] uppercase tracking-widest block whitespace-nowrap">
                // COMMAND ROOT
              </span>
            </div>
          </div>

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
                  className={`h-11 rounded-none border-2 transition-all duration-75 relative flex items-center overflow-hidden ${
                    isActive
                      ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                      : 'bg-[#141619] text-neutral-400 border-neutral-800 hover:border-white hover:text-white hover:shadow-[2px_2px_0px_0px_#000000]'
                  }`}
                >
                  <div className="w-10 h-full flex items-center justify-center shrink-0 relative">
                    <Icon size={19} strokeWidth={2.5} />
                    {hasUnread && (
                      <div className="absolute top-1 right-0.5 min-w-[16px] h-[16px] bg-[#FF3333] text-white border-2 border-black rounded-none flex items-center justify-center text-[8px] font-mono font-black px-0.5 shadow-[1px_1px_0px_0px_#000000]">
                        {alerts.length > 99 ? '99+' : alerts.length}
                      </div>
                    )}
                  </div>
                  <div className={`overflow-hidden transition-all duration-200 pl-1.5 ${isHovered ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'}`}>
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
            <button
              onClick={onOpenSettings}
              title="System Settings"
              className="h-11 w-full rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <Settings size={18} strokeWidth={2.5} />
              </div>
              <div className={`overflow-hidden transition-all duration-200 pl-1.5 ${isHovered ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'}`}>
                <span className="text-[11px] font-mono font-black tracking-wider uppercase text-neutral-300 whitespace-nowrap block">
                  SETTINGS
                </span>
              </div>
            </button>

            <button
              onClick={() => setIsSignOutModalOpen(true)}
              title={`Sign out (${displayName})`}
              className="h-11 w-full rounded-none bg-[#1E2227] border-2 border-black text-white hover:bg-[#FF3333] hover:text-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] flex items-center overflow-hidden"
            >
              <div className="w-10 h-full flex items-center justify-center shrink-0">
                <div className="w-6 h-6 rounded-none bg-black/40 border border-neutral-700 flex items-center justify-center font-mono text-[10px] font-black shrink-0">
                  {initials || <LogOut size={12} />}
                </div>
              </div>
              <div className={`overflow-hidden transition-all duration-200 pl-1.5 ${isHovered ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0 pointer-events-none'}`}>
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
