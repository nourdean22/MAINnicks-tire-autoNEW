# Mastery XP Backfill — runbook + reference

**What:** an all-time, all-source pass that credits the operator's historical
activity into the 33-stat mastery character sheet, so `/stats` reads who he
actually is instead of only forward-counting from when each crediting path was
wired. Built 2026-06-03.

**Code:**
- `lib/mastery/comprehensive-backfill.ts` — the engine (`measureBackfill`,
  `runComprehensiveBackfill`). Credits ride one shared `recordCredit` helper so
  the credited/xp/byStat tallies can't drift.
- `lib/mastery/attribution.ts` — `attributeText` (one signal) + **`attributeTextBatch`**
  (the backfill fast-path: one AI call scores up to `BATCH_SIZE` signals).
- `lib/mastery/credit.ts` — `creditStatXp` (the idempotent credit seam, with an
  optional `backfillRun` marker) + `revertBackfillRun` (undo) + **`summarizeBackfillRun`**
  (read-only footprint: count/xpTotal/byStat a run actually wrote).
- `scripts/backfill-mastery.ts` — the operator CLI (`measure` · `dry` · `run` ·
  `status` · `revert`).

---

## How the XP system stores credit (the thing that makes this safe)

The character sheet (`lib/mastery/character-sheet.ts`) sums **two** stores:

1. **`MasteryScore.delta`** rows — domain-level score deltas written **live by
   auto-learn** when a task completes.
2. **`BrainMemory(category="mastery_xp_event")`** rows — one row per credit for
   every other signal (habits, journal, chat, email, decisions, people…),
   written by **`creditStatXp`**, keyed + deduped by a stable **`sourceKey`**.

These two stores never overlap, so they can't double-count each other. The
backfill writes **only** into store #2, reusing the **same sourceKeys** that the
live paths use — so a row a live path already credited is a no-op skip here.

### Idempotency
`creditStatXp` upserts on `(category="mastery_xp_event", key=sourceKey)`. Re-
running the backfill:
- **skips** already-credited keys **before** the (costly) AI call, and
- even if it does re-credit, the upsert **overwrites** (never adds), so stored
  XP can't inflate.

→ The backfill is fully **re-runnable / resumable**. If it dies partway, just
run it again — it picks up where it left off.

### Reversibility
Newly-created backfill rows are stamped `metadata.backfillRun = <tag>`
**(create-only** — preserved across re-runs, **never** added to a row some live
path created). `revertBackfillRun(<tag>)` hard-deletes exactly those rows. So a
bad run is one command to undo, and a live-credited row is never collateral.

### Batched attribution (the speed lever)
The "reason" tier **serializes** inference (~10-95s/call regardless of
concurrency — a 10-wide parallel test gave no speedup). So the cost that matters
is **call count**, not parallelism. `attributeTextBatch` scores up to
`BATCH_SIZE` (=12) signals per call → ~12x fewer calls. Items the model omits
(no-skill) or that fail to parse simply aren't in the returned map → they earn
nothing this run and retry on the next idempotent pass. Writes stay sequential.

### Non-circular attribution
BrainMemory attribution is **whitelisted** to operator-signal categories
(wisdom, lesson, pattern, reflection, skill, belief, decision_log, nick_advice,
etc.). Our own AI outputs (briefs, traces, the xp-event log itself) are excluded
by omission, so the system never attributes its own words back to the operator.

---

## Source map (what gets credited, from where)

| Source | Store / key | Attribution | Notes |
|---|---|---|---|
| Chat (user turns) | `chat:<id>` | AI | all-time (live path only did recent-25) |
| Journal — brain dump | `journal-base:<id>` | AI | shares the live journal-ingest key |
| Journal — reflection | `journal-reflection:<id>` | AI | was uncredited |
| Journal — situation log | `journal-situation:<id>` | AI | was uncredited |
| Journal — decision replay | `journal-replay:<id>` | AI | was uncredited |
| Capture inbox | `capture:<id>` | AI | matches existing backfill key |
| Decisions | `decision:<id>` | AI | matches existing key |
| Email (gmail BrainMemory) | `email:<id>` | AI | 0 rows today (lights up when mail integration stores threads) |
| Pins | `pin:<id>` | AI | category `pinned_user` |
| Brain memory | `brain:<id>` | AI | WHITELISTED categories only |
| Goals achieved | `goal-achieved:<id>` | AI | 0 today (no achieved goals yet) |
| Body workouts | `body:<id>:conditioning` | **rule (free)** | only `workoutDone=true` rows; 0 today |
| People | `person:…` | (delegated) | runs the existing idempotent `backfillPeopleXp` |

**Already credited live — NOT re-done by this engine:**
- **Tasks** — credited live via `creditTaskStats` (`goal-task:`/`task-stat:`
  keys) + auto-learn's `MasteryScore.delta`. Re-crediting would be a near-total
  no-op, so the engine skips tasks entirely.

**Deferred:** knowledge-base files (filesystem `lib/mastery/knowledge.ts`) —
static, low-signal reference docs; not yet a source.

---

## Operating it (run via `railway run` so it reads PROD)

> **Gotcha — the `--conditions=react-server` flag is REQUIRED.** The engine
> imports `server-only` modules (the AI attributor). Under plain `tsx` that
> throws ("cannot be imported from a Client Component"). Running node with the
> `react-server` export condition makes `server-only` a no-op, exactly as the
> Next server runtime does. Use the invocations below verbatim.

```bash
# 1. MEASURE — FREE, read-only, NO AI, NO writes. Counts uncredited items per
#    source (≈ the AI-call count = the spend). ALWAYS run this first.
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts measure

# 2. DRY — real AI on a small sample (8/source), writes NOTHING. Preview
#    attribution quality before committing.
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts dry

# 3. RUN — the full run. Writes XP (idempotent · resumable). Pass a stable tag
#    so the whole run is revertible as one unit.
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts run <tag>

# 4. STATUS — read-only footprint of a run: how many rows it actually wrote,
#    total XP, and byStat. The runtime proof a run's credits LANDED (distinct
#    from `measure`, which counts what's LEFT to do). Safe to run mid-run.
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts status <tag>

# 5. REVERT — undo exactly that run (deletes only the rows it created).
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts revert <tag>
```

### Operating gotchas
- **Verify it landed with `status`, don't trust the run summary.** A run's
  printed `credited` is only what THAT process newly wrote; if a prior
  interrupted run (or an overlapping detached process) shares the tag, the DB
  total is higher. `status <tag>` against prod is the authoritative count.
  Convergence = a fresh full run credits ~0 (everything attributable is already
  in store #2).
- **Background runs can be raced/resumed.** A run launched with
  `run_in_background` may overlap a prior detached run under the same tag —
  harmless (idempotent upsert on sourceKey = zero double-count), but the per-run
  `credited` then under-reports the real total. Re-run the same tag to resume.
- **Provider chain is brittle.** "reason" tier order is ollama/glm-5.1 (works,
  slow ~10-95s/call) -> venice (400: min_p+logit_bias unsupported with
  speculative decoding) -> openai/gpt-4o-mini (quota/billing). In practice
  ollama is the only live one; a batch that fails all three retries next pass.
- **Rate / cost** — batched at `BATCH_SIZE`=12, a full ~1.8k-item run is ~35 AI
  calls (not ~1.8k), minutes on the cheap tier. `measure` gives the candidate
  count before you spend; structured sources (body) are free (no AI).
- **Prod access is gated** — `railway run` against `statenour-web` requires
  explicit operator approval naming the prod target.

---

## Run log

- **2026-06-03 · tag `backfill-all-2026-06-03` · COMPLETE + verified** —
  measured ~1,769 candidate uncredited items (chat+journal ~855, situation 331,
  reflection 208, brain-memory 347, misc). Ran across several resumed/overlapping
  processes under the one tag (idempotent, so zero double-count); the final full
  pass scanned all 1,846 items and credited only 58 new = **converged** (the
  idempotent fixpoint — a further run adds ~0). **Final prod footprint (via
  `status`): 1,434 rows · 1,609.5 XP · 30 stats** — top stats: critical_thinking
  265.5, marketing 210.5, discipline 208, follow_through 184, strategy 149.5,
  technical 78.5, advertising 76, seduction 52.5. email/goals/body = 0 (no data
  yet). **End-to-end verified** on `bdnick.info/stats` (Claude-in-Chrome): POWER
  Lvl 203 · 3,501 XP, with "▲ week Discipline +352.8" = the backfill rows
  surfacing through the live character-sheet read path. Reversible via
  `revert backfill-all-2026-06-03`.
