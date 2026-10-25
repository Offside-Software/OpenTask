import React, { useEffect, useState } from "react";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Skeleton } from "../../design-system/Skeleton";
import { useToast } from "../../design-system/Toast";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { ProjectAiKey } from "../../models";
import { meetingJobService } from "../../services/meetingJobService";

interface GroqKeyCardProps {
  projectId: string | number;
  className?: string;
}

const inputClass =
  "w-full bg-[#0B0E14] border-2 border-neutral-700 rounded-none px-3 py-2 text-white font-mono text-[12px] placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600]";

/** The project's own Groq key for the meeting pipeline. Managers set or remove it; the key never comes back. */
export const GroqKeyCard: React.FC<GroqKeyCardProps> = ({ projectId, className = "" }) => {
  const { showToast } = useToast();
  const [info, setInfo] = useState<ProjectAiKey | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tier, setTier] = useState<"free" | "developer">("free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    meetingJobService
      .getAiKey(projectId)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setTier(data.tier ?? "free");
      })
      .catch((err) => {
        console.error("Failed to load the project's Groq key", err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const closeForm = () => {
    setEditing(false);
    setApiKey("");
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const saved = await meetingJobService.setAiKey(projectId, apiKey.trim(), tier);
      setInfo(saved);
      closeForm();
      showToast("Key checked with Groq and saved", "success");
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
      setInfo(await meetingJobService.removeAiKey(projectId));
      showToast("Meeting jobs use the shared Groq key again", "info");
    } catch (err) {
      showToast((err as Error).message || "Could not remove the key", "error");
    } finally {
      setBusy(false);
    }
  };

  const status = info?.configured ? (
    <Badge variant="success">Project key active</Badge>
  ) : (
    <Badge variant="default">Shared key</Badge>
  );

  return (
    <SurfaceCard
      className={className}
      title="Meeting AI (Groq)"
      subtitle="Transcription, task extraction and summaries for meetings"
      icon={KeyRound}
      rightElement={info ? status : null}
    >
      {!info && !loadError ? (
        <div className="space-y-3">
          <Skeleton width="80%" height={12} />
          <Skeleton height={44} />
        </div>
      ) : !info ? (
        <p className="text-neutral-400 font-mono text-[12px]">Could not load the key settings. Reload the page to try again.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] font-mono text-neutral-400 leading-relaxed">
            Without a project key, meeting jobs use the shared Groq key and this project's daily quotas. With one, the quotas stop
            applying and usage counts against the key's own Groq limits.
          </p>

          <div className="border-2 border-neutral-700 bg-[#121417] p-3 flex flex-col md:flex-row md:items-center gap-3">
            <p className="flex-1 text-neutral-300 font-mono text-[12px] flex items-center gap-2 flex-wrap">
              {info.configured ? (
                <>
                  Key ending <span className="text-white font-bold">····{info.hint}</span>
                  <Badge variant={info.tier === "developer" ? "primary" : "default"}>
                    {info.tier === "developer" ? "Developer tier" : "Free tier"}
                  </Badge>
                  {info.updated_at && <span className="text-neutral-400">set {new Date(info.updated_at).toLocaleDateString()}</span>}
                </>
              ) : (
                "No project key. Meeting jobs use the shared key."
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

          {!info.can_manage && <p className="text-neutral-400 font-mono text-[11px]">Only project managers can change this key.</p>}

          {editing && (
            <form onSubmit={save} className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="groq-key" className="text-[11px] font-bold uppercase text-neutral-400 font-mono">
                  // Groq API key
                </label>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-[#FFE600] hover:underline"
                >
                  Get a key <ExternalLink size={11} />
                </a>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <input
                  id="groq-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputClass}
                  placeholder="gsk_…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <select className={inputClass} aria-label="Groq tier" value={tier} onChange={(e) => setTier(e.target.value as "free" | "developer")}>
                  <option value="free">Free tier</option>
                  <option value="developer">Developer tier</option>
                </select>
              </div>
              <p className="text-neutral-400 font-mono text-[10px]">Checked with Groq before it is saved, stored encrypted, and never shown again.</p>
              {error && <p className="border-2 border-black bg-[#FF3333] text-white font-mono text-[11px] p-2">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={closeForm}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit" disabled={busy || apiKey.trim().length < 20}>
                  {busy && <Loader2 size={12} className="animate-spin" />} Check and save
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remove the project's Groq key?"
          message="Meeting jobs of this project will use the shared Groq key again, with the daily quotas."
          confirmLabel="Remove key"
          variant="warning"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </SurfaceCard>
  );
};
