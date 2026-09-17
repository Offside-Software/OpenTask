import { LayoutDashboard, Briefcase, Bell, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { getDisplayName } from '../../auth/displayName';
import logo from '../../assets/logo.png';
import { useAlerts } from '../../controllers/useAlerts';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'DASH', icon: LayoutDashboard },
  { id: 'workspaces', label: 'WORK', icon: Briefcase },
  { id: 'notifications', label: 'ALRT', icon: Bell },
];

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { alerts } = useAlerts();

  const currentPage = location.pathname.split('/')[1] || 'dashboard';

  const initials = getDisplayName(user!)
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="w-[84px] border-r-2 border-black flex flex-col items-center py-5 bg-[#0C0D0E] z-40 flex-shrink-0 relative select-none">
      {/* Brutalist Brand Badge */}
      <div
        className="w-12 h-12 rounded-none border-2 border-black bg-[#FFE600] flex items-center justify-center mb-7 cursor-pointer shadow-[3px_3px_0px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform"
        onClick={() => navigate('/dashboard')}
        title="OpenTask Root"
      >
        <img src={logo} alt="OpenTask Logo" className="w-8 h-8 object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-3.5 w-full px-2.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = currentPage === id || (id === 'workspaces' && currentPage === 'projects');
          const hasUnread = id === 'notifications' && alerts.length > 0;
          return (
            <Link
              key={id}
              to={`/${id}`}
              title={label}
              className={`flex flex-col items-center justify-center p-2.5 rounded-none border-2 transition-all duration-75 relative ${
                isActive
                  ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                  : 'bg-[#141619] text-neutral-400 border-neutral-800 hover:border-white hover:text-white hover:shadow-[2px_2px_0px_0px_#000000]'
              }`}
            >
              <div className="relative">
                <Icon size={20} strokeWidth={2.5} />
                {hasUnread && (
                  <div className="absolute -top-2.5 -right-2.5 min-w-[18px] h-[18px] bg-[#FF3333] text-white border-2 border-black rounded-none flex items-center justify-center text-[9px] font-mono font-black px-0.5 shadow-[1px_1px_0px_0px_#000000]">
                    {alerts.length > 99 ? '99+' : alerts.length}
                  </div>
                )}
              </div>
              <span className="text-[9px] font-mono font-bold mt-1 tracking-wider uppercase">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="mt-auto w-full flex flex-col gap-3 items-center px-2.5">
        <button
          onClick={onOpenSettings}
          title="System Settings"
          className="w-10 h-10 rounded-none bg-[#141619] border-2 border-neutral-800 text-neutral-400 hover:text-white hover:border-white flex items-center justify-center transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <Settings size={18} strokeWidth={2.5} />
        </button>

        <button
          onClick={logout}
          title={`Sign out (${getDisplayName(user!)})`}
          className="w-10 h-10 rounded-none bg-[#1E2227] border-2 border-black flex items-center justify-center font-mono text-[11px] font-black text-white hover:bg-[#FF3333] hover:text-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px]"
        >
          {initials || <LogOut size={14} />}
        </button>
      </div>
    </aside>
  );
}
