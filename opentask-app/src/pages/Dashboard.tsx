import React from 'react';
import {
  Calendar,
  Search,
  Zap,
  MoreHorizontal,
  Bell,
  ArrowUpRight
} from 'lucide-react';
import { SurfaceCard } from '../design-system/SurfaceCard';
import { Button } from '../design-system/Button';
import { UrgentActions } from '../components/dashboard/UrgentActions';
import { MyQueue } from '../components/dashboard/MyQueue';
import { CriticalWatchlist } from '../components/dashboard/CriticalWatchlist';
import { useAuth } from '../auth/useAuth';
import { getDisplayName } from '../auth/displayName';
import { useNavigate } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const displayName = user ? getDisplayName(user) : 'OPERATOR';
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const currentMonthDays = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, isCurrent: true }));
  const nextMonthDays = Array.from({ length: 4 }, (_, i) => ({ day: i + 1, isCurrent: false }));
  const calendarDays = [...currentMonthDays, ...nextMonthDays];

  const getEvents = (day: number) => {
    if (day === 5) return [{ color: 'bg-[#00E5FF]', title: 'Sprint Planning' }];
    if (day === 12) return [{ color: 'bg-[#FF3333]', title: 'Hotfix Deployment' }, { color: 'bg-[#00FF66]', title: 'Release v1.2' }];
    if (day === 24) return [{ color: 'bg-[#FFE600]', title: 'Sync Meeting' }, { color: 'bg-[#00FF66]', title: 'Client Demo' }];
    if (day === 29) return [{ color: 'bg-[#FF5500]', title: 'Database Migration' }];
    return [];
  };

  const handleEventNavigation = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate('/projects/1');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 max-w-[1600px] mx-auto w-full select-none">
      {/* Header & Banner */}
      <div className="flex flex-col gap-5">
        <div className="flex justify-between items-end flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-2 px-2 py-0.5 bg-[#FFE600] text-black border border-black font-mono text-[10px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000]">
              <span className="w-2 h-2 bg-black animate-pulse" /> DEV OPS // PERSONAL DASHBOARD
            </div>
            <h1 className="text-[28px] sm:text-[34px] font-black text-white uppercase tracking-tight font-mono">
              OPERATOR: {displayName}
            </h1>
            <p className="text-[12px] font-mono text-neutral-400 mt-0.5 uppercase tracking-wider">
              [SYSTEM STATUS: OPERATIONAL] • WORKLOAD BALANCED
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} strokeWidth={2.5} />
              <input 
                placeholder="SEARCH REPO / TASKS..." 
                className="bg-[#141619] border-2 border-neutral-700 text-white rounded-none pl-10 pr-4 py-2 font-mono text-[11px] w-64 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000]" 
              />
            </div>
            <button className="p-2.5 rounded-none bg-[#141619] border-2 border-neutral-700 text-neutral-300 hover:text-black hover:bg-[#FFE600] hover:border-black transition-colors shadow-[2px_2px_0px_0px_#000000] cursor-pointer active:translate-x-[1px] active:translate-y-[1px]">
              <Bell size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Action Banner (Brutalist Alert Ribbon) */}
        <div className="bg-[#141619] border-2 border-black rounded-none p-5 flex items-center justify-between flex-wrap gap-4 shadow-[5px_5px_0px_0px_#000000]">
          <div className="flex items-center gap-4">
            <div className="bg-[#FFE600] text-black border-2 border-black p-2.5 rounded-none shadow-[2px_2px_0px_0px_#000000] flex-shrink-0">
              <Zap size={22} strokeWidth={3} />
            </div>
            <div>
              <h4 className="text-white font-bold text-[14px] uppercase tracking-wide">
                MEETING <span className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700 font-mono">SPRINT REVIEW</span> HAS NO AGENDA. GENERATE VIA AI?
              </h4>
              <p className="text-neutral-400 font-mono text-[10px] mt-1 uppercase font-bold tracking-wider">
                // AGENT: OPENTASK MOM PARSER • STANDBY
              </p>
            </div>
          </div>
          <Button variant="primary" size="md">GENERATE AGENDA</Button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Calendar - Left Column */}
        <div className="xl:col-span-8 flex flex-col h-full relative z-10">
          <SurfaceCard 
            title="TIMELINE SYNC" 
            subtitle="SCHEDULED RELEASES & COMMIT TARGETS" 
            icon={Calendar} 
            className="h-full flex flex-col" 
            rightElement={<MoreHorizontal className="text-neutral-500 cursor-pointer" size={18} />}
          >
            <div className="grid grid-cols-7 gap-px bg-black border-2 border-black shadow-[3px_3px_0px_0px_#000000] flex-1">
              {days.map((d, i) => (
                <div key={`day-label-${i}`} className="bg-[#1E2227] py-2.5 text-center text-[10px] text-white font-mono font-bold uppercase tracking-wider border-b border-black">
                  {d}
                </div>
              ))}
              {calendarDays.map((d, i) => {
                const events = d.isCurrent ? getEvents(d.day) : [];
                return (
                  <div 
                    key={`cal-day-${i}`} 
                    className={`bg-[#141619] p-2.5 min-h-[90px] relative group hover:bg-[#1E2227] transition-colors flex flex-col ${
                      events.length > 0 ? 'cursor-pointer hover:z-[60]' : ''
                    }`}
                  >
                    <span className={`text-[12px] font-mono font-bold ${
                      d.isCurrent && d.day === 24 
                        ? 'text-black bg-[#00FF66] px-1 w-fit border border-black' 
                        : d.isCurrent 
                        ? 'text-white' 
                        : 'text-neutral-600'
                    }`}>
                      {d.day < 10 ? `0${d.day}` : d.day}
                    </span>

                    <div className="mt-auto flex flex-col gap-1 w-full pb-1">
                      {events.length > 0 && (
                        <div className="flex gap-1 w-full">
                          {events.map((ev, idx) => (
                            <div key={idx} className={`h-2 flex-1 rounded-none border border-black ${ev.color}`} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Tooltip */}
                    {events.length > 0 && (
                      <div className="absolute bottom-[100%] left-1/2 -translate-x-1/2 pb-2 hidden group-hover:block z-[60] w-56">
                        <div className="bg-[#1E2227] border-2 border-black rounded-none p-2 shadow-[4px_4px_0px_0px_#000000]">
                          <div className="text-[10px] text-[#FFE600] font-mono uppercase font-bold mb-1.5 px-1">
                            // EVENTS DAY {d.day}
                          </div>
                          {events.map((ev, idx) => (
                            <div 
                              key={idx} 
                              onClick={handleEventNavigation} 
                              className="flex items-center justify-between gap-2 p-1.5 hover:bg-black rounded-none cursor-pointer transition-colors border border-transparent hover:border-neutral-700"
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-none border border-black ${ev.color}`} />
                                <span className="text-white font-mono text-[11px] font-semibold">{ev.title}</span>
                              </div>
                              <ArrowUpRight size={12} className="text-neutral-400" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SurfaceCard>
        </div>

        {/* Action Columns - Right Column */}
        <div className="xl:col-span-4 space-y-6 flex flex-col min-h-0 relative z-0">
          <UrgentActions className="flex-1 min-h-0" onNavigateProject={(id) => navigate(`/projects/${id}`)} />
          <MyQueue className="flex-1 min-h-0" />
        </div>
      </div>

      {/* Critical Watchlist - Bottom Row */}
      <CriticalWatchlist onNavigate={(id) => navigate(`/projects/${id}`)} />
    </div>
  );
};
