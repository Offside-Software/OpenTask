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
  if (act.includes('complete')) return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  if (act.includes('create')) return 'bg-primary/10 text-primary border-primary/20';
  if (act.includes('move')) return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
  if (act.includes('delete')) return 'bg-destructive/10 text-destructive border-destructive/20';
  if (act.includes('assign')) return 'bg-primary/10 text-primary border-primary/20';
  return 'bg-muted text-muted-foreground border-border';
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
            className="p-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
            title="Refresh Timeline"
            aria-label="Refresh Timeline"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* View toggle */}
          <div className="flex border border-border bg-muted/40 p-0.5 rounded-md">
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'chart' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Line Chart View"
            >
              <LineChartIcon size={12} className="inline mr-1 -mt-0.5" />
              Chart
            </button>
            <button
              type="button"
              onClick={() => setViewMode('feed')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'feed' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Feed List View"
            >
              <List size={12} className="inline mr-1 -mt-0.5" />
              Feed
            </button>
          </div>
        </div>
      }
    >
      {/* Interval Selector Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mt-2 pb-3 border-b border-border">
        <div className="flex items-center gap-1 flex-wrap">
          {INTERVALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setInterval(item.id)}
              className={`px-2 py-0.5 text-xs font-medium rounded-md border cursor-pointer transition-colors ${
                interval === item.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Total: <strong className="text-foreground font-semibold">{totalActivities}</strong></span>
          <span>Peak: <strong className="text-foreground font-semibold">{peakCount}</strong></span>
        </div>
      </div>

      {/* Main Content Area: Chart or Feed */}
      {viewMode === 'chart' ? (
        <div className="relative flex-1 flex flex-col justify-center min-h-[220px] mt-2">
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton width="100%" height={120} className="rounded-lg" />
              <div className="flex justify-between">
                <Skeleton width="15%" height={10} />
                <Skeleton width="15%" height={10} />
                <Skeleton width="15%" height={10} />
              </div>
            </div>
          ) : error && buckets.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">
              <p className="text-destructive font-medium mb-2">{error}</p>
              <button
                type="button"
                onClick={() => refreshTimeline(false)}
                className="px-3 py-1 bg-card border border-border text-foreground hover:bg-muted text-xs font-medium rounded-md cursor-pointer transition-colors"
              >
                Reload Data
              </button>
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs">
              <p className="mb-2">No timeline data available.</p>
              <button
                type="button"
                onClick={() => refreshTimeline(false)}
                className="px-3 py-1 bg-card border border-border text-foreground hover:bg-muted text-xs font-medium rounded-md cursor-pointer transition-colors"
              >
                Refresh
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
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                  </linearGradient>
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
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={PADDING_LEFT - 8}
                        y={y + 3}
                        fill="var(--muted-foreground)"
                        fontSize="9"
                        fontWeight="normal"
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
                    stroke="var(--primary)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
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
                          fill="var(--muted-foreground)"
                          fontSize="9"
                          fontWeight="normal"
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
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={isHovered ? 4.5 : 3}
                          fill={isHovered ? '#FFFFFF' : 'var(--primary)'}
                          stroke="var(--background)"
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
                      stroke="var(--foreground)"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                      opacity="0.4"
                    />

                    {/* Active point indicator ring */}
                    <circle
                      cx={activePoint.x}
                      cy={activePoint.y}
                      r={5}
                      fill="var(--primary)"
                      stroke="var(--background)"
                      strokeWidth="2"
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
                  <div className="bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-3 text-left w-64 max-w-[280px]">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <span className="text-xs font-semibold text-primary">
                        {activePoint.bucket.label}
                      </span>
                      <Badge variant={activePoint.bucket.count > 0 ? "accent" : "neutral"} className="!text-[9px] !py-0">
                        {activePoint.bucket.count} {activePoint.bucket.count === 1 ? 'event' : 'events'}
                      </Badge>
                    </div>

                    <div className="mt-2.5 space-y-2 max-h-44 overflow-y-auto">
                      {activePoint.bucket.activities && activePoint.bucket.activities.length > 0 ? (
                        activePoint.bucket.activities.slice(0, 5).map((act, i) => (
                          <div key={act.id || i} className="flex items-start gap-2 text-xs">
                            {act.avatar_url ? (
                              <img
                                src={act.avatar_url}
                                alt={act.user_name}
                                className="w-4 h-4 rounded-full border border-border object-cover shrink-0 mt-0.5"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.nextElementSibling;
                                  if (fallback) fallback.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <span
                              className={`w-4 h-4 rounded-full bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center shrink-0 border border-primary/20 mt-0.5 ${
                                act.avatar_url ? 'hidden' : ''
                              }`}
                            >
                              {getInitials(act.user_name)}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-foreground truncate max-w-[80px]">
                                  {act.user_name}
                                </span>
                                <span className={`px-1 py-0.2 text-[9px] font-medium border rounded-md ${getActionBadgeClass(act.action)}`}>
                                  {act.action}
                                </span>
                              </div>
                              <p className="text-muted-foreground truncate mt-0.5 text-[11px]" title={act.target}>
                                {act.target}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground text-xs py-1">
                          No activity at this timestamp.
                        </p>
                      )}

                      {activePoint.bucket.activities && activePoint.bucket.activities.length > 5 && (
                        <p className="text-[10px] text-muted-foreground font-medium text-right pt-1">
                          + {activePoint.bucket.activities.length - 5} more activities
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
        <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2.5 mt-3 pr-1">
          {loading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 p-2.5 bg-card border border-border rounded-lg">
                <Skeleton width={18} height={18} className="rounded-full" />
                <div className="flex-1">
                  <Skeleton width="50%" height={10} className="mb-1" />
                  <Skeleton width="80%" height={10} />
                </div>
              </div>
            ))
          ) : allIntervalActivities.length === 0 ? (
            <div className="text-muted-foreground text-xs text-center py-10">
              No recent activities in this timeframe.
            </div>
          ) : (
            allIntervalActivities.map((act, i) => (
              <div
                key={act.id || i}
                className="p-2.5 rounded-lg bg-card border border-border shadow-xs flex items-start gap-2.5"
              >
                {act.avatar_url ? (
                  <img
                    src={act.avatar_url}
                    alt={act.user_name}
                    className="w-4 h-4 rounded-full border border-border object-cover shrink-0 mt-0.5"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling;
                      if (fallback) fallback.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <span
                  className={`w-4 h-4 rounded-full bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center shrink-0 border border-primary/20 mt-0.5 ${
                    act.avatar_url ? 'hidden' : ''
                  }`}
                >
                  {getInitials(act.user_name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground font-medium text-xs truncate">
                      {act.user_name}
                    </span>
                    <span className={`px-1.5 py-0.2 text-[12px] font-medium border rounded-md shrink-0 ${getActionBadgeClass(act.action)}`}>
                      {act.action}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs truncate mt-0.5" title={act.target}>
                    {act.target}
                  </p>
                  {act.created_at && (
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      <Clock size={10} className="inline mr-1 -mt-0.5" />
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
