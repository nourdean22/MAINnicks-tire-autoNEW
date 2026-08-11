# Active Development Roadmap

**This file is an index, not a roadmap.** It sat in `00-current-truth/` for two months describing
June work as "In Progress" that had already shipped — a stale file in a folder whose name promises
currency is worse than no file, because it is read as authoritative. Rebuilt 2026-08-11 to point at
the documents that are actually maintained.

## Where the roadmap actually lives

| Product | Canonical roadmap | Mission |
|---|---|---|
| Nick's Tire | [`apps/nickstire/docs/REVENUE-OPS-ROADMAP.md`](../../apps/nickstire/docs/REVENUE-OPS-ROADMAP.md) — dependency-ordered, revenue impact per wave | [`agent-os/product/nickstire/mission.md`](../../agent-os/product/nickstire/mission.md) |
| NOUR OS (statenour) | No single canonical file — work runs in waves closed out in `CURRENT-TRUTH.md`. See [`agent-os/product/statenour/roadmap.md`](../../agent-os/product/statenour/roadmap.md) for the trust-ranked source list. | [`agent-os/product/statenour/mission.md`](../../agent-os/product/statenour/mission.md) |

## Where current status actually lives

- [`apps/nickstire/docs/CURRENT-TRUTH.md`](../../apps/nickstire/docs/CURRENT-TRUTH.md) — separates
  automated / operator-gated / experimental / retired systems. **Read this before claiming anything
  about nickstire is or is not running.**
- [`apps/statenour/docs/CURRENT-TRUTH.md`](../../apps/statenour/docs/CURRENT-TRUTH.md) — includes a
  "Retired — do NOT treat as current" landmine list.
- [`apps/nickstire/docs/ISSUE-REGISTRY.md`](../../apps/nickstire/docs/ISSUE-REGISTRY.md).

Production evidence outranks every file above — see the source-of-truth hierarchy in
[`AGENTS.md`](../../AGENTS.md).

---

## Closed initiatives (kept for lineage)

### 1. Integration auth & key synchronization — CLOSED (2026-06-27)
`BRIDGE_API_KEY` and `STATENOUR_SYNC_KEY` synced across both apps; fast-path
`/api/bridge/shop-snapshot` validated. Follow-on (2026-06-22): `STATENOUR_SYNC_KEY` was added to
`REQUIRED_ENV` with a ≥32-char boot guard after a 22-char placeholder froze the site on boot.
**Do not weaken that guard.**

### 2. Live capacity & health governor sync — CLOSED (2026-06-27)
`readLiveState()` in `task-signals.ts` calls `getLatestGovernorDecision()` directly, resolving
capacity from live biometrics rather than the `OPEN`/`CLOSED` `DayState` enum.

### 3. Instagram reel publishing — SHIPPED, and now judge-gated
No longer "In Progress", and materially different from what this file used to describe:

- **Publishing is live and autonomous**, not awaiting Graph API wiring. Deferred publishing runs
  Studio → `scheduled_posts` → cron, with at-most-once claiming; a dispatched request that gets no
  answer parks as `ambiguous`, never as retryable `failed`.
- **Every path to Meta goes through the kill switch** (2026-07-27), including `runIgAutopost`.
  Automated callers **fail CLOSED** when switch state is unreadable.
- **An independent judge gates the LIVE branch** (2026-08-07, operator flip). It fails closed on
  judge error or missing verdict — so **a dead judge lane pauses live IG posting rather than
  publishing blind. That is intended, and it is the first thing to check if autoposting goes
  quiet.** `IG_SHADOW_JUDGE=false` disables judge and gate together.
- **Clip generation is dual-provider, not "the Higgsfield pipeline."** `reelPipeline.ts` selects
  by which key is actually credentialed — preferring Veo (`REEL_VEO_MODEL`, default
  `veo-3.1-fast-generate-preview`) and falling back to Higgsfield/Seedance. Hardwiring to one
  provider is what previously let a dead Gemini key block reels while a funded Higgsfield plan sat
  loaded. **Higgsfield is a live fallback, not retired** — a claim to the contrary has been made
  more than once and is wrong.

Full detail for all three lives in `apps/nickstire/docs/CURRENT-TRUTH.md`; it is maintained, this
summary is not.

## Ongoing guardrails

1. **Google Places fallback cache** — keep the backup rating/count in `shop_settings` fresh so the
   public site shows accurate fallbacks when the Places API locks out. ⚠ Currently blocked: the
   Maps key is set on Railway but returns `REQUEST_DENIED` until Places API is enabled and the key's
   API-restriction allowlist is updated (operator-only, GCP Console).
2. **Markdown lint warnings** under `docs/` and `/brain` — formatting only, never technical content.
