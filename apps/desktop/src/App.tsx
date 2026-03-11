import { useEffect, useRef, useState } from "react";

import type { FeatureFlags, VoiceEvent } from "@voice-dev-agent/contracts";

import { VoiceOrb, type VoiceOrbState } from "./components/VoiceOrb";
import { useMicrophone } from "./hooks/useMicrophone";

const HEARD_PLACEHOLDER = "Tap start, then speak naturally.";
const REPLY_PLACEHOLDER = "Jarvis will answer here.";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(payload: unknown, field: string): string {
  if (!isObject(payload)) {
    return "";
  }

  const value = payload[field];
  return typeof value === "string" ? value : "";
}

function getApprovalMessage(payload: unknown): string {
  return (
    getStringField(payload, "prompt") ||
    getStringField(payload, "message") ||
    getStringField(payload, "reason") ||
    "Approval required. Say confirm to proceed or cancel to discard."
  );
}

function normalizeSpeechCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isSpeechInterruptCommand(text: string): boolean {
  const normalized = normalizeSpeechCommand(text);
  return normalized === "stop" || normalized === "stop talking" || normalized === "be quiet" || normalized === "quiet";
}

function getStateLabel(state: VoiceOrbState): string {
  switch (state) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "talking":
      return "Speaking";
    case "error":
      return "Attention";
    default:
      return "Standing By";
  }
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V7a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" />
      <path d="M18 11.75a.75.75 0 0 0-1.5 0 4.5 4.5 0 0 1-9 0 .75.75 0 0 0-1.5 0 5.99 5.99 0 0 0 5.25 5.94V20H9.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-1.75v-2.31A5.99 5.99 0 0 0 18 11.75Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
    </svg>
  );
}

export function App() {
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({
    micMode: true,
    callMode: false,
    autoExecGuarded: true
  });
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready when you are.");
  const [heardText, setHeardText] = useState(HEARD_PLACEHOLDER);
  const [replyText, setReplyText] = useState(REPLY_PLACEHOLDER);
  const [errorMessage, setErrorMessage] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef(false);
  const listeningRef = useRef(false);
  const speakingRef = useRef(false);
  const interruptCooldownUntilRef = useRef(0);

  const { startMic, stopMic } = useMicrophone({
    onChunk: (chunk: number[]) => {
      void window.voiceApi.pushAudioChunk(chunk);
    },
    onError: (message: string) => {
      listeningRef.current = false;
      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
      setIsWorking(false);
      setErrorMessage(message);
      setStatusMessage(`Microphone error: ${message}`);
      void window.voiceApi.stopListening().catch(() => undefined);
    }
  });

  useEffect(() => {
    void window.voiceApi.getFeatureFlags().then((flags) => {
      setFeatureFlags(flags);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.voiceApi.onVoiceEvent((event: VoiceEvent) => {
      switch (event.type) {
        case "transcript.partial": {
          const text = getStringField(event.payload, "text");
          if (text) {
            setHeardText(text);
            setErrorMessage("");

            if (speakingRef.current && Date.now() >= interruptCooldownUntilRef.current && isSpeechInterruptCommand(text)) {
              interruptCooldownUntilRef.current = Date.now() + 1_500;
              interruptSpeechPlayback("Interrupted. Listening.");
              void window.voiceApi.interruptSpeech().catch(() => undefined);
            }
          }
          return;
        }
        case "transcript.final": {
          const text = getStringField(event.payload, "text");
          if (text) {
            setHeardText(text);
            setIsThinking(true);
            setApprovalMessage("");
            setErrorMessage("");
            setStatusMessage("Thinking through your request.");
          }
          return;
        }
        case "agent.reply": {
          const text = getStringField(event.payload, "text");
          if (text) {
            setReplyText(text);
            setIsThinking(false);
            setApprovalMessage("");
            setErrorMessage("");
            setStatusMessage("Reply ready. Preparing voice.");
          }
          return;
        }
        case "tts.started": {
          setIsThinking(false);
          speakingRef.current = true;
          setIsSpeaking(true);
          setErrorMessage("");
          setStatusMessage("Preparing voice.");
          return;
        }
        case "tts.interrupted": {
          interruptSpeechPlayback(getStringField(event.payload, "reason") || "Interrupted. Listening.");
          return;
        }
        case "tts.stopped": {
          if (!audioPlayingRef.current && audioQueueRef.current.length === 0) {
            speakingRef.current = false;
            setIsSpeaking(false);
            setStatusMessage(listeningRef.current ? "Listening." : "Standing by.");
          }
          return;
        }
        case "approval.required": {
          setIsThinking(false);
          setApprovalMessage(getApprovalMessage(event.payload));
          setStatusMessage("Approval required.");
          return;
        }
        case "error": {
          const message = getStringField(event.payload, "message") || "Something failed.";
          setIsThinking(false);
          speakingRef.current = false;
          setIsSpeaking(false);
          setApprovalMessage("");
          setErrorMessage(message);
          setStatusMessage(message);
          return;
        }
        case "state.changed": {
          if (!isObject(event.payload)) {
            return;
          }

          if (typeof event.payload.listening === "boolean") {
            listeningRef.current = event.payload.listening;
            setIsListening(event.payload.listening);
          }

          if (event.payload.health && isObject(event.payload.health) && event.payload.health.reachable === false) {
            const detail = typeof event.payload.health.detail === "string" ? event.payload.health.detail : "Gateway unreachable.";
            setErrorMessage(detail);
            setStatusMessage(detail);
          }

          const message = getStringField(event.payload, "message");
          if (message) {
            setStatusMessage(message);
          }
          return;
        }
        default:
          return;
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const playNextAudioChunk = () => {
      const audio = audioRef.current;
      if (!audio) {
        speakingRef.current = false;
        setIsSpeaking(false);
        setErrorMessage("Audio output is unavailable.");
        setStatusMessage("Audio output is unavailable.");
        audioPlayingRef.current = false;
        audioQueueRef.current = [];
        return;
      }

      const nextSrc = audioQueueRef.current.shift();
      if (!nextSrc) {
        audioPlayingRef.current = false;
        speakingRef.current = false;
        setIsSpeaking(false);
        setStatusMessage(listeningRef.current ? "Listening." : "Standing by.");
        return;
      }

      audioPlayingRef.current = true;
      audio.onended = () => {
        playNextAudioChunk();
      };
      audio.onerror = () => {
        audioPlayingRef.current = false;
        audioQueueRef.current = [];
        speakingRef.current = false;
        setIsSpeaking(false);
        setErrorMessage("Audio playback failed.");
        setStatusMessage("Audio playback failed.");
      };
      audio.src = nextSrc;
      audio.load();
      setIsThinking(false);
      speakingRef.current = true;
      setIsSpeaking(true);
      setStatusMessage("Speaking.");
      void audio.play().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Audio playback failed.";
        audioPlayingRef.current = false;
        audioQueueRef.current = [];
        speakingRef.current = false;
        setIsSpeaking(false);
        setErrorMessage(message);
        setStatusMessage(message);
      });
    };

    const unsubscribe = window.voiceApi.onTtsAudio((payload) => {
      const src = `data:${payload.mimeType};base64,${payload.base64}`;
      audioQueueRef.current.push(src);

      if (!audioPlayingRef.current) {
        playNextAudioChunk();
      }
    });

    return () => {
      audioQueueRef.current = [];
      audioPlayingRef.current = false;
      speakingRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      unsubscribe();
    };
  }, []);

  function interruptSpeechPlayback(reason: string): void {
    interruptCooldownUntilRef.current = Date.now() + 750;
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    speakingRef.current = false;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }

    setIsThinking(false);
    setIsSpeaking(false);
    setErrorMessage("");
    setStatusMessage(reason);
  }

  async function handleStartListening(): Promise<void> {
    if (!featureFlags.micMode) {
      setErrorMessage("Microphone mode is disabled by runtime flags.");
      setStatusMessage("Microphone mode is disabled.");
      return;
    }

    setIsWorking(true);
    setErrorMessage("");
    setApprovalMessage("");
    setStatusMessage("Opening microphone.");

    try {
      await window.voiceApi.startListening();
      await startMic();
      listeningRef.current = true;
      setIsListening(true);
      setStatusMessage("Listening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start listening.";
      listeningRef.current = false;
      setIsListening(false);
      setErrorMessage(message);
      setStatusMessage(message);
      void window.voiceApi.stopListening().catch(() => undefined);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleStopListening(): Promise<void> {
    let failed = false;
    setIsWorking(true);
    setStatusMessage("Stopping microphone.");

    try {
      await stopMic();
      await window.voiceApi.flushAudio();
      await window.voiceApi.stopListening();
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "Failed to stop listening.";
      setErrorMessage(message);
      setStatusMessage(message);
    } finally {
      listeningRef.current = false;
      setIsListening(false);
      setIsThinking(false);
      setIsWorking(false);
      if (!failed) {
        setStatusMessage("Standing by.");
      }
    }
  }

  const orbState: VoiceOrbState = errorMessage
    ? "error"
    : isSpeaking
      ? "talking"
      : isThinking || Boolean(approvalMessage)
        ? "thinking"
        : isListening
          ? "listening"
          : "idle";

  return (
    <main className="jarvis-shell">
      <section className="jarvis-panel">
        <header className="jarvis-header">
          <p className="jarvis-eyebrow">ElevenLabs voice shell, OpenClaw brain</p>
          <div className="jarvis-heading">
            <div>
              <h1>Jarvis</h1>
              <p>{statusMessage}</p>
            </div>
            <span className={`status-pill status-pill--${orbState}`}>{getStateLabel(orbState)}</span>
          </div>
        </header>

        <div className="jarvis-orb-stage">
          <VoiceOrb state={orbState} />
        </div>

        <div className="jarvis-actions">
          <button
            className="action-button action-button--primary"
            onClick={() => void handleStartListening()}
            disabled={isListening || isWorking || !featureFlags.micMode}
          >
            <MicrophoneIcon />
            <span>Start</span>
          </button>
          <button
            className="action-button action-button--secondary"
            onClick={() => void handleStopListening()}
            disabled={!isListening || isWorking}
          >
            <StopIcon />
            <span>Stop</span>
          </button>
        </div>

        {!featureFlags.micMode ? (
          <p className="jarvis-note">Microphone mode is disabled by runtime flags.</p>
        ) : null}

        {approvalMessage ? (
          <section className="signal-card signal-card--approval">
            <p className="signal-card__label">Approval</p>
            <p className="signal-card__value">{approvalMessage}</p>
          </section>
        ) : null}

        {errorMessage ? (
          <section className="signal-card signal-card--error">
            <p className="signal-card__label">Error</p>
            <p className="signal-card__value">{errorMessage}</p>
          </section>
        ) : null}

        <section className="signal-card">
          <p className="signal-card__label">Heard</p>
          <p className={`signal-card__value ${heardText === HEARD_PLACEHOLDER ? "is-placeholder" : ""}`}>
            {heardText}
          </p>
        </section>

        <section className="signal-card">
          <p className="signal-card__label">Reply</p>
          <p className={`signal-card__value ${replyText === REPLY_PLACEHOLDER ? "is-placeholder" : ""}`}>
            {replyText}
          </p>
        </section>

        <footer className="jarvis-footer">
          <span>{isListening ? "Mic open" : "Mic closed"}</span>
          <span>{isSpeaking ? "Voice active" : isThinking ? "Processing" : "Ready"}</span>
        </footer>

        <audio ref={audioRef} preload="auto" hidden />
      </section>
    </main>
  );
}
