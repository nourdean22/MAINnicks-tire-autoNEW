# Nick's Tire Admin — route/capability inventory + forensic wiring audit

**2026-09-01 · Artifact 1 of a multi-part audit.** Near-pure verified fact. Everything here is
checkable against a named file and line. Opinion, redesign and benchmarking are deliberately
NOT in this file — they land in later artifacts so this one can be trusted without filtering.

---

## 0. Ground truth (read this before believing any number below)

| Fact | Value |
|---|---|
| Audited ref | `origin/main` @ **`5c1195e6fcba112fae55f94a4f2becf29ccf5391`** |
| origin/main tip | 2026-09-01 17:32:31 -0400 · `fix · statenour · Journal+Settings truth wave (#2055)` |
| Session local HEAD | `6e1114e2b` on `statenour/hard-delete-guard-wiring` — **5 behind, 1 ahead** of origin/main |
| `apps/nickstire` HEAD vs origin/main | **byte-identical** (`git diff HEAD origin/main -- apps/nickstire` → empty) |
| Evidence class of everything below | VERIFIED CURRENT CODE. **No runtime, no live UI, no DB rows.** |

### The working tree is gutted — this changed the method

All **3,260** tracked files under `apps/nickstire` are absent from the working tree
(`git status` shows 3,260 ` D` entries; `ls apps/nickstire` returns nothing). This is the
condition recorded in agent memory as *main checkout GUTTED 2026-09-01*.

**Consequence for any agent repeating this audit:** ordinary `Read` / `Grep` / `Glob` against
the working tree return "not found" for every file, and would manufacture a catastrophic false
report — "the entire nickstire app is missing." Every fact in this document was read from the
git object database instead (`git show origin/main:<path>`, `git grep <pat> origin/main -- <path>`),
which is unaffected. Nothing was checked out; disk was at **13 GB free**, not the 27 GB assumed
at briefing time.

### Convention note

The brief asked for `apps/nickstire/docs/research/`. **That directory does not exist and the
repo has no such convention** — `apps/nickstire/docs/` is flat, `UPPERCASE-KEBAB.md`, ~40 files.
Following the existing convention instead, per the brief's own instruction.

---

## 1. The route tree is not a route tree

**The single most structurally important fact about this admin**, and the one a route-based
taxonomy would miss entirely:

`/admin` is **one wouter route** (`client/src/App.tsx:258`) rendering one component
(`pages/Admin.tsx`, 382 lines). There are no nested admin routes. Navigation is `?tab=<slug>`
query-string state resolved by a client-side registry.

Complete admin URL surface — this is all of it:

| URL | Behaviour | Source |
|---|---|---|
| `/admin` | the entire admin; section from `?tab=` / `?section=` | `App.tsx:258` |
| `/admin/content` | 301-equivalent redirect → `/admin?tab=content` | `App.tsx:259` |
| `/admin/ig-studio` | redirect → `/admin?tab=instagram` | `App.tsx:263` |
| `/admin/reel-studio` | redirect → `/admin?tab=instagram` | `App.tsx:264` |
| `/admin/ad-studio` | **the only genuinely separate admin page** | `App.tsx:265` |

Implications that follow directly and are worth stating once:

- There is no server-side authorization boundary at a URL. Every section is one client bundle
  behind one auth check; per-section access is enforced by `allowedRoles` in the registry plus
  `adminProcedure` on each tRPC call. The registry gate is **cosmetic**; the procedure gate is
  the real one. Do not confuse them.
- Deep links, browser history, and "open in new tab" all work only to section granularity plus
  whatever inner key a section reads (`moneyTab`, `outreachTab`, …).
- `/admin/ad-studio` being separate is an inconsistency, not a design: it is the one surface
  that cannot receive the shell's sidebar, badges, command palette, or degraded-data banner.

---

## 2. Capability inventory — 17 sections, verified from the registry

Source of truth: `client/src/pages/admin/registry.tsx` (`ADMIN_REGISTRY`) and
`client/src/pages/admin/shared/types.ts:20-24` (`AdminSection` union). Both agree: **17 ids**.

Sidebar groups render in fixed order `Daily · Reach · Automation · Truth · System`
(`registry.tsx:24`). Roles: `owner, manager, front_desk, tech, accountant, viewer`
(`shared/adminPermissions.ts:1`). `FULL_ACCESS = [owner, manager]`.

| # | id | Sidebar label | Group | Prio | In sidebar | Roles |
|---|---|---|---|---|---|---|
| 1 | `overview` | Today | Daily | 10 | yes | all 6 |
| 2 | `approvals` | Approvals | Daily | 15 | yes | owner, manager |
| 3 | `customers` | Customers | Daily | 20 | yes | +front_desk, tech |
| 4 | `leads` | Sales Pipeline | Daily | 30 | yes | +front_desk |
| 5 | `revenue` | Money | Daily | 40 | yes | +accountant |
| 6 | `memberships` | Nonstop Nick | Daily | 45 | yes | +accountant |
| 7 | `tireOrders` | Tires | Daily | 50 | yes | +front_desk, tech |
| 8 | `growth` | Marketing / Growth | Reach | 10 | yes | owner, manager |
| 9 | `content` | Website & Local | Reach | 20 | yes | owner, manager |
| 10 | `instagram` | Instagram | Reach | 30 | yes | owner, manager |
| 11 | `campaigns` | Winback | Reach | 40 | yes | owner, manager |
| 12 | `voiceReceptionist` | Voice Receptionist | Automation | 10 | yes | +front_desk |
| 13 | `intelligence` | Intelligence HQ | Automation | 20 | yes | +viewer |
| 14 | `opsHub` | Reports | Truth | 10 | yes | +accountant, viewer |
| 15 | `settings` | Settings / Safety | System | 10 | yes | owner, manager |
| 16 | `callTrackingView` | Call Tracking | Automation | 30 | **no** | +front_desk |
| 17 | `trafficFunnel` | Traffic → Revenue | Truth | 20 | **no** | +accountant |

Two sections (`callTrackingView`, `trafficFunnel`) are reachable **only** by alias, command
palette, or deep link. On the iPhone PWA the operator actually uses, there is no Cmd+K — so on
that device these two are reachable only by typing a URL. The registry comments show this exact
class of defect was fixed for `revenue` and `content` on 2026-07-25; these two are the residue.

Beyond the 17 sections there are **8 compound redirect slugs** (`COMPOUND_REDIRECTS`,
`registry.tsx`) that set a section *and* an inner tab: `declinedestimates`, `declined`,
`estimates`, `declined-work`, `snapdashboard`, `snap-finance`, `financing`, `snap`.

### Scale of what sits behind those 17 doors

| Thing | Count | How counted |
|---|---|---|
| Admin page/panel files | **127** | `git ls-tree -r origin/main -- client/src/pages/admin` |
| Admin shell components | 23 | `client/src/components/admin` |
| tRPC router files | 94 | `server/routers/**` |
| **Registered tRPC procedures** | **703** | `server/__tests__/proc-census.test.ts` (prior art, #1478) |
| Server services | 273 | `server/services/**` |
| Cron jobs | 52 | `server/cron/jobs/**` |
| DB tables (Drizzle) | **146** | `drizzle/schema.ts`, `^export const … mysqlTable(` |
| Server test files | ~350 | `server/*.test.ts` |

---

## 3. Method — and my own error rate

The brief's central instruction was that mechanical detectors are wrong about one time in
three, and that no automated finding ships without a positive control. That was correct, and
generous. **My raw detector's false-positive rate was 50%.**

### Detector design, and why the obvious one was rejected

The obvious wiring detector is "tRPC procedure with no client caller = dead." **I did not use
it**, because the repo's own prior art refutes it: `docs/DEAD-PROCEDURE-HARVEST-2026-08-30.md`
measured 703 registered procedures against 77 served in a 13-hour window, and states plainly
that every procedure is reachable over HTTP by callers outside this repo (the statenour bridge,
webhook dispatchers, phone shortcuts, curl). A no-caller grep proves nothing in either
direction, and that document records the repo being burned in **both** directions in one week.

I used a detector whose closure property actually holds instead: **TiDB tables can only be
written by code in this repo.** "Table is read, and nothing anywhere writes it" survives the
external-caller objection completely.

### Controls, run before believing any output

- **Positive control** — six tables known live (`leads`, `customers`, `bookings`,
  `smsMessages`, `workOrders`, `invoices`). Detector reported writers *and* readers for all six.
  Fires on true cases. ✅
- **Extraction control** — `grep -c mysqlTable` said 147, my extractor found 146. Chased the
  discrepancy rather than assuming: the 147th is the `import { mysqlTable }` line. Denominator
  confirmed at 146, no table missed. ✅
- **Negative control** — after falsification, the eliminated candidates were required to show a
  *named write site*, not merely an absence. `customer_metrics` →
  `services/customerMetricsRefresh.ts:40`; `expected_arrivals` →
  `services/expectedArrivals.ts:123`. Detector correctly goes quiet on false cases. ✅

### Correction ledger — my own

| # | Claim I nearly shipped | What refuted it | Class |
|---|---|---|---|
| 1 | 6 tables are read-with-no-writer | Raw-SQL `INSERT INTO <snake_case>` writers exist for 3 (`customer_metrics`, `daily_execution`, `expected_arrivals`). Drizzle-identifier scanning cannot see raw SQL. | **50% false positive** |
| 2 | `dispatch.sendMessage` fakes an SMS an operator is clicking | It has **no client caller**. It is a loaded gun, not a firing one. Severity overclaimed. | severity |
| 3 | The follow-up module is orphaned, no caller | `server/routers/admin/followUps.ts:16` imports `runFollowUps`. My first grep was for the *inner* functions, not the *exported wrapper*. | false negative |
| 4 | `kpi.history` is dead (no caller) | Kept the claim but **downgraded its evidence class** — no-caller is weak per §3. Replaced it with the table-writer claim, which is strong. | evidence class |

Four corrections on roughly a dozen candidate findings. Every finding in §4 survived a
falsification pass designed to kill it.

### What this method cannot see — stated, not hidden

- **Runtime.** No production access was used. Every feature-flag state, every "is this cron
  actually scheduled in prod", every row count is **NOT VERIFIED**. Where a flag is the
  discriminator for a finding's blast radius, I say so.
- **Live UI.** Nothing was rendered. No screenshot, no DOM, no click.
- **External callers.** Anything reachable over HTTP from statenour or curl is outside this
  repo's graph.
- **Dynamic table access.** A table written via a runtime-constructed table name would evade
  the detector. I found no such pattern, but I did not prove its absence.

---

## 4. Findings

Three shapes were hunted, per the brief: **writer with no reader**, **reader with no writer**,
**gate with the wrong subject** — plus the operational shape that matters most for a shop:
**the system reports success while the real-world outcome did not happen.**

---

### 🔴 F-1 · "RUN FOLLOW-UPS" burns bookings and reports success without sending anything

**Shape: success reported, real-world outcome failed. Confirmed end-to-end, live button.**
This is the highest-severity finding in this artifact.

Full chain, every link verified:

1. `client/src/pages/admin/outreach/FollowUpsSection.tsx:84` — operator clicks **RUN FOLLOW-UPS**.
2. → `trpc.followUps.run` → `server/routers/admin/followUps.ts:15-18` → `runFollowUps()`.
3. → `server/follow-ups.ts:152` → `process24hFollowUps()` + `process7dReviewRequests()`.
4. **`follow-ups.ts:55-57`** — for each eligible booking, `bookings.followUp24hSent = 1` is set
   **before any send is attempted**. The claim is never released on failure. Comment at
   `:50-53` documents this as deliberate: *"a failed send is no longer retried — an acceptable
   miss for a thank-you, never a double-text."*
5. **`follow-ups.ts:73-75`** — a text is attempted only if `booking.phone` is truthy **and**
   feature flag `sms_review_requests` is enabled.
6. **`follow-ups.ts:84`** — `processed++` runs **unconditionally**, outside both guards.
7. → `{ total: thankYou.processed + reviews.processed }` (`follow-ups.ts:157`).
8. → `FollowUpsSection.tsx:43` — **`toast.success("Processed ${data.total} follow-ups")`**.

**Failure scenario.** `sms_review_requests` is disabled. Operator clicks the button. Twenty
completed bookings are permanently stamped `followUp24hSent = 1`. Zero texts are sent. A green
toast reads *"Processed 20 follow-ups."* Those twenty customers can never be followed up again
by this system — the claim is irreversible and there is no release path. The same holds for any
booking with a null phone, at any flag state.

The `customer_notifications` rows *are* created (step 4 of the function) and stay `pending`
forever: `followUps.retry` only moves `failed → pending`, and the booking-level claim blocks
reprocessing regardless. They accumulate in the admin's own pending list
(`admin/followUps.ts:22`).

**In fairness, two things here are right and should not be "fixed" away:** the at-most-once
claim genuinely does prevent double-texting, and `markNotificationSent` is correctly gated on
`smsResult.success` (`:79`) — the notification row never lies. The defect is that the *booking*
and the *counter* are not held to the same standard as the notification row.

**Positive control that this is a deviation, not house style:**
`server/cron/jobs/missedCallRecovery.ts:193` does it correctly —
`if (result.status === "sent" || result.status === "queued") processed++`. The codebase already
knows the right pattern.

**NOT VERIFIED:** the production value of `sms_review_requests`. That flag is the entire blast
radius. Agent memory records 9 of 10 external-side-effect flags as armed, but a doc's flag value
is a cache with no invalidation — read the service, or the DB, before acting.

**What would change this finding:** evidence that `followUp24hSent` is reset somewhere I did not
find, or that `processed` is not what the toast renders.

---

### 🟠 F-2 · `dispatch.sendMessage` writes `status: "sent"` and sends nothing

**Shape: gate with the wrong subject / receipt without the event. Loaded but unfired.**

`server/routers/dispatch.ts:261-273` — an `adminProcedure` **mutation** named `sendMessage`,
taking `recipient` and `message`, whose entire body is:

```ts
const { logStatusMessage } = await import("../services/customerMessaging");
const id = await logStatusMessage({ ...input, status: "sent" });
return { id };
```

`logStatusMessage` (`server/services/customerMessaging.ts:119-142`) is a pure
`db.insert(customerStatusMessages)` with `sentAt: new Date()`. **The module imports no SMS
sender at all** — no Twilio, no `sendSms`, no gateway; its only imports are `drizzle-orm`, a
logger, the db, and `resolveWorkOrderCustomer`.

Two defects, one of which is the subtler:

1. Nothing is sent. The row asserts delivery that never occurred.
2. `status` is **hardcoded** `"sent"` at the only call site. The type permits
   `"sent" | "failed" | "skipped" | "suggested"` — so this message log is *structurally
   incapable* of recording a non-delivery. A log that can only say "sent" is not a log.

**Severity is MEDIUM, not HIGH, and this correction matters:** `dispatch.sendMessage`,
`dispatch.generateMessage` and `dispatch.messageHistory` have **zero client callers**. No
operator button reaches this today. But the procedure is mounted and `adminProcedure`-gated,
and per §3 procedures in this repo are reachable over HTTP from outside it. The whole
three-procedure customer-messaging feature is **built and unwired** — a complete subsystem with
no door, whose door, if ever fitted, opens onto a lie.

---

### 🟠 F-3 · `payments` table: read in the refund path, never written anywhere

**Shape: reader with no writer. Confirmed — zero writers of any kind.**

- Defined `drizzle/schema.ts:2027`.
- Read exactly once: `server/routers/advanced/invoices.ts:1210`, inside `refundOrder`.
- **Writers: none.** No `db.insert(payments)`, no `INSERT INTO payments` anywhere in
  `apps/nickstire`. Verified by identifier scan *and* by raw-SQL scan on the snake_case name.

The read is step (b) of a three-tier refund lookup for a Stripe payment intent
(`invoices.ts:1197-1231`):

| step | source | status |
|---|---|---|
| a | `tireOrders.stripeSessionId` → Stripe session | live |
| b | **`payments` table where `status = 'paid'`** | **always empty — dead branch** |
| c | Stripe `paymentIntents.search` by `metadata.invoiceNumber` | live |

Consequence: the designed three-tier lookup is in fact two-tier. For an invoice that is not a
tire order *and* whose Stripe payment intent lacks `metadata.invoiceNumber`, the refund throws
`"Could not locate a Stripe payment for invoice …"` — where the designer's intent was that the
`payments` table would catch exactly that case. The failure is loud (a thrown error, not a
silent wrong refund), which is why this is 🟠 and not 🔴.

---

### 🟠 F-4 · `kpi_snapshots`: never written — and a prior audit called it "fully wired"

**Shape: reader with no writer, plus a falsified prior claim.**

- Defined `drizzle/schema.ts:1373`.
- Read at `server/routers/advanced/kpi.ts:107` — `kpi.history`, documented in-file as
  *"Get historical KPI snapshots for trend charts."*
- **Writers: none** — no Drizzle insert, no raw SQL. Every occurrence outside `schema.ts` is a
  migration snapshot, a type export, an import list, or `advanced.test.ts` asserting the schema
  object merely *exists*.

Therefore `kpi.history` returns **`[]` to every caller**, in-repo or external, permanently. This
is the strong form of the claim and it does not depend on the caller graph.

The weaker, separately-labelled observation: `trpc.kpi.*` has **no in-repo client caller**
(verified against the real mount path — `server/routers.ts:170` mounts `kpi: kpiRouter`, so the
paths are `kpi.current` / `kpi.history`; I checked the mount before believing the grep). Per §3,
that is not proof of deadness.

**The prior-audit contradiction — a finding about the audits, not just the code.**
`docs/audits/NICKSTIRE-ADMIN-CLEANUP-AUDIT.md:112` describes the Money Dashboard as reading
`kpi.current` and `kpi_snapshots (weekly snapshots for trends)`, and grades the surface
**"fully wired"**, gap **"none"**, action **"none needed."** Against `origin/main` today: no
client calls `kpi.*`, and nothing has ever written `kpi_snapshots`. That row is wrong on both
counts. It is the exact category error this audit was commissioned to prevent — a confident
paragraph under a heading nobody actually investigated.

---

### 🟡 F-5 · `customer_testimonials`: created on demand, read by the evidence engine, never written

**Shape: reader with no writer. Degrades silently rather than breaking.**

- Defined `drizzle/schema.ts:3770`; additionally `CREATE TABLE IF NOT EXISTS
  customer_testimonials` at `server/routers/nick/intelligence.ts:484` — so the table is
  *provisioned* at runtime.
- Two readers: `server/services/contentTopicSignals.ts:122-127` and
  `server/services/evidenceEngine.ts:196-202` (the latter filtering `rating >= 4`).
- **Writers: none anywhere**, Drizzle or raw SQL.

The evidence engine builds a testimonial list from Google reviews *plus* this table, then
`.slice(0, 5)`. The manual-testimonial contribution is permanently zero. Impact is bounded
because Google reviews fill the list — **except** that agent memory records *Google Reviews DEAD
IN BOTH APPS*, which if still true means `combinedTestimonials` is always empty and the
"evidence" engine produces no testimonial evidence at all, silently, forever. That compounding
is **NOT VERIFIED** here and is the first thing to check in artifact 2.

This is the "absent evidence is not a pass" pattern already recorded for this app on 2026-08-29:
a stage that never ran is indistinguishable from a stage that passed.

---

### ✅ N-1 · Three candidates that were NOT defects — recorded so nobody re-flags them

The detector accused these; falsification cleared them. **Do not re-open without new evidence.**

| Table | Accused of | Actual writer |
|---|---|---|
| `customer_metrics` | no writer | `services/customerMetricsRefresh.ts:40` — raw `INSERT INTO customer_metrics` (+5 `UPDATE`) |
| `daily_execution` | no writer | raw `INSERT INTO daily_execution` ×2, `UPDATE` ×2 |
| `expected_arrivals` | no writer | `services/expectedArrivals.ts:123` — raw `INSERT INTO expected_arrivals` (+3 `UPDATE`) |

All three write via raw SQL using the snake_case DB name, invisible to Drizzle-identifier
scanning. **Any future automated wiring audit of this repo must scan both spellings.**

---

## 5. Things the brief asserted that the repository does not support

Per the brief's own instruction that a wrong premise is itself a finding:

1. **"`apps/nickstire/docs/research/` unless the repo has a convention."** No such directory;
   the convention is flat `docs/UPPERCASE-KEBAB.md`. Followed the convention.
2. **"~27 GB free."** Actual free space at audit time: **13 GB**. Relevant because the brief
   correctly warns that a full disk masquerades as exit-134 — the margin is half what was
   assumed.
3. **The brief's implicit model of `/admin` as a tree of pages, nested routes, modals and
   settings subsections.** It is one route and a query-string registry (§1). A page-by-page
   taxonomy imposed on this admin would have invented structure that does not exist.
4. **"48-item deliverable list."** Not attempted, by design — see §6.

---

## 6. What this artifact deliberately does not contain

The brief ends in a 48-section template. A fixed output shape is the precise pressure that
manufactures confident filler under headings nobody investigated — demonstrated in this very
repo by `NICKSTIRE-ADMIN-CLEANUP-AUDIT.md:112` (F-4), which filled a "fully wired / none needed"
cell for a surface that reads a table with no writer.

So: **cut from this artifact, with reasons.** Nothing below is claimed as investigated.

| Cut | Why |
|---|---|
| Competitor benchmarking (Shopmonkey, Tekmetric, AutoLeap, …) | Zero repository evidence. Belongs in a later artifact and must not be interleaved with verified fact. |
| OSS landscape, versions, ADOPT/ADAPT/REJECT | Same. Also requires network research not yet done. |
| Wireframes, visual system, IA redesign | Opinion. Would dilute an artifact whose value is that it is checkable. |
| Performance/CWV budgets | Requires runtime. Would be inference dressed as measurement. |
| Accessibility audit | Requires rendered DOM. Not available; not guessed. |
| Threat model | Deserves real work, not a paragraph. Artifact 3. |
| Metric contracts, analytics audit | Partially reachable statically; not yet done honestly. |
| Full per-section inner-tab inventory | **NOT INVESTIGATED.** 127 files; I inventoried the 17 top-level sections exhaustively and did not enumerate every inner tab. Would take a further pass reading each section component's tab array. |
| Runtime/live-UI verification of every finding | No production access this session. Every finding is labelled accordingly. |

---

## 7. Immediate actions, ranked by (certainty × harm) ÷ effort

1. **Read the production value of `sms_review_requests`** (F-1). One flag read decides whether
   "RUN FOLLOW-UPS" is currently consuming real customers. Do this before anything else.
2. **Do not press RUN FOLLOW-UPS until F-1 is resolved.** Each press permanently consumes every
   eligible booking whether or not a text goes out.
3. **F-1 fix, two lines, no redesign:** move `processed++` inside the success branch (mirroring
   `missedCallRecovery.ts:193`), and set `followUp24hSent` only after a successful send *or*
   record a distinct terminal state for "claimed but not sent" so the count and the claim tell
   the same story.
4. **Correct `NICKSTIRE-ADMIN-CLEANUP-AUDIT.md:112`** (F-4). A stale audit that says "fully
   wired" is worse than no audit — it retires the question.
5. **Decide F-2's direction:** either wire `dispatch.sendMessage` to a real sender and let it
   record real outcomes, or delete all three procedures. Leaving a mounted `sendMessage` that
   only writes `"sent"` is the worst of the three options.
6. **Add the raw-SQL spelling to any wiring gate** (N-1). A detector that reads only Drizzle
   identifiers will keep producing 50% false positives on this codebase.

---

## 8. Unresolved questions carried into artifact 2

1. Are Google reviews actually dead in nickstire? If so F-5 compounds into a fully silent
   evidence engine.
2. Do the 630 not-served procedures from the 2026-08-30 harvest include externally-served ones?
   Needs a second harvest window, per that document's own protocol — not a fresh grep.
3. `callTrackingView` and `trafficFunnel` have no sidebar door and no Cmd+K on the operator's
   iPhone. Are they reached at all, or are they the next `revenue`/`content` nav-orphan fix?
4. `/admin/ad-studio` sits outside the shell — deliberate, or drift?
5. Do the other 143 tables hide the same reader/writer asymmetry in the *other* direction
   (written, never read)? Shape A was not yet run; it needs a different detector.
