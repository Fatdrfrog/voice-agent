# Voice Dev Agent

Voice-first coding assistant built around OpenClaw, ACP, OpenAI Realtime STT, and ElevenLabs TTS.

## Quick Start

1. Copy `.env.example` to `.env` and fill API keys and gateway settings.
   - Mic-only mode default: `VOICE_DEV_AGENT_CALL_MODE=false`
2. Configure workspace allowlist in `config/workspaces.json`.
3. Install dependencies:
   - `pnpm install`
4. Build packages + run app:
   - `pnpm dev`

## Project Layout

- `apps/desktop`: Electron + React desktop app.
- `packages/contracts`: shared Zod schemas and TS contracts.
- `packages/openclaw-bridge`: resilient OpenClaw CLI adapters.
- `packages/orchestrator`: session/control/safety orchestration.
- `packages/voice`: OpenAI Realtime STT and ElevenLabs TTS clients.
- `config/workspaces.json`: explicit workspace allowlist.
- `docs/`: setup and operations runbooks.

## Runbooks

- `docs/wsl-gateway-bootstrap.md`
- `docs/acp-setup.md`
- `docs/safety-policy.md`
- `docs/operations.md`
- Optional when enabling calls: `docs/twilio-voice-call-setup.md`
