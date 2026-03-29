# Bridge API Contracts — Nick's Admin ↔ NOUR OS
Generated: 2026-03-29

## Authentication

All bridge endpoints require `X-Bridge-Key` header matching `BRIDGE_API_KEY` env var.

| Response | Meaning |
|----------|---------|
| 401 | Missing or invalid key |
| 503 | BRIDGE_API_KEY not configured on this system |
| 200 | Success |

---

## Nick's Admin Endpoints (nickstire.org)

### GET /api/bridge/health

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T12:00:00.000Z",
  "version": "1.0"
}
```

### GET /api/bridge/shop-snapshot

```typescript
interface ShopSnapshot {
  timestamp: string;
  bookings: {
    todayCount: number;
    newCount: number;
    confirmedCount: number;
    completedCount: number;
  };
  leads: {
    totalActive: number;
    uncontactedCount: number;
    urgentCount: number;
    thisWeek: number;
  };
  callbacks: {
    pendingCount: number;
    totalCount: number;
    completedCount: number;
  };
  revenue: {
    todayEstimate: number | null;
    weekEstimate: number | null;
  };
  syncHealth: {
    overall: "healthy" | "degraded" | "down";
    services: Record<string, "up" | "degraded" | "down" | "not_configured">;
  };
  chat: {
    totalSessions: number;
    thisWeek: number;
  };
  recentActivity: {
    lastBookingAt: string | null;
    lastLeadAt: string | null;
  };
}
```

**Example:**
```json
{
  "timestamp": "2026-03-29T15:30:00.000Z",
  "bookings": { "todayCount": 12, "newCount": 3, "confirmedCount": 5, "completedCount": 4 },
  "leads": { "totalActive": 8, "uncontactedCount": 2, "urgentCount": 1, "thisWeek": 5 },
  "callbacks": { "pendingCount": 2, "totalCount": 15, "completedCount": 13 },
  "revenue": { "todayEstimate": null, "weekEstimate": null },
  "syncHealth": { "overall": "healthy", "services": { "database": "up", "twilio": "up", "sheets": "up" } },
  "chat": { "totalSessions": 45, "thisWeek": 8 },
  "recentActivity": { "lastBookingAt": "2026-03-29T14:22:00.000Z", "lastLeadAt": "2026-03-29T15:10:00.000Z" }
}
```

---

## NOUR OS Endpoints (autonicks.com) — TO BE BUILT

### GET /api/bridge/health

Same shape as Nick's Admin health endpoint.

### GET /api/bridge/owner-snapshot

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

---

## Testing

```bash
# Nick's Admin — health
curl -H "X-Bridge-Key: YOUR_KEY" https://nickstire.org/api/bridge/health

# Nick's Admin — shop snapshot
curl -H "X-Bridge-Key: YOUR_KEY" https://nickstire.org/api/bridge/shop-snapshot

# Without key — should return 401
curl https://nickstire.org/api/bridge/health

# No BRIDGE_API_KEY configured — should return 503
# (happens when env var is not set)
```
