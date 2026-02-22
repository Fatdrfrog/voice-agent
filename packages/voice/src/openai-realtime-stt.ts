import { EventEmitter } from "node:events";

import WebSocket from "ws";

import type { OpenAiRealtimeConfig } from "@voice-dev-agent/contracts";

export interface RealtimeTranscriptPartial {
  type: "partial";
  text: string;
}

export interface RealtimeTranscriptFinal {
  type: "final";
  text: string;
}

export interface RealtimeTranscriptError {
  type: "error";
  message: string;
}

export interface RealtimeTranscriptState {
  type: "state";
  state: "connecting" | "connected" | "closed";
}

export type RealtimeTranscriptEvent =
  | RealtimeTranscriptPartial
  | RealtimeTranscriptFinal
  | RealtimeTranscriptError
  | RealtimeTranscriptState;

function encodeInt16Pcm(chunk: Int16Array): string {
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("base64");
}

export class OpenAiRealtimeSttClient extends EventEmitter {
  private readonly config: OpenAiRealtimeConfig;
  private ws: WebSocket | null = null;

  public constructor(config: OpenAiRealtimeConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.emitEvent({ type: "state", state: "connecting" });

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.model)}`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Realtime socket was not initialized."));
        return;
      }

      this.ws.once("open", () => {
        this.emitEvent({ type: "state", state: "connected" });

        // Configure server-side VAD + transcription defaults.
        this.send({
          type: "session.update",
          session: {
            modalities: ["text"],
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: this.config.model
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 250,
              silence_duration_ms: 500
            }
          }
        });

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
      type: "input_audio_buffer.append",
      audio: encodeInt16Pcm(chunk)
    });
  }

  public commitAudioBuffer(): void {
    if (!this.isOpen()) {
      return;
    }

    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
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
      const type = typeof payload.type === "string" ? payload.type : "";

      if (
        type === "conversation.item.input_audio_transcription.delta" ||
        type === "response.audio_transcript.delta"
      ) {
        const text = this.extractText(payload);
        if (text) {
          this.emitEvent({ type: "partial", text });
        }
        return;
      }

      if (
        type === "conversation.item.input_audio_transcription.completed" ||
        type === "response.audio_transcript.done"
      ) {
        const text = this.extractText(payload);
        if (text) {
          this.emitEvent({ type: "final", text });
        }
        return;
      }

      if (type === "error") {
        const errorObj = payload.error as { message?: string } | undefined;
        this.emitEvent({
          type: "error",
          message: errorObj?.message ?? "Unknown realtime error"
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
    const direct = payload.transcript;
    if (typeof direct === "string") {
      return direct;
    }

    const delta = payload.delta;
    if (typeof delta === "string") {
      return delta;
    }

    const text = payload.text;
    if (typeof text === "string") {
      return text;
    }

    return "";
  }

  private emitEvent(event: RealtimeTranscriptEvent): void {
    this.emit("realtime:event", event);
  }
}
