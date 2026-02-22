# Twilio Voice Call Setup (Inbound Allowlist First)

## Prerequisites

- Twilio account + voice-capable number
- OpenClaw `voice-call` plugin enabled
- Public webhook URL (ngrok domain, tailscale funnel, or stable HTTPS endpoint)

## OpenClaw Config Snippet

Add to `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "voice-call": {
        enabled: true,
        config: {
          provider: "twilio",
          fromNumber: "+1...",
          twilio: {
            accountSid: "AC...",
            authToken: "..."
          },
          inboundPolicy: "allowlist",
          allowFrom: ["+1<your-phone>"],
          serve: {
            port: 3334,
            bind: "127.0.0.1",
            path: "/voice/webhook"
          },
          publicUrl: "https://<your-public-domain>/voice/webhook",
          streaming: {
            enabled: true,
            sttProvider: "openai-realtime",
            streamPath: "/voice/stream"
          },
          tts: {
            provider: "elevenlabs",
            elevenlabs: {
              apiKey: "${ELEVENLABS_API_KEY}",
              voiceId: "${ELEVENLABS_VOICE_ID}",
              modelId: "eleven_multilingual_v2"
            }
          }
        }
      }
    }
  }
}
```

## Twilio Console

Set webhook URL on the number to:

- `https://<your-public-domain>/voice/webhook`

## Validation

```bash
openclaw plugins list
openclaw voicecall status --call-id <id>
openclaw voicecall tail
```

## Security

- Keep signature verification enabled.
- Keep inbound policy as `allowlist` for v1.
- Restrict exposed host/path to voice webhook only.
