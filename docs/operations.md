# Operations and Recovery

## Useful Commands

```bash
openclaw status
openclaw gateway status
openclaw gateway health
openclaw plugins list
openclaw nodes status
openclaw approvals get
```

## Gateway Unreachable

1. Confirm WSL gateway service is running.
2. Confirm `OPENCLAW_GATEWAY_URL` points to reachable endpoint.
3. Confirm token matches gateway config.
4. Check logs:
   - `openclaw logs --follow`

## Voice Fails

1. Check `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`.
2. Verify microphone permission for Electron app.
3. Inspect event log panel in the app.

## Call Fails

1. Verify Twilio webhook URL and plugin config.
2. Confirm allowlisted caller number.
3. Check signature verification/public URL consistency.
4. Tail call logs:
   - `openclaw voicecall tail`

## ACL Hardening (Windows Native OpenClaw)

Use `scripts/fix-openclaw-acl.ps1` and rerun `openclaw security audit`.
