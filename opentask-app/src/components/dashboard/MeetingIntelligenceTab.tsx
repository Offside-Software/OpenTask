import React, { useState, useRef, useEffect } from "react";
import {
  Video,
  Link as LinkIcon,
  Upload,
  CheckCircle2,
  Trash2,
  Save,
  ArrowLeft,
  Loader2,
  Sparkles,
  Calendar,
  User,
} from "lucide-react";
import "../MeetingAnalyzer.css"; // Reusing established styles
import { useTasks } from "../../controllers/useTasks";

interface Task {
  id: string;
  title: string;
  pic: string;
  priority: "high" | "medium" | "low";
  due_date: string;
  completed: boolean;
}

interface MoMData {
  judul_meeting: string;
  ringkasan_eksekutif: string;
  poin_diskusi: string[];
  keputusan_final: string[];
}

interface AnalyzerResult {
  mom: MoMData;
  tasks: Task[];
  alertId?: number;
}

interface MeetingIntelligenceTabProps {
  projectId: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMeetingCreated?: (data: any) => Promise<any>;
}

export const MeetingIntelligenceTab: React.FC<MeetingIntelligenceTabProps> = ({
  projectId,
  onMeetingCreated,
}) => {
  const [view, setView] = useState<
    "choice" | "upload" | "link" | "loading" | "processing" | "result"
  >("choice");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { createTask } = useTasks(projectId);

  // Polling effect for background processing (Meeting Link)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (view === "processing") {
      interval = setInterval(async () => {
        const response = await fetch(
          `http://localhost:8000/meetings/poll-analysis`,
          { credentials: "include" }
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === "success" && data.data && data.data.mom) {
            try {
              const transformedTasks: Task[] = (
                (data.proposed_tasks as Record<string, unknown>[]) || []
              ).map((t: Record<string, unknown>, i: number) => ({
                id: `task-bg-${i}-${Date.now()}`,
                title: (t.title as string) || "Untitled Task",
                pic: (t.assignee_username as string) || "TBD",
                priority:
                  ((t.priority as string)?.toLowerCase() as Task["priority"]) ||
                  "medium",
                due_date: (t.due_date as string) || "TBD",
                completed: false,
              }));

              setResult({
                mom: data.data.mom,
                tasks: transformedTasks,
                alertId: data.alert_id,
              });

              // Refresh history (optional: we can trigger it)
              if (onMeetingCreated) {
                // Since we don't have the fully inserted meeting ID from the background db insertion,
                // we just pass an empty trigger, or fetch count to re-trigger.
                onMeetingCreated({ id: "bg-refresh" });
              }

              setView("result");
              clearInterval(interval);
            } catch (e) {
              console.error("Failed to parse background meeting content", e);
            }
          } else if (data.status === "error") {
            setError("Background analysis failed.");
            setView("choice");
            clearInterval(interval);
          }
        }
      }, 5000);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setView("loading");
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", String(projectId));

    try {
      // Hitting backend directly to avoid Vite proxy multipart form drop bugs
      const response = await fetch("http://localhost:8000/analyze-meeting", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to analyze meeting");

      const data = await response.json();

      const transformedTasks: Task[] = (data.proposed_tasks || []).map(
        (t: Record<string, unknown>, index: number) => ({
          id: `task-${index}-${Date.now()}`,
          title: t.title,
          pic: t.assignee_username || "TBD",
          priority:
            ((t.priority as string)?.toLowerCase() as Task["priority"]) ||
            "medium",
          due_date: t.due_date || "TBD",
          completed: false,
        })
      );

      setResult({
        mom: data.data.mom,
        tasks: transformedTasks,
        alertId: data.alert_id,
      });

      // Refresh history immediately
      if (data.meeting && onMeetingCreated) {
        onMeetingCreated(data.meeting);
      }

      setView("result");
    } catch (err: unknown) {
      setError(
        (err as Error).message || "Something went wrong during analysis"
      );
      setView("choice");
    }
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingUrl) return;

    setView("loading");
    setError(null);

    try {
      const response = await fetch(
        `http://localhost:8000/invite-bot?meeting_url=${encodeURIComponent(
          meetingUrl
        )}&project_id=${projectId}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (!response.ok) throw new Error("Failed to invite bot");

      setView("processing");
      setMeetingUrl("");
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to invite meeting bot");
      setView("choice");
    }
  };

  const toggleTask = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      tasks: result.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      ),
    });
  };

  const deleteTask = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      tasks: result.tasks.filter((t) => t.id !== id),
    });
  };

  const syncToProject = async () => {
    if (!result) return;
    setSyncing(true);
    try {
      // 1. Create only uncompleted tasks on the Kanban board
      for (const task of result.tasks) {
        if (!task.completed) {
          await createTask({
            project_id: projectId,
            title: task.title,
            type: "REQUIREMENT",
            weight:
              task.priority === "high" ? 8 : task.priority === "medium" ? 5 : 3,
            bucket_id: "draft",
          });
        }
      }
      // 3. Mark the draft approval alert as resolved if it exists
      if (result.alertId) {
        const { alertService } = await import("../../services/alertService");
        await alertService.resolveAlert(result.alertId);
      }

      setSynced(true);
      setTimeout(() => setSynced(false), 3000);
    } catch (err) {
      console.error("Failed to sync to project", err);
      setError("Failed to sync results to project board.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-[#0C0D0E] border-2 border-black rounded-none p-8 min-h-[600px] relative overflow-hidden select-none shadow-[6px_6px_0px_0px_#000000]">
      {view === "choice" && (
        <div className="relative z-10 flex flex-col items-center justify-center h-full py-12">
          <div className="w-16 h-16 bg-black border-2 border-black rounded-none flex items-center justify-center text-[#FFE600] mb-6 shadow-[3px_3px_0px_0px_#000000]">
            <Sparkles size={32} />
          </div>
          <span className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700 font-mono text-[10px] font-black uppercase tracking-wider mb-2 inline-block">
            // AI RECON INTELLIGENCE
          </span>
          <h2 className="text-[28px] font-mono font-black uppercase tracking-wide text-white mb-2 text-center">
            MEETING INTELLIGENCE
          </h2>
          <p className="text-neutral-400 font-mono text-[12px] text-center max-w-md mb-12 uppercase tracking-wider">
            CONVERT RECORDINGS OR LIVE SESSIONS INTO ACTIONABLE TASKS & EXECUTIVE SPECIFICATIONS.
          </p>

          {error && (
            <div className="mb-8 p-4 bg-[#EF4444]/10 border-2 border-black rounded-none text-[#EF4444] font-mono text-[12px] text-center w-full max-w-md flex items-center gap-3 shadow-[3px_3px_0px_0px_#000000]">
              <div className="w-2 h-2 rounded-none bg-[#EF4444]" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
            <div
              onClick={() => setView("upload")}
              className="bg-[#141619] border-2 border-black rounded-none p-8 cursor-pointer transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] shadow-[4px_4px_0px_0px_#000000] hover:shadow-[6px_6px_0px_0px_#000000] active:translate-x-[0px] active:translate-y-[0px] active:shadow-[2px_2px_0px_0px_#000000] group"
            >
              <div className="w-12 h-12 bg-[#FFE600] text-black border-2 border-black rounded-none flex items-center justify-center mb-6 shadow-[2px_2px_0px_0px_#000000]">
                <Video size={24} strokeWidth={2.5} />
              </div>
              <h3 className="text-white font-mono font-black text-[18px] uppercase tracking-wider mb-2 group-hover:text-[#FFE600] transition-colors">
                Upload Video
              </h3>
              <p className="text-neutral-400 font-mono text-[12px] leading-relaxed">
                Upload MP4, WEBM, or MOV recordings. Extract executive summaries and tasks in seconds.
              </p>
            </div>

            <div
              onClick={() => setView("link")}
              className="bg-[#141619] border-2 border-black rounded-none p-8 cursor-pointer transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] shadow-[4px_4px_0px_0px_#000000] hover:shadow-[6px_6px_0px_0px_#000000] active:translate-x-[0px] active:translate-y-[0px] active:shadow-[2px_2px_0px_0px_#000000] group"
            >
              <div className="w-12 h-12 bg-[#00F0FF] text-black border-2 border-black rounded-none flex items-center justify-center mb-6 shadow-[2px_2px_0px_0px_#000000]">
                <LinkIcon size={24} strokeWidth={2.5} />
              </div>
              <h3 className="text-white font-mono font-black text-[18px] uppercase tracking-wider mb-2 group-hover:text-[#00F0FF] transition-colors">
                Meeting Link
              </h3>
              <p className="text-neutral-400 font-mono text-[12px] leading-relaxed">
                Dispatch our AI bot to Zoom, Google Meet, or Teams to transcribe and analyze live.
              </p>
            </div>
          </div>
        </div>
      )}

      {view === "upload" && (
        <div className="relative z-10">
          <button
            onClick={() => setView("choice")}
            className="flex items-center gap-2 text-neutral-400 hover:text-white mb-8 font-mono text-[12px] uppercase font-bold tracking-wider transition-colors group cursor-pointer"
          >
            <ArrowLeft
              size={16}
              className="group-hover:-translate-x-1 transition-transform"
            />
            <span>// BACK TO SELECTION</span>
          </button>

          <div className="max-w-2xl mx-auto">
            <h3 className="text-[20px] font-mono font-black text-white uppercase tracking-wider mb-2">
              UPLOAD RECORDING
            </h3>
            <p className="text-neutral-400 font-mono text-[12px] uppercase tracking-wider mb-8">
              SELECT VIDEO/AUDIO FILE TO INITIALIZE GEMINI PIPELINE
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-neutral-700 hover:border-[#FFE600] bg-[#121417] rounded-none p-16 flex flex-col items-center justify-center gap-4 cursor-pointer shadow-[4px_4px_0px_0px_#000000] transition-all"
            >
              <div className="w-16 h-16 bg-black border-2 border-black rounded-none flex items-center justify-center text-[#FFE600] shadow-[2px_2px_0px_0px_#000000]">
                <Upload size={32} strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className="text-white font-mono font-bold text-[14px] uppercase tracking-wider">
                  DROP MEDIA FILE HERE OR CLICK TO BROWSE
                </p>
                <p className="text-neutral-500 font-mono text-[11px] mt-1 uppercase tracking-wider">
                  MP4, WEBM, MOV, MP3, WAV UP TO 500MB
                </p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                hidden
                accept="video/*,audio/*"
                onChange={handleFileUpload}
              />
            </div>
          </div>
        </div>
      )}

      {view === "link" && (
        <div className="relative z-10">
          <button
            onClick={() => setView("choice")}
            className="flex items-center gap-2 text-neutral-400 hover:text-white mb-8 font-mono text-[12px] uppercase font-bold tracking-wider transition-colors group cursor-pointer"
          >
            <ArrowLeft
              size={16}
              className="group-hover:-translate-x-1 transition-transform"
            />
            <span>// BACK TO SELECTION</span>
          </button>

          <div className="max-w-2xl mx-auto">
            <h3 className="text-[20px] font-mono font-black text-white uppercase tracking-wider mb-2">
              DISPATCH MEETING BOT
            </h3>
            <p className="text-neutral-400 font-mono text-[12px] uppercase tracking-wider mb-8">
              ENTER LIVE MEETING URL TO DEPLOY OUR RECON BOT
            </p>

            <form onSubmit={handleLinkSubmit} className="space-y-4">
              <input
                type="url"
                required
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-4 text-white font-mono text-[14px] placeholder:text-neutral-600 focus:outline-none focus:border-[#FFE600] shadow-[2px_2px_0px_0px_#000000]"
              />
              <button
                type="submit"
                className="w-full py-4 rounded-none bg-[#FFE600] text-black border-2 border-black font-mono font-black uppercase tracking-wider shadow-[4px_4px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000000] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles size={18} strokeWidth={2.5} />
                DISPATCH BOT TO MEETING
              </button>
            </form>
          </div>
        </div>
      )}

      {(view === "loading" || view === "processing") && (
        <div className="relative z-10 flex flex-col items-center justify-center h-[500px]">
          <div className="relative mb-8">
            <div className="w-20 h-20 border-4 border-black border-t-[#FFE600] rounded-none animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-[#FFE600]">
              <Loader2 size={28} className="animate-spin" />
            </div>
          </div>
          <h3 className="text-white font-mono font-black text-[20px] uppercase tracking-wider mb-2">
            {view === "loading"
              ? "// ANALYZING AUDIO STREAM"
              : "// RECON BOT ACTIVE IN MEETING"}
          </h3>
          <p className="text-neutral-400 font-mono text-[12px] text-center max-w-sm uppercase tracking-wider">
            {view === "loading"
              ? "Gemini 2.5 Flash is extracting audio decisions, MoM, and generating task payloads."
              : "Bot is recording live audio. When the meeting ends, analysis will render here automatically."}
          </p>
          {view === "processing" && (
            <div className="mt-8 flex gap-3">
              <div className="px-3 py-1 bg-[#EF4444] text-white text-[10px] font-mono font-black rounded-none border-2 border-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#000000]">
                <div className="w-2 h-2 rounded-none bg-white animate-ping" />
                LIVE RECORDING
              </div>
              <div className="px-3 py-1 bg-[#FFE600] text-black text-[10px] font-mono font-black rounded-none border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
                POLLING FOR RESULTS
              </div>
            </div>
          )}
        </div>
      )}

      {view === "result" && result && (
        <div className="relative z-10 animate-in fade-in duration-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-4 border-b-2 border-neutral-800">
            <div>
              <button
                onClick={() => setView("choice")}
                className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors font-mono text-[11px] font-bold uppercase tracking-wider mb-2 cursor-pointer"
              >
                <ArrowLeft size={14} /> // BACK TO SELECTION
              </button>
              <h2 className="text-[24px] font-mono font-black uppercase tracking-wide text-white flex items-center gap-3">
                {result.mom.judul_meeting}
                <span className="text-[10px] font-mono font-black bg-[#22C55E] text-black px-2 py-0.5 rounded-none border border-black uppercase tracking-widest shadow-[1px_1px_0px_0px_#000000]">
                  ANALYZED
                </span>
              </h2>
            </div>
            <div className="flex gap-3">
              <button
                onClick={syncToProject}
                disabled={syncing || synced || result.tasks.length === 0}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-none font-mono font-black uppercase text-[12px] tracking-wider transition-all border-2 border-black shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer ${
                  synced
                    ? "bg-[#22C55E] text-black"
                    : "bg-[#FFE600] text-black hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] disabled:opacity-50"
                }`}
              >
                {syncing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>SYNCING BOARD...</span>
                  </>
                ) : synced ? (
                  <>
                    <CheckCircle2 size={16} strokeWidth={3} />
                    <span>BOARD SYNCED!</span>
                  </>
                ) : (
                  <>
                    <Save size={16} strokeWidth={2.5} />
                    <span>COMMIT TASKS TO BOARD</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* MoM Section */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-[#141619] border-2 border-black rounded-none p-6 shadow-[4px_4px_0px_0px_#000000]">
                <h4 className="text-[#FFE600] font-mono text-[11px] font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Sparkles size={14} /> // EXECUTIVE SUMMARY
                </h4>
                <p className="text-neutral-300 font-mono text-[13px] leading-relaxed">
                  {result.mom.ringkasan_eksekutif}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#141619] border-2 border-black rounded-none p-6 shadow-[4px_4px_0px_0px_#000000]">
                  <h4 className="text-white font-mono text-[11px] font-black uppercase tracking-widest mb-4">
                    // KEY DISCUSSION POINTS
                  </h4>
                  <ul className="space-y-3 font-mono text-[12px] text-neutral-300">
                    {result.mom.poin_diskusi.map((pt, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="text-[#FFE600] font-black">→</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-[#141619] border-2 border-black rounded-none p-6 shadow-[4px_4px_0px_0px_#000000]">
                  <h4 className="text-white font-mono text-[11px] font-black uppercase tracking-widest mb-4">
                    // FINAL DECISIONS
                  </h4>
                  <ul className="space-y-3 font-mono text-[12px] text-neutral-300">
                    {result.mom.keputusan_final.map((dec, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="text-[#22C55E] font-black">✓</span>
                        <span>{dec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Tasks Section */}
            <div className="space-y-6">
              <div className="bg-[#121417] border-2 border-black rounded-none p-6 flex flex-col h-full min-h-[400px] shadow-[4px_4px_0px_0px_#000000]">
                <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-neutral-800">
                  <h4 className="text-white font-mono font-black text-[14px] uppercase tracking-wider">
                    // PROPOSED TASKS
                  </h4>
                  <span className="bg-[#FFE600] text-black font-mono font-black text-[10px] px-2 py-0.5 rounded-none border border-black shadow-[1px_1px_0px_0px_#000000]">
                    {result.tasks.length} ITEMS
                  </span>
                </div>

                <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar max-h-[460px]">
                  {result.tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-neutral-500 font-mono text-[12px] gap-2">
                      <CheckCircle2 size={32} className="opacity-20" />
                      <p>// NO TASKS IDENTIFIED.</p>
                    </div>
                  ) : (
                    result.tasks.map((task) => (
                      <div
                        key={task.id}
                        className={`group relative p-3.5 rounded-none border-2 border-black transition-all shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] ${
                          task.completed ? "opacity-50 bg-black" : "bg-[#181B20]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleTask(task.id)}
                            className={`mt-0.5 w-5 h-5 rounded-none border-2 border-black flex items-center justify-center transition-all cursor-pointer ${
                              task.completed
                                ? "bg-[#22C55E] text-black"
                                : "bg-white hover:bg-[#FFE600]"
                            }`}
                          >
                            {task.completed && <CheckCircle2 size={12} strokeWidth={3} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-[13px] font-mono font-bold text-white leading-snug ${
                                task.completed
                                  ? "line-through text-neutral-500"
                                  : ""
                              }`}
                            >
                              {task.title}
                            </p>
                            <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-neutral-400 flex-wrap">
                              <span className="flex items-center gap-1 bg-black px-1.5 py-0.5 border border-neutral-700">
                                <User size={10} /> {task.pic}
                              </span>
                              <span className="flex items-center gap-1 bg-black px-1.5 py-0.5 border border-neutral-700">
                                <Calendar size={10} /> {task.due_date}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded-none border border-black font-black uppercase ${
                                  task.priority === "high"
                                    ? "bg-[#EF4444] text-white"
                                    : task.priority === "medium"
                                    ? "bg-[#F59E0B] text-black"
                                    : "bg-[#22C55E] text-black"
                                }`}
                              >
                                {task.priority}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-[#EF4444] transition-all cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
