# WSL Gateway Bootstrap (Ubuntu)

## 1) Install Node + pnpm + OpenClaw inside WSL

```bash
sudo apt update
sudo apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
corepack prepare pnpm@9.0.0 --activate
npm i -g openclaw
```

## 2) Initialize OpenClaw config/workspace

```bash
openclaw setup --wizard
# or
openclaw onboard --flow manual
```

## 3) Install and enable gateway service

```bash
openclaw gateway install
openclaw gateway start
openclaw gateway status
```

## 4) Enable voice-call plugin

```bash
openclaw plugins enable voice-call
openclaw plugins list
```

## 5) Configure gateway auth token

In `~/.openclaw/openclaw.json` set:

```json5
{
  gateway: {
    auth: {
      mode: "token",
      token: "<strong-random-token>"
    }
  }
}
```

Restart gateway:

```bash
openclaw gateway restart
```

## 6) Validate

```bash
openclaw status
openclaw gateway health
openclaw plugins list
openclaw voicecall --help
```

## Windows Access

If gateway is loopback-only in WSL, set up port forwarding on Windows as needed.
Use `docs/operations.md` for diagnostics.
