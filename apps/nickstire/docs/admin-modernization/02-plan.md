# Nickstire Admin Modernization — Validated Plan (systems → front)

> Worktree `nickstire/admin-modernize` · locked 2026-06-01 · clarity-gate: `[V]` verified-from-code · `[I]` inferred/design · `[ASSUMPTION]`.
> Companion: `00-exploration-profile.md` (the data + structure profile this plan is built on).

## Target end-state — the "Stream + Command" Hybrid IA
A phone-first operator admin where you **clear obligations** and **jump to anything**, not "browse tabs":
- **Home = The Stream.** One prioritized, self-clearing *"what needs you now"* queue, built by promoting the existing `nextBestActions` engine `[V intelligence.ts:261]` from a buried card to the whole home. Decay-weighted rank (`urgency × $-at-stake × staleness × VIP`), inline act-rail (Call/Text/Quote/Done), drill-in sheets, an "all caught up" finish line. Done/Call are training signals back into the ranker.
- **Nav = Command + Entities.** A thumb-FAB / Cmd+K (promote the existing 858-line `CommandSearch` `[V]`) is the nav spine; zero-query home = recents + pinned verbs + live-count chips. Destinations are **entity pages** — Customer / Invoice / Call / Lead / Work Order — replacing fixed sections. The unified Customer page is already prototyped as `CustomerDrawer` `[V]`.
- **Modes = lenses on the Stream.** Triage / Floor / Outreach / Books become filters over the one stream (+ time/context flavors the default sort), not 12 destinations.
- **Nick = a Phase-3+ layer.** Proactive Stream cards + natural-language answers, gated by a Verify Card + 15s undo — added *after* the data front makes answers trustworthy. Not the foundation.
- **Cleanup is a side-effect:** when sections dissolve, the `/admin/content` duplicate `[V]`, the god-file sections (Voice 1678 / Revenue 1593 / Customers 1495 `[V]`), and the 5-6-tab mobile overflow `[V]` all disappear without separate fixes.

## Phase 1 — Data integrity (systems · NON-DESTRUCTIVE) — FIRST, gates the entity pages
Every migration additive + reversible + verified by row-count parity before any cutover; the live admin never breaks.
1. **Canonical customer identity** — add a canonical key (resolve the INT `customers.id` vs VARCHAR(36) `vehicles/workOrders/warranties.customerId` vs BIGINT mismatch `[V]`); backfill a mapping table; verify; leave old columns until reads are migrated.
2. **Phone normalization** — add normalized 10-digit columns alongside the varchar(20/30) chaos `[V]`; backfill; verify; this is the join key the Customer entity page needs.
3. **SMS dedup** — clean the ~33% dup rows `[PLP]`, then promote `idx_sms_msg_twilio_sid` → UNIQUE `[V]` so inserts are atomic-or-fail; merge the 31 dup conversations.
4. **Status-enum honesty** — stop `logOutboundSms` writing `failed` for no-SID/queued (84% mislabel `[PLP]`); default `queued`, `failed` only on a real gateway error → reporting becomes trustworthy.
5. **Opt-out merge** — one source of truth across `customers.smsOptOut` + `smsPreferences.optedOut` `[V]`.
6. **Promote ghost table** `drip_enrollments` into `schema.ts` `[V]`; add missing unique indexes (`cronAlertsFired`, `voiceFollowups`) `[V]`.
- Apply via the additive-migration + admin-tRPC pattern (no prod DB creds needed). Verify each before proceeding.

## Phase 2 — API / server (middle)
- **Prune/wire the ~40 orphan intelligence procedures** `[V]`: delete the genuinely dead ones; wire the valuable ones (anomaly, churn, walk-away) as **Stream card-emitters** so they finally have a consumer.
- **Expand `nextBestActions`** to emit the full card taxonomy the Stream needs (missed-call, stuck-WO, declined-ALG, inbound-SMS, anomaly).
- **Entity-page data resolvers** (Customer/Invoice/Call/Lead/WO) built on the unified identity from Phase 1.
- **Bundle** Today's 11 concurrent queries `[V]` into shop/state bundles; single identity + opt-out source.

## Phase 3 — UI / IA (front)
- Build **The Stream** home (decay rank, lenses, inline actions, finish line) — promote `OverviewSection`'s queue `[V]`.
- Build **Command + Entities** nav — promote `CommandSearch` to the spine + thumb-FAB + zero-query home; grow `CustomerDrawer` → full entity pages.
- **Retire** the 6-section sidebar, `/admin/content`, the god-file sections, the nested tab-bars — behind a feature flag, running parallel to the old UI until proven.
- **Neutral dashboard** styling: 3-color signal palette (kill `text-purple-*` `[V]`), tight type, generous spacing, **44px touch targets**, one-handed thumb zones, zero decoration.
- **Nick augmentation** (last): port the working customer-side `chatTools` function-calling loop `[V]` to the operator brain, add `requiresConfirmation` + the Verify Card (reuse the existing self-critique LLM `[V]`) + SSE undo `[V]`.

## Sequencing + verification
- **Hard dependency:** Phase 1 identity/phone gates the entity pages (Phase 3). The Stream home can ship early (engine exists) before full entity pages.
- **Ship incrementally**, each behind a flag, **parallel to the current admin** until the new surface is proven on your phone — then flip + delete the old.
- Verify: row-count parity on every migration · `pnpm typecheck`/build green · mobile spot-check each surface on a real phone viewport · `curl` the bot/asset paths after any static change (prior prerender lesson).

## Decision log
- **D1 — Full systems→front rebuild** (rej: UI-only/data-only/mobile-only) — data rot leaks into the UI; partial fixes paint over cracks.
- **D2 — Non-destructive migrations** (rej: careful-decisive / move-fast) — zero tolerance for corrupting live customer data.
- **D3 — Clean neutral dashboard** (rej: Euclid Grit / minimal-only) — a data-dense daily phone tool needs calm clarity over brand personality.
- **D4 — Hybrid "Stream + Command" IA** (rej: pure Stream / Modes / Command / Nick-first) — best-of-4, phone-first, ~80% on shipped code, and the redesign IS the cleanup. Nick deferred (unbuilt + data-gated).
- **D5 — Data-first phasing** — Phase 1 gates the trustworthy Customer entity page.
