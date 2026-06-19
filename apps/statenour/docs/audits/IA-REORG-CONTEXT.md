# statenour IA Reorg — Context Enrichment & Vision Reconciliation

**For:** operator (Nour) · **Date:** 2026-06-18 · **Stance:** kaizen + karpathy + brainstorming (UNDERSTANDING phase — enrich, don't implement).
**Provenance:** 5-agent read-only workflow (memory-historian · docs-cartographer · handoff-git-lineage · per-page-intent → synthesis). Companion to [`IA-REORG-DESIGN.md`](./IA-REORG-DESIGN.md).

---

## 1. Enriched context — the missing layer

**What statenour actually is (operator's terms).** NOUR OS — a single-operator personal life-operating-system that runs Nour's whole life from a phone (`bdnick.info`, iOS PWA). It is explicitly *not* a business ops tool — Nick's Tire ops live at `nickstire.org` and feed in only as a thin oversight signal over a 4-hour bridge. The canon (`ULTRON-VISION.md`) frames it as a "personal operating system consciousness" built to solve five operator-specific problems: **scatter, rumination, weak planning, weak calibration, out-of-touch-with-world**. The deeper "why": the operator is ADHD-wired, novelty-seeking, drifts without systems — so the OS must (a) run itself between attention cycles, (b) be toggle-gated so features turn on/off without breakage, (c) compute deeply but never push unless invited. Aesthetic is locked: dark industrial command center (void black, blood-red + gold `#FDB913`, Barlow Condensed, Instrument Serif editorial), Nick narrates in adaptive MODE personas, never cheerful. **For IA:** the design's "phone-primary, tap-depth-by-frequency" instinct is not a UX preference — it is the literal product thesis.

**The wave-lineage story.** statenour has run a *consolidation oscillation* for two months: build many surfaces → fold them when the IA gets noisy. v6–v10 (May) laid the schema/soft-delete/logger spine. Then a deliberate **collapse arc**: Wave 18 / ADR-0016 merged `/brain`+`/life`+`/ops` into context bands above execution (10 nav rows → 7; doctrine: **context-before-execution, brain-is-metadata-not-a-surface**). Wave 2 (2026-06-03) folded ~10 shallow routes → 5 deep PageTabs surfaces. **The IA reorg is not a new idea — it is the third beat of an established "one deep surface beats ten shallow" rhythm.** The bottom-tab proposal is the natural next step, not a pivot.

**The WHY behind /crm /finance /wealth /voice (June "NOUR OS" wave, `75a6671f`, 2026-06-18).** One consolidation: rebrand → "NOUR OS" and fold the operator's *personal* money + coaching + wealth into the OS, distinct from business ops:
- **/finance** = personal cash in/out ledger (CSV/Plaid) — "where did my money go" reflection input. Distinct from business revenue.
- **/wealth** = portfolio + net-worth (blocked on `FINNHUB_API_KEY` — keyless Yahoo/Stooq IP-blocked on Railway).
- **/crm** = coaching pipeline (Contact/Booking/Agreement) — coaching-revenue loop. Distinct from `/people` (inward strategic dossier).
- **/voice** = hands-free capture + morning audio brief. Wave-200 demoted the live-call button below the brief → async brief-consumption is the matured primary intent.

**Direction of travel.** Two roadmap meta-patterns: **Pattern A — "backend complete, frontend missing"** (engines compute signals no surface consumes — the IA reorg is the flagship fix) and **Pattern B — feedback loops don't close**. Stated order: close the surface gap (this reorg + Telegram pushes + cards) → flip autonomy/proactive flags → attack feedback loops → cost levers. The IA reorg sits at the *front* because 10–25 of 35 pages are phone-unreachable today — the single biggest "computed-but-unreachable" defect.

---

## 2. Reconcile the design against the vision (HOLDS / ADJUST / RISKY)

| # | Design decision | Verdict | Reasoning |
|---|---|---|---|
| 1 | 5 bottom tabs: Home/Missions/Journal/Stats/More | **HOLDS** | All four are mature daily-loop surfaces = exactly what `smart-now.ts` rotates. Literal product thesis. |
| 2 | MORE verb taxonomy (Capture/Execute/Reflect/Money/Operate) | **HOLDS** (minor) | Matches the OS loop model. `/voice` could also cross-link to Reflect (brief-consumption). Not blocking. |
| 3 | MORE top = 🔍 Search → `setOpen(true)` | **HOLDS — top fix** | cmdK has no tap trigger → ~50 destinations unreachable on phone. Ship first. |
| 4 | NEW `/money` hub (finance+wealth) | **ADJUST — sequencing** | `/finance` + `/wealth` are **unfinished stubs**, not finished pages. Complete + verify their UIs *before* the 307 redirect (folding an incomplete page hides it worse than orphan-but-URL-reachable). |
| 5 | `/crm` → BUILD `/business?tab=clients` THEN redirect (same deploy) | **HOLDS** | Design already self-corrected (build-before-redirect). Confirmed independently. |
| 6 | `/people` stays separate from `/crm` (one-way bridge) | **HOLDS strongly** | Distinct tables + intents. Vision's relationship-as-a-stat needs `/people` independent. |
| 7 | Surface `/knowledge` + `/pins` as MORE rows | **HOLDS** | tRPC-wired, infra-complete. Pure reachability win, zero risk. |
| 8 | Surface `/voice /learn /photo-improver` | **HOLDS** | All active/intentional. Low-risk ADDs. |
| 9 | Surface `/system/alerts /inbox /cockpit-observability` | **ADJUST — by readiness** | alerts ready → surface now; inbox + cockpit-observability are stubs → gate behind render-check or defer. Don't surface a blank page. |
| 10 | Un-shadow `/system/tools` + `/proactive-preview` | **HOLDS** | Design folds the render-check guard. Self-protecting. |
| 11 | Delete dead `components/scoreboard/` + card (keep API route) | **HOLDS** | 0 importers; fix #4 protects the live service mirror. |
| 12 | Delete ~10 cmdK theatrical labels (cmdK iterates NAV) | **HOLDS** | Kills three-way nav drift. |
| 13 | Demote orb to optional FAB; bottom bar primary | **HOLDS** | Keeps orb as fallback until Phase 4 + fixes 8px stranding bug. Reversible. |
| 14 | De-dup `/business?tab=money` | **HOLDS** | Confirms operator's own "business belongs on nickstire" rule. No-number-disappears guard. |
| 15 | 6-phase strictly-serial (3 & 4 share nav-items.ts) | **HOLDS** | Serial constraint verified. Don't parallelize 3/4. |
| 16 | Short-link re-point = EXTERNAL operator dependency | **HOLDS** | Short-links live in sibling app; statenour 307s are correct. |

**No RISKY verdicts.** The only recurring gap: the design assumed some surfaces are finished page bodies when they are **stubs** (#4, #9) — a readiness-sequencing gap, not a taxonomy flaw. **The IA structure is vision-aligned end to end.**

---

## 3. What is STILL only in the operator's head (ranked)

1. **Is `bdnick.info` becoming a public/multi-tenant product, or staying a private single-operator OS?** Roadmap lists "multi-tenant (Nour shares Nick with Dania)" as Horizon 3, and the June wave publicly rebranded to "NOUR OS" with anonymous short-link redirects + click tracking — both smell like productization. If public is intended, the IA must plan auth-gated vs public surfaces, onboarding, marketing layer — none of which the single-operator bottom-tab design contemplates. **Highest-leverage unknown.**
2. **Roadmap weight of `/crm` + `/wealth` — core pillars or experiments?** If coaching is becoming a real business, `/crm` may deserve a top-level surface rather than a `/business` sub-tab. Determines #4/#5 disposition.
3. **Which pages does the operator actually open daily?** The tab ranking is *assumed*, no telemetry cited. If real touch-counts differ (`/money` or `/chat` out-ranks `/stats`), the 5-tab selection changes. **Measurable from logs.**
4. **Is the autonomy/proactive layer (Telegram push, `NICK_AUTONOMY`) shipping soon?** 51 approvals rotting; proactive push wired with zero callers. If it flips on, the nav needs a notifications/approvals slot — no slot today.
5. **Does `/voice` become a primary voice-first mode or stay niche capture?** Lower stakes; cheap to confirm.

---

## 4. Net recommendation — PROCEED WITH ADJUSTMENTS

The IA structure is fully vision-aligned (third beat of the consolidation rhythm, matches `smart-now`, respects every invariant, adversarial pass caught the hard traps). **Zero RISKY contradictions — do not re-design.** Three adjustments:

- **A1 — Gate stub surfaces on "renders without error" before folding/surfacing.** Complete + verify `/finance` + `/wealth` UIs before their 307s (Phase 5); split Phase 2 system tiles (alerts ready; inbox + cockpit-observability render-gated).
- **A2 — Order the cheap reachability wins first** (Phase 1 cmdK tap-trigger + Search; surface `/knowledge /pins /voice /learn /photo-improver`). Zero-risk, unblock ~50 destinations, independent of every open question.
- **A3 — Answer Q1 (public vs private) + Q3 (daily-touch telemetry) before the irreversible Phase 4 (tab flip) + Phase 5 (`/money` consolidation).** Phases 0–3 are reversible and safe to start now without the answers.

**One line:** the design is right and buildable — start Phases 0–3 (reachability + cleanup) immediately, fold the stub-readiness gate, and answer "public product?" + "what do you open daily?" before the Phase 4/5 flips.
