import React, { useEffect, useState } from "react";
import { Activity, Loader2, RotateCcw } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { ProgressBar } from "../../design-system/ProgressBar";
import { Skeleton } from "../../design-system/Skeleton";
import { useToast } from "../../design-system/Toast";
import type { MeetingHealth, ModelUsageToday } from "../../models";
import { meetingJobService } from "../../services/meetingJobService";

interface PipelineHealthPanelProps {
  projectId: string | number;
  /** Changes when jobs may have changed. */
  refreshSignal: string;
  onRetried: () => void;
}

const percent = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);

const modelLabel = (model: string) => {
  if (model.startsWith("@cf/")) return "Cloudflare Whisper";
  if (model.includes("whisper")) return "Groq Whisper";
  return model.split("/").pop() ?? model;
};

/** The figure that runs out first for this model, as [used, limit, unit]. */
const binding = (m: ModelUsageToday): [number, number, string] | null => {
  if (m.limits.audio_per_day > 0) return [Math.round(m.audio_seconds / 60), Math.round(m.limits.audio_per_day / 60), "min"];
  if (m.limits.tpd > 0) return [m.tokens, m.limits.tpd, "tokens"];
  if (m.limits.rpd > 0) return [m.requests, m.limits.rpd, "requests"];
  return null;
};

const time = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";

const sectionLabel = "text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-wider mb-2";
const UsageBars: React.FC<{ title: string; models: ModelUsageToday[] }> = ({ title, models }) => {
  const shown = models.filter((m) => binding(m) !== null);
  if (shown.length === 0) return null;
  return (
    <div>
      <p className={sectionLabel}>{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shown.map((m) => {
          const [used, limit, unit] = binding(m)!;
          return (
            <ProgressBar
              key={m.model}
              value={percent(used, limit)}
              label={`${modelLabel(m.model)} · ${used.toLocaleString()} of ${limit.toLocaleString()} ${unit}`}
              colorClass={percent(used, limit) >= 90 ? "bg-[#FF3333]" : "bg-[#FFE600]"}
            />
          );
        })}
      </div>
    </div>
  );
};

/** Same layout as the loaded panel, so the page does not jump when the health data arrives. */
const PipelineHealthSkeleton: React.FC = () => (
  <SurfaceCard title="Pipeline Health" subtitle="Today (UTC) · free tier" icon={Activity}>
    <div className="space-y-5" aria-busy="true" aria-label="Loading pipeline health">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton width="55%" height={10} />
            <Skeleton height={8} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton width="30%" height={10} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton width="65%" height={10} />
              <Skeleton height={8} />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton width="25%" height={10} />
        <Skeleton height={52} />
      </div>
    </div>
  </SurfaceCard>
);

export const PipelineHealthPanel: React.FC<PipelineHealthPanelProps> = ({ projectId, refreshSignal, onRetried }) => {
  const { showToast } = useToast();
  const [health, setHealth] = useState<MeetingHealth | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .getHealth(projectId)
      .then((data) => {
        if (cancelled) return;
        setHealth(data);
        setFailed(false);
      })
      .catch((err) => {
        console.error("Failed to load meeting pipeline health", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshSignal, tick]);

  if (!health && failed) {
    return (
      <SurfaceCard title="Pipeline Health" subtitle="Today (UTC) · free tier" icon={Activity}>
        <p className="text-neutral-400 font-mono text-[12px]">Could not load the pipeline health. It refreshes with the meeting list.</p>
      </SurfaceCard>
    );
  }
  if (!health) return <PipelineHealthSkeleton />;
  const { quota } = health;

  const retry = async (jobId: string) => {
    setRetrying(jobId);
    try {
      await meetingJobService.retryJob(jobId);
      showToast("The job is running again", "success");
      setTick((t) => t + 1);
      onRetried();
    } catch (err) {
      showToast((err as Error).message || "Could not retry the job", "error");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <SurfaceCard title="Pipeline Health" subtitle="Today (UTC) · free tier" icon={Activity}>
      <div className="space-y-5">
        {quota.exempt ? (
          <p className="text-neutral-300 font-mono text-[12px]">
            {quota.jobs_today} meeting job{quota.jobs_today === 1 ? "" : "s"} today. This project uses its own Groq key (set in Settings), so the daily quotas don't apply.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quota.jobs_per_day > 0 && (
              <ProgressBar value={percent(quota.jobs_today, quota.jobs_per_day)} label={`Meeting jobs · ${quota.jobs_today} of ${quota.jobs_per_day}`} />
            )}
            {quota.audio_minutes_per_day > 0 && (
              <ProgressBar
                value={percent(quota.audio_minutes_today, quota.audio_minutes_per_day)}
                label={`Transcription · ${quota.audio_minutes_today} of ${quota.audio_minutes_per_day} min`}
              />
            )}
          </div>
        )}

        <UsageBars title="This project's Groq key" models={health.own_models} />
        <UsageBars title="Shared by all projects" models={health.models} />

        <div>
          <p className={sectionLabel}>Failed or waiting jobs</p>
          {health.jobs.length === 0 ? (
            <p className="text-neutral-400 font-mono text-[12px]">None.</p>
          ) : (
            <ul className="space-y-2">
              {health.jobs.map(({ job, meeting_title, problem, can_retry }) => {
                const waiting = job.status !== "FAILED";
                return (
                  <li key={job.id} className="border-2 border-neutral-700 bg-[#121417] p-3 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-mono font-bold text-[12px] truncate max-w-[20rem]">{meeting_title || "Untitled meeting"}</span>
                        <Badge variant={waiting ? "warning" : "critical"}>
                          {waiting ? `Waiting until ${time(job.next_attempt_at)}` : `Failed after ${job.attempts} tries`}
                        </Badge>
                      </div>
                      {problem && <p className="text-neutral-400 font-mono text-[11px] mt-1 break-words">{problem}</p>}
                    </div>
                    {can_retry && (
                      <Button variant="outline" size="sm" disabled={retrying === job.id} onClick={() => void retry(job.id)} className="shrink-0">
                        {retrying === job.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        {waiting ? "Run now" : "Retry"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
};
