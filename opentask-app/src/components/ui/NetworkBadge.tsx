import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Wifi, WifiOff, Server, Database, RefreshCw, ChevronDown, Activity } from 'lucide-react';
import { resolveApiUrl } from '../../services/apiClient';
import { cn } from '@/lib/utils';

interface HealthData {
  status: string;
  service: string;
  database?: string;
  db_latency_ms?: number;
}

export const NetworkBadge: React.FC = () => {
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const isHealthy = isOnline && apiStatus === 'connected' && dbStatus === 'connected';
  const isDegraded = isOnline && (apiStatus === 'degraded' || (apiStatus === 'connected' && dbStatus !== 'connected'));
  const isDown = !isOnline || apiStatus === 'disconnected';

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
    <div ref={dropdownRef} className="fixed top-3.5 right-4 z-40 sm:right-6 select-none">
      {/* Trigger Button: Status Dot + Label + Live Latency */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Toggle system telemetry"
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-card/80 hover:bg-muted text-foreground transition-all cursor-pointer shadow-xs backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          isDown ? "border-destructive/30" : isDegraded ? "border-amber-500/30" : "border-border"
        )}
      >
        {/* Animated Status Dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          {isHealthy && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
          )}
          <span
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              isHealthy
                ? "bg-emerald-500"
                : isDegraded
                ? "bg-amber-500"
                : "bg-destructive"
            )}
          />
        </span>

        {/* Primary Status Text */}
        <span className="text-xs font-medium text-foreground">
          {getStatusLabel()}
        </span>

        {/* Live Latency Chip */}
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
      </button>

      {/* Popover Telemetry HUD */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-4 z-50 animate-in fade-in zoom-in-95 duration-100">
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
        </div>
      )}
    </div>
  );
};
