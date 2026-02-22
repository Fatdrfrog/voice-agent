import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain } from "electron";

import {
  appConfigSchema,
  executionPolicySchema,
  featureFlagsSchema,
  type AppConfig,
  type VoiceEvent
} from "@voice-dev-agent/contracts";
import { VoiceOrchestrator } from "@voice-dev-agent/orchestrator";
import { VoiceController } from "@voice-dev-agent/voice";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(appRoot, ".env") });

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function buildConfig(): AppConfig {
  const workspacesFilePath = process.env.VOICE_DEV_AGENT_WORKSPACES
    ? path.resolve(appRoot, process.env.VOICE_DEV_AGENT_WORKSPACES)
    : path.resolve(appRoot, "config/workspaces.json");

  return appConfigSchema.parse({
    gateway: {
      binary: process.env.OPENCLAW_BINARY ?? "openclaw.cmd",
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
      gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN
    },
    openAiRealtime: {
      apiKey: getRequiredEnv("OPENAI_API_KEY"),
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-mini-transcribe",
      sampleRateHz: 24_000
    },
    elevenLabs: {
      apiKey: getRequiredEnv("ELEVENLABS_API_KEY"),
      voiceId: getRequiredEnv("ELEVENLABS_VOICE_ID"),
      modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
      baseUrl: process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io"
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
      inboundPolicy: "allowlist",
      allowFrom: [],
      responseSystemPromptRef: "docs/prompts/call-system-prompt.md",
      twilioConfigRef: "docs/config/twilio.md"
    },
    featureFlags: featureFlagsSchema.parse({
      micMode: true,
      callMode: true,
      autoExecGuarded: true
    }),
    workspacesFilePath
  });
}

const config = buildConfig();
const orchestrator = new VoiceOrchestrator(config);
const voiceController = new VoiceController(config.openAiRealtime, config.elevenLabs);

let mainWindow: BrowserWindow | null = null;

function forwardEvent(event: VoiceEvent): void {
  mainWindow?.webContents.send("voice:event", event);
}

orchestrator.on("voice:event", async (event: VoiceEvent) => {
  forwardEvent(event);

  if (event.type === "agent.reply") {
    const payload = event.payload as { text?: string };
    if (payload.text) {
      await voiceController.speak(payload.text);
    }
  }
});

voiceController.on("voice:event", async (event: { type: string; payload: unknown }) => {
  if (event.type === "transcript.partial") {
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
    const payload = event.payload as { text?: string };
    if (payload.text) {
      await orchestrator.handleTranscript(payload.text);
    }
    return;
  }

  if (event.type === "tts.audio") {
    mainWindow?.webContents.send("voice:tts-audio", event.payload);
    return;
  }

  if (event.type === "error") {
    forwardEvent({
      type: "error",
      sessionId: orchestrator.getCurrentWorkspace().defaultSessionKey,
      workspaceId: orchestrator.getCurrentWorkspace().id,
      timestamp: new Date().toISOString(),
      payload: event.payload
    });
  }
});

function createWindow(): void {
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
    void mainWindow.loadFile(path.join(appRoot, "apps/desktop/dist/index.html"));
  }
}

ipcMain.handle("voice:start-listening", async () => {
  orchestrator.startListening();
  await voiceController.startListening();
});

ipcMain.handle("voice:stop-listening", async () => {
  voiceController.stopListening();
  orchestrator.stopListening();
});

ipcMain.handle("voice:pause-listening", async () => {
  orchestrator.pause();
});

ipcMain.handle("voice:resume-listening", async () => {
  orchestrator.resume();
});

ipcMain.handle("voice:submit-transcript", async (_event, text: string) => {
  await orchestrator.handleTranscript(text);
});

ipcMain.handle("voice:audio-chunk", (_event, chunk: number[]) => {
  voiceController.pushAudioChunk(new Int16Array(chunk));
});

ipcMain.handle("voice:flush-audio", () => {
  voiceController.flushAudioTurn();
});

ipcMain.handle("workspace:list", () => orchestrator.listWorkspaces());
ipcMain.handle("workspace:switch", (_event, workspaceId: string) => {
  orchestrator.switchWorkspace(workspaceId);
});
ipcMain.handle("gateway:health", async () => {
  await orchestrator.getGatewayHealth();
});
ipcMain.handle("gateway:status", async () => {
  await orchestrator.getGatewayStatus();
});
ipcMain.handle("allowlist:add", async (_event, pattern: string) => {
  await orchestrator.addAllowlistCommand(pattern);
});
ipcMain.handle("allowlist:remove", async (_event, pattern: string) => {
  await orchestrator.removeAllowlistCommand(pattern);
});
ipcMain.handle("approvals:fetch", async () => {
  await orchestrator.fetchApprovalsSnapshot();
});
ipcMain.handle("acp:snippets", () => orchestrator.getAcpSnippets());
ipcMain.handle("call:status", async (_event, callId: string) => {
  await orchestrator.getCallStatus(callId);
});
ipcMain.handle("call:end", async (_event, callId: string) => {
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
