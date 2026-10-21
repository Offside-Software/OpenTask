import React, { useEffect, useState } from "react";
import { Activity, KeyRound, Loader2, RotateCcw } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { ProgressBar } from "../../design-system/ProgressBar";
import { useToast } from "../../design-system/Toast";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { MeetingHealth, ModelUsageToday, ProjectAiKey } from "../../models";
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
const inputClass =
  "w-full bg-[#0B0E14] border-2 border-neutral-700 rounded-none px-3 py-2 text-white font-mono text-[12px] placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600]";

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

const ProjectKeySection: React.FC<{ projectId: string | number; info: ProjectAiKey; onChanged: () => void }> = ({ projectId, info, onChanged }) => {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tier, setTier] = useState<"free" | "developer">(info.tier ?? "free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await meetingJobService.setAiKey(projectId, apiKey.trim(), tier);
      setApiKey("");
      setEditing(false);
      showToast("Key checked with Groq and saved", "success");
      onChanged();
    } catch (err) {
      setError((err as Error).message || "Could not save the key");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy(true);
    try {
      await meetingJobService.removeAiKey(projectId);
      showToast("The project uses the shared key again", "info");
      onChanged();
    } catch (err) {
      showToast((err as Error).message || "Could not remove the key", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className={sectionLabel}>Groq API key</p>
      <div className="border-2 border-neutral-700 bg-[#121417] p-3 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <p className="flex-1 text-neutral-300 font-mono text-[12px] flex items-center gap-2 flex-wrap">
            <KeyRound size={13} className="shrink-0" />
            {info.configured ? (
              <>
                This project's own key <span className="text-white font-bold">····{info.hint}</span>
                <Badge variant={info.tier === "developer" ? "primary" : "default"}>{info.tier === "developer" ? "Developer tier" : "Free tier"}</Badge>
                {info.updated_at && <span className="text-neutral-400">set {new Date(info.updated_at).toLocaleDateString()}</span>}
              </>
            ) : (
              "Using the shared key, with this project's daily quotas."
            )}
          </p>
          {info.can_manage && !editing && (
            <div className="flex gap-2 shrink-0">
              {info.configured && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
              <Button variant={info.configured ? "outline" : "primary"} size="sm" disabled={busy} onClick={() => setEditing(true)}>
                {info.configured ? "Replace" : "Use own key"}
              </Button>
            </div>
          )}
        </div>

        {editing && (
          <form onSubmit={save} className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
                placeholder="gsk_…"
                aria-label="Groq API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <select className={inputClass} aria-label="Groq tier" value={tier} onChange={(e) => setTier(e.target.value as "free" | "developer")}>
                <option value="free">Free tier</option>
                <option value="developer">Developer tier</option>
              </select>
            </div>
            <p className="text-neutral-400 font-mono text-[10px]">
              Checked with Groq before it is saved, stored encrypted, and never shown again. The project's daily quotas stop applying;
              its usage counts against this key's own limits.
            </p>
            {error && <p className="border-2 border-black bg-[#FF3333] text-white font-mono text-[11px] p-2">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => { setEditing(false); setApiKey(""); setError(null); }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={busy || apiKey.trim().length < 20}>
                {busy && <Loader2 size={12} className="animate-spin" />} Check and save
              </Button>
            </div>
          </form>
        )}
      </div>
      {confirmRemove && (
        <ConfirmModal
          title="Remove the project's key?"
          message="Meeting jobs of this project will use the shared Groq key again, with the daily quotas."
          confirmLabel="Remove key"
          variant="warning"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
};

export const PipelineHealthPanel: React.FC<PipelineHealthPanelProps> = ({ projectId, refreshSignal, onRetried }) => {
  const { showToast } = useToast();
  const [health, setHealth] = useState<MeetingHealth | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    meetingJobService
      .getHealth(projectId)
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err) => console.error("Failed to load meeting pipeline health", err));
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshSignal, tick]);

  if (!health) return null;
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
            {quota.jobs_today} meeting job{quota.jobs_today === 1 ? "" : "s"} today. This project uses its own Groq key, so the daily quotas don't apply.
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
        <ProjectKeySection key={`${health.key.configured}:${health.key.hint}`} projectId={projectId} info={health.key} onChanged={() => setTick((t) => t + 1)} />

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
