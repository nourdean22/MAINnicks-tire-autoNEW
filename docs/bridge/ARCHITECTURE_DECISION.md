# Bridge Architecture Decision — Nick's Admin ↔ NOUR OS
Generated: 2026-03-29

## Decision: Snapshot-Based HTTP Bridge

### Pattern
Each system exposes a read-only JSON snapshot endpoint. The other system polls it.

### Why NOT:
- **Shared database** — Different DBs (TiDB vs Neon Postgres), different schemas, different hosting
- **WebSocket push** — Overkill for 60s polling, adds complexity
- **Message queue** — No message broker exists, would add infra cost
- **Direct DB reads** — Security nightmare, coupling, latency across providers

### Why snapshot polling:
- Simple HTTP GET → JSON response
- Each system owns its data, controls what's exposed
- Works across Railway ↔ Vercel without special networking
- Easy to test with curl
- Gracefully degrades (if one is down, the other just shows "offline")

---

## Auth: Shared Secret via X-Bridge-Key Header

Both systems:
1. Store `BRIDGE_API_KEY` in their environment variables
2. On incoming bridge requests: check `req.headers['x-bridge-key'] === process.env.BRIDGE_API_KEY`
3. If missing or wrong → 401
4. If BRIDGE_API_KEY env var not set → 503 (bridge not configured)

### Key rotation:
1. Generate new key
2. Set on BOTH systems simultaneously
3. Redeploy both

---

## Endpoints

### Nick's Admin (Railway — nickstire.org)
| Endpoint | Method | Auth | Returns |
|----------|--------|------|---------|
| `/api/bridge/health` | GET | X-Bridge-Key | `{status, timestamp, version}` |
| `/api/bridge/shop-snapshot` | GET | X-Bridge-Key | ShopSnapshot (see contracts) |

### NOUR OS (Vercel — autonicks.com)
| Endpoint | Method | Auth | Returns |
|----------|--------|------|---------|
| `/api/bridge/health` | GET | X-Bridge-Key | `{status, timestamp, version}` |
| `/api/bridge/owner-snapshot` | GET | X-Bridge-Key | OwnerSnapshot (see contracts) |

---

## Polling Strategy

- Each system polls the other every **60 seconds** (matches existing admin stats interval)
- On failure: show "Offline" status, retry on next interval
- On 3 consecutive failures: show warning banner
- No retry storms, no exponential backoff (60s is already conservative)

---

## Data Flow

```
Nick's Admin (Railway)                    NOUR OS (Vercel)
┌──────────────────────┐                 ┌──────────────────────┐
│ /api/bridge/         │ ←── polls ────  │ Bridge consumer      │
│   shop-snapshot      │                 │ (shows shop health   │
│   health             │                 │  on NOUR OS dash)    │
└──────────────────────┘                 └──────────────────────┘
┌──────────────────────┐                 ┌──────────────────────┐
│ Bridge consumer      │ ── polls ────→  │ /api/bridge/         │
│ (shows owner status  │                 │   owner-snapshot     │
│  on admin overview)  │                 │   health             │
└──────────────────────┘                 └──────────────────────┘
```

No direct database access. No shared state. Snapshots only.
