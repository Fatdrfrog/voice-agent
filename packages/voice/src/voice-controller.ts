import { EventEmitter } from "node:events";

import {
  type ElevenLabsConfig,
  type OpenAiRealtimeConfig
} from "@voice-dev-agent/contracts";

import {
  OpenAiRealtimeSttClient,
  type RealtimeTranscriptEvent
} from "./openai-realtime-stt.js";
import { ElevenLabsTtsClient } from "./elevenlabs-tts.js";

export interface VoiceControllerEvent {
  type:
    | "transcript.partial"
    | "transcript.final"
    | "tts.started"
    | "tts.stopped"
    | "tts.audio"
    | "error"
    | "state.changed";
  payload: unknown;
}

export class VoiceController extends EventEmitter {
  private readonly stt: OpenAiRealtimeSttClient;
  private readonly tts: ElevenLabsTtsClient;
  private listening = false;

  public constructor(sttConfig: OpenAiRealtimeConfig, ttsConfig: ElevenLabsConfig) {
    super();
    this.stt = new OpenAiRealtimeSttClient(sttConfig);
    this.tts = new ElevenLabsTtsClient(ttsConfig);

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
    this.emitEvent("tts.started", { text });
    try {
      const audioBuffer = await this.tts.synthesize(text);
      this.emitEvent("tts.audio", {
        mimeType: "audio/mpeg",
        base64: audioBuffer.toString("base64")
      });
    } catch (error) {
      this.emitEvent("error", {
        message: error instanceof Error ? error.message : "TTS failed"
      });
    } finally {
      this.emitEvent("tts.stopped", null);
    }
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
}
