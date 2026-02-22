# ACP IDE Setup

## Session Strategy

Use a stable session key per workspace (from `config/workspaces.json`).

Example session key:

- `agent:main:ice-core-ai`

## Zed

Add generated snippet from desktop app into Zed `settings.json` under `agent_servers`.

## Generic ACP

```bash
openclaw acp --session agent:main:ice-core-ai --url ws://127.0.0.1:18789 --token <token>
```

## Verify Shared Context

1. Ask question in IDE ACP thread.
2. Ask follow-up via voice app.
3. Confirm both see same prior context.
