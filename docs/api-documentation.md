# NOURCITY Monorepo API Developer Guide

This document is the authoritative developer reference for the API surface of the NOURCITY monorepo. It details authentication schemes, webhook integrations, stethoscopic health checks, analytical telemetry sinks, the cross-ring bridge query contract, and runtime metadata discovery.

---

## 1. System Architecture

The monorepo contains two primary application hubs:
1. **Nick's Tire & Auto (`apps/nickstire`)**: Express-based server exposing REST endpoints, specialized webhooks, and a comprehensive tRPC v11 API.
2. **Statenour (`apps/statenour`)**: Next.js App Router workspace exposing tRPC procedures, Inngest durable workflows, and the autonomous AI COO query surface.

Both applications communicate via a secure Cross-Ring Bridge using database mirrors, cron pipelines, and HTTP sync requests.

```
       [ Statenour OS (bdnick.info) ]
                    │
            Cross-Ring Sync API
      (X-Statenour-Sync-Key protected)
                    │
                    ▼
  [ Express Server (nickstire.org) ] ◄── Webhooks (Twilio, Vapi, Capevace, Stripe)
        │                 │
    tRPC API          REST Endpoints
```

---

## 2. Authentication Reference

Every API endpoint enforces strict validation based on its caller classification:

### 2.1. Statenour Bridge Key (`X-Statenour-Sync-Key`)
Used for cross-ring communication between Statenour and Nick's Tire.
- **Header**: `X-Statenour-Sync-Key: <STATENOUR_SYNC_KEY>`
- **Query Key (Alternative for action endpoints)**: `x-sync-key: <STATENOUR_SYNC_KEY>`
- **Security Check**: Enforced server-side using a cryptographically secure `timingSafeEqual` comparison:
  ```typescript
  import { timingSafeEqual } from "crypto";
  function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
  ```

### 2.2. Admin API Key
Gates mutating self-healing and diagnostics routes.
- **Header**: `Authorization: Bearer <ADMIN_API_KEY>` or `X-Admin-Api-Key: <ADMIN_API_KEY>`

### 2.3. Session Cookies
Used to authenticate public clients and admin panels.
- **Cookie Name**: `COOKIE_NAME` (configured via shared constants).
- Configured dynamically with platform-respectful options (HTTPS-only in production, strict SameSite).

---

## 3. REST Endpoint Directory

### 3.1. Utility & Diagnostics

#### Get Application Uptime
Proves which commit/build is running.
- **Path**: `GET /api/version`
- **Auth**: Public
- **Response**:
  ```json
  {
    "status": "ok",
    "uptime": 128471
  }
  ```

#### Health Status Check
Probes database connectivity and critical services.
- **Path**: `GET /api/health`
- **Auth**: Public
- **Response (Healthy)**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-06-27T23:30:00Z"
  }
  ```

#### Self-Healing Action Trigger
Triggers manual repair scripts.
- **Path**: `POST /api/health/recover`
- **Auth**: Admin API Key (`requireAdminApiKey`)
- **Response**:
  ```json
  {
    "success": true,
    "actionsTaken": ["reconnected_redis", "rescheduled_stale_jobs"]
  }
  ```

---

### 3.2. Webhooks

#### Twilio Webhook (Inbound Voice Receptionist)
Routes inbound phone calls to the local AI agent script.
- **Path**: `POST /api/v1/webhooks/twilio`
- **Auth**: Twilio signature validation (header `X-Twilio-Signature`)
- **Payload**: Standard Twilio x-www-form-urlencoded params.

#### Vapi Webhook (AI Assistant Integration)
Handles Vapi tool calls and call-end lifecycle updates.
- **Path**: `POST /api/webhooks/vapi`
- **Auth**: Vapi signature verification (header `X-Vapi-Signature`)
- **Payload**:
  ```json
  {
    "message": {
      "type": "tool-calls",
      "call": { "id": "call_123" },
      "toolCalls": [
        {
          "id": "call_abc",
          "function": {
            "name": "bookSlot",
            "arguments": { "date": "2026-06-28", "time": "09:00" }
          }
        }
      ]
    }
  }
  ```

#### SMS Gateway Webhook (Shop Phone Relay)
Receives inbound customer texts from the Capevace cloud relay.
- **Path**: `POST /api/webhooks/smsGateway`
- **Auth**: HMAC verification performed in the router.
- **Payload**:
  ```json
  {
    "id": "msg_982",
    "sender": "+12165550100",
    "text": "Need to cancel my tire change",
    "timestamp": 1782658930000
  }
  ```

#### Stripe Webhook
Receives billing status events.
- **Path**: `POST /api/webhooks/stripe`
- **Auth**: Stripe signature verification (header `stripe-signature`)
- **Payload**: Standard Stripe Webhook Event JSON.

---

### 3.3. Conversion & Telemetry Sinks

Registered via `registerAnalyticsRoutes(app)`:
- `POST /api/analytics/conversion`
- `POST /api/track-abandoned`
- `POST /api/uber-code`
- `POST /api/cwv`

All analytics payloads require structured JSON bodies and are rate-limited.

---

## 4. Statenour-Gated AI Endpoints

Gated under `aiLimiter` rate-limiting. These routes are proxies to run LLM reasoning on behalf of Statenour:
- `/api/nour-strategy` (POST): Analyzes inbound lead details to generate strategic follow-ups.
- `/api/agents/psych-dominance` (POST): Evaluates deal structures and generates psychology-aware pricing recommendations.
- `/api/nour-chief-strategist` (POST): Solves general operational challenges.
- `/api/agents/simulator` (POST): Runs scenario simulations.
- `/api/agents/burnout-radar` (POST): Monitors personnel strain and flags fatigue.

---

## 5. Cross-Ring Query Contract (`/api/bridge/*`)

These endpoints are used by Statenour OS to display live shop status dashboards. Every response includes a data freshness payload:

```json
{
  "generatedAt": "2026-06-27T23:30:00.000Z",
  "dataAsOf": "2026-06-27T23:15:00.000Z",
  "ageMinutes": 15,
  "staleness": "recent"
}
```

### 5.1. Cars Today
- **Path**: `GET /api/bridge/cars-today`
- **Description**: Returns today's active tickets and payment metrics.
- **Response**:
  ```json
  {
    "count": 14,
    "openTickets": 9,
    "avgTicket": 187.50,
    "byStatus": {
      "drop_off": 4,
      "in_progress": 3,
      "ready": 2,
      "paid": 5
    },
    "byPayment": {
      "card": { "count": 3, "totalDollars": 632.00 },
      "cash": { "count": 1, "totalDollars": 85.00 },
      "financing": { "count": 1, "totalDollars": 850.00 }
    }
  }
  ```

### 5.2. Estimates Conversion
- **Path**: `GET /api/bridge/estimates-conversion?range=7d|30d|90d&scope=online|alg`
- **Description**: Returns lead-to-invoice conversion stats.
  - `scope=online`: AI / Customer portal quotes.
  - `scope=alg`: Physical walk-in quotes synced from ShopDriver.
- **Response (scope=alg)**:
  ```json
  {
    "range": "30d",
    "given": 84,
    "converted": 61,
    "rate": 72.6,
    "avgTimeToConvertHours": 46.2,
    "declinedCount": 23,
    "declinedValue": 7420.00,
    "topUnmatched": [
      { "name": "SMITH, JOHN", "service": "Front struts + alignment", "amount": 1485.00, "daysOld": 9 }
    ],
    "scope": "alg"
  }
  ```

### 5.3. Estimates Aging
- **Path**: `GET /api/bridge/estimates-aging?scope=online|alg`
- **Response (scope=alg)**:
  ```json
  {
    "total": 23,
    "bucket_lt24h": 2,
    "bucket_1d_3d": 6,
    "bucket_3d_7d": 7,
    "bucket_gt7d": 8,
    "stalest": {
      "id": 41,
      "customer": "SMITH, JOHN",
      "service": "Front struts",
      "days": 47,
      "amount": 1485.00
    },
    "totalDeclinedValue": 12840.00,
    "scope": "alg"
  }
  ```

### 5.4. Drop-off Ratio
- **Path**: `GET /api/bridge/drop-off-ratio?range=7d|30d|90d`
- **Response**:
  ```json
  {
    "range": "30d",
    "dropOffs": 87,
    "walkIns": 164,
    "ratio": 34.7,
    "uberBackCount": 19
  }
  ```

---

## 6. Action Queries (`POST /api/nour-os/query`)

Statenour OS uses this endpoint to request real-time actions and analytical reports.
- **Body**:
  ```json
  {
    "query": "<action-name>",
    "filters": {}
  }
  ```

### Available Action Queries
- `attention_needed`: Outstanding alerts.
- `bookings_status` / `bookings_today`: Appt pipelines.
- `customer_search` / `customer_detail`: CRM 360 lookups.
- `master_report`: Multi-engine business health scorecard.
- `funnel_overview` / `funnel_first_visit`: Marketing funnels.
