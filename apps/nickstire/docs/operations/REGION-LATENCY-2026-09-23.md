# Region latency: the app server is in California, the database in Virginia (2026-09-23)

Read-only measurement. Nothing in Railway, the database or the code was changed for this doc.

## Answer

1. nickstire's app server (Railway service `MAINnicks-tire-auto`) runs in Railway `us-west2`, California.
   Its TiDB database is in AWS `us-east-1`, Virginia.
   Every database query that has to finish before the next one starts costs about **72 ms** of travel alone (measured, median of 15).
2. The live phone path has a twist: Vapi calls the server from AWS `us-west-2`, Oregon.
   Today the server sits next to Vapi and far from the database.
   Moving it to Virginia puts it next to the database and next to the shop's customers in Cleveland, but further from Vapi.
3. Net effect of a move to Railway `us-east4-eqdc4a` (Virginia), estimated from the measurements below:
   - the homepage data call gets about 230 ms faster for a Cleveland customer;
   - an online tire order gets about 0.55 s faster;
   - the confirmation text the receptionist sends at the end of a call gets about 0.9-1.0 s faster;
   - a booking made on the phone gets about 160 ms faster;
   - every admin console request gets about 200 ms faster;
   - the six receptionist tools that never touch the database get about 50 ms slower.
4. **Recommendation: move it, at a quiet hour, and re-measure with the same receipts (section 7).**
   The gains land on the slow, database-heavy steps. The only regression is about 50 ms on answers that already take about 27 ms on the server.
   It is a deploy-config change, so it needs the operator's instruction (AGENTS.md > Protected operations).

## 1. Topology (verified 2026-09-23)

| Piece | Where | Source |
|---|---|---|
| App server `MAINnicks-tire-auto` | Railway `us-west2` (California), 1 replica, **no volume** | Railway `get-service-config` (`multiRegionConfig`) and `describe-environment` |
| TiDB | `gateway01.us-east-1.prod.aws.tidbcloud.com` (Virginia) | `docs/CURRENT-TRUTH.md` target-host row. The 72 ms round trip below is consistent with a coast-to-coast hop; an Oregon database would be about 20-25 ms from California. |
| Vapi (phone receptionist) | AWS `us-west-2` (Oregon), EC2 | Every webhook in the call below came from `34.217.109.186`, which AWS's published `ip-ranges.json` places in `us-west-2`. |
| Media bucket `nickstire-media` | Railway bucket in `sjc` (California) | `describe-environment` |
| Redis | not used: no `REDIS_URL`, so `server/lib/cache.ts` runs its in-memory fallback | `get-service-config` variable names; `server/lib/cache.ts:2-26` |
| StateNour (`statenour-web`) | moved from `us-west2` to `us-east4-eqdc4a` on 2026-09-23, operator-approved, for the same reason (its Neon database is in `aws-us-east-1`) | Railway deployment `58ec0c98` |
| Customers | Cleveland, Ohio | the shop's address |

Railway's own docs (`deployments/regions`) say a service's region can be changed at any time with no domain or private-networking change, and **with no downtime unless a volume is attached**. `MAINnicks-tire-auto` has none.

## 2. Measurements (production, read-only)

### 2.1 One database round trip: 67-82 ms, median 72 ms

`GET https://nickstire.org/api/health` runs a timed `SELECT 1` inside the production container (`server/lib/health.ts:53-59`) and reports it as `checks.database.responseTime`. Fifteen sequential reads at about 12:17Z:

`72, 67, 69, 68, 69, 72, 72, 82, 73, 75, 81, 72, 70, 73, 71` ms.

The health handler makes no paid or customer-facing call. Its one side effect is a Telegram alert to the operator when heap use passes 80%, capped at once an hour (`health.ts:214-223`).

### 2.2 What real requests cost (Railway HTTP logs)

`totalDuration` is measured at Railway's edge. Windows are 12:08:05-12:11:26Z and 12:12:55-12:16:27Z.

| Request | Measured | Reading |
|---|---|---|
| `/api/health` | 68-72 ms | one round trip plus next to nothing |
| `/api/analytics/conversion`, `customerEvents.log`, `conversion.liveSessions`, `shopStatus.getStatus` | 70-89 ms | about one round trip each |
| Homepage data call: one batched tRPC request for `weather.current, content.activeNotifications, specials.getActive, reviews.google, activity.recent, conversion.shopCapacity` (some pages add 1-4 more) | **p50 210 ms, p90 220 ms, max 585 ms** (n=21, second window). The first window: 16 more at 197-228 ms, and one at 565 ms. | about 3 sequential round trips on the slowest procedure in the batch |
| Static assets | 4-11 ms | no database |

### 2.3 One live receptionist call (11:55:55-11:59:04Z)

The Vapi webhook (`POST /api/webhooks/vapi`) was hit 64 times during the call. Tool names come from the deploy log's `Vapi tool call` lines. Durations come from the HTTP log at the same timestamps. No caller data is reproduced here.

| Webhook | Measured |
|---|---|
| Status, transcript and conversation updates (about 60) | 26-29 ms each: none waits on the database |
| `bookSlot` | **241 ms** |
| `sendConfirmationSms` | **1,219 ms** |
| `shopInfo` | 27 ms |
| End-of-call | 46-51 ms (post-call work is detached) |

## 3. Round trips per path (read from the code)

### 3.1 Receptionist tools

No middleware on the Vapi webhook touches the database.
- The secret check is in memory (`server/routes/webhooks/vapi.ts:39-65`).
- The tRPC rate limiters only match `/api/trpc/...` (`server/_core/batchGuard.ts:31-32`).
- `createCaller` skips `createContext`.

Tool calls in one webhook run concurrently (`Promise.allSettled`, `vapi.ts:950`). Each handler's own queries run one after another.

| Tool | Sequential DB round trips before it answers | Other blocking calls |
|---|---|---|
| `shopInfo`, `capacityCheck`, `getCurrentWaitTime`, `tireSizeFromVehicle`, `checkTireStock` | 0 | none |
| `tireInquiry` | 0. With a legacy rack-check note: 4 (`routers/voiceAgent.ts:671-762`). | none |
| `bookSlot` | 3 (`voiceAgent.ts:221-223`, `services/expectedArrivals.ts:120-144`) | none |
| `escalate` | 4, 5 on a unique-key race (`voiceAgent.ts:285-315`, `services/promiseLedger.ts:127-135, 344-350, 386`) | Telegram, only at urgency "high" |
| `sendConfirmationSms` | **14-15**, or 19-20 when the 5-minute opt-out cache is cold (`services/smsOrchestrator.ts:486-1667`, `sms.ts:170-227, 1533-1549`) | the SMS gateway POST (15 s cap); a device-status GET when its 60 s cache is cold (8 s cap) |

The measured call agrees with the count. `bookSlot`: 3 x 72 ms = 216 ms, plus about 25 ms of fixed cost, predicts about 241 ms, which is what the log shows. `sendConfirmationSms`: 14-15 x 72 ms is about 1.0-1.1 s, plus the gateway POST.

### 3.2 Forms and public pages

Anonymous customers pay no database round trips before a handler runs:
- With no session cookie, `sdk.authenticateRequest` throws before any query (`server/_core/sdk.ts:212`). Only Google sign-in sets the cookie.
- The rate limiters use in-memory stores.

The page HTML is static, from disk. All page data comes from one batched tRPC request (`client/src/main.tsx:199-209`), whose queries run concurrently, so a page waits for the longest chain in its batch.

| Path | Sequential DB round trips | Notes |
|---|---|---|
| Every page's data batch | **3**: `activity.recent`, the site-wide ticker, which is uncached (`server/routers/public.ts:224, 246, 305`) | The other layout queries are 0-2 each and cached for 60 s to 1 h. 3 x ~70 ms matches the measured p50 of 210 ms. |
| Lead/quote form (`lead.submit`, 7 entry points) | 2-3 (`routers/lead.ts:130, 146`, plus an awaited audit insert) | An awaited LLM lead score runs first whenever `problem` is filled (`lead.ts:119`, 30 s cap). The move does not change that part. |
| Callback/drop-off (`callback.submit`) | 3 (`routers/callback.ts:61, 87, 98-103`) | |
| Emergency (`emergency.submit`) | 2 | The second round trip re-reads the row just inserted (`routers/emergency.ts:148-153`). |
| Careers (`candidates.submit`) | 1-2 | |
| Tire order (`gatewayTire.placeOrder`) | **8**, up to about 12 with number-collision retries (`routers/gatewayTire.ts:494-774`) | about 576 ms of round trips today |
| Chat widget (`chat.message`) | 3-7 or more | plus 1-2 LLM calls |
| Booking page | 0 | It is a call/text/directions card. `booking.create` has no caller. |

**The admin console pays the most per request.** This is the owner's `/admin`, not customers.
- Every signed-in tRPC request makes 2 sequential round trips in `createContext` before any handler runs: a user read, then an `upsertUser` write that updates `lastSignedIn` on every request (`_core/sdk.ts:216, 222`).
- The admin role check adds 1 more (`_core/trpc.ts:177`).
- So each admin request spends at least about 216 ms before its real work starts, on a console that polls about 540 requests per 15 minutes (`middleware/rateLimiters.ts:67-76`).

**Pool (inference, not verified).** The pool keeps at most 4 idle connections and closes them after 60 s (`server/db.ts:61-71`). A burst after a quiet minute therefore opens fresh connections, and each pays TCP + TLS + MySQL login, which is several more round trips. That cost scales with the round-trip time too, so the move shrinks it as well.

## 4. What a move to `us-east4-eqdc4a` changes

Assumptions (typical public round-trip times, **not measured here**):
- an in-region database round trip of 1-5 ms;
- Oregon to Virginia about 70 ms, against 20-25 ms for Oregon to California;
- Cleveland to Virginia about 15-20 ms, against 55-65 ms for Cleveland to California.

| Path | Now (measured) | After (estimate) | Change |
|---|---|---|---|
| Homepage data call, as a Cleveland customer sees it | about 210 ms server + about 60 ms network | about 15 ms server + about 20 ms network | **about 230 ms faster** |
| `sendConfirmationSms` | 1,219 ms | about 0.2-0.3 s. The gateway leg is unknown: `api.sms-gate.app`'s location was not established. | **about 0.9-1.0 s faster** |
| `bookSlot` | 241 ms | about 30 ms server + about 50 ms longer Vapi leg | about 160 ms faster |
| `escalate` | about 290 ms (from the count) | about 35 ms + 50 ms | about 200 ms faster |
| Tire order (`placeOrder`) | about 576 ms of round trips (8 x 72) | about 20 ms | **about 0.55 s faster**, plus the shorter browser leg |
| Callback, lead, emergency and careers forms | 1-3 round trips (70-210 ms) | a few ms | 70-210 ms faster. The lead form's LLM score is unchanged. |
| Each admin console request | at least about 216 ms before its work starts | a few ms | about 200 ms faster per request |
| Zero-database tools | 27 ms | 27 ms + about 50 ms longer Vapi leg | **about 50 ms slower** |
| Informational webhooks | 26-29 ms | about 75 ms | slower. Assumed harmless: Vapi does not wait on them to continue the conversation. |

For scale, one turn of Vapi's own speech-to-text, model and text-to-speech pipeline is typically several hundred milliseconds to over a second, so a 50 ms change on a zero-database tool is small. The 1 s saved on the recap text is not.

## 5. Costs and risks of the move

1. **Media from the bucket.** `/generated/*` streams objects from the `sjc` bucket through the server (`server/_core/index.ts:167-200`). After a move each stream crosses the country: about 65 ms more to the first byte, and slower transfer for 15-30 MB reel masters.
   - Meta fetches these asynchronously, and the responses are cached `immutable`.
   - The booking form's photo upload (`routers/booking.ts:457-470`) writes to the same bucket, so each upload also pays one cross-country PUT.
2. **Anything else still in `us-west2`.** nickstire uses no Railway Redis and no volume. StateNour moved east on 2026-09-23, so a nickstire move puts the two back in the same region. They talk over the bridge, `statenourSync` and the event bus.
3. **Sibling sessions.** A region change redeploys the service. Any session comparing latency before and after needs to know the date and time it happened.
4. **Reversible.** Set the region back to `us-west2`; same no-downtime rule.

## 6. Found along the way (recorded, not fixed)

These touch SMS and payments, which are protected core, so each is recorded for its own PR.

1. **A paid tire order can be recorded against another customer's invoice.** The chain was verified in the code:
   - `placeOrder` gets an invoice number, keeps it in a local variable and passes a copy to `createInvoice` (`routers/gatewayTire.ts:~702-728`).
   - On a duplicate-number collision, `createInvoice` picks a fresh number, but only on its own `data` object (`server/db.ts:2405-2414`).
   - The order row, the API response and the Stripe checkout all keep the old number (`gatewayTire.ts:774, 907, 968`).
   - When payment lands, `finalizeTireOrderPayment` marks `WHERE invoiceNumber = <old number>` paid and overwrites its `totalAmount` (`services/payments.ts:289-295`). That row is the other invoice, the one that won the race. This customer's own invoice stays unpaid.
   - It needs two invoices created at nearly the same moment: the number is `MAX(invoiceNumber)+1` with no lock (`db.ts:2388`). Today the read and the insert are at least one 72 ms round trip apart, which widens that window. The move narrows it but does not remove it.
2. **The recap text has no working duplicate check.**
   - `sendConfirmationSms`'s input schema is `{ phone, summary, mapLink }` (`voiceAgent.ts:411-415`). Vapi's `callId` is dropped, so the orchestrator gets no `vapiCallId`.
   - The idempotency key then falls through to `..._unique_${Date.now()}_${random}` (`smsOrchestrator.ts:572-577`), and the idempotency SELECT can never match.
   - The remaining guard is a one-hour per-phone cooldown that counts only `sent` and `queued` rows (`smsOrchestrator.ts:441-450`). A message left in `sending` after a gateway timeout does not block a second attempt.
   - So if the gateway times out and the tool runs again (a retry, or the model calling it twice), the customer can get the text twice.
3. **Most of `sendConfirmationSms`'s round trips only fill log columns.**
   - The voice confirmation's text is fixed from the call summary. The preflight guard declares `customerContext` but never reads it (`services/nickgptPreflightGuard.ts:38`).
   - Context reads 2-9 (`smsOrchestrator.ts:301-404`) run one at a time. Most filter with `LIKE '%<phone>'`, which cannot use an index.
   - Running them in parallel, or after the send, saves about 0.5-0.6 s in either region.
4. **Two mid-call UPDATEs can never match.** Only the end-of-call handler writes `vapi_call_logs` (`routes/webhooks/vapi.ts:488`). The UPDATEs in `bookSlot` (`voiceAgent.ts:221-223`) and `tireInquiry` (`:760-762`) therefore match 0 rows, and each costs a round trip.
5. **A misleading metric name.** `voice_latency_events` rows with stage `llm_first_token` and `metadata.source = 'vapi-webhook'` measure webhook handling time, not the model's first token.
6. **Round trips that cost nothing to remove, in any region:**
   - `activity.recent`'s three independent SELECTs run one after another (`routers/public.ts:224-324`). A `Promise.all` makes every page's data batch wait about 1 round trip instead of 3.
   - `emergency.submit` re-reads the row it just inserted (`routers/emergency.ts:148-153`); the insert already returns the id.
   - `lead.submit` awaits the LLM lead score before its duplicate check, so duplicates pay for it too (`routers/lead.ts:119, 130`).

## 7. How to verify after a move (same receipts)

1. `GET /api/health`, `checks.database.responseTime`, 15 samples. Expect single-digit ms.
2. Railway HTTP logs: the homepage batched tRPC request's `totalDuration`. Expect p50 well under 50 ms.
3. The next live call: the `bookSlot` and `sendConfirmationSms` webhook durations, against 241 ms and 1,219 ms here.
4. Read-only, for whoever has database access: the real webhook-handling distribution before and after, from `voice_latency_events`.

```sql
SELECT COUNT(*) n, APPROX_PERCENTILE(latency_ms, 50) p50, APPROX_PERCENTILE(latency_ms, 95) p95
FROM voice_latency_events
WHERE stage = 'llm_first_token'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = 'vapi-webhook'
  AND created_at >= NOW() - INTERVAL 30 DAY;
```

## What this does not establish

1. How often each tool is called. The query above, grouped by tool, would weight section 4.
2. Where `api.sms-gate.app` (the SMS gateway relay) is hosted, so its leg of `sendConfirmationSms` is unknown.
3. The in-region round-trip times in section 4 are typical figures, not measurements.
4. Whether the live assistant sends `assistant-request` before connecting. If it does, that path costs 1-2 round trips (`services/vapi-bdi.ts:139, 181`), and a move saves about 70-140 ms at pickup.
