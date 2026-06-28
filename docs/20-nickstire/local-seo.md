# Local SEO & Google Reviews Cache Architecture

This document serves as the Single Source of Truth for how **Nick's Tire** manages local SEO, Google Places API reviews, caching strategies, and fail-safe database overrides.

---

## ⚡ 1. Google Places API Cache & Error Backoff Lock

The reviews integration layer (`apps/nickstire/server/google-reviews.ts`) dynamically queries the Google Places API to retrieve rating statistics and review snippets.

### The Problem
If the Google API key expires, exceeds budget quotas, or encounters transient network failures:
*   High-frequency client requests would spam Google APIs.
*   Slow response timeouts would degrade public site performance.

### The Cache & Lock Architecture
To mitigate this, the review engine implements an in-memory cache and backoff lock:

```
                  ┌───────────────────────────────┐
                  │   Incoming Review Request     │
                  └───────────────┬───────────────┘
                                  │
                       [Is Cache Fresh? < 24h]
                       ├───────────YES───────────> Return Cached Data
                       │
                       NO
                       │
               [Fail Count >= 3?]
               ├───────────YES───────────> Backoff Active?
               │                           ├─────YES────> Return Cached Data
               │                           │
               NO                          NO (Initiate API Request)
               │                           │
               └──────────────┬────────────┘
                              │
                    [Fetch Google Places]
                    ├── Success ──> Reset failCount, Cache 24h, Return Data
                    └── Failure ──> Increment failCount, Return DB Fallback
```

*   **Cache TTL**: Fresh reviews are cached in-memory for 24 hours (`CACHE_TTL`).
*   **Failed Tries threshold**: If an API call fails 3 or more times (`failCount >= 3`), a backoff throttle is activated.
*   **Backoff Lock Duration**: The cache lock duration matches `MAX_FAIL_BACKOFF * failCount` (scaling dynamically with failures to prevent log and connection exhaustion).

---

## 💾 2. Database Fallback & Display Resolution

When the Google Places API is offline or locked, the system automatically falls back to database-stored values via the `buildFallbackData()` handler:

### Display Resolution Rule
The review count shown on the website is determined by the `resolveReviewDisplay()` formula in `shared/business.ts`:

$$\text{Display Count} = \max(\text{Marketing Floor}, \text{Live Google Reviews}, \text{Admin Database Override})$$

1.  **Marketing Floor**: Static value configured in `BUSINESS.reviews.count` (currently `1700+`). Prevents Google Place API lags or key errors from showing zero/low review counts to customers.
2.  **Live Google Reviews**: Real-time review count retrieved from the Google Places API.
3.  **Admin Database Override**: Custom override value stored in the `shop_settings` DB table.

---

## 🔧 3. Managing DB Fallback Settings (Admin Panel)

Admin overrides are stored in the TiDB database under the `shop_settings` table using the following key entries:

| Key Name | Type | Category | Purpose | Default / Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **`reviewCount`** | String / Int | `general` | Admin review count override | `BUSINESS.reviews.count` (1700) |
| **`reviewRating`** | String / Float | `general` | Admin review rating override | `BUSINESS.reviews.rating` (4.9) |

To save/update these fallbacks programmatically or via admin dashboard controls, the system invokes `saveReviewStatsToDb(stats)`:
```typescript
import { saveReviewStatsToDb } from "./google-reviews";

// Programmatic update
await saveReviewStatsToDb({
  count: 1723,
  rating: 4.9
});
```
This updates the database fields dynamically, which instantly refreshes the public fallback display without requiring a server reboot or static code rebuild.
