# NOUR OS Session — Bridge + Agent Fixes
Handoff from Nick's Admin session (2026-03-29)

## Context

Nick's Admin (nickstire.org) now has:
- Bridge API at `/api/bridge/shop-snapshot` and `/api/bridge/health`
- Auth via `X-Bridge-Key` header matching `BRIDGE_API_KEY` env var
- NOUR OS placeholder card on admin overview linking to autonicks.com
- Command bar (Ctrl+K) with section navigation and customer search
- Priority rail showing urgent leads, bookings, callbacks

The Nick's Admin side is DONE. This session builds the NOUR OS side.

---

## NOUR OS Project Context

```
Location: C:\Users\nourd\NOUR-OS\apps\statenour-os
Stack: Next.js 16.1.7 (App Router) + TypeScript + Turbopack
Database: PostgreSQL on Neon via Prisma 7
Repo: github.com/nourdean22/statenour-os (private)
Branch: codex/ollama-local (production deploy branch)
Hosting: Vercel (Hobby plan)
Domains: autonicks.com, statenour-os.vercel.app
Local agent: Python-based at local-agent/ directory
```

---

## PRIORITY 1: Fix Local Agent (BLOCKING)

All device integrations are broken:

1. **Tuya**: "Token fetch failed: sign invalid" — needs new API credentials from Tuya IoT Platform
2. **Ring**: 0 devices synced — auth token expired, needs re-auth
3. **Eufy**: 0 devices synced — connection issue
4. **V380 cameras**: 0 cameras synced — camera IPs not responding on local network
5. **Health server (port 8765)**: NOT responding despite python.exe processes running

Fix order: Tuya first (8 devices), then Ring (5), then Eufy (5), then V380 (2).

---

## PRIORITY 2: Fix Cron System

### Weekly cron trigger
In `app/api/cron/mega/route.ts`, weekly jobs fire on **Sunday evening** (already fixed in previous session):
```typescript
const isSunday = now.getUTCDay() === 0;
if (slot === 'evening' && isSunday) { jobs = [...jobs, ...CRON_JOBS.weekly]; }
```

### CRON_SECRET
Already set to real 64-char hex: `0d1843456cab3e03561c385c730a2c2f3ca8add1b93ceaa772fd3e2a54ec6bf3`
Verify it's in Vercel env vars.

---

## PRIORITY 3: Build Bridge Endpoint

### GET /api/bridge/owner-snapshot

Protected by `X-Bridge-Key` header matching `BRIDGE_API_KEY` env var.

```typescript
interface OwnerSnapshot {
  timestamp: string;
  ownerMode: "active" | "away" | "after-hours";
  localAgent: {
    status: "running" | "degraded" | "offline";
    lastHeartbeat: string | null;
  };
  devices: {
    totalCount: number;
    onlineCount: number;
    offlineCount: number;
    degradedProviders: string[];
  };
  cameras: {
    totalCount: number;
    onlineCount: number;
    lastMotionAt: string | null;
  };
  alerts: {
    unacknowledgedCount: number;
    criticalCount: number;
  };
  priorities: string[];
}
```

### GET /api/bridge/health

```json
{ "status": "ok", "timestamp": "...", "version": "1.0" }
```

Auth middleware:
```typescript
const bridgeKey = process.env.BRIDGE_API_KEY;
if (!bridgeKey) return NextResponse.json({ error: "Bridge not configured" }, { status: 503 });
if (req.headers.get("x-bridge-key") !== bridgeKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

---

## PRIORITY 4: Build Shop-Snapshot Consumer

Call Nick's Admin bridge endpoint and display on NOUR OS dashboard:

```typescript
const SHOP_URL = process.env.NICKS_ADMIN_URL || "https://nickstire.org";
const res = await fetch(`${SHOP_URL}/api/bridge/shop-snapshot`, {
  headers: { "X-Bridge-Key": process.env.BRIDGE_API_KEY! },
  next: { revalidate: 60 },
});
```

Display as a card on the NOUR OS main dashboard showing:
- Bookings today (new / confirmed / completed)
- Urgent leads count
- Pending callbacks
- Link to open Nick's Admin

---

## PRIORITY 5: Build Owner Command Surface

Add to NOUR OS dashboard:
- **Shop health card** (from bridge shop-snapshot)
- **Device health card** (from local agent status — only after Priority 1 is fixed)
- **Quick actions**: "Open Nick's Admin" → nickstire.org/admin, "View cameras" → /cameras, "Check system" → /system

---

## Environment Variables Needed on NOUR OS (Vercel)

```
BRIDGE_API_KEY=<generate and set same value on both systems>
NICKS_ADMIN_URL=https://nickstire.org
FB_APP_SECRET=c261dffe3073b6ac66a93bec1187aaca
```

Generate BRIDGE_API_KEY:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Set the SAME value on both Railway (Nick's Admin) and Vercel (NOUR OS).

---

## What NOT to build

- No camera streaming — just snapshots and status
- No AI operator brief — basic bridge first
- No WebSocket — polling at 60s is fine
- No shared database between systems
- No device credentials exposed through bridge
