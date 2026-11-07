import React, { useState } from 'react';
import { Bell, Clock, CheckCircle2, ArrowRight, Sparkles, AlertTriangle, ExternalLink, Radio, Send, RefreshCw, Monitor, BellOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { CloseButton } from '../design-system/CloseButton';
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
  const {
    isSupported,
    isDesktop,
    permission,
    loading: pushLoading,
    subscribe,
    unsubscribe,
    sendTestAlert,
  } = usePushNotifications();
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
    if (!id) return 'System Dispatch';
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
    if (type === 'DRAFT_APPROVAL') return <Sparkles size={20} />;
    if (type === 'TASK_ASSIGNED' || type === 'TASK_COMPLETED') return <CheckCircle2 size={20} />;
    if (type === 'TASK_UNASSIGNED' || type === 'TASK_REOPENED') return <AlertTriangle size={20} />;
    if (type === 'PR_REVIEWED') return <Sparkles size={20} />;
    if (type === 'SYSTEM_TEST') return <Bell size={20} />;
    return <AlertTriangle size={20} />;
  };

  const getAlertColors = (type?: string, severity?: string) => {
    if (type === 'DRAFT_APPROVAL') return {
      icon: 'bg-primary/10 text-primary border-primary/20',
      headerBg: 'bg-primary/5'
    };
    if (type === 'TASK_ASSIGNED' || type === 'TASK_COMPLETED') return {
      icon: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      headerBg: 'bg-emerald-500/5'
    };
    if (type === 'TASK_UNASSIGNED' || type === 'TASK_REOPENED') return {
      icon: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      headerBg: 'bg-amber-500/5'
    };
    if (type === 'PR_REVIEWED') return {
      icon: 'bg-primary/10 text-primary border-primary/20',
      headerBg: 'bg-primary/5'
    };
    if (type === 'SYSTEM_TEST') return {
      icon: 'bg-primary/10 text-primary border-primary/20',
      headerBg: 'bg-primary/5'
    };
    if (severity === 'critical') return {
      icon: 'bg-destructive/10 text-destructive border-destructive/20',
      headerBg: 'bg-destructive/5'
    };
    return {
      icon: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      headerBg: 'bg-amber-500/5'
    };
  };

  const displayed = filter === 'unread' ? alerts.filter(a => !a.is_resolved) : alerts;

  return (
    <div className="max-w-[1000px] mx-auto animate-in fade-in duration-200 w-full select-none">
      {/* Header */}
      <div className="mb-6 border-b border-border pb-5 flex justify-between items-end flex-wrap gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary mb-1 inline-block">
            System Dispatch
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-tight">Notifications</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Real-time project event logs and activity dispatches</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading}
            title="Refresh Notifications"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </Button>
          <div className="flex items-center border border-border bg-muted/40 p-0.5 rounded-lg">
            {(['all', 'unread'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${filter === f
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {f === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Push / Desktop Notification Control Card */}
      <div className="mb-6 p-4 bg-card border border-border rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center flex-shrink-0">
            {isDesktop ? <Monitor size={18} /> : <Radio size={18} />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-foreground font-semibold text-sm">
                {isDesktop ? 'Desktop Notification Engine' : 'Web Push Notification Engine'}
              </h3>
              <Badge
                variant={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'warning'}
                className="text-[10px]"
              >
                {permission === 'granted' ? 'Active' : permission === 'denied' ? 'Blocked' : 'Standby'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {permission === 'granted'
                ? (isDesktop
                    ? 'Native desktop notifications active. New task assignments & events pop up natively via OS.'
                    : 'Browser device registered for real-time task assignment alerts.')
                : permission === 'denied'
                  ? (isDesktop
                      ? 'Desktop notifications are blocked by system settings. Check your OS notification permissions.'
                      : 'Web push notifications are blocked in your browser settings.')
                  : (isDesktop
                      ? 'Enable native desktop notifications to receive instant OS alerts on task and project events.'
                      : 'Enable browser push notifications to receive instant assignee dispatches.')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {permission !== 'granted' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={subscribe}
              disabled={pushLoading || !isSupported}
            >
              <Bell size={13} />
              <span>{pushLoading ? 'Enabling...' : isDesktop ? 'Enable Desktop Alerts' : 'Enable Web Push'}</span>
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSendTestAlert}
                disabled={pushLoading}
              >
                <Send size={13} />
                <span>{pushLoading ? 'Dispatching...' : 'Send Test Alert'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={unsubscribe}
                disabled={pushLoading}
                title="Deactivate notifications"
              >
                <BellOff size={13} />
                <span>Deactivate</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <LoadingScreen
              fullscreen={false}
              message="Retrieving updates…"
              subtext="Synchronizing real-time event stream"
            />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16 flex flex-col items-center gap-3 border border-dashed border-border bg-card/50 rounded-xl shadow-xs">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <Bell size={22} />
            </div>
            <p className="text-muted-foreground text-xs font-medium">No notifications recorded.</p>
          </div>
        ) : (
          displayed.map(alert => {
            const colors = getAlertColors(alert.type, alert.severity);
            return (
              <div
                key={alert.id!}
                className={`bg-card border border-border p-4 rounded-xl flex gap-4 items-center hover:border-primary/40 shadow-xs transition-all cursor-pointer group ${alert.is_resolved ? 'opacity-65' : ''}`}
                onClick={() => {
                  if (!alert.is_resolved) resolveAlert(alert.id!);
                  setSelectedAlert(alert);
                }}
              >
                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
                  {getAlertIcon(alert.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge
                      variant={
                        alert.type === 'DRAFT_APPROVAL'
                          ? 'accent'
                          : (alert.type === 'TASK_ASSIGNED' || alert.type === 'TASK_COMPLETED')
                            ? 'success'
                            : alert.severity === 'critical'
                              ? 'danger'
                              : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {alert.type?.replace('_', ' ')}
                    </Badge>
                    {alert.is_resolved && (
                      <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] rounded font-medium border border-border">
                        Resolved
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                      <Clock size={11} /> {getTimeAgo(alert.created_at!)}
                    </span>
                    <span className="text-primary text-[11px] font-medium">• {getProjectName(alert.project_id)}</span>
                  </div>
                  <h3 className="text-foreground font-semibold text-sm truncate group-hover:text-primary transition-colors">{alert.title}</h3>
                  <p className="text-muted-foreground text-xs mt-0.5 line-clamp-1">{alert.description}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center">
                  {!alert.is_resolved && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={e => { e.stopPropagation(); resolveAlert(alert.id!); }}
                    >
                      Dismiss
                    </Button>
                  )}
                  {alert.pr_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={e => {
                        e.stopPropagation();
                        if (!alert.is_resolved) resolveAlert(alert.id!);
                        window.open(alert.pr_url, '_blank', 'noopener,noreferrer');
                      }}
                      title="Open GitHub Pull Request in new tab"
                    >
                      <span>PR</span> <ExternalLink size={12} />
                    </Button>
                  )}
                  {alert.context_id && alert.project_id && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={e => {
                        e.stopPropagation();
                        if (!alert.is_resolved) resolveAlert(alert.id!);
                        navigate(`/projects/${alert.project_id}?taskId=${alert.context_id}`);
                      }}
                      title="Directly open task on project board"
                    >
                      <span>Task</span> <ExternalLink size={12} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      if (!alert.is_resolved) resolveAlert(alert.id!);
                      setSelectedAlert(alert);
                    }}
                  >
                    <span>View</span> <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
            );
          })
        )}

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-4" />

        {loadingMore && (
          <div className="py-4 text-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-card border border-border rounded-lg text-xs text-primary shadow-xs">
              <RefreshCw size={13} className="animate-spin" />
              <span>Retrieving next events...</span>
            </div>
          </div>
        )}

        {!hasMore && displayed.length > 0 && !loading && (
          <div className="py-6 text-center text-xs text-muted-foreground border-t border-border">
            End of log stream • All {displayed.length} events loaded
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAlert && (() => {
        const colors = getAlertColors(selectedAlert.type, selectedAlert.severity);
        const isDraftApproval = selectedAlert.type === 'DRAFT_APPROVAL';
        return (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-100" onClick={() => setSelectedAlert(null)}>
            <div
              className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-lg shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 select-none"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className={`p-5 border-b border-border flex items-start gap-4 ${colors.headerBg}`}>
                <div className={`p-2.5 rounded-lg border flex-shrink-0 ${colors.icon}`}>
                  {getAlertIcon(selectedAlert.type)}
                </div>
                <div className="flex-1 mt-0.5 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge
                      variant={
                        isDraftApproval
                          ? 'accent'
                          : (selectedAlert.type === 'TASK_ASSIGNED' || selectedAlert.type === 'TASK_COMPLETED')
                            ? 'success'
                            : selectedAlert.severity === 'critical'
                              ? 'danger'
                              : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {selectedAlert.type?.replace('_', ' ')}
                    </Badge>
                    <span className="text-muted-foreground text-xs font-medium">{getProjectName(selectedAlert.project_id)}</span>
                  </div>
                  <h2 className="text-foreground font-semibold text-base leading-snug">{selectedAlert.title}</h2>
                </div>
                <CloseButton onClick={() => setSelectedAlert(null)} />
              </div>

              {/* Modal Body */}
              <div className="p-5">
                <p className="text-foreground text-xs leading-relaxed mb-5">{selectedAlert.description}</p>

                {isDraftApproval && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3.5 mb-5">
                    <h4 className="text-primary text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Sparkles size={13} /> Instructions
                    </h4>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Navigate to your project's <strong className="text-foreground font-medium">MoM & Meetings</strong> tab to review the extracted tasks and commit them to your project board.
                    </p>
                  </div>
                )}

                {(selectedAlert.suggested_actions?.length ?? 0) > 0 && (
                  <div className="bg-muted/30 rounded-lg border border-border p-3.5 mb-5">
                    <h4 className="text-foreground text-xs font-semibold mb-2">Suggested Actions</h4>
                    <ul className="space-y-1.5">
                      {selectedAlert.suggested_actions!.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="text-primary font-bold">→</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Footer Actions */}
                <div className="flex gap-2.5 justify-end pt-3 border-t border-border">
                  {!selectedAlert.is_resolved && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resolveAlert(selectedAlert.id!);
                        setSelectedAlert(null);
                      }}
                    >
                      <CheckCircle2 size={14} />
                      <span>Dismiss</span>
                    </Button>
                  )}
                  {selectedAlert.pr_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        window.open(selectedAlert.pr_url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>Open PR</span>
                    </Button>
                  )}
                  {selectedAlert.project_id && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleNavigateToProject(selectedAlert)}
                    >
                      {selectedAlert.context_id ? (
                        <><ExternalLink size={13} /> <span>Open Task</span></>
                      ) : isDraftApproval ? (
                        <><Sparkles size={13} /> <span>Review Meeting Tasks</span></>
                      ) : (
                        <><ExternalLink size={13} /> <span>View Project</span></>
                      )}
                    </Button>
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
