# Twilio Config Reference

Keep Twilio secrets in OpenClaw config, not in this repository.

Required fields:

- `plugins.entries.voice-call.config.provider = "twilio"`
- `plugins.entries.voice-call.config.twilio.accountSid`
- `plugins.entries.voice-call.config.twilio.authToken`
- `plugins.entries.voice-call.config.fromNumber`
- `plugins.entries.voice-call.config.inboundPolicy = "allowlist"`
- `plugins.entries.voice-call.config.allowFrom = ["+1..."]`

Optional but recommended:

- `publicUrl`
- `streaming.enabled = true`
- `tts.provider = "elevenlabs"`
- `webhookSecurity.allowedHosts`
