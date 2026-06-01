# Journal Brain Redesign — Design Spec

**Status:** Design accepted (brainstorming complete) — awaiting implementation green light
**Date:** 2026-06-01
**Owner:** Nour (single operator)
**App:** statenour (`apps/statenour/`)

---

## 1. Understanding Summary

Turn the statenour Journal from an isolated dead-drop into a **sharp thinking instrument** that:
1. **Generates & is unrestricted** — gives bold creative ideas, pushes thinking forward (not a timid classifier).
2. **Reflects you back** — connects to past entries, surfaces patterns/arc.
3. **Is visibly consequential** — every entry shows its XP/stat/goal impact immediately.
4. **Is context-aware** — frames each entry against your *active* goals/missions.
5. **Challenges you** — counter-questions, contradiction flags, drift warnings.

**Why:** Today the Journal is structurally an island — ~90% of entries earn zero XP, classification is arbitrary ungrounded AI output stored in a JSON blob, and nothing connects an entry to what you're working toward. The felt result is "generic / shallow."

**Capture stays instant.** Entry saves and returns immediately; all enrichment (score/link/classify/ideas/challenge) runs async a beat later.

**Non-goals:** Not multi-user. Not rewriting the task/mission/goal engine. No external AI providers (stays on Ollama). Not a UI reskin for its own sake.

---

## 2. Key Constraints

- **Instant capture, async enrich** via the existing brain-bus `void` fire-and-forget pattern (safe on the Railway long-running Node server) + a nightly cron re-sweep of any entry where `enrichedAt IS NULL` as the durability safety-net.
- **Ollama only.** "reason" model for depth/creative/challenge; "fast" model for quick classification.
- **Shared `main` + hand-applied migrations.** Worktree isolation, `git fetch` before push, explicit-path staging, `statenour-migration` + `statenour-verify` protocols.

---

## 3. Decision Log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| D1 | Full redesign, phased | Minimal XP wiring; clean-slate v2 table | Only full redesign targets the real pain ("generic"); minimal fixes only the XP symptom; clean-slate over-engineers for one user (YAGNI) |
| D2 | XP = baseline + grounded bonus | Only-when-linked; flat-per-entry | Rewards the habit AND the substance; flat is gameable |
| D3 | AI auto-detect link + confirm | Fully automatic; manual only | Grounds classification in real targets while keeping operator control |
| D4 | Unified async "Journal Brain" pass | Bolt-on per feature | Consolidates 6 scattered half-built brains into one coherent loop — the deepest lever for "sharp" |
| D5 | Promote `entryType` + links to real DB columns | Keep JSON blob | Queryable, SQL-filterable (perf), scoreable |
| D6 | Backfill historical entries | Forward-only | User wants past entries scored/linked too |
| D7 | All 4 high-signal silos (BrainDump, Reflection, SituationLog, DecisionReplay) | Captures+Reflections only | Decisions/incidents are highest-signal thinking |
| D8 | Tunable-knobs settings panel; scoring weights live-tunable | Minimal; maximal | Folds "scoring system" + "settings" into one deliverable; default journal weight stays 0.8 |
| D9 | Skip goal embeddings; feed active goals inline | Embed goals into pgvector | Active goal set is small (dozens); embedding pipeline is unnecessary work (YAGNI) |
| D10 | `ingestJournal` gets `creditXp` flag | Unguarded credit | Prevents verified double-credit on reflections with `extractIntelligence=true` |
| D11 | Inline "impact receipt" is primary impact surface | Ticker-only | Most direct way to make impact *felt*; ticker/character-sheet update automatically via the existing spine |

---

## 4. Final Design

### 4.1 Data model (hand-applied migration)
Add to `BrainDump`, `Reflection`, `SituationLog`, `DecisionReplay` (where missing):
- `entryType String?` — promoted to a real, indexed column (was JSON-blob only)
- `goalId String?` — FK → `LifeGoal` (onDelete: SetNull)
- `missionId String?` — FK → `Mission` (onDelete: SetNull)
- `linkConfidence Float?` — AI match confidence 0–1
- `linkStatus String?` — `proposed | confirmed | rejected | auto`
- `enrichedAt DateTime?` — null = not yet processed (cron re-sweep target)

New `JournalSettings` (single-row, operator-owned) for tunable knobs (§4.6).
Migration includes a data step to populate `entryType` on existing rows from `extractedItems` JSON (or leave null for the Phase 3 backfill to fill).

### 4.2 The Journal Brain pass (async, post-capture)
One pipeline, fired `void` after the entry row is safely written:
1. **Ground** — fetch *active* goals/missions (small set), pass titles+metrics inline to the model.
2. **Classify (grounded)** — `entryType` + `domains` chosen *with* goal context + few-shot examples (kills the arbitrariness).
3. **Link (propose)** — best goal/mission match + `linkConfidence`. Above threshold → `auto`-confirm; below → `proposed` (pending your ✓/✗).
4. **Score** — baseline XP (habit) + grounded bonus crediting the linked goal's stats. Idempotency keys: `journal-base:<id>` (baseline), `goal-journal:<id>:<stat>` (grounded), distinct from the reflection path's `journal:<reflectionId>` and from backfill keys.
5. **Generate** — unrestricted creative idea pass ("reason" model, high temperature, bold prompt).
6. **Challenge** — one sharp counter-question + contradiction flag (reusing existing contradiction/prediction machinery).
7. **Emit receipt** — impact receipt + ideas written back to the entry; `enrichedAt` stamped.

### 4.3 Grounding & confirm UX
- **Web:** inline confirmable chip under the entry — "Relates to: *Close Global Cleveland* — ✓ / ✗ / pick another." Confirm flips `linkStatus` → `confirmed` and lands the grounded XP bonus.
- **Telegram:** after a `/dump`, send `sendTelegramWithButtons` with ✓/✗ inline buttons; add a `handleCallback` case to flip `linkStatus` and `editTelegramMessage` to show the result.
- High-confidence (≥ threshold, default 0.8) auto-confirms with no prompt.

### 4.4 Scoring
- Baseline XP per qualifying entry (default `0.8`, = `SIGNAL_XP.journal`), gated by an **anti-gaming quality floor** (min length + the existing 90s dedup; noise rejected).
- Grounded bonus credits the linked goal's stats via the existing `creditStatXp` / `creditFromSignal` doors.
- All weights read from `JournalSettings` (live-tunable), defaulting to today's constants.
- **Double-credit guard:** `ingestJournal` accepts `{ creditXp?: boolean }`; `createReflection` calls it with `false`.

### 4.5 Generative + challenge layers
Consolidate the 6 scattered brains (threads, drift, contradictions, predictions, metacognition, Nick counter-questions) so they fire as part of this one pass and surface in the receipt. Delete the orphaned regex classifier (`lib/journal/classifier.ts`) or fold its taxonomy in.

### 4.6 Settings surface (tunable knobs)
- Scoring weights (journal / decision baseline XP)
- Baseline-XP on/off + quality-floor length
- Challenge cadence (every entry / daily / off)
- Creative-mode intensity
- Auto-confirm confidence threshold

### 4.7 Backfill (Phase 3)
- **Get the real count first** (`scripts/quality-sweep-v2.ts` or an admin tRPC count).
- Idempotent batch (reuse the `backfill.ts` 25-at-a-time pattern), admin-triggered, **dry-run first**, then live in batches.
- Re-classify, link, and score historical entries across all 4 silos. Distinct backfill sourceKeys so they never collide with live credits.

---

## 5. Phase Plan

**Phase 0 — Foundation:** migration (columns + FKs + `JournalSettings`) + baseline XP wired into `ingestJournal` (with `creditXp` guard). *Closes the zero-XP hole; makes entries queryable.*

**Phase 1 — Journal Brain pass + impact receipt:** the async pipeline (ground→classify→link→score→receipt) + inline receipt + confirm chip (web + Telegram). SQL-based feed filtering replaces in-memory. *The felt turning point.*

**Phase 2 — Generative + challenge:** creative idea pass + counter-question/contradiction; consolidate the scattered brains; delete orphaned classifier. Settings panel ships here (or end of P1).

**Phase 3 — Backfill:** sized, dry-run, batched, admin-triggered across all 4 silos.

Each phase = own commit(s) + `statenour-verify` gate + `statenour-migration` protocol for schema steps. Work isolated in a git worktree.

---

## 6. Risks & Mitigations
- **XP corruption via double/triple credit** → distinct idempotency keys per path + `creditXp` guard (verified necessary).
- **Enrichment lost on process death** → `enrichedAt IS NULL` cron re-sweep.
- **Migration drops pgvector data** → follow `statenour-migration` exactly; never the wrong flag.
- **Shared-main collision** → worktree + fetch-before-push + explicit-path staging.
- **Backfill on prod data** → count first, dry-run, batch, idempotent.
