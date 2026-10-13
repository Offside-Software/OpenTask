import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Wifi, WifiOff, Server, Database, RefreshCw, ChevronDown, Activity } from 'lucide-react';
import { resolveApiUrl } from '../../services/apiClient';
import { useTheme } from '../../context/themeContext';

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
                    // If backend /health doesn't include an explicit database field yet (e.g. running previous build),
                    // verify database connectivity directly via lightweight /projects probe
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

    // Poll health every 10 seconds
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

    // Handle click outside & Escape to close dropdown
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

    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const isHealthy = isOnline && apiStatus === 'connected' && dbStatus === 'connected';
    const isDegraded = isOnline && (apiStatus === 'degraded' || (apiStatus === 'connected' && dbStatus !== 'connected'));
    const isDown = !isOnline || apiStatus === 'disconnected';

    // Badge Status Color
    const getBadgeBg = () => {
        if (isDown) {
            return isDark
                ? 'bg-[#181010] text-[#FF4D4D] border-2 border-black hover:bg-[#221414]'
                : 'bg-[#FEF2F2] text-[#DC2626] border-2 border-black hover:bg-[#FEE2E2]';
        }
        if (isDegraded) {
            return isDark
                ? 'bg-[#181610] text-[#FFE600] border-2 border-black hover:bg-[#232014]'
                : 'bg-[#FFFBEB] text-[#B45309] border-2 border-black hover:bg-[#FEF3C7]';
        }
        return isDark
            ? 'bg-[#0E1410] text-[#00FF66] border-2 border-black hover:bg-[#131C16]'
            : 'bg-[#F0FDF4] text-[#15803D] border-2 border-black hover:bg-[#DCFCE7]';
    };

    const getStatusLabel = () => {
        if (!isOnline) return 'OFFLINE';
        if (apiStatus === 'disconnected') return 'DISCONNECTED';
        if (dbStatus === 'disconnected') return 'DB OFFLINE';
        if (isDegraded) return 'DEGRADED';
        return 'ONLINE';
    };

    const getLatencyColor = (ms: number | null) => {
        if (ms === null) return 'text-neutral-500';
        if (ms < 100) return isDark ? 'text-[#00FF66]' : 'text-emerald-800';
        if (ms < 300) return isDark ? 'text-[#FFE600]' : 'text-amber-800';
        return isDark ? 'text-[#FF4D4D]' : 'text-red-800';
    };

    return (
        <div ref={dropdownRef} className="fixed top-3.5 right-4 z-40 sm:right-6 select-none font-mono">
            {/* Trigger Button: Shows Status Dot + Status Label + LIVE LATENCY */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                title="Click to toggle telemetry dashboard"
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-none shadow-[2px_2px_0px_0px_#000000] text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] ${getBadgeBg()}`}
            >
                {/* Animated Status Dot */}
                <span className="relative flex h-2 w-2 shrink-0">
                    {isHealthy && (
                        <span
                            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                isDark ? 'bg-[#00FF66]' : 'bg-[#16A34A]'
                            }`}
                        ></span>
                    )}
                    <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${
                            isHealthy
                                ? isDark ? 'bg-[#00FF66]' : 'bg-[#16A34A] border border-black'
                                : isDegraded
                                ? isDark ? 'bg-[#FFE600]' : 'bg-[#D97706] border border-black'
                                : isDark ? 'bg-[#FF3333]' : 'bg-[#DC2626] border border-black'
                        }`}
                    ></span>
                </span>

                {/* Primary Status Text */}
                <span
                    className={`font-mono font-black tracking-wider ${
                        isDark ? 'text-white' : 'text-neutral-900'
                    }`}
                >
                    {getStatusLabel()}
                </span>

                {/* Live Latency Chip directly on the badge */}
                <span
                    className={`px-1.5 py-0.5 font-mono text-[10px] font-black tracking-tight shrink-0 ${
                        isDark
                            ? 'bg-black border border-neutral-700'
                            : 'bg-white border-2 border-black shadow-[1px_1px_0px_0px_#000000]'
                    } ${getLatencyColor(roundtripLatency)}`}
                >
                    {roundtripLatency !== null ? `${roundtripLatency}ms` : '--'}
                </span>

                <ChevronDown
                    size={12}
                    strokeWidth={3}
                    className={`transition-transform duration-150 shrink-0 ${
                        isDark ? 'text-neutral-400' : 'text-neutral-800'
                    } ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {/* Popover Telemetry HUD */}
            {isOpen && (
                <div
                    className={`absolute right-0 mt-2 w-72 sm:w-80 border-2 border-black rounded-none shadow-[5px_5px_0px_0px_#000000] p-4 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                        isDark ? 'bg-[#121417] text-white' : 'bg-white text-neutral-900'
                    }`}
                >
                    {/* Header */}
                    <div
                        className={`flex items-center justify-between pb-2.5 mb-3 border-b-2 ${
                            isDark ? 'border-neutral-800' : 'border-black'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <Activity
                                size={14}
                                strokeWidth={3}
                                className={isDark ? 'text-[#FFE600]' : 'text-[#B45309]'}
                            />
                            <span
                                className={`text-[11px] font-mono font-black uppercase tracking-wider ${
                                    isDark ? 'text-white' : 'text-black'
                                }`}
                            >
                                // SYSTEM TELEMETRY
                            </span>
                        </div>
                        <span
                            className={`px-1.5 py-0.5 text-[9px] font-mono font-black uppercase tracking-wider border-2 border-black shadow-[1.5px_1.5px_0px_0px_#000000] ${
                                isHealthy
                                    ? 'bg-[#00FF66] text-black'
                                    : isDegraded
                                    ? 'bg-[#FFE600] text-black'
                                    : 'bg-[#FF3333] text-white'
                            }`}
                        >
                            {isHealthy ? 'ALL SYSTEMS NORMAL' : isDegraded ? 'PERFORMANCE DEGRADED' : 'OFFLINE'}
                        </span>
                    </div>

                    {/* Details List */}
                    <div className="space-y-2.5 text-[11px]">
                        {/* 1. Client Network */}
                        <div
                            className={`flex items-center justify-between p-2 rounded-none border-2 ${
                                isDark
                                    ? 'bg-[#0B0E14] border-neutral-800 text-neutral-300'
                                    : 'bg-[#F4F4F0] border-black text-neutral-900 shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                {isOnline ? (
                                    <Wifi
                                        size={13}
                                        strokeWidth={2.5}
                                        className={isDark ? 'text-[#00FF66]' : 'text-emerald-700'}
                                    />
                                ) : (
                                    <WifiOff
                                        size={13}
                                        strokeWidth={2.5}
                                        className={isDark ? 'text-[#FF3333]' : 'text-red-700'}
                                    />
                                )}
                                <span className={`font-mono font-black uppercase ${isDark ? 'text-neutral-300' : 'text-neutral-900'}`}>
                                    BROWSER LINK
                                </span>
                            </div>
                            <span
                                className={`font-mono font-black ${
                                    isOnline
                                        ? isDark ? 'text-[#00FF66]' : 'text-emerald-800'
                                        : isDark ? 'text-[#FF3333]' : 'text-red-800'
                                }`}
                            >
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                        </div>

                        {/* 2. API Gateway */}
                        <div
                            className={`flex items-center justify-between p-2 rounded-none border-2 ${
                                isDark
                                    ? 'bg-[#0B0E14] border-neutral-800 text-neutral-300'
                                    : 'bg-[#F4F4F0] border-black text-neutral-900 shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <Server
                                    size={13}
                                    strokeWidth={2.5}
                                    className={
                                        apiStatus === 'connected'
                                            ? isDark ? 'text-[#00FF66]' : 'text-emerald-700'
                                            : apiStatus === 'degraded'
                                            ? isDark ? 'text-[#FFE600]' : 'text-amber-700'
                                            : isDark ? 'text-[#FF3333]' : 'text-red-700'
                                    }
                                />
                                <span className={`font-mono font-black uppercase ${isDark ? 'text-neutral-300' : 'text-neutral-900'}`}>
                                    API (AXUM TOKIO)
                                </span>
                            </div>
                            <span
                                className={`font-mono font-black ${
                                    apiStatus === 'connected'
                                        ? isDark ? 'text-[#00FF66]' : 'text-emerald-800'
                                        : apiStatus === 'degraded'
                                        ? isDark ? 'text-[#FFE600]' : 'text-amber-800'
                                        : isDark ? 'text-[#FF3333]' : 'text-red-800'
                                }`}
                            >
                                {apiStatus === 'connected' ? 'CONNECTED' : apiStatus === 'degraded' ? 'DEGRADED' : 'DOWN'}
                            </span>
                        </div>

                        {/* 3. Database Connection */}
                        <div
                            className={`flex items-center justify-between p-2 rounded-none border-2 ${
                                isDark
                                    ? 'bg-[#0B0E14] border-neutral-800 text-neutral-300'
                                    : 'bg-[#F4F4F0] border-black text-neutral-900 shadow-[2px_2px_0px_0px_#000000]'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <Database
                                    size={13}
                                    strokeWidth={2.5}
                                    className={
                                        dbStatus === 'connected'
                                            ? isDark ? 'text-[#00FF66]' : 'text-emerald-700'
                                            : isDark ? 'text-[#FF3333]' : 'text-red-700'
                                    }
                                />
                                <span className={`font-mono font-black uppercase ${isDark ? 'text-neutral-300' : 'text-neutral-900'}`}>
                                    POSTGRESQL DB
                                </span>
                            </div>
                            <span
                                className={`font-mono font-black ${
                                    dbStatus === 'connected'
                                        ? isDark ? 'text-[#00FF66]' : 'text-emerald-800'
                                        : dbStatus === 'disconnected'
                                        ? isDark ? 'text-[#FF3333]' : 'text-red-800'
                                        : 'text-neutral-500'
                                }`}
                            >
                                {dbStatus === 'connected' ? 'CONNECTED' : dbStatus === 'disconnected' ? 'DISCONNECTED' : 'UNKNOWN'}
                            </span>
                        </div>

                        {/* 4. Roundtrip Latency & DB Ping */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                            <div
                                className={`p-2.5 rounded-none border-2 ${
                                    isDark
                                        ? 'bg-[#0B0E14] border-neutral-800'
                                        : 'bg-[#F4F4F0] border-black shadow-[2px_2px_0px_0px_#000000]'
                                }`}
                            >
                                <div
                                    className={`text-[10px] font-mono font-black uppercase tracking-wider ${
                                        isDark ? 'text-neutral-400' : 'text-neutral-700'
                                    }`}
                                >
                                    // ROUNDTRIP PING
                                </div>
                                <div className={`text-[13px] font-mono font-black mt-1 ${getLatencyColor(roundtripLatency)}`}>
                                    {roundtripLatency !== null ? `${roundtripLatency} ms` : '--'}
                                </div>
                            </div>
                            <div
                                className={`p-2.5 rounded-none border-2 ${
                                    isDark
                                        ? 'bg-[#0B0E14] border-neutral-800'
                                        : 'bg-[#F4F4F0] border-black shadow-[2px_2px_0px_0px_#000000]'
                                }`}
                            >
                                <div
                                    className={`text-[10px] font-mono font-black uppercase tracking-wider ${
                                        isDark ? 'text-neutral-400' : 'text-neutral-700'
                                    }`}
                                >
                                    // DB QUERY LATENCY
                                </div>
                                <div className={`text-[13px] font-mono font-black mt-1 ${getLatencyColor(dbLatency)}`}>
                                    {dbLatency !== null ? `${dbLatency} ms` : '--'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer with Refresh button */}
                    <div
                        className={`mt-3 pt-2.5 border-t-2 flex items-center justify-between text-[10px] ${
                            isDark ? 'border-neutral-800 text-neutral-400' : 'border-black text-neutral-800'
                        }`}
                    >
                        <span className="font-mono font-bold tracking-wider">
                            {lastChecked
                                ? `CHECKED ${lastChecked.toLocaleTimeString()}`
                                : 'CHECKING...'}
                        </span>
                        <button
                            type="button"
                            onClick={checkHealth}
                            disabled={isPinging}
                            className={`px-2.5 py-1.5 border-2 border-black rounded-none font-mono font-black text-[10px] uppercase flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 ${
                                isDark
                                    ? 'bg-[#1E2227] text-neutral-200 hover:bg-[#FFE600] hover:text-black'
                                    : 'bg-[#FFE600] text-black hover:bg-black hover:text-[#FFE600]'
                            }`}
                        >
                            <RefreshCw size={11} strokeWidth={2.5} className={isPinging ? 'animate-spin' : ''} />
                            <span>{isPinging ? 'PINGING...' : 'PING NOW'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
