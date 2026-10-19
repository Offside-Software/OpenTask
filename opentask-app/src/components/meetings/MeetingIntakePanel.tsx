import React, { useRef, useState } from "react";
import { Link as LinkIcon, FileText, ClipboardPaste, Video, Loader2, Sparkles, Upload } from "lucide-react";
import { SurfaceCard } from "../../design-system/SurfaceCard";
import { Button } from "../../design-system/Button";
import { useToast } from "../../design-system/Toast";
import type { ProjectMember } from "../../models";
import { browserTimezone, meetingJobService, todayLocal } from "../../services/meetingJobService";
import { ACCEPTED_TEXT_FILES, MAX_TEXT_CHARS, MIN_TEXT_CHARS, extractDocumentText } from "../../utils/documentText";

type Source = "link" | "file" | "paste";

interface MeetingIntakePanelProps {
  projectId: string | number;
  members: ProjectMember[];
  onSubmitted: () => void;
}

const inputClass =
  "w-full bg-[#0B0E14] border-2 border-neutral-700 rounded-none px-3 py-2 text-white font-mono text-[12px] placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600]";
const labelClass = "block text-neutral-400 font-mono text-[10px] font-bold uppercase tracking-wider mb-1";

const SOURCES: { id: Source; label: string; hint: string; icon: React.ElementType }[] = [
  { id: "link", label: "Meeting link", hint: "Send a bot to Zoom, Meet or Teams", icon: LinkIcon },
  { id: "file", label: "Notes file", hint: ".txt .md .docx .pdf", icon: FileText },
  { id: "paste", label: "Paste text", hint: "Minutes, transcript or chat", icon: ClipboardPaste },
];

export const MeetingIntakePanel: React.FC<MeetingIntakePanelProps> = ({ projectId, members, onSubmitted }) => {
  const { showToast } = useToast();
  const [source, setSource] = useState<Source>("file");
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(todayLocal());
  const [attendees, setAttendees] = useState<string[]>([]);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "reading" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setMeetingUrl("");
    setPasted("");
    setFile(null);
    setAttendees([]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const toggleAttendee = (id: string) =>
    setAttendees((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const common = {
      project_id: String(projectId),
      title: title.trim() || undefined,
      meeting_date: meetingDate,
      timezone: browserTimezone(),
      attendee_ids: attendees,
    };
    try {
      if (source === "link") {
        if (!meetingUrl.trim().startsWith("https://")) {
          setError("Paste the full https:// meeting link.");
          return;
        }
        setStage("sending");
        await meetingJobService.inviteBot({ ...common, meeting_url: meetingUrl.trim() });
        showToast("Bot sent. Tasks appear here after the meeting ends.", "success");
      } else {
        let text: string;
        if (source === "file") {
          if (!file) {
            setError("Choose a file first.");
            return;
          }
          setStage("reading");
          text = await extractDocumentText(file);
        } else {
          text = pasted.trim();
          if (text.length < MIN_TEXT_CHARS) {
            setError(`Paste at least ${MIN_TEXT_CHARS} characters.`);
            return;
          }
        }
        setStage("sending");
        const result = await meetingJobService.createTextJob({
          ...common,
          title: common.title ?? (file ? file.name.replace(/\.[^.]+$/, "") : undefined),
          text,
        });
        if (result.job.status === "NO_ACTIONS") {
          showToast("Saved without tasks: this doesn't look like a meeting record with follow-ups.", "warning");
        } else {
          showToast("Uploaded. Drafting tasks…", "success");
        }
      }
      reset();
      onSubmitted();
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    } finally {
      setStage("idle");
    }
  };

  const busy = stage !== "idle";

  return (
    <SurfaceCard title="Meeting Intelligence" subtitle="Turn meetings into reviewed tasks" icon={Sparkles}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" role="radiogroup" aria-label="Meeting source">
          {SOURCES.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={source === id}
              onClick={() => setSource(id)}
              className={`text-left p-3 border-2 rounded-none transition-all cursor-pointer ${
                source === id
                  ? "border-black bg-[#FFE600] text-black shadow-[3px_3px_0px_0px_#000000]"
                  : "border-neutral-700 bg-[#121417] text-white hover:border-white"
              }`}
            >
              <Icon size={16} strokeWidth={2.5} />
              <span className="block font-mono font-black uppercase text-[12px] mt-1.5">{label}</span>
              <span className={`block font-mono text-[10px] ${source === id ? "text-black" : "text-neutral-400"}`}>{hint}</span>
            </button>
          ))}
          <div className="text-left p-3 border-2 border-dashed border-neutral-700 bg-[#121417] opacity-60" aria-disabled="true">
            <Video size={16} strokeWidth={2.5} className="text-neutral-400" />
            <span className="block font-mono font-black uppercase text-[12px] mt-1.5 text-neutral-300">Recording</span>
            <span className="block font-mono text-[10px] text-neutral-400">Audio/video: coming soon</span>
          </div>
        </div>

        {source === "link" && (
          <div>
            <label className={labelClass} htmlFor="meeting-url">Meeting link</label>
            <input
              id="meeting-url"
              type="url"
              className={inputClass}
              placeholder="https://meet.google.com/abc-defg-hij"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
            <p className="text-neutral-400 font-mono text-[10px] mt-1">
              The bot records the meeting audio. When it leaves, the audio is transcribed and tasks are drafted.
            </p>
          </div>
        )}

        {source === "file" && (
          <div>
            <label className={labelClass} htmlFor="meeting-file">Notes or transcript file</label>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="w-full border-2 border-dashed border-neutral-700 hover:border-[#FFE600] bg-[#121417] p-5 flex items-center gap-3 cursor-pointer"
            >
              <Upload size={18} className="text-neutral-300" />
              <span className="font-mono text-[12px] text-white truncate">{file ? file.name : "Choose a .txt, .md, .docx or .pdf file"}</span>
            </button>
            <input
              id="meeting-file"
              ref={fileInput}
              type="file"
              hidden
              accept={ACCEPTED_TEXT_FILES}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {source === "paste" && (
          <div>
            <label className={labelClass} htmlFor="meeting-text">Meeting text</label>
            <textarea
              id="meeting-text"
              className={`${inputClass} min-h-[140px] resize-y`}
              placeholder="Paste the minutes, a transcript or a chat thread…"
              value={pasted}
              maxLength={MAX_TEXT_CHARS}
              onChange={(e) => setPasted(e.target.value)}
            />
            <p className="text-neutral-400 font-mono text-[10px] mt-1">{pasted.trim().length.toLocaleString()} characters</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="meeting-title">Title</label>
            <input
              id="meeting-title"
              className={inputClass}
              placeholder={source === "file" && file ? file.name : "Weekly sync"}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="meeting-date">Meeting date</label>
            <input id="meeting-date" type="date" className={inputClass} value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
          </div>
        </div>

        {members.length > 0 && (
          <div>
            <span className={labelClass}>Attendees</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const id = String(m.user_id);
                const on = attendees.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAttendee(id)}
                    className={`px-2 py-1 border-2 rounded-none font-mono text-[11px] cursor-pointer ${
                      on ? "border-black bg-[#00FF66] text-black" : "border-neutral-700 bg-[#121417] text-neutral-300 hover:border-white"
                    }`}
                  >
                    {m.display_name || m.gh_username || id}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && <p className="border-2 border-black bg-[#FF3333] text-white font-mono text-[12px] p-2.5">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {stage === "reading" ? "Reading file…" : stage === "sending" ? "Sending…" : source === "link" ? "Send bot" : "Extract tasks"}
          </Button>
        </div>
      </form>
    </SurfaceCard>
  );
};
