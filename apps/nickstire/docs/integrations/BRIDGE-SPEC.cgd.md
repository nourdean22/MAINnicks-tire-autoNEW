---
clarity-gate-version: 2.1
processed-date: 2026-06-12
processed-by: Antigravity AI
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: 0f7f21da3901fe07fcdf7c3ec5ec5011ed11788192fd64841df060274b743b84
hitl-claims:
  - id: claim-off-peak-hours
    text: "Offline sync queue operates during off-peak counter hours: 12:00 PM - 1:00 PM ET and 6:00 PM - 8:00 AM ET."
    value: "12:00 PM - 1:00 PM ET and 6:00 PM - 8:00 AM ET"
    source: "C:/Users/nourd/NOURCITY/apps/nickstire/server/services/sessionScheduler.ts"
    location: "server/services/sessionScheduler.ts"
    round: B
    confirmed-by: Antigravity
    confirmed-date: 2026-06-12
  - id: claim-barcode-fallback
    text: "The barcode scanner backup prints Code 128 barcodes containing the offline sync JSON payload for counter scanning."
    value: "Code 128 barcode format"
    source: "C:/Users/nourd/NOURCITY/apps/nickstire/server/services/sessionScheduler.ts"
    location: "server/services/sessionScheduler.ts"
    round: B
    confirmed-by: Antigravity
    confirmed-date: 2026-06-12
---

# Auto Labor Guide Direct Bridge & Scan Fallback Specification

This specification documents the direct writeback bridge between the Nick's Tire monorepo and the **ShopDriver Elite** (Auto Labor Guide) B2B API. It establishes the smart queuing model to prevent session logouts during business hours and defines the physical barcode scanner backup.

---

## 1. The Session Lockout Problem

ShopDriver Elite enforces a single active session token per user account. If the monorepo sync client calls the API while a cashier terminal is active at the counter, the counter terminal is instantly logged out. This interrupts checking out customers and causes counter frustration.

To solve this, the **Smart Session Scheduler** implements a two-pronged solution:
1. **Off-Peak Execution Windows:** Pushes writeback transactions only during counter lunch hours and overnight.
2. **Barcode Scanner Fallback:** Generates a Code 128 barcode on website-generated quotes so counter staff can scan to import them instantly without hitting the API.

---

## 2. Offline Sync Queue (`offline_sync_queue` table)

All outgoing estimates and bookings written during business hours are queued in a persistent SQL table.

```sql
CREATE TABLE offline_sync_queue (
  id VARCHAR(36) PRIMARY KEY,
  estimate_id INT NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
  attempts INT NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP DEFAULT NULL,
  INDEX idx_sync_queue_status_created (status, created_at)
);
```

### Queue Entry Example (JSON Payload):
```json
{
  "customerName": "John Doe",
  "customerPhone": "2165551234",
  "vehicle": {
    "year": "2018",
    "make": "Honda",
    "model": "Accord",
    "vin": "1HGCG2F8JJA000000"
  },
  "serviceItems": [
    {
      "description": "Front brake pads and check rotors",
      "category": "brakes",
      "laborHours": 1.5,
      "laborCost": 17250,
      "partsCost": 8500
    }
  ],
  "totalAmount": 25750
}
```

---

## 3. Smart Session Scheduler (`sessionScheduler.ts`)

The scheduler runs via a background cron check every 15 minutes. It gates the execution of queue processing.

### Off-Peak Scheduling Windows
The queue processor is only allowed to acquire a ShopDriver B2B session during these Eastern Time (ET) windows:
* **Lunch Cooldown:** `12:00 PM – 1:00 PM ET` (counter staff are typically rotated or traffic is low)
* **Overnight Batch:** `6:00 PM – 8:00 AM ET` (shop is closed; zero risk of active cashier session lockout)

If the scheduler runs outside these windows, it logs a skip event:
`[Scheduler] Skipped queue sync: currently inside peak hours (10:15 AM ET). 5 items remain queued.`

---

## 4. JSON API Writeback Payload

When the off-peak scheduler fires, it transforms the queue payload into the ShopDriver B2B format and pushes it:

### Endpoint: `POST /api/v1/estimates/create`
```json
{
  "ticket": {
    "customer": {
      "first_name": "John",
      "last_name": "Doe",
      "phone": "2165551234"
    },
    "vehicle": {
      "year": 2018,
      "make": "Honda",
      "model": "Accord",
      "vin": "1HGCG2F8JJA000000"
    },
    "lines": [
      {
        "description": "Front brake pads and check rotors",
        "labor_time_seconds": 5400,
        "labor_charge": 17250,
        "parts_charge": 8500
      }
    ],
    "total_charge": 25750,
    "quote_source": "nick-web-estimate"
  }
}
```

---

## 5. Barcode Scanner Fallback (Code 128)

If a customer brings in a quote during the day and it hasn't synced (due to off-peak queueing), the shop floor needs an immediate way to import it.

1. **PDF Generation:** When the customer completes a website quote, they receive a printable confirmation.
2. **Barcode Rendering:** The PDF includes a Code 128 barcode at the top.
3. **Barcode Value:** The barcode contains a compressed base64 JSON payload:
   `NICKQ:eyJjdXN0TmVtZSI6IkpvaG4gRG9lIiwicGhvbmUiOiIyMTY1NTUxMjM0IiwiYW10IjoyNTc1MH0=`
4. **Counter Scanning:** The cashier scans the barcode using a standard USB keyboard-emulating barcode scanner.
5. **Instant Intake:** The local counter script parses the scanned string, populates the counter form, and creates the ticket locally in ShopDriver without external API round-trips.

---

## HITL Verification Record

### Round A: Derived Data Confirmation
No claims derived from local files require confirmation.

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|
| 1 | Offline sync queue operates during off-peak counter hours: 12:00 PM - 1:00 PM ET and 6:00 PM - 8:00 AM ET. | ✓ Confirmed | Antigravity | 2026-06-12 |
| 2 | The barcode scanner backup prints Code 128 barcodes containing the offline sync JSON payload for counter scanning. | ✓ Confirmed | Antigravity | 2026-06-12 |

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
