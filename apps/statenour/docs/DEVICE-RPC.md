# Device RPC — statenour-os ↔ nour-os-unified

> **Status header note (v10.0.529.106 Wave 56)**: this document describes
> the shape that was in production through Q1 2026. As of MEMORY.md
> 2026-05-01, device tracking is flagged as a "known-stale issue" with
> the desktop bridges not actively syncing. The schemas + endpoints are
> all still wired (the bridges just aren't running). When the operator
> next spins up nour-os-unified the contract here is still the source
> of truth. The local-agent/tuya_agent.py + the /api/sync/nour-os
> route still exist + still work if the agent is restarted.

How the Vercel-hosted web app sends smart-home commands to the
Windows desktop agent that actually talks to Ring / Eufy / Tuya /
Google Home.

Bridges the **personal ring** (cloud Next.js) ↔ **desktop layer**
(PowerShell + Python + Node bridges) without making the agent
publicly reachable from the internet.

---

## The shape

```
  ┌─────────────────────────────┐        ┌──────────────────────────┐
  │  statenour-os (Vercel)      │        │  nour-os-unified         │
  │  POST /api/devices/command  │───────▶│  (Windows desktop)       │
  │  enqueues → Postgres        │        │  polls every 15-30s      │
  │                             │        │  executes via bridges    │
  │  GET  /api/devices/queue    │◀───────│  acks via PATCH          │
  │  PATCH /api/devices/        │◀───────│                          │
  │        command/[id]         │        │                          │
  └─────────────────────────────┘        └──────────────────────────┘
         ▲                                           │
         │                                           ▼
  SmartDevice + DeviceCommand +                 Ring bridge.js
  DeviceEvent rows on Neon                      Eufy bridge.js
                                                Tuya controller.py
                                                Google controller.py
```

The agent NEVER opens an inbound port. All traffic is outbound
polls → cloud and cloud-returned commands → local execution →
outbound PATCH ack. Works behind any NAT / firewall.

---

## Endpoints

All agent-facing endpoints auth with `x-sync-key: $SYNC_KEY` —
the same secret the rest of the statenour-os sync surface uses
(see `lib/auth-guard.ts · requireSyncAuth`). **No separate
agent secret to manage.**

### `POST /api/devices/command`
Enqueue a command. Called by the UI (or Nick via a tool call in
the future).

**Body:**
```json
{
  "deviceId": "cl1a...",
  "command": "turn_on",
  "params": { "brightness": 70 }
}
```

**Responses:**
- `200` → `{ commandId, status: "pending", enqueuedAt, device:{id,name,platform} }`
- `400` → `BAD_REQUEST` (missing fields or command too long)
- `404` → `DEVICE_NOT_FOUND`
- `409` → `DEVICE_OFFLINE` (refuses to enqueue to an offline device)

### `GET /api/devices/command?deviceId=X&limit=20`
Read recent commands for a device. Used by the detail UI to show
command history.

**Response:** `{ commands: [...], count }`

### `GET /api/devices/queue?platform=TUYA,RING&limit=10`
**Agent-facing.** Returns a batch of pending commands and atomically
marks them `status=sent` so concurrent polls don't re-claim.

Required header: `x-sync-key: $SYNC_KEY`

Optional filters:
- `platform=X,Y,Z` — restrict to platforms the agent knows
- `limit=N` — cap batch size (max 20)

**Response:**
```json
{
  "commands": [
    {
      "id": "cmd_abc",
      "deviceId": "dev_xyz",
      "command": "turn_on",
      "params": null,
      "createdAt": "...",
      "device": {
        "id": "dev_xyz",
        "name": "Living room lamp",
        "platform": "TUYA",
        "platformDeviceId": "vendor-id-from-tuya",
        "deviceType": "LIGHT",
        "location": "home-living"
      }
    }
  ],
  "count": 1,
  "now": "2026-04-20T23:40:00.000Z"
}
```

### `PATCH /api/devices/command/[id]`
**Agent-facing.** Ack or fail a command after executing.

Required header: `x-sync-key: $SYNC_KEY`

**Body (success):**
```json
{ "status": "acked", "resultState": { "on": true, "brightness": 70 } }
```

**Body (failure):**
```json
{ "status": "failed", "error": "Tuya returned 400: invalid devId" }
```

**Side effects on success:**
- `DeviceCommand.status = "acked"`, `ackedAt = now`.
- If `resultState` provided, merged into `SmartDevice.currentState`
  and `SmartDevice.status` set to `ONLINE`, `lastSeenAt = now`.
- A `DeviceEvent` row is written with `event =
  "command_acked:<command>"` for timeline observability.

**Side effects on failure:**
- `DeviceCommand.status = "failed"`, `ackedAt = now`,
  `error` recorded (truncated to 500 chars).
- A `DeviceEvent` row is written with `event =
  "command_failed:<command>"`.

Failure **does not re-queue** — that's the agent's job. Auto-retry
at the server level would loop on genuine vendor errors (bad
credentials, offline, etc). Idempotency: calling PATCH twice on
the same id is safe; the second call overwrites timestamps but
the event trail keeps both records.

---

## Command vocabulary (informal, per-platform)

The server treats `command` as opaque — only the agent interprets.
Agreed conventions so the UI + Nick can target consistently:

| Verb | Params | Platforms |
|------|--------|-----------|
| `turn_on` | — | TUYA, GOOGLE_HOME |
| `turn_off` | — | TUYA, GOOGLE_HOME |
| `set_brightness` | `{ value: 0-100 }` | TUYA |
| `set_temp` | `{ celsius or fahrenheit }` | TUYA, GOOGLE_HOME |
| `lock` / `unlock` | — | RING, EUFY, TUYA |
| `snapshot` | — | RING, EUFY, V380 |
| `record` | `{ durationSec }` | RING, EUFY, V380 |
| `arm` / `disarm` | — | RING |
| `siren_on` / `siren_off` | — | RING, EUFY |
| `speak` | `{ text }` | GOOGLE_HOME |

Agent may support more; server doesn't care.

---

## Agent implementation

See `scripts/agent-poll-example.ps1` (in statenour-os) for a minimal
PowerShell loop the desktop agent can run. Pseudo:

```powershell
while ($true) {
  $batch = Invoke-RestMethod `
    "$BASE_URL/api/devices/queue?platform=TUYA,RING,EUFY,GOOGLE_HOME&limit=10" `
    -Headers @{ "x-sync-key" = $env:SYNC_KEY }

  foreach ($cmd in $batch.commands) {
    try {
      $result = switch ($cmd.device.platform) {
        "TUYA"        { & ./modules/iot/tuya/controller.py $cmd.device.platformDeviceId $cmd.command $cmd.params }
        "RING"        { & node ./modules/iot/ring/bridge.js   $cmd.device.platformDeviceId $cmd.command }
        "EUFY"        { & node ./modules/iot/eufy/bridge.js   $cmd.device.platformDeviceId $cmd.command }
        "GOOGLE_HOME" { & ./modules/iot/google/controller.py   $cmd.device.platformDeviceId $cmd.command $cmd.params }
      }
      Invoke-RestMethod "$BASE_URL/api/devices/command/$($cmd.id)" `
        -Method PATCH `
        -Headers @{ "x-sync-key" = $env:SYNC_KEY; "Content-Type" = "application/json" } `
        -Body (@{ status = "acked"; resultState = $result } | ConvertTo-Json)
    } catch {
      Invoke-RestMethod "$BASE_URL/api/devices/command/$($cmd.id)" `
        -Method PATCH `
        -Headers @{ "x-sync-key" = $env:SYNC_KEY; "Content-Type" = "application/json" } `
        -Body (@{ status = "failed"; error = $_.ToString() } | ConvertTo-Json)
    }
  }
  Start-Sleep -Seconds 20
}
```

---

## Failure modes + recovery

- **Agent offline** → commands pile up as `pending`. UI shows
  "agent offline" if oldest pending > 5 min (future: pulse in
  situation card).
- **Command never acked** → `status=sent` forever. A `/api/cron/
  device-command-reap` could flip sents older than 10 min back to
  `pending`; not built yet — low volume and the manual flag is
  "oldest-sent-age" on the dashboard.
- **Vendor returned success but the physical device didn't change**
  → `resultState` comes back with server-reported state, not true
  state. No verification loop yet. A future upgrade: the agent
  re-queries the device 2s after the command and diff-compares.

---

## Security

- `SYNC_KEY` lives in Vercel env (server-side only) + desktop
  `.env` (agent-side only). Never committed; never sent to client.
- Agent polls over HTTPS; no inbound port on the desktop.
- `DEVICE_OFFLINE` rejection prevents queue DoS against known-dead
  devices. Malicious enqueue at API level requires session auth
  (POST is `{ auth: "owner" }` on `[id]/command`).

---

## When things change

- New verb? Agent just handles it; no server change required.
- New platform? Add the string to SmartDevice.platform validators
  (if any) + agent bridge.
- Want Nick to control devices via chat? Add a `runDeviceCommand`
  tool to `lib/ai/tools.ts` that POSTs to `/api/devices/command`.
  Nick says "lock the front door" → tool → queue → agent → Ring
  bridge → ack. ~30 lines of code.

---

## Quick test

```bash
# Enqueue a command (as the dashboard would)
curl -X POST https://bdnick.info/api/devices/command \
  -H "Content-Type: application/json" \
  -b "<session cookie>" \
  -d '{"deviceId":"cl1a...","command":"turn_on"}'

# Agent poll (as the desktop would)
curl https://bdnick.info/api/devices/queue?limit=5 \
  -H "x-sync-key: $SYNC_KEY"

# Agent ack
curl -X PATCH https://bdnick.info/api/devices/command/<cmdId> \
  -H "x-sync-key: $SYNC_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"acked","resultState":{"on":true}}'
```

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
