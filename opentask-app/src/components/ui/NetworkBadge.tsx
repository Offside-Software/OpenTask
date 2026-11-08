import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Wifi, WifiOff, Server, Database, RefreshCw, ChevronDown, Activity } from 'lucide-react';
import { resolveApiUrl } from '../../services/apiClient';
import { cn } from '@/lib/utils';

interface HealthData {
  status: string;
  service: string;
  database?: string;
  db_latency_ms?: number;
}

export interface NetworkBadgeProps {
  isCollapsed?: boolean;
  className?: string;
}

export const NetworkBadge: React.FC<NetworkBadgeProps> = ({ isCollapsed = false, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [apiStatus, setApiStatus] = useState<'connected' | 'degraded' | 'disconnected' | 'checking'>('checking');
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [roundtripLatency, setRoundtripLatency] = useState<number | null>(null);
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const checkHealth = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setApiStatus('disconnected');
      setDbStatus('unknown');
      setRoundtripLatency(null);
      setDbLatency(null);
      setLastChecked(new Date());
      return;
    }

    setIsOnline(true);
    setIsPinging(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const startTime = performance.now();
    try {
      const url = resolveApiUrl('/health');
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
      });

      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);
      setRoundtripLatency(latency);

      if (response.ok) {
        const data: Partial<HealthData> = await response.json().catch(() => ({}));
        setApiStatus(data.status === 'healthy' ? 'connected' : 'degraded');

        if (data.database === 'connected') {
          setDbStatus('connected');
          setDbLatency(typeof data.db_latency_ms === 'number' ? data.db_latency_ms : null);
        } else if (data.database === 'disconnected') {
          setDbStatus('disconnected');
          setDbLatency(typeof data.db_latency_ms === 'number' ? data.db_latency_ms : null);
        } else {
          try {
            const dbT0 = performance.now();
            const dbCheck = await fetch(resolveApiUrl('/projects'), {
              cache: 'no-store',
              signal: controller.signal,
            });
            const dbT1 = performance.now();
            if (dbCheck.ok) {
              setDbStatus('connected');
              setDbLatency(Math.round(dbT1 - dbT0));
            } else {
              setDbStatus('disconnected');
              setDbLatency(null);
            }
          } catch {
            setDbStatus('disconnected');
            setDbLatency(null);
          }
        }
      } else {
        const data: Partial<HealthData> = await response.json().catch(() => ({}));
        setApiStatus('degraded');
        setDbStatus(data?.database === 'connected' ? 'connected' : 'disconnected');
        setDbLatency(typeof data?.db_latency_ms === 'number' ? data.db_latency_ms : null);
      }
    } catch {
      setApiStatus('disconnected');
      setDbStatus('unknown');
      setRoundtripLatency(null);
      setDbLatency(null);
    } finally {
      clearTimeout(timeoutId);
      setIsPinging(false);
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);

    const handleOnline = () => {
      setIsOnline(true);
      checkHealth();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setApiStatus('disconnected');
      setDbStatus('unknown');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkHealth]);

  const updatePopoverPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 360;

    if (isCollapsed) {
      const left = rect.right + 10;
      let bottom = window.innerHeight - rect.bottom;
      if (bottom + popoverHeight > window.innerHeight) {
        bottom = 16;
      }
      setPopoverStyle({
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(Math.max(12, bottom))}px`,
        width: `${popoverWidth}px`,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 9999,
      });
    } else {
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12));
      const bottom = Math.max(12, window.innerHeight - rect.top + 6);
      setPopoverStyle({
        position: 'fixed',
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(bottom)}px`,
        width: `${popoverWidth}px`,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 9999,
      });
    }
  }, [isCollapsed]);

  const toggleOpen = () => {
    if (!isOpen) {
      updatePopoverPosition();
    }
    setIsOpen(prev => !prev);
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePopoverPosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleResize = () => {
      updatePopoverPosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [isOpen, updatePopoverPosition]);

  const isHealthy = isOnline && apiStatus === 'connected' && dbStatus === 'connected';
  const isDegraded = isOnline && (apiStatus === 'degraded' || (apiStatus === 'connected' && dbStatus !== 'connected'));

  const getStatusLabel = () => {
    if (!isOnline) return 'Offline';
    if (apiStatus === 'disconnected') return 'Disconnected';
    if (dbStatus === 'disconnected') return 'DB Offline';
    if (isDegraded) return 'Degraded';
    return 'Online';
  };

  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return 'text-muted-foreground';
    if (ms < 100) return 'text-emerald-500';
    if (ms < 300) return 'text-amber-500';
    return 'text-destructive';
  };

  return (
    <>
      {/* Sidebar Action Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        title={`System Telemetry: ${getStatusLabel()} (${roundtripLatency !== null ? `${roundtripLatency}ms` : '--'})`}
        className={cn(
          "h-9 w-full rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer flex items-center px-2 text-xs font-medium relative group select-none",
          isOpen && "bg-sidebar-accent text-sidebar-foreground",
          className
        )}
      >
        <div className="w-6 h-full flex items-center justify-center shrink-0 relative">
          <Activity
            size={15}
            className={cn(
              isHealthy
                ? "text-emerald-500"
                : isDegraded
                ? "text-amber-500"
                : "text-destructive"
            )}
          />
          <span className="absolute top-1 right-0.5 flex h-2 w-2">
            {isHealthy && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex rounded-full h-2 w-2 border border-sidebar",
                isHealthy
                  ? "bg-emerald-500"
                  : isDegraded
                  ? "bg-amber-500"
                  : "bg-destructive"
              )}
            />
          </span>
        </div>

        {!isCollapsed && (
          <div className="ml-2.5 flex items-center justify-between flex-1 min-w-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="truncate">System</span>
              <span
                className={cn(
                  "text-[9px] font-semibold px-1.5 py-0.2 rounded-full leading-tight border",
                  isHealthy
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : isDegraded
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-destructive/10 text-destructive border-destructive/20"
                )}
              >
                {getStatusLabel()}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-1">
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-md font-mono text-[10px] font-semibold bg-muted",
                  getLatencyColor(roundtripLatency)
                )}
              >
                {roundtripLatency !== null ? `${roundtripLatency}ms` : '--'}
              </span>
              <ChevronDown
                size={12}
                className={cn(
                  "text-muted-foreground transition-transform duration-150 shrink-0",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </div>
        )}
      </button>

      {/* Popover Telemetry HUD rendered in Body via Portal */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            style={popoverStyle}
            className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-4 select-none animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/70">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  System Telemetry
                </span>
              </div>
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded-full border",
                  isHealthy
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    : isDegraded
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-destructive/15 text-destructive border-destructive/30"
                )}
              >
                {isHealthy ? 'Normal' : isDegraded ? 'Degraded' : 'Offline'}
              </span>
            </div>

            {/* Details List */}
            <div className="space-y-2 text-xs">
              {/* 1. Client Network */}
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/30">
                <div className="flex items-center gap-2">
                  {isOnline ? (
                    <Wifi size={14} className="text-emerald-500" />
                  ) : (
                    <WifiOff size={14} className="text-destructive" />
                  )}
                  <span className="font-medium text-foreground">Browser Link</span>
                </div>
                <span className={cn("font-medium", isOnline ? "text-emerald-500" : "text-destructive")}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              {/* 2. API Gateway */}
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Server
                    size={14}
                    className={
                      apiStatus === 'connected'
                        ? "text-emerald-500"
                        : apiStatus === 'degraded'
                        ? "text-amber-500"
                        : "text-destructive"
                    }
                  />
                  <span className="font-medium text-foreground">API Server</span>
                </div>
                <span
                  className={cn(
                    "font-medium",
                    apiStatus === 'connected'
                      ? "text-emerald-500"
                      : apiStatus === 'degraded'
                      ? "text-amber-500"
                      : "text-destructive"
                  )}
                >
                  {apiStatus === 'connected' ? 'Connected' : apiStatus === 'degraded' ? 'Degraded' : 'Down'}
                </span>
              </div>

              {/* 3. Database Connection */}
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Database
                    size={14}
                    className={
                      dbStatus === 'connected'
                        ? "text-emerald-500"
                        : "text-destructive"
                    }
                  />
                  <span className="font-medium text-foreground">PostgreSQL</span>
                </div>
                <span
                  className={cn(
                    "font-medium",
                    dbStatus === 'connected'
                      ? "text-emerald-500"
                      : dbStatus === 'disconnected'
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {dbStatus === 'connected' ? 'Connected' : dbStatus === 'disconnected' ? 'Disconnected' : 'Unknown'}
                </span>
              </div>

              {/* 4. Roundtrip Latency & DB Ping */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30">
                  <div className="text-[10px] font-medium text-muted-foreground">
                    Roundtrip Ping
                  </div>
                  <div className={cn("text-sm font-semibold font-mono mt-0.5", getLatencyColor(roundtripLatency))}>
                    {roundtripLatency !== null ? `${roundtripLatency}ms` : '--'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30">
                  <div className="text-[10px] font-medium text-muted-foreground">
                    DB Query Latency
                  </div>
                  <div className={cn("text-sm font-semibold font-mono mt-0.5", getLatencyColor(dbLatency))}>
                    {dbLatency !== null ? `${dbLatency}ms` : '--'}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with Refresh button */}
            <div className="mt-3 pt-3 border-t border-border/70 flex items-center justify-between text-xs">
              <span className="text-[11px] text-muted-foreground">
                {lastChecked ? `Checked ${lastChecked.toLocaleTimeString()}` : 'Checking…'}
              </span>
              <button
                type="button"
                onClick={checkHealth}
                disabled={isPinging}
                className="px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={11} className={isPinging ? 'animate-spin' : ''} />
                <span>{isPinging ? 'Pinging…' : 'Ping now'}</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
