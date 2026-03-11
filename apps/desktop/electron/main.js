import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain } from "electron";

import {
  appConfigSchema,
  executionPolicySchema,
  featureFlagsSchema
} from "@voice-dev-agent/contracts";
import { VoiceOrchestrator } from "@voice-dev-agent/orchestrator";
import { VoiceController } from "@voice-dev-agent/voice";
import {
  isDuplicateTranscriptSegment,
  joinTranscriptSegments,
  sanitizeTranscriptSegment
} from "./transcript-coalescer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

dotenv.config({ path: path.join(repoRoot, ".env") });

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function getNumberEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultOpenClawBinary() {
  return process.platform === "win32" ? "openclaw.cmd" : "openclaw";
}

function buildGatewayConfig() {
  const wslDistro = process.env.OPENCLAW_WSL_DISTRO;
  if (process.platform === "win32" && wslDistro) {
    return {
      binary: "wsl.exe",
      binaryArgs: ["-d", wslDistro, "--", "openclaw"],
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
      gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN
    };
  }

  return {
    binary: process.env.OPENCLAW_BINARY ?? getDefaultOpenClawBinary(),
    binaryArgs: [],
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN
  };
}

function buildConfig() {
  const micMode = getBooleanEnv("VOICE_DEV_AGENT_MIC_MODE", true);
  const callMode = getBooleanEnv("VOICE_DEV_AGENT_CALL_MODE", false);
  const autoExecGuarded = getBooleanEnv("VOICE_DEV_AGENT_AUTO_EXEC_GUARDED", true);
  const sttProvider = process.env.VOICE_DEV_AGENT_STT_PROVIDER ?? "openai-realtime";

  const workspacesFilePath = process.env.VOICE_DEV_AGENT_WORKSPACES
    ? path.resolve(repoRoot, process.env.VOICE_DEV_AGENT_WORKSPACES)
    : path.resolve(repoRoot, "config/workspaces.json");

  return appConfigSchema.parse({
    gateway: buildGatewayConfig(),
    sttProvider,
    openAiRealtime: sttProvider === "openai-realtime"
      ? {
          apiKey: getRequiredEnv("OPENAI_API_KEY"),
          model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-mini-transcribe",
          sampleRateHz: 24_000
        }
      : undefined,
    elevenLabsScribe: sttProvider === "elevenlabs-scribe"
      ? {
          apiKey: getRequiredEnv("ELEVENLABS_API_KEY"),
          modelId: process.env.ELEVENLABS_SCRIBE_MODEL_ID ?? "scribe_v2_realtime",
          wsUrl: process.env.ELEVENLABS_SCRIBE_WS_URL ?? "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
          languageCode: process.env.ELEVENLABS_SCRIBE_LANGUAGE_CODE,
          includeTimestamps: getBooleanEnv("ELEVENLABS_SCRIBE_INCLUDE_TIMESTAMPS", true),
          includeLanguageDetection: getBooleanEnv("ELEVENLABS_SCRIBE_INCLUDE_LANGUAGE_DETECTION", true),
          sampleRateHz: 24_000,
          audioFormat: process.env.ELEVENLABS_SCRIBE_AUDIO_FORMAT ?? "pcm_24000",
          commitStrategy: process.env.ELEVENLABS_SCRIBE_COMMIT_STRATEGY ?? "vad",
          vadSilenceThresholdSecs: getNumberEnv("ELEVENLABS_SCRIBE_VAD_SILENCE_THRESHOLD_SECS", 0.45),
          vadThreshold: getNumberEnv("ELEVENLABS_SCRIBE_VAD_THRESHOLD", 0.4),
          minSpeechDurationMs: getNumberEnv("ELEVENLABS_SCRIBE_MIN_SPEECH_DURATION_MS", 80),
          minSilenceDurationMs: getNumberEnv("ELEVENLABS_SCRIBE_MIN_SILENCE_DURATION_MS", 80)
        }
      : undefined,
    elevenLabs: {
      apiKey: getRequiredEnv("ELEVENLABS_API_KEY"),
      voiceId: getRequiredEnv("ELEVENLABS_VOICE_ID"),
      modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
      baseUrl: process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io",
      outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT ?? "mp3_22050_32",
      voiceSpeed: getNumberEnv("ELEVENLABS_VOICE_SPEED", 1.05)
    },
    executionPolicy: executionPolicySchema.parse({
      host: "node",
      security: "allowlist",
      ask: "on-miss",
      allowlistedBins: [],
      blockedPatterns: ["rm\\\\s+-rf", "del\\\\s+/f", "format\\\\s+c:"],
      confirmationRequiredPatterns: ["delete", "remove", "drop database", "reset"]
    }),
    callPolicy: {
      inboundPolicy: callMode ? "allowlist" : "disabled",
      allowFrom: [],
      responseSystemPromptRef: "docs/prompts/call-system-prompt.md",
      twilioConfigRef: "docs/config/twilio.md"
    },
    featureFlags: featureFlagsSchema.parse({
      micMode,
      callMode,
      autoExecGuarded
    }),
    workspacesFilePath
  });
}

const config = buildConfig();
const orchestrator = new VoiceOrchestrator(config);
const voiceController = new VoiceController({
  sttProvider: config.sttProvider,
  openAiRealtime: config.openAiRealtime,
  elevenLabsScribe: config.elevenLabsScribe,
  elevenLabs: config.elevenLabs
});

let mainWindow = null;
let suppressInterruptTranscriptUntil = 0;
let speechOutputActive = false;
let pendingTranscriptSegments = [];
let transcriptFlushTimer = null;
const TRANSCRIPT_FLUSH_DELAY_MS = getNumberEnv("VOICE_DEV_AGENT_TRANSCRIPT_FLUSH_DELAY_MS", 450);

function normalizeSpeechCommand(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isSpeechInterruptCommand(text) {
  const normalized = normalizeSpeechCommand(text);
  return normalized === "stop" || normalized === "stop talking" || normalized === "be quiet" || normalized === "quiet";
}

function shouldSuppressInterruptedTranscript(text) {
  if (Date.now() > suppressInterruptTranscriptUntil) {
    suppressInterruptTranscriptUntil = 0;
    return false;
  }

  return isSpeechInterruptCommand(text);
}

function appendTranscriptSegment(text) {
  const trimmed = sanitizeTranscriptSegment(text);
  if (!trimmed) {
    return;
  }

  const lastSegment = pendingTranscriptSegments.at(-1);
  if (lastSegment && isDuplicateTranscriptSegment(lastSegment, trimmed)) {
    return;
  }

  pendingTranscriptSegments.push(trimmed);
}

function clearPendingTranscriptSegments() {
  pendingTranscriptSegments = [];
  if (transcriptFlushTimer) {
    clearTimeout(transcriptFlushTimer);
    transcriptFlushTimer = null;
  }
}

async function flushPendingTranscriptSegments() {
  if (transcriptFlushTimer) {
    clearTimeout(transcriptFlushTimer);
    transcriptFlushTimer = null;
  }

  const transcript = sanitizeTranscriptSegment(joinTranscriptSegments(pendingTranscriptSegments));
  pendingTranscriptSegments = [];

  if (!transcript) {
    return;
  }

  await orchestrator.handleTranscript(transcript);
}

function scheduleTranscriptFlush() {
  if (transcriptFlushTimer) {
    clearTimeout(transcriptFlushTimer);
  }

  transcriptFlushTimer = setTimeout(() => {
    void flushPendingTranscriptSegments();
  }, TRANSCRIPT_FLUSH_DELAY_MS);
}

function getPayloadText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const text = payload.text;
  return typeof text === "string" ? text : "";
}

function forwardEvent(event) {
  mainWindow?.webContents.send("voice:event", event);
}

function emitRendererEvent(type, payload) {
  forwardEvent({
    type,
    sessionId: orchestrator.getCurrentWorkspace().defaultSessionKey,
    workspaceId: orchestrator.getCurrentWorkspace().id,
    timestamp: new Date().toISOString(),
    payload
  });
}

orchestrator.on("voice:event", async (event) => {
  forwardEvent(event);

  if (event.type === "agent.reply") {
    const text = getPayloadText(event.payload);
    if (text) {
      await voiceController.speak(text);
    }
  }
});

voiceController.on("voice:event", async (event) => {
  if (event.type === "transcript.partial") {
    const text = getPayloadText(event.payload);
    if (speechOutputActive && !isSpeechInterruptCommand(text)) {
      return;
    }

    forwardEvent({
      type: "transcript.partial",
      sessionId: orchestrator.getCurrentWorkspace().defaultSessionKey,
      workspaceId: orchestrator.getCurrentWorkspace().id,
      timestamp: new Date().toISOString(),
      payload: event.payload
    });
    return;
  }

  if (event.type === "transcript.final") {
    const text = getPayloadText(event.payload);
    if (!text) {
      return;
    }

    if (speechOutputActive && !isSpeechInterruptCommand(text)) {
      clearPendingTranscriptSegments();
      return;
    }

    if (shouldSuppressInterruptedTranscript(text)) {
      suppressInterruptTranscriptUntil = 0;
      clearPendingTranscriptSegments();
      return;
    }

    if (isSpeechInterruptCommand(text)) {
      suppressInterruptTranscriptUntil = Date.now() + 4_000;
      clearPendingTranscriptSegments();
      voiceController.interruptSpeech("Interrupted by voice command.");
      emitRendererEvent("tts.interrupted", { reason: "Interrupted by voice command." });
      return;
    }

    appendTranscriptSegment(text);
    scheduleTranscriptFlush();
    return;
  }

  if (event.type === "tts.audio") {
    mainWindow?.webContents.send("voice:tts-audio", event.payload);
    return;
  }

  if (event.type === "tts.started") {
    speechOutputActive = true;
  }

  if (event.type === "tts.stopped" || event.type === "tts.interrupted") {
    speechOutputActive = false;
  }

  if (event.type === "error") {
    emitRendererEvent("error", event.payload);
    return;
  }

  emitRendererEvent(event.type, event.payload);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#111827",
    title: "Voice Dev Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(repoRoot, "apps/desktop/dist/index.html"));
  }
}

ipcMain.handle("voice:start-listening", async () => {
  clearPendingTranscriptSegments();
  orchestrator.startListening();
  await voiceController.startListening();
});

ipcMain.handle("voice:stop-listening", async () => {
  await flushPendingTranscriptSegments();
  voiceController.stopListening();
  orchestrator.stopListening();
});

ipcMain.handle("voice:pause-listening", async () => {
  orchestrator.pause();
});

ipcMain.handle("voice:resume-listening", async () => {
  orchestrator.resume();
});

ipcMain.handle("voice:submit-transcript", async (_event, text) => {
  clearPendingTranscriptSegments();
  await orchestrator.handleTranscript(text);
});

ipcMain.handle("voice:audio-chunk", (_event, chunk) => {
  voiceController.pushAudioChunk(new Int16Array(chunk));
});

ipcMain.handle("voice:flush-audio", () => {
  voiceController.flushAudioTurn();
});
ipcMain.handle("voice:interrupt-speech", () => {
  suppressInterruptTranscriptUntil = Date.now() + 4_000;
  clearPendingTranscriptSegments();
  const interrupted = voiceController.interruptSpeech("Interrupted by voice command.");
  if (!interrupted) {
    emitRendererEvent("tts.interrupted", { reason: "Interrupted by voice command." });
  }
});

ipcMain.handle("workspace:list", () => orchestrator.listWorkspaces());
ipcMain.handle("workspace:switch", (_event, workspaceId) => {
  orchestrator.switchWorkspace(workspaceId);
});
ipcMain.handle("gateway:health", async () => {
  await orchestrator.getGatewayHealth();
});
ipcMain.handle("gateway:status", async () => {
  await orchestrator.getGatewayStatus();
});
ipcMain.handle("allowlist:add", async (_event, pattern) => {
  await orchestrator.addAllowlistCommand(pattern);
});
ipcMain.handle("allowlist:remove", async (_event, pattern) => {
  await orchestrator.removeAllowlistCommand(pattern);
});
ipcMain.handle("approvals:fetch", async () => {
  await orchestrator.fetchApprovalsSnapshot();
});
ipcMain.handle("acp:snippets", () => orchestrator.getAcpSnippets());
ipcMain.handle("feature-flags:get", () => config.featureFlags);
ipcMain.handle("call:status", async (_event, callId) => {
  await orchestrator.getCallStatus(callId);
});
ipcMain.handle("call:end", async (_event, callId) => {
  await orchestrator.endCall(callId);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
