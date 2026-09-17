import React, { useState, useRef, useMemo } from 'react';
import {
  Activity as ActivityIcon,
  Clock,
  List,
  LineChart as LineChartIcon,
  RefreshCw
} from 'lucide-react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { Skeleton } from '../../design-system/Skeleton';
import { useTimeline, type TimelineInterval } from '../../controllers/useTimeline';
import type { Activity } from '../../models';

interface ProjectPulseChartProps {
  projectId: string | number;
  className?: string;
}

const INTERVALS: { id: TimelineInterval; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '3d', label: '3D' },
  { id: '7d', label: '7D' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '12m', label: '1Y' },
  { id: '5y', label: '5Y' },
];

const getActionBadgeClass = (action: string) => {
  const act = action.toLowerCase();
  if (act.includes('complete')) return 'bg-[#22C55E] text-black border-black';
  if (act.includes('create')) return 'bg-[#00E5FF] text-black border-black';
  if (act.includes('move')) return 'bg-[#FFE600] text-black border-black';
  if (act.includes('delete')) return 'bg-[#EF4444] text-white border-black';
  if (act.includes('assign')) return 'bg-[#A855F7] text-white border-black';
  return 'bg-neutral-800 text-white border-neutral-700';
};

const getInitials = (name?: string): string => {
  if (!name) return '?';
  const clean = name.replace(/^User\s*#/i, '').trim();
  const parts = clean.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
};

export const ProjectPulseChart: React.FC<ProjectPulseChartProps> = ({ projectId, className = '' }) => {
  const { interval, setInterval, data, loading, error, refreshTimeline } = useTimeline(projectId, '7d');
  const [viewMode, setViewMode] = useState<'chart' | 'feed'>('chart');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const buckets = useMemo(() => data?.buckets ?? [], [data]);
  const peakCount = useMemo(() => Math.max(data?.peak_count ?? 0, 4), [data]);
  const totalActivities = data?.total_activities ?? 0;

  // Chart coordinate geometry
  const SVG_WIDTH = 600;
  const SVG_HEIGHT = 180;
  const PADDING_TOP = 25;
  const PADDING_BOTTOM = 30;
  const PADDING_LEFT = 40;
  const PADDING_RIGHT = 20;

  const chartWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const chartHeight = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  // Compute (x, y) coordinates for each bucket
  const points = useMemo(() => {
    if (!buckets.length) return [];
    return buckets.map((b, index) => {
      const x = buckets.length > 1
        ? PADDING_LEFT + (index / (buckets.length - 1)) * chartWidth
        : PADDING_LEFT + chartWidth / 2;
      const normalizedCount = peakCount > 0 ? b.count / peakCount : 0;
      const y = PADDING_TOP + chartHeight - normalizedCount * chartHeight;
      return { x, y, bucket: b, index };
    });
  }, [buckets, peakCount, chartWidth, chartHeight]);

  // Construct SVG Path
  const linePath = useMemo(() => {
    if (!points.length) return '';
    return points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
    }, '');
  }, [points]);

  const areaPath = useMemo(() => {
    if (!points.length) return '';
    const bottomY = PADDING_TOP + chartHeight;
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    return `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;
  }, [linePath, points, chartHeight]);

  // Handle hover on SVG
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !points.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;

    // Find nearest point along X
    let closestIdx = 0;
    let minDiff = Infinity;
    points.forEach((pt, idx) => {
      const diff = Math.abs(pt.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoverIndex(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  // Flatten all activities in current interval for the Feed view
  const allIntervalActivities = useMemo(() => {
    const list: Activity[] = [];
    buckets.forEach(b => {
      if (b.activities && b.activities.length > 0) {
        list.push(...b.activities);
      }
    });
    return list.reverse(); // Most recent first
  }, [buckets]);

  // Y-axis grid ticks
  const yTicks = useMemo(() => {
    const ticks = [0, Math.round(peakCount / 2), peakCount];
    return Array.from(new Set(ticks)).sort((a, b) => a - b);
  }, [peakCount]);

  return (
    <SurfaceCard
      title="Project Pulse"
      subtitle="Activity Velocity & Timeline"
      icon={ActivityIcon}
      className={`h-full flex flex-col ${className}`}
      rightElement={
        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            type="button"
            onClick={() => refreshTimeline(false)}
            className="p-1.5 border-2 border-black bg-black text-neutral-400 hover:text-[#FFE600] shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-colors"
            title="Refresh Timeline"
            aria-label="Refresh Timeline"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* View toggle */}
          <div className="flex border-2 border-black bg-black p-0.5 shadow-[2px_2px_0px_0px_#000000]">
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`px-2 py-0.5 text-[10px] font-mono font-black uppercase transition-colors cursor-pointer ${
                viewMode === 'chart' ? 'bg-[#FFE600] text-black' : 'text-neutral-400 hover:text-white'
              }`}
              title="Line Chart View"
            >
              <LineChartIcon size={12} className="inline mr-1 -mt-0.5" />
              CHART
            </button>
            <button
              type="button"
              onClick={() => setViewMode('feed')}
              className={`px-2 py-0.5 text-[10px] font-mono font-black uppercase transition-colors cursor-pointer ${
                viewMode === 'feed' ? 'bg-[#FFE600] text-black' : 'text-neutral-400 hover:text-white'
              }`}
              title="Feed List View"
            >
              <List size={12} className="inline mr-1 -mt-0.5" />
              FEED
            </button>
          </div>
        </div>
      }
    >
      {/* Interval Selector Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mt-2 pb-3 border-b-2 border-black">
        <div className="flex items-center gap-1.5 flex-wrap">
          {INTERVALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setInterval(item.id)}
              className={`px-2 py-0.5 font-mono text-[10px] font-black border-2 border-black shadow-[1.5px_1.5px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px] ${
                interval === item.id
                  ? 'bg-[#FFE600] text-black'
                  : 'bg-[#141619] text-neutral-400 hover:text-white hover:border-neutral-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] font-bold text-neutral-400">
          <span>TOTAL: <strong className="text-[#FFE600] font-black">{totalActivities}</strong></span>
          <span>PEAK: <strong className="text-white font-black">{peakCount}</strong></span>
        </div>
      </div>

      {/* Main Content Area: Chart or Feed */}
      {viewMode === 'chart' ? (
        <div className="relative flex-1 flex flex-col justify-center min-h-[220px] mt-2">
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton width="100%" height={120} className="rounded-none" />
              <div className="flex justify-between">
                <Skeleton width="15%" height={10} />
                <Skeleton width="15%" height={10} />
                <Skeleton width="15%" height={10} />
              </div>
            </div>
          ) : error && buckets.length === 0 ? (
            <div className="text-center py-10 text-neutral-400 font-mono text-[12px]">
              <p className="text-[#EF4444] font-bold mb-2">// {error}</p>
              <button
                type="button"
                onClick={() => refreshTimeline(false)}
                className="px-3 py-1 bg-[#141619] border-2 border-black text-white hover:bg-[#FFE600] hover:text-black font-mono text-[11px] font-bold shadow-[2px_2px_0px_0px_#000000] cursor-pointer"
              >
                RELOAD DATA
              </button>
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-center py-12 text-neutral-500 font-mono text-[12px]">
              <p className="mb-2">// NO TIMELINE DATA AVAILABLE.</p>
              <button
                type="button"
                onClick={() => refreshTimeline(false)}
                className="px-3 py-1 bg-[#141619] border-2 border-black text-white hover:bg-[#FFE600] hover:text-black font-mono text-[11px] font-bold shadow-[2px_2px_0px_0px_#000000] cursor-pointer"
              >
                REFRESH
              </button>
            </div>
          ) : (
            <div className="relative w-full select-none">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                className="w-full h-auto overflow-visible cursor-crosshair"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <defs>
                  {/* Linear Gradient for fill under polyline */}
                  <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFE600" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#FFE600" stopOpacity="0.0" />
                  </linearGradient>

                  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="2" dy="2" stdDeviation="0" floodColor="#000000" />
                  </filter>
                </defs>

                {/* Horizontal Gridlines & Y-Axis labels */}
                {yTicks.map((val) => {
                  const normalizedY = peakCount > 0 ? val / peakCount : 0;
                  const y = PADDING_TOP + chartHeight - normalizedY * chartHeight;
                  return (
                    <g key={val}>
                      <line
                        x1={PADDING_LEFT}
                        y1={y}
                        x2={SVG_WIDTH - PADDING_RIGHT}
                        y2={y}
                        stroke="#262626"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={PADDING_LEFT - 8}
                        y={y + 3}
                        fill="#737373"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                        textAnchor="end"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Gradient Fill under the line */}
                {areaPath && (
                  <path d={areaPath} fill="url(#pulseGradient)" />
                )}

                {/* The Main Polyline */}
                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#FFE600"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: 'drop-shadow(2px 2px 0px #000000)' }}
                  />
                )}

                {/* X-Axis Ticks & Labels */}
                {points.map((pt, idx) => {
                  // Only display every Nth label to avoid label crowding on large intervals
                  const step = points.length > 15 ? Math.ceil(points.length / 7) : points.length > 8 ? 2 : 1;
                  const isVisible = idx % step === 0 || idx === points.length - 1;
                  return (
                    <g key={idx}>
                      {isVisible && (
                        <text
                          x={pt.x}
                          y={SVG_HEIGHT - 8}
                          fill="#737373"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {pt.bucket.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Data Points */}
                {points.map((pt) => {
                  const hasCount = pt.bucket.count > 0;
                  const isHovered = hoverIndex === pt.index;
                  return (
                    <g key={pt.index}>
                      {hasCount && (
                        <rect
                          x={pt.x - 3}
                          y={pt.y - 3}
                          width={6}
                          height={6}
                          fill={isHovered ? '#FFFFFF' : '#FFE600'}
                          stroke="#000000"
                          strokeWidth="1.5"
                          className="transition-all duration-200"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Hover Guide & Crosshair */}
                {activePoint && (
                  <g>
                    {/* Vertical dashed guideline */}
                    <line
                      x1={activePoint.x}
                      y1={PADDING_TOP}
                      x2={activePoint.x}
                      y2={PADDING_TOP + chartHeight}
                      stroke="#FFFFFF"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                      opacity="0.6"
                    />

                    {/* Active point indicator ring */}
                    <rect
                      x={activePoint.x - 5}
                      y={activePoint.y - 5}
                      width={10}
                      height={10}
                      fill="#FFE600"
                      stroke="#000000"
                      strokeWidth="2"
                      style={{ filter: 'drop-shadow(2px 2px 0px #000000)' }}
                    />
                  </g>
                )}
              </svg>

              {/* Dynamic Hover Popover Card */}
              {activePoint && (
                <div
                  className="absolute pointer-events-none z-50 transition-all duration-75"
                  style={{
                    top: `${Math.max(10, Math.min(130, (activePoint.y / SVG_HEIGHT) * 100))}%`,
                    left: activePoint.x > SVG_WIDTH * 0.65
                      ? `calc(${((activePoint.x - 10) / SVG_WIDTH) * 100}% - 260px)`
                      : `calc(${((activePoint.x + 10) / SVG_WIDTH) * 100}%)`,
                  }}
                >
                  <div className="bg-[#0B0E14] border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-3 text-left w-64 max-w-[280px]">
                    <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                      <span className="text-[11px] font-mono font-black text-[#FFE600] uppercase">
                        // {activePoint.bucket.label}
                      </span>
                      <Badge variant={activePoint.bucket.count > 0 ? "primary" : "default"} className="!text-[8px] !py-0">
                        {activePoint.bucket.count} {activePoint.bucket.count === 1 ? 'EVENT' : 'EVENTS'}
                      </Badge>
                    </div>

                    <div className="mt-2.5 space-y-2 max-h-44 overflow-y-auto no-scrollbar">
                      {activePoint.bucket.activities && activePoint.bucket.activities.length > 0 ? (
                        activePoint.bucket.activities.slice(0, 5).map((act, i) => (
                          <div key={act.id || i} className="flex items-start gap-2 text-[10px] font-mono">
                            {act.avatar_url ? (
                              <img
                                src={act.avatar_url}
                                alt={act.user_name}
                                className="w-3.5 h-3.5 rounded-none border border-black object-cover shrink-0 mt-0.5"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.nextElementSibling;
                                  if (fallback) fallback.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <span
                              className={`w-3.5 h-3.5 rounded-none bg-black text-[#00E5FF] font-mono text-[7px] font-black flex items-center justify-center shrink-0 border border-black mt-0.5 ${
                                act.avatar_url ? 'hidden' : ''
                              }`}
                            >
                              {getInitials(act.user_name)}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-white uppercase truncate max-w-[80px]">
                                  {act.user_name}
                                </span>
                                <span className={`px-1 py-0.2 text-[8px] font-black uppercase border rounded-none ${getActionBadgeClass(act.action)}`}>
                                  {act.action}
                                </span>
                              </div>
                              <p className="text-neutral-400 truncate mt-0.5 font-semibold" title={act.target}>
                                {act.target}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-neutral-500 text-[10px] font-mono uppercase py-1">
                          // NO ACTIVITY AT THIS TIMESTAMP.
                        </p>
                      )}

                      {activePoint.bucket.activities && activePoint.bucket.activities.length > 5 && (
                        <p className="text-[9px] font-mono text-neutral-500 font-bold uppercase text-right pt-1">
                          + {activePoint.bucket.activities.length - 5} MORE ACTIVITIES
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Feed View */
        <div className="flex-1 overflow-y-auto no-scrollbar max-h-[220px] space-y-3 mt-3 pr-1">
          {loading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 p-2 bg-[#141619] border border-black">
                <Skeleton width={18} height={18} className="rounded-none" />
                <div className="flex-1">
                  <Skeleton width="50%" height={10} className="mb-1" />
                  <Skeleton width="80%" height={10} />
                </div>
              </div>
            ))
          ) : allIntervalActivities.length === 0 ? (
            <div className="text-neutral-500 font-mono text-[11px] text-center py-10 uppercase">
              // NO RECENT ACTIVITIES IN THIS TIMEFRAME.
            </div>
          ) : (
            allIntervalActivities.map((act, i) => (
              <div
                key={act.id || i}
                className="p-2.5 rounded-none bg-[#141619] border-2 border-black shadow-[2px_2px_0px_0px_#000000] flex items-start gap-2.5 font-mono"
              >
                {act.avatar_url ? (
                  <img
                    src={act.avatar_url}
                    alt={act.user_name}
                    className="w-4 h-4 rounded-none border border-black object-cover shrink-0 mt-0.5"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling;
                      if (fallback) fallback.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <span
                  className={`w-4 h-4 rounded-none bg-black text-[#00E5FF] font-mono text-[8px] font-black flex items-center justify-center shrink-0 border border-black mt-0.5 ${
                    act.avatar_url ? 'hidden' : ''
                  }`}
                >
                  {getInitials(act.user_name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-bold text-[11px] uppercase truncate">
                      {act.user_name}
                    </span>
                    <span className={`px-1.5 py-0.2 text-[8px] font-black uppercase border rounded-none shrink-0 ${getActionBadgeClass(act.action)}`}>
                      {act.action}
                    </span>
                  </div>
                  <p className="text-neutral-300 text-[10px] truncate mt-0.5 font-semibold" title={act.target}>
                    {act.target}
                  </p>
                  {act.created_at && (
                    <span className="text-[9px] text-neutral-500 font-bold uppercase mt-1 block">
                      <Clock size={9} className="inline mr-1 -mt-0.5" />
                      {new Date(act.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </SurfaceCard>
  );
};
