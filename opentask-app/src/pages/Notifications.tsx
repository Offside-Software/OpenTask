import React, { useState } from 'react';
import { Bell, Clock, CheckCircle2, ArrowRight, Sparkles, AlertTriangle, X, ExternalLink, Radio, Send, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/Badge';
import { useAlerts } from '../controllers/useAlerts';
import { useProjects } from '../controllers/useProjects';
import { usePushNotifications } from '../controllers/usePushNotifications';
import { useAuth } from '../auth/useAuth';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import type { Alert } from '../models';

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dbUserId = user?.db_user?.id;
  const { alerts, loading, loadingMore, hasMore, loadMore, resolveAlert, refetch } = useAlerts({
    userId: dbUserId,
    includeResolved: true,
    pageSize: 20,
  });
  const { isSupported, permission, loading: pushLoading, subscribe, sendTestAlert } = usePushNotifications();
  const { leadProjects, collaboratingProjects } = useProjects();
  const allProjects = [...leadProjects, ...collaboratingProjects];

  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px', threshold: 0.1 }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

  const getProjectName = (id?: number | string | null) => {
    if (!id) return 'SYSTEM // DISPATCH';
    return allProjects.find(p => String(p.id) === String(id))?.name || `Project #${id}`;
  };

  const getTimeAgo = (dateStr: string) => {
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / (1000 * 60));
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const handleNavigateToProject = (alert: Alert) => {
    if (alert.project_id) {
      if (alert.context_id) {
        navigate(`/projects/${alert.project_id}?taskId=${alert.context_id}`);
      } else {
        navigate(`/projects/${alert.project_id}`);
      }
    }
    setSelectedAlert(null);
  };

  const handleSendTestAlert = async () => {
    const res = await sendTestAlert();
    if (res) {
      void refetch(true);
    }
  };

  const getAlertIcon = (type?: string) => {
    if (type === 'DRAFT_APPROVAL') return <Sparkles size={22} />;
    if (type === 'TASK_ASSIGNED' || type === 'TASK_COMPLETED') return <CheckCircle2 size={22} />;
    if (type === 'TASK_UNASSIGNED' || type === 'TASK_REOPENED') return <AlertTriangle size={22} />;
    if (type === 'PR_REVIEWED') return <Sparkles size={22} />;
    if (type === 'SYSTEM_TEST') return <Bell size={22} />;
    return <AlertTriangle size={22} />;
  };

  const getAlertColors = (type?: string, severity?: string) => {
    if (type === 'DRAFT_APPROVAL') return {
      bg: 'bg-[#FFE600]', border: 'border-black', text: 'text-black',
      headerBg: 'bg-[#FFE600]/15'
    };
    if (type === 'TASK_ASSIGNED' || type === 'TASK_COMPLETED') return {
      bg: 'bg-[#22C55E]', border: 'border-black', text: 'text-black',
      headerBg: 'bg-[#22C55E]/15'
    };
    if (type === 'TASK_UNASSIGNED' || type === 'TASK_REOPENED') return {
      bg: 'bg-[#F97316]', border: 'border-black', text: 'text-black',
      headerBg: 'bg-[#F97316]/15'
    };
    if (type === 'PR_REVIEWED') return {
      bg: 'bg-[#8B5CF6]', border: 'border-black', text: 'text-white',
      headerBg: 'bg-[#8B5CF6]/15'
    };
    if (type === 'SYSTEM_TEST') return {
      bg: 'bg-[#FFE600]', border: 'border-black', text: 'text-black',
      headerBg: 'bg-[#FFE600]/15'
    };
    if (severity === 'critical') return {
      bg: 'bg-[#EF4444]', border: 'border-black', text: 'text-white',
      headerBg: 'bg-[#EF4444]/15'
    };
    return {
      bg: 'bg-[#F59E0B]', border: 'border-black', text: 'text-black',
      headerBg: 'bg-[#F59E0B]/15'
    };
  };

  const displayed = filter === 'unread' ? alerts.filter(a => !a.is_resolved) : alerts;

  return (
    <div className="max-w-[1000px] mx-auto animate-in fade-in duration-200 w-full select-none">
      {/* Header */}
      <div className="mb-8 border-b-2 border-neutral-800 pb-6 flex justify-between items-end flex-wrap gap-4">
        <div>
          <span className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700 font-mono text-[10px] font-black uppercase tracking-wider mb-2 inline-block">
            // SYSTEM DISPATCH • ALERTS
          </span>
          <h1 className="text-[32px] font-black text-white font-mono uppercase tracking-tight leading-tight">NOTIFICATIONS</h1>
          <p className="text-[12px] font-mono text-neutral-400 uppercase tracking-wider mt-1">// REAL-TIME PROJECT EVENT LOGS</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="px-3 py-2 rounded-none text-[11px] font-mono font-black uppercase tracking-wider transition-all duration-75 border-2 border-black bg-[#141619] text-neutral-400 hover:text-white hover:border-white shadow-[2px_2px_0px_0px_#000000] cursor-pointer flex items-center gap-1.5 active:translate-x-[1px] active:translate-y-[1px]"
            title="Refresh Notifications"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>REFRESH</span>
          </button>
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-none text-[11px] font-mono font-black uppercase tracking-wider transition-all duration-75 border-2 border-black cursor-pointer ${filter === f
                  ? 'bg-[#FFE600] text-black shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px]'
                  : 'bg-[#141619] text-neutral-400 hover:text-white hover:border-white shadow-[2px_2px_0px_0px_#000000]'
                }`}
            >
              {f === 'all' ? '// ALL LOGS' : '// UNREAD ONLY'}
            </button>
          ))}
        </div>
      </div>

      {/* Web Push Notification Control Card */}
      <div className="mb-6 p-4 bg-[#121417] border-2 border-black rounded-none shadow-[4px_4px_0px_0px_#000000] flex items-center justify-between flex-wrap gap-4 font-mono">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-black text-[#FFE600] border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_#000000] flex-shrink-0">
            <Radio size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-white font-black text-[13px] uppercase tracking-wider">// WEB PUSH DISPATCH ENGINE</h3>
              <span className={`px-2 py-0.5 text-[9px] font-black uppercase border border-black ${permission === 'granted'
                  ? 'bg-[#22C55E] text-black'
                  : permission === 'denied'
                    ? 'bg-[#EF4444] text-white'
                    : 'bg-[#FFE600] text-black'
                }`}>
                {permission === 'granted' ? 'ACTIVE // GRANTED' : permission === 'denied' ? 'BLOCKED' : 'STANDBY'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {permission === 'granted'
                ? 'Browser device registered for real-time task assignment alerts.'
                : 'Enable browser push notifications to receive instant assignee dispatches.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {permission !== 'granted' ? (
            <button
              onClick={subscribe}
              disabled={pushLoading || !isSupported}
              className="px-4 py-2 bg-[#FFE600] hover:bg-[#ffe81a] text-black border-2 border-black text-[11px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Bell size={13} strokeWidth={3} />
              <span>{pushLoading ? 'ENABLING...' : 'ENABLE WEB PUSH'}</span>
            </button>
          ) : (
            <button
              onClick={handleSendTestAlert}
              disabled={pushLoading}
              className="px-4 py-2 bg-[#141619] hover:bg-[#FFE600] text-neutral-300 hover:text-black border-2 border-black text-[11px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send size={13} strokeWidth={2.5} />
              <span>{pushLoading ? 'DISPATCHING...' : 'SEND TEST ALERT'}</span>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <LoadingScreen
              fullscreen={false}
              message="RETRIEVING DISPATCH UPDATES…"
              subtext="// SYNCHRONIZING REAL-TIME EVENT STREAM"
            />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 flex flex-col items-center gap-4 border-2 border-dashed border-black bg-[#121417] rounded-none shadow-[4px_4px_0px_0px_#000000]">
            <div className="w-14 h-14 rounded-none bg-black border-2 border-black text-[#FFE600] flex items-center justify-center shadow-[2px_2px_0px_0px_#000000]">
              <Bell size={28} strokeWidth={2.5} />
            </div>
            <p className="text-neutral-400 font-mono text-[13px] uppercase tracking-wider">// NO NOTIFICATIONS RECORDED.</p>
          </div>
        ) : (
          displayed.map(alert => {
            const colors = getAlertColors(alert.type, alert.severity);
            return (
              <div
                key={alert.id!}
                className={`bg-[#121417] border-2 border-black p-5 rounded-none flex gap-5 items-center hover:translate-x-[-2px] hover:translate-y-[-2px] shadow-[4px_4px_0px_0px_#000000] hover:shadow-[6px_6px_0px_0px_#000000] active:translate-x-[0px] active:translate-y-[0px] active:shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer group ${alert.is_resolved ? 'opacity-70' : ''}`}
                onClick={() => {
                  if (!alert.is_resolved) resolveAlert(alert.id!);
                  setSelectedAlert(alert);
                }}
              >
                <div className={`w-12 h-12 rounded-none border-2 flex items-center justify-center flex-shrink-0 shadow-[2px_2px_0px_0px_#000000] ${colors.bg} ${colors.border} ${colors.text}`}>
                  {getAlertIcon(alert.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge
                      variant={
                        alert.type === 'DRAFT_APPROVAL'
                          ? 'primary'
                          : (alert.type === 'TASK_ASSIGNED' || alert.type === 'TASK_COMPLETED')
                            ? 'success'
                            : alert.severity === 'critical'
                              ? 'critical'
                              : 'warning'
                      }
                      className="!py-0.5 !text-[8px] uppercase font-mono"
                    >
                      {alert.type?.replace('_', ' ')}
                    </Badge>
                    {alert.is_resolved && (
                      <span className="px-1.5 py-0.5 bg-neutral-800 text-neutral-400 text-[8px] font-mono font-bold uppercase border border-neutral-700">
                        RESOLVED
                      </span>
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono font-medium flex items-center gap-1">
                      <Clock size={10} /> {getTimeAgo(alert.created_at!)}
                    </span>
                    <span className="text-[#FFE600] font-mono text-[10px] font-bold uppercase tracking-wider">• {getProjectName(alert.project_id)}</span>
                  </div>
                  <h3 className="text-white font-mono font-black text-[15px] uppercase tracking-wide truncate group-hover:text-[#FFE600] transition-colors">{alert.title}</h3>
                  <p className="text-neutral-400 font-mono text-[12px] mt-0.5 line-clamp-1">{alert.description}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center">
                  {!alert.is_resolved && (
                    <button
                      onClick={e => { e.stopPropagation(); resolveAlert(alert.id!); }}
                      className="px-3 py-1.5 rounded-none border-2 border-black bg-[#1E2227] text-neutral-300 font-mono text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      Dismiss
                    </button>
                  )}
                  {alert.pr_url && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (!alert.is_resolved) resolveAlert(alert.id!);
                        window.open(alert.pr_url, '_blank', 'noopener,noreferrer');
                      }}
                      className="px-3 py-1.5 rounded-none border-2 border-black bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-mono text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] transition-all flex items-center gap-1 cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                      title="Open GitHub Pull Request in new tab"
                    >
                      <span>OPEN PR</span> <ExternalLink size={11} strokeWidth={2.5} />
                    </button>
                  )}
                  {alert.context_id && alert.project_id && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (!alert.is_resolved) resolveAlert(alert.id!);
                        navigate(`/projects/${alert.project_id}?taskId=${alert.context_id}`);
                      }}
                      className="px-3 py-1.5 rounded-none border-2 border-black bg-[#FFE600] text-black font-mono text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] transition-all flex items-center gap-1 cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                      title="Directly open task on project board"
                    >
                      <span>TASK</span> <ExternalLink size={11} strokeWidth={2.5} />
                    </button>
                  )}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (!alert.is_resolved) resolveAlert(alert.id!);
                      setSelectedAlert(alert);
                    }}
                    className="px-3 py-1.5 rounded-none border-2 border-black bg-[#141619] hover:bg-white text-neutral-300 hover:text-black font-mono text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] transition-all flex items-center gap-1.5 cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                  >
                    View <ArrowRight size={12} strokeWidth={3} />
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-4" />

        {loadingMore && (
          <div className="py-4 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#121417] border-2 border-black font-mono text-[11px] text-[#FFE600] uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000]">
              <RefreshCw size={13} className="animate-spin text-[#FFE600]" />
              <span>RETRIEVING NEXT 20 EVENT LOGS...</span>
            </div>
          </div>
        )}

        {!hasMore && displayed.length > 0 && !loading && (
          <div className="py-6 text-center font-mono text-[11px] text-neutral-500 uppercase tracking-widest border-t border-neutral-800">
            // END OF DISPATCH LOG STREAM • ALL EVENTS LOADED ({displayed.length} TOTAL)
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAlert && (() => {
        const colors = getAlertColors(selectedAlert.type, selectedAlert.severity);
        const isDraftApproval = selectedAlert.type === 'DRAFT_APPROVAL';
        return (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-none animate-in fade-in duration-100" onClick={() => setSelectedAlert(null)}>
            <div
              className="bg-[#121417] border-3 border-black rounded-none w-full max-w-lg shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 select-none"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className={`p-6 border-b-2 border-black flex items-start gap-4 ${colors.headerBg}`}>
                <div className={`p-3 rounded-none ${colors.bg} ${colors.border} border-2 ${colors.text} shadow-[2px_2px_0px_0px_#000000]`}>
                  {getAlertIcon(selectedAlert.type)}
                </div>
                <div className="flex-1 mt-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      variant={
                        isDraftApproval
                          ? 'primary'
                          : (selectedAlert.type === 'TASK_ASSIGNED' || selectedAlert.type === 'TASK_COMPLETED')
                            ? 'success'
                            : selectedAlert.severity === 'critical'
                              ? 'critical'
                              : 'warning'
                      }
                      className="uppercase font-mono"
                    >
                      {selectedAlert.type?.replace('_', ' ')}
                    </Badge>
                    <span className="text-neutral-400 font-mono text-[12px] font-bold uppercase tracking-wider">{getProjectName(selectedAlert.project_id)}</span>
                  </div>
                  <h2 className="text-white font-mono font-black text-[18px] uppercase tracking-wide leading-tight">{selectedAlert.title}</h2>
                </div>
                <button
                  onClick={() => setSelectedAlert(null)}
                  className="p-1.5 rounded-none bg-black border-2 border-black text-neutral-300 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer"
                >
                  <X size={18} strokeWidth={3} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6">
                <p className="text-neutral-300 font-mono text-[13px] leading-relaxed mb-6">{selectedAlert.description}</p>

                {isDraftApproval && (
                  <div className="bg-[#FFE600]/10 border-2 border-black rounded-none p-4 mb-6 shadow-[3px_3px_0px_0px_#000000]">
                    <h4 className="text-[#FFE600] font-mono text-[11px] font-black uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Sparkles size={14} /> // INSTRUCTIONS
                    </h4>
                    <p className="text-neutral-300 font-mono text-[12px] leading-relaxed">
                      Navigate to your project's <strong className="text-white uppercase font-bold">MoM & Meetings</strong> tab to review the extracted tasks and commit them to your project board.
                    </p>
                  </div>
                )}

                {(selectedAlert.suggested_actions?.length ?? 0) > 0 && (
                  <div className="bg-[#0E1012] rounded-none border-2 border-black p-4 mb-6 shadow-[3px_3px_0px_0px_#000000]">
                    <h4 className="text-white font-mono text-[11px] font-black uppercase tracking-wider mb-3">// SUGGESTED ACTIONS</h4>
                    <ul className="space-y-2">
                      {selectedAlert.suggested_actions!.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-3 font-mono text-[12px] text-neutral-300">
                          <span className="text-[#FFE600] font-black">→</span>
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Footer Actions */}
                <div className="flex gap-3 justify-end pt-2 border-t-2 border-neutral-800">
                  {!selectedAlert.is_resolved && (
                    <button
                      onClick={() => {
                        resolveAlert(selectedAlert.id!);
                        setSelectedAlert(null);
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-none border-2 border-black bg-[#1E2227] text-neutral-300 font-mono text-[12px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      <CheckCircle2 size={16} strokeWidth={2.5} /> Dismiss
                    </button>
                  )}
                  {selectedAlert.pr_url && (
                    <button
                      onClick={() => {
                        window.open(selectedAlert.pr_url, '_blank', 'noopener,noreferrer');
                      }}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-none border-2 border-black bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      <ExternalLink size={14} strokeWidth={2.5} /> Open Pull Request
                    </button>
                  )}
                  {selectedAlert.project_id && (
                    <button
                      onClick={() => handleNavigateToProject(selectedAlert)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-none border-2 border-black bg-[#FFE600] text-black font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      {selectedAlert.context_id ? (
                        <><ExternalLink size={14} strokeWidth={2.5} /> Open Task</>
                      ) : isDraftApproval ? (
                        <><Sparkles size={14} strokeWidth={2.5} /> Review Meeting Tasks</>
                      ) : (
                        <><ExternalLink size={14} strokeWidth={2.5} /> View Project</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

