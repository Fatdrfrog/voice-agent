import { EventEmitter } from "node:events";

import WebSocket from "ws";

import type { ElevenLabsScribeConfig } from "@voice-dev-agent/contracts";

import type { RealtimeTranscriptEvent } from "./stt-types.js";

function encodeInt16Pcm(chunk: Int16Array): string {
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("base64");
}

export class ElevenLabsScribeSttClient extends EventEmitter {
  private readonly config: ElevenLabsScribeConfig;
  private ws: WebSocket | null = null;

  public constructor(config: ElevenLabsScribeConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.emitEvent({ type: "state", state: "connecting" });

    const url = new URL(this.config.wsUrl);
    url.searchParams.set("model_id", this.config.modelId);
    url.searchParams.set("audio_format", this.config.audioFormat);
    url.searchParams.set("commit_strategy", this.config.commitStrategy);
    if (this.config.languageCode) {
      url.searchParams.set("language_code", this.config.languageCode);
    }
    url.searchParams.set("include_timestamps", String(this.config.includeTimestamps));
    url.searchParams.set("include_language_detection", String(this.config.includeLanguageDetection));
    url.searchParams.set("vad_silence_threshold_secs", String(this.config.vadSilenceThresholdSecs));
    url.searchParams.set("vad_threshold", String(this.config.vadThreshold));
    url.searchParams.set("min_speech_duration_ms", String(this.config.minSpeechDurationMs));
    url.searchParams.set("min_silence_duration_ms", String(this.config.minSilenceDurationMs));

    this.ws = new WebSocket(url, {
      headers: {
        "xi-api-key": this.config.apiKey
      }
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Realtime socket was not initialized."));
        return;
      }

      this.ws.once("open", () => {
        this.emitEvent({ type: "state", state: "connected" });
        resolve();
      });

      this.ws.once("error", (error: Error) => {
        this.emitEvent({ type: "error", message: error.message });
        reject(error);
      });

      this.ws.on("message", (raw: WebSocket.RawData) => {
        this.handleMessage(raw.toString());
      });

      this.ws.on("close", () => {
        this.emitEvent({ type: "state", state: "closed" });
      });
    });
  }

  public appendPcmChunk(chunk: Int16Array): void {
    if (!this.isOpen()) {
      return;
    }

    this.send({
      message_type: "input_audio_chunk",
      audio_base_64: encodeInt16Pcm(chunk),
      sample_rate: this.config.sampleRateHz
    });
  }

  public commitAudioBuffer(): void {
    if (!this.isOpen() || this.config.commitStrategy !== "manual") {
      return;
    }

    // ElevenLabs manual commit is sent on the chunk envelope. A zero-length
    // chunk is enough to flush whatever audio the server already buffered.
    this.send({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      sample_rate: this.config.sampleRateHz,
      commit: true
    });
  }

  public close(): void {
    if (!this.ws) {
      return;
    }

    this.ws.close();
    this.ws = null;
  }

  private isOpen(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string): void {
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const type = typeof payload.message_type === "string" ? payload.message_type : "";

      if (type === "partial_transcript") {
        const text = this.extractText(payload);
        if (text) {
          const detectedLanguageCode = this.extractLanguageCode(payload);
          this.emitEvent({
            type: "partial",
            text,
            ...(detectedLanguageCode ? { languageCode: detectedLanguageCode } : {})
          });
        }
        return;
      }

      if (type === "committed_transcript" || type === "committed_transcript_with_timestamps") {
        const detectedLanguageCode = this.extractLanguageCode(payload);
        if (!this.shouldAcceptTranscript(detectedLanguageCode)) {
          return;
        }

        const text = this.extractText(payload);
        if (text) {
          this.emitEvent({
            type: "final",
            text,
            ...(detectedLanguageCode ? { languageCode: detectedLanguageCode } : {})
          });
        }
        return;
      }

      if (type.endsWith("_error") || type === "error") {
        this.emitEvent({
          type: "error",
          message: this.extractErrorMessage(payload)
        });
      }
    } catch (error) {
      this.emitEvent({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to parse realtime payload"
      });
    }
  }

  private extractText(payload: Record<string, unknown>): string {
    const directText = payload.text;
    if (typeof directText === "string") {
      return directText.trim();
    }

    const transcript = payload.transcript;
    if (typeof transcript === "string") {
      return transcript.trim();
    }

    const words = payload.words;
    if (Array.isArray(words)) {
      const text = words
        .map((word) => {
          if (!word || typeof word !== "object") {
            return "";
          }

          const token = (word as { text?: unknown; word?: unknown }).text ?? (word as { word?: unknown }).word;
          return typeof token === "string" ? token : "";
        })
        .join(" ")
        .trim();

      if (text) {
        return text;
      }
    }

    return "";
  }

  private extractErrorMessage(payload: Record<string, unknown>): string {
    const direct = payload.message;
    if (typeof direct === "string" && direct) {
      return direct;
    }

    const nestedError = payload.error;
    if (nestedError && typeof nestedError === "object") {
      const nestedMessage = (nestedError as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage) {
        return nestedMessage;
      }
    }

    return "Unknown ElevenLabs Scribe realtime error";
  }

  private extractLanguageCode(payload: Record<string, unknown>): string | undefined {
    const direct = payload.language_code;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim().toLowerCase();
    }

    const nested = payload.language;
    if (nested && typeof nested === "object") {
      const code = (nested as { code?: unknown }).code;
      if (typeof code === "string" && code.trim()) {
        return code.trim().toLowerCase();
      }
    }

    return undefined;
  }

  private shouldAcceptTranscript(detectedLanguageCode: string | undefined): boolean {
    if (!this.config.languageCode || !detectedLanguageCode) {
      return true;
    }

    const expected = this.config.languageCode.trim().toLowerCase();
    return detectedLanguageCode === expected;
  }

  private emitEvent(event: RealtimeTranscriptEvent): void {
    this.emit("realtime:event", event);
  }
}
