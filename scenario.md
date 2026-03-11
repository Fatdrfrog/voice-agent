# Scenario Guide: OpenClaw Terminal to Voice Desktop App

This session should feel like a guided product tour, not a heavy live-coding session.
The plan is to explain the architecture in plain language, then paste in ready-made files one by one and briefly explain what each file is doing.

## Session Goal

By the end of the session, the audience should understand this simple story:

1. OpenClaw is the guarded agent runtime.
2. Electron is the desktop shell.
3. IPC connects the safe browser UI to the Node/Electron side.
4. ElevenLabs Scribe turns microphone audio into text.
5. OpenClaw handles the request safely.
6. ElevenLabs TTS speaks the answer back.

Do not try to teach every implementation detail.
Keep the explanation focused on "what role does this layer play?" and "why do we need it?"

## Agenda

Open with the agenda so people know what they are looking at today.

1. `OpenClaw`
   - What it is
   - Why we use it instead of letting the UI run commands directly
   - Security model: gateway, workspaces, approvals, allowlists
2. `Protocols and moving parts`
   - `IPC`: messages between Electron renderer and Electron main
   - `WebSocket`: realtime connection for speech-to-text and agent connectivity
   - `STT`: speech to text
   - `TTS`: text to speech
3. `Terminal-first demo`
   - Show OpenClaw in PowerShell before showing the app
4. `Electron app assembly`
   - Paste ready files in a sensible order
   - Explain main, preload, renderer, and microphone capture
5. `Voice layer`
   - Add ElevenLabs Scribe for input
   - Add ElevenLabs TTS for output
6. `End-to-end demo`
   - Speak -> transcript -> OpenClaw -> reply -> spoken response

## The Simple Narrative

Use one sentence early and keep repeating it:

> "First we show the brain in the terminal, then we add the desktop shell, then we give it ears and a voice."

That keeps the session easy to follow.

## Step 1: Explain OpenClaw First

Start here before touching the app.

### What OpenClaw is

Explain it simply:

- OpenClaw is the agent runtime and control layer.
- It is the part that knows how to talk to tools safely.
- It gives us a gateway and a command surface instead of making the UI execute shell commands by itself.

In this repo, OpenClaw is used through:

- `packages/openclaw-bridge/src/openclaw-bridge.ts`
  - Wraps the `openclaw` CLI.
  - Runs commands like status, approvals, gateway health, and agent turns.
- `packages/orchestrator/src/voice-orchestrator.ts`
  - Receives finalized transcripts.
  - Decides whether this is a normal request, a control command, or something that needs confirmation.
  - Sends the safe request to OpenClaw.

### What to say about tools, skills, gateway

Keep it high-level:

- `Tools`
  - Tools are the actions the agent can use.
  - In practice, think "things the agent is allowed to call."
- `Skills`
  - Skills are reusable behavior or workflow packages.
  - They are more about guidance and repeatable patterns than raw execution.
  - This repo is mostly consuming OpenClaw as a runtime, not building a big custom skill library inside it.
- `Gateway`
  - The gateway is the network entry point for agent communication.
  - In this project the default URL is `ws://127.0.0.1:18789`.
  - It lets different clients talk to the same agent/session safely.

### What to say about security

This part matters. Keep it concrete.

- `config/workspaces.json`
  - Defines which workspace paths are allowed.
  - This is the boundary that stops the agent from wandering around the whole machine.
- `docs/safety-policy.md`
  - Documents the default posture: allowlist security, ask on miss, confirmation for risky actions.
- `docs/acp-setup.md`
  - Shows the stable session key idea, so voice and IDE can share context.

Important teaching line:

> "The UI is not trusted to run commands. The UI asks the orchestrator, the orchestrator checks policy, and OpenClaw is the guarded executor."

## Step 2: Show OpenClaw in PowerShell

Before opening the app, prove that the backend story is real.

Use PowerShell for the demo:

```powershell
openclaw status
openclaw gateway status
openclaw gateway health
openclaw plugins list
openclaw nodes status
openclaw approvals get
```

### What each command proves

- `openclaw status`
  - OpenClaw is installed and the CLI works.
- `openclaw gateway status`
  - The gateway service exists and is configured.
- `openclaw gateway health`
  - The app will have something real to connect to.
- `openclaw plugins list`
  - There is an actual tool surface behind the agent.
- `openclaw nodes status`
  - Backend nodes/providers are reachable.
- `openclaw approvals get`
  - Safety is visible and inspectable, not hidden magic.

### Presenter line

> "I always start in the terminal because it makes the security story visible before I show the UI."

If someone asks about WSL, keep it short:

- OpenClaw can run in WSL.
- Electron can still run on Windows.
- The shared point is the gateway URL and session configuration.

## Step 3: Explain Electron and the Protocols

Before pasting files, explain the roles.

### Electron in one minute

- `Main process`
  - The trusted Node side.
  - Creates windows, loads config, talks to OpenClaw and voice services.
- `Renderer`
  - The web UI.
  - Should not get direct access to Node or the shell.
- `Preload`
  - The narrow bridge between the two.
  - Exposes only the safe APIs that the renderer needs.

### IPC in one sentence

> "IPC is just the private message bus between the browser-looking part and the trusted desktop part."

### WebSocket in one sentence

> "WebSocket is the always-open realtime pipe we use when low-latency streaming matters, especially for speech."

## Step 4: Build the Electron App by Pasting Ready Files

This is the main assembly section.
Do not frame it as "we are coding everything now."
Frame it as "we are dropping in prepared pieces and explaining each layer."

Paste files in this order.

### 4.1 `apps/desktop/electron/preload.js`

What this file does:

- Uses `contextBridge.exposeInMainWorld(...)`.
- Exposes a very small API to the renderer.
- Gives the UI methods like:
  - start listening
  - stop listening
  - push audio chunks
  - submit transcript
  - fetch approvals and gateway status

How to explain it:

> "This is the safety boundary for Electron. The UI does not get raw Node access. It only gets the exact functions we choose to expose."

### 4.2 `apps/desktop/src/hooks/useMicrophone.ts`

What this file does:

- Opens the microphone.
- Forces single-channel audio.
- Uses an `AudioWorklet` to collect PCM chunks.
- Sends normalized chunks back through the callback.

How to explain it:

> "This is the ear. It turns live microphone input into small PCM packets that we can stream elsewhere."

Important point:

- The sample rate is `24000`, which matches the speech pipeline used here.

### 4.3 `apps/desktop/src/App.tsx`

What this file does:

- Shows the UI shell.
- Starts and stops listening.
- Displays partial and final transcript updates.
- Displays the agent reply.
- Plays returned TTS audio.
- Reacts to approval-required and error states.

How to explain it:

> "This file is intentionally boring in a good way. It is just the operator console: start, stop, what I heard, what the agent said, and whether attention is needed."

### 4.4 `apps/desktop/electron/main.js`

This is the most important file in the app.

What this file does:

- Loads `.env`.
- Builds the runtime config.
- Creates the Electron window.
- Instantiates:
  - `VoiceOrchestrator`
  - `VoiceController`
- Wires IPC handlers like:
  - `voice:start-listening`
  - `voice:audio-chunk`
  - `voice:submit-transcript`
  - `approvals:fetch`
  - `gateway:health`
- Forwards events back to the renderer.

How to explain it:

> "This is the switchboard. The renderer talks to main with IPC, main talks to speech services and OpenClaw, then main pushes results back to the UI."

## Step 5: Add the OpenClaw Handoff

Once the shell exists, explain how spoken text becomes agent work.

### 5.1 `packages/openclaw-bridge/src/openclaw-bridge.ts`

What to say:

- This file is an adapter around the `openclaw` CLI.
- It keeps command execution in one place.
- It handles:
  - health checks
  - status checks
  - approvals
  - allowlist updates
  - agent turns

Important message:

> "The desktop app is not shelling out all over the codebase. The bridge centralizes that responsibility."

### 5.2 `packages/orchestrator/src/voice-orchestrator.ts`

What to say:

- This file is the traffic controller.
- It receives transcript text.
- It recognizes control phrases like confirm, cancel, pause, resume, status.
- It checks risk before running an agent turn.
- If the text looks risky, it asks for confirmation instead of executing immediately.

Useful teaching line:

> "This is where voice becomes governed behavior instead of just speech recognition."

### 5.3 `config/workspaces.json`

What to say:

- This file keeps the agent tied to approved paths.
- It also stores the stable session key.
- That session key matters because voice and IDE can point to the same conversation state.

If someone asks why this matters:

> "Without a workspace boundary, an agent demo is just a trust fall."

## Step 6: Add ElevenLabs for Voice Input and Output

Now add the "ears" and "mouth".

## 6A: Speech to Text with ElevenLabs Scribe

Paste and explain these files:

- `packages/voice/src/elevenlabs-scribe-stt.ts`
- `packages/voice/src/voice-controller.ts`
- `packages/voice/src/index.ts`

### What `elevenlabs-scribe-stt.ts` does

- Opens a WebSocket to ElevenLabs realtime STT.
- Sends audio chunks as base64 PCM.
- Receives:
  - `partial_transcript`
  - `committed_transcript`
  - `committed_transcript_with_timestamps`
- Normalizes those messages into app-friendly events.

How to explain it:

> "This is our realtime captioning pipe. The microphone sends chunks, ElevenLabs streams transcript events back."

### What `voice-controller.ts` does for STT

- Chooses which STT provider to use.
- Starts and stops listening.
- Accepts audio chunks from Electron main.
- Emits normalized events like:
  - `transcript.partial`
  - `transcript.final`
  - `error`

How to explain it:

> "The voice controller hides provider-specific details so the rest of the app can think in simple events."

### Env values to mention

For the demo, call out these values:

```env
VOICE_DEV_AGENT_STT_PROVIDER=elevenlabs-scribe
ELEVENLABS_API_KEY=...
ELEVENLABS_SCRIBE_MODEL_ID=scribe_v2_realtime
ELEVENLABS_SCRIBE_WS_URL=wss://api.elevenlabs.io/v1/speech-to-text/realtime
ELEVENLABS_SCRIBE_AUDIO_FORMAT=pcm_24000
ELEVENLABS_SCRIBE_COMMIT_STRATEGY=vad
```

Keep the explanation short:

- Scribe is the input side.
- It listens over WebSocket because we want realtime updates.

## 6B: Text to Speech with ElevenLabs

Paste and explain:

- `packages/voice/src/elevenlabs-tts.ts`
- `packages/voice/src/voice-controller.ts`

### What `elevenlabs-tts.ts` does

- Calls ElevenLabs text-to-speech.
- Streams MP3 audio back.
- Returns audio buffers for playback.

### What `voice-controller.ts` does for TTS

- Splits long replies into chunks.
- Requests TTS audio chunk by chunk.
- Emits `tts.started`, `tts.audio`, `tts.stopped`, and `tts.interrupted`.

How to explain it:

> "Once OpenClaw gives us text, this layer turns the text into playable audio and sends it back to the UI."

Also mention:

- `apps/desktop/electron/main.js` forwards TTS audio through IPC.
- `apps/desktop/src/App.tsx` plays the returned audio.

Required env values:

```env
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

## Step 7: Show the Full Request Flow

At this point, pause and explain the complete chain slowly.

### The exact flow

1. User clicks Start in Electron.
2. `useMicrophone.ts` captures PCM audio.
3. Audio goes from renderer to main through IPC.
4. `VoiceController` streams audio to ElevenLabs Scribe over WebSocket.
5. Scribe returns partial and final transcript events.
6. Final transcript is passed to `VoiceOrchestrator`.
7. `VoiceOrchestrator` checks control intents and risk.
8. If safe, `OpenClawBridge` runs the agent turn.
9. OpenClaw returns a reply.
10. `VoiceController` sends that reply to ElevenLabs TTS.
11. Audio comes back to Electron.
12. The renderer plays it.

Presenter line:

> "The important thing is not just that it talks. The important thing is that every hop has a clear job and a clear boundary."

## Step 8: Demo Script

Keep the final demo very simple.

### Terminal setup

```powershell
openclaw status
openclaw gateway health
openclaw approvals get
pnpm install
pnpm run build:deps
pnpm dev
```

### On-stage flow

1. Show the terminal checks first.
2. Open the desktop app.
3. Click `Start`.
4. Say one safe command.
   - Example: "Open VS Code and split the terminal."
5. Show the transcript.
6. Show the text reply.
7. Let the spoken reply play.
8. Show one risky example, but keep it safe.
   - Example: "Delete the workspace."
9. When approval appears, say `cancel`.

This gives you both stories:

- normal action
- guarded action

## Step 9: What Not to Over-Explain

If time is limited, do not get lost in:

- Zod schema details
- every Electron lifecycle event
- the full OpenClaw internals
- waveform/audio math
- test files

Only go deeper if someone asks.

## Short Explanations You Can Reuse Live

Use these lines when you want a clean explanation without going too deep.

- `OpenClaw`
  - "The guarded execution layer."
- `Electron`
  - "The desktop shell."
- `IPC`
  - "The safe bridge between UI and trusted runtime."
- `WebSocket`
  - "The low-latency streaming pipe."
- `Scribe`
  - "Speech in."
- `TTS`
  - "Speech out."
- `Orchestrator`
  - "The traffic controller."
- `Bridge`
  - "The adapter to OpenClaw."

## Backup Plan

If something breaks, keep the narrative intact.

- If microphone capture fails:
  - Use manual transcript submission and explain that the rest of the pipeline is unchanged.
- If Scribe fails:
  - Explain STT conceptually and continue with typed text.
- If TTS fails:
  - Keep the text reply visible and continue.
- If OpenClaw gateway is unreachable:
  - Run `openclaw gateway health`, show the failure honestly, and continue by explaining the expected handoff.

## Final Message to Leave the Audience With

End with this idea:

> "This project is not just a voice demo. It is a guarded agent pipeline: terminal-safe execution, desktop UI, realtime transcription, and spoken feedback, all connected through clear boundaries."
