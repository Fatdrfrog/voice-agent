import { EventEmitter } from "node:events";

import {
  type ElevenLabsConfig,
  type ElevenLabsScribeConfig,
  type OpenAiRealtimeConfig,
  type SttProvider
} from "@voice-dev-agent/contracts";

import { ElevenLabsScribeSttClient } from "./elevenlabs-scribe-stt.js";
import { ElevenLabsTtsClient } from "./elevenlabs-tts.js";
import { OpenAiRealtimeSttClient } from "./openai-realtime-stt.js";
import type { RealtimeTranscriptEvent } from "./stt-types.js";
import { splitSpeechText } from "./tts-text.js";

interface SpeechToTextClient {
  on(eventName: "realtime:event", listener: (event: RealtimeTranscriptEvent) => void): this;
  connect(): Promise<void>;
  appendPcmChunk(chunk: Int16Array): void;
  commitAudioBuffer(): void;
  close(): void;
}

export interface VoiceControllerConfig {
  sttProvider: SttProvider;
  openAiRealtime?: OpenAiRealtimeConfig;
  elevenLabsScribe?: ElevenLabsScribeConfig;
  elevenLabs: ElevenLabsConfig;
}

export interface VoiceControllerEvent {
  type:
    | "transcript.partial"
    | "transcript.final"
    | "tts.started"
    | "tts.interrupted"
    | "tts.stopped"
    | "tts.audio"
    | "error"
    | "state.changed";
  payload: unknown;
}

export class VoiceController extends EventEmitter {
  private readonly stt: SpeechToTextClient;
  private readonly tts: ElevenLabsTtsClient;
  private listening = false;
  private ttsAbortController: AbortController | null = null;
  private ttsGeneration = 0;
  private synthesizing = false;

  public constructor(config: VoiceControllerConfig) {
    super();
    this.stt = this.createSttClient(config);
    this.tts = new ElevenLabsTtsClient(config.elevenLabs);

    this.stt.on("realtime:event", (event: RealtimeTranscriptEvent) => {
      this.handleSttEvent(event);
    });
  }

  public async startListening(): Promise<void> {
    await this.stt.connect();
    this.listening = true;
    this.emitEvent("state.changed", { listening: true });
  }

  public stopListening(): void {
    this.stt.close();
    this.listening = false;
    this.emitEvent("state.changed", { listening: false });
  }

  public pushAudioChunk(chunk: Int16Array): void {
    if (!this.listening) {
      return;
    }

    this.stt.appendPcmChunk(chunk);
  }

  public flushAudioTurn(): void {
    this.stt.commitAudioBuffer();
  }

  public async speak(text: string): Promise<void> {
    const chunks = splitSpeechText(text);
    if (chunks.length === 0) {
      return;
    }

    const generation = ++this.ttsGeneration;
    this.synthesizing = true;
    this.emitEvent("tts.started", { text, chunkCount: chunks.length });
    try {
      for (const [index, chunk] of chunks.entries()) {
        if (generation !== this.ttsGeneration) {
          return;
        }

        this.ttsAbortController = new AbortController();
        const options = {
          ...(index > 0 ? { previousText: chunks[index - 1] } : {}),
          ...(index < chunks.length - 1 ? { nextText: chunks[index + 1] } : {})
        };
        const audioBuffer = await this.tts.synthesize(chunk, options, this.ttsAbortController.signal);

        if (generation !== this.ttsGeneration) {
          return;
        }

        this.ttsAbortController = null;

        this.emitEvent("tts.audio", {
          mimeType: "audio/mpeg",
          base64: audioBuffer.toString("base64"),
          chunkIndex: index,
          chunkCount: chunks.length
        });
      }
    } catch (error) {
      if (this.isAbortError(error)) {
        return;
      }

      this.emitEvent("error", {
        message: error instanceof Error ? error.message : "TTS failed"
      });
    } finally {
      if (generation === this.ttsGeneration) {
        this.ttsAbortController = null;
        this.synthesizing = false;
        this.emitEvent("tts.stopped", null);
      }
    }
  }

  public interruptSpeech(reason = "Interrupted by user"): boolean {
    const hadActiveSpeech = this.synthesizing || this.ttsAbortController !== null;

    this.ttsGeneration += 1;
    this.synthesizing = false;

    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    if (hadActiveSpeech) {
      this.emitEvent("tts.interrupted", { reason });
      this.emitEvent("tts.stopped", { interrupted: true, reason });
    }

    return hadActiveSpeech;
  }

  private handleSttEvent(event: RealtimeTranscriptEvent): void {
    switch (event.type) {
      case "partial":
        this.emitEvent("transcript.partial", { text: event.text });
        return;
      case "final":
        this.emitEvent("transcript.final", { text: event.text });
        return;
      case "error":
        this.emitEvent("error", { message: event.message });
        return;
      case "state":
        this.emitEvent("state.changed", { stt: event.state });
        return;
      default:
        this.emitEvent("error", { message: "Unknown STT event" });
    }
  }

  private emitEvent(type: VoiceControllerEvent["type"], payload: unknown): void {
    const event: VoiceControllerEvent = {
      type,
      payload
    };
    this.emit("voice:event", event);
  }

  private createSttClient(config: VoiceControllerConfig): SpeechToTextClient {
    if (config.sttProvider === "elevenlabs-scribe") {
      if (!config.elevenLabsScribe) {
        throw new Error("Missing ElevenLabs Scribe config.");
      }
      return new ElevenLabsScribeSttClient(config.elevenLabsScribe);
    }

    if (!config.openAiRealtime) {
      throw new Error("Missing OpenAI Realtime config.");
    }

    return new OpenAiRealtimeSttClient(config.openAiRealtime);
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const name = "name" in error ? error.name : undefined;
    return name === "AbortError";
  }
}
