/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  canEncodeAudio,
} from "mediabunny";

export type ExtractRequest = { type: "extract"; file: File } | { type: "cancel" };

export type ExtractReply =
  | { type: "progress"; progress: number }
  | { type: "done"; buffer: ArrayBuffer; mimeType: string; extension: string; duration: number }
  /** Not possible here; upload the original. */
  | { type: "skip"; reason: string }
  | { type: "no-audio" };

const SAMPLE_RATE = 48_000;
const BITRATE = 32_000;

let conversion: Conversion | null = null;

const post = (reply: ExtractReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);

async function pickTarget() {
  const options = { numberOfChannels: 1, sampleRate: SAMPLE_RATE };
  if (await canEncodeAudio("opus", options)) {
    return { codec: "opus" as const, format: new OggOutputFormat(), mimeType: "audio/ogg", extension: "ogg" };
  }
  if (await canEncodeAudio("aac", options)) {
    return { codec: "aac" as const, format: new Mp4OutputFormat(), mimeType: "audio/mp4", extension: "m4a" };
  }
  return null;
}

async function extract(file: File) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      post({ type: "no-audio" });
      return;
    }
    const duration = await input.computeDuration();
    const target = await pickTarget();
    if (!target) {
      post({ type: "skip", reason: "this browser cannot encode audio" });
      return;
    }
    const output = new Output({ format: target.format, target: new BufferTarget() });
    conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { numberOfChannels: 1, sampleRate: SAMPLE_RATE, codec: target.codec, bitrate: BITRATE },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => d.reason).join(", ");
      post({ type: "skip", reason: reasons || "the audio cannot be converted here" });
      return;
    }
    conversion.onProgress = (progress) => post({ type: "progress", progress });
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) {
      post({ type: "skip", reason: "the conversion produced nothing" });
      return;
    }
    post({ type: "done", buffer, mimeType: target.mimeType, extension: target.extension, duration }, [buffer]);
  } catch (err) {
    if (err instanceof ConversionCanceledError) return;
    post({ type: "skip", reason: (err as Error)?.message || "unreadable file" });
  } finally {
    conversion = null;
    input.dispose();
  }
}

self.onmessage = (event: MessageEvent<ExtractRequest>) => {
  if (event.data.type === "cancel") {
    void conversion?.cancel();
    return;
  }
  void extract(event.data.file);
};
