# Safety Policy

## Execution Defaults

- `host=node`
- `security=allowlist`
- `ask=on-miss`

## Workspace Boundary

All operations must stay in paths listed in `config/workspaces.json`.

## Guarded Autonomy

- Normal coding tasks run directly.
- High-risk patterns require confirmation (`confirm`/`cancel`).

## Initial Confirmation Patterns

- `delete`
- `remove`
- `drop database`
- `reset`
- explicit destructive shell fragments (`rm -rf`, `del /f`, `format c:`)

## Approval Model

Use OpenClaw approvals allowlist for binaries (example: `git`, `rg`, `pnpm`, `node`).

## Audit Trail

Every voice event is logged in-app with timestamp + payload for local inspection.
