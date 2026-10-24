import { useSyncExternalStore } from "react";
import { resolveApiUrl } from "./apiClient";
import { meetingJobService, type MeetingIntakeFields } from "./meetingJobService";
import { meetingService } from "./meetingService";
import type { ExtractReply } from "./audioExtract.worker";

export type UploadStage = "extracting" | "uploading" | "finishing" | "done" | "failed";

export interface MeetingUpload {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
  stage: UploadStage;
  progress: number;
  extracted: boolean;
  bytes: number;
  jobId?: string;
  meetingId?: string;
  error?: string;
}

export const RECORDING_ACCEPT = "audio/*,video/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,.mov,.mkv,.aac,.flac";
/** Must match the API's `max_upload_mb`. */
export const MAX_UPLOAD_MB = 1024;

interface Running {
  worker?: Worker;
  xhr?: XMLHttpRequest;
  cancelled: boolean;
}

let uploads: MeetingUpload[] = [];
const running = new Map<string, Running>();
const listeners = new Set<() => void>();

const emit = () => {
  uploads = uploads.slice();
  listeners.forEach((l) => l());
};

const patch = (id: string, change: Partial<MeetingUpload>) => {
  const index = uploads.findIndex((u) => u.id === id);
  if (index === -1) return;
  uploads[index] = { ...uploads[index], ...change };
  emit();
};

const isActive = (u: MeetingUpload) => u.stage === "extracting" || u.stage === "uploading" || u.stage === "finishing";

const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
  if (uploads.some(isActive)) {
    event.preventDefault();
    event.returnValue = "";
  }
};
if (typeof window !== "undefined") window.addEventListener("beforeunload", warnBeforeLeaving);

class Cancelled extends Error {}

/** Extracted audio, or `null` to send the original file. Throws when the file has no audio. */
function extractAudio(id: string, file: File, run: Running): Promise<{ blob: Blob; extension: string; duration: number } | null> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./audioExtract.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    run.worker = worker;
    const finish = () => {
      worker.terminate();
      run.worker = undefined;
    };
    worker.onmessage = (event: MessageEvent<ExtractReply>) => {
      const reply = event.data;
      if (reply.type === "progress") {
        patch(id, { progress: Math.min(1, Math.max(0, reply.progress)) });
      } else if (reply.type === "done") {
        finish();
        resolve({ blob: new Blob([reply.buffer], { type: reply.mimeType }), extension: reply.extension, duration: reply.duration });
      } else if (reply.type === "no-audio") {
        finish();
        reject(new Error("This file has no audio track."));
      } else {
        finish();
        console.info(`Uploading the original recording: ${reply.reason}`);
        resolve(null);
      }
    };
    worker.onerror = () => {
      finish();
      resolve(null);
    };
    worker.postMessage({ type: "extract", file });
  });
}

function put(id: string, url: string, headers: Record<string, string>, body: Blob, run: Running): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    run.xhr = xhr;
    xhr.open("PUT", url.startsWith("/") ? resolveApiUrl(url) : url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) patch(id, { progress: event.loaded / event.total });
    };
    xhr.onload = () => {
      run.xhr = undefined;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`The upload was refused (${xhr.status}${xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : ""})`));
    };
    xhr.onerror = () => {
      run.xhr = undefined;
      reject(new Error("The upload failed: the connection dropped or storage refused it (check its CORS rule)."));
    };
    xhr.onabort = () => {
      run.xhr = undefined;
      reject(new Cancelled());
    };
    xhr.send(body);
  });
}

async function completeWithRetry(jobId: string) {
  // Storage may take a moment to show a fresh upload.
  for (let attempt = 0; ; attempt++) {
    try {
      return await meetingJobService.completeUpload(jobId);
    } catch (err) {
      if (attempt >= 3 || !/not arrived/i.test((err as Error).message)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function run(id: string, file: File, fields: MeetingIntakeFields) {
  const job = running.get(id)!;
  const check = () => {
    if (job.cancelled) throw new Cancelled();
  };
  try {
    const extracted = await extractAudio(id, file, job);
    check();
    const body: Blob = extracted?.blob ?? file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "recording";
    const fileName = extracted ? `${baseName}.${extracted.extension}` : file.name;
    if (body.size > MAX_UPLOAD_MB * 1024 * 1024) {
      throw new Error(`The recording is ${Math.ceil(body.size / 1024 / 1024)} MB and its audio could not be extracted here; the limit is ${MAX_UPLOAD_MB} MB.`);
    }
    patch(id, { stage: "uploading", progress: 0, extracted: Boolean(extracted), bytes: body.size });

    const created = await meetingJobService.createMediaJob({
      ...fields,
      file_name: fileName,
      content_type: body.type || undefined,
      size_bytes: body.size,
      duration_sec: extracted?.duration,
    });
    patch(id, { jobId: created.job.id, meetingId: String(created.meeting.id) });
    check();
    await put(id, created.upload.url, created.upload.headers, body, job);
    check();

    patch(id, { stage: "finishing", progress: 1 });
    await completeWithRetry(created.job.id);
    patch(id, { stage: "done" });
    setTimeout(() => dismissMeetingUpload(id), 6000);
  } catch (err) {
    if (err instanceof Cancelled || job.cancelled) return;
    patch(id, { stage: "failed", error: (err as Error).message || "The upload failed." });
  } finally {
    running.delete(id);
  }
}

/** Starts a recording upload in the background and returns its id. */
export function startMeetingUpload(file: File, fields: MeetingIntakeFields & { title?: string }): string {
  const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  uploads = [
    ...uploads,
    {
      id,
      projectId: String(fields.project_id),
      title: fields.title || file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      stage: "extracting",
      progress: 0,
      extracted: false,
      bytes: file.size,
    },
  ];
  running.set(id, { cancelled: false });
  emit();
  void run(id, file, fields);
  return id;
}

/** Stops an upload; a meeting already created for it is deleted, with its partial file. */
export async function cancelMeetingUpload(id: string) {
  const job = running.get(id);
  const upload = uploads.find((u) => u.id === id);
  if (job) {
    job.cancelled = true;
    job.worker?.postMessage({ type: "cancel" });
    job.worker?.terminate();
    job.xhr?.abort();
  }
  dismissMeetingUpload(id);
  if (upload?.meetingId && upload.stage !== "done") {
    try {
      await meetingService.deleteMeeting(upload.meetingId);
    } catch (err) {
      console.error("Could not remove the cancelled upload's meeting", err);
    }
  }
}

export function dismissMeetingUpload(id: string) {
  uploads = uploads.filter((u) => u.id !== id);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => uploads;

export function useMeetingUploads(): MeetingUpload[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
