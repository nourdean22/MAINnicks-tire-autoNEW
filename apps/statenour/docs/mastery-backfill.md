# Mastery XP Backfill — runbook + reference

**What:** an all-time, all-source pass that credits the operator's historical
activity into the 33-stat mastery character sheet, so `/stats` reads who he
actually is instead of only forward-counting from when each crediting path was
wired. Built 2026-06-03.

**Code:**
- `lib/mastery/comprehensive-backfill.ts` — the engine (`measureBackfill`,
  `runComprehensiveBackfill`).
- `lib/mastery/credit.ts` — `creditStatXp` (the idempotent credit seam, now
  with an optional `backfillRun` marker) + `revertBackfillRun`.
- `scripts/backfill-mastery.ts` — the operator CLI.

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

# 4. REVERT — undo exactly that run (deletes only the rows it created).
railway run --service statenour-web pnpm exec \
  node --conditions=react-server --import tsx scripts/backfill-mastery.ts revert <tag>
```

### Operating gotchas
- **Background runs die on session-resume.** A long run (~25 min for ~1.8k
  items) launched with `run_in_background` does NOT survive the agent session
  being suspended/resumed. It's idempotent, so just re-run the same tag — it
  resumes. For an unattended full run, prefer a stable session or chunk it.
- **Rate** ≈ ~1 item/sec on the "reason" tier → budget ~25–30 min for a full
  ~1.8k-item run. Structured sources (body) are instant (no AI).
- **Cost** ≈ one cheap "reason"-tier `attributeText` call per uncredited item.
  ~1.8k items = cents–low-dollars on the cheap tier. `measure` tells you the
  count before you spend.
- **Prod access is gated** — `railway run` against `statenour-web` requires
  explicit operator approval naming the prod target.

---

## Run log

- **2026-06-03 · tag `backfill-all-2026-06-03`** — measured ~1,769 uncredited
  (chat+journal ~855, situation 331, reflection 208, brain-memory 347, misc).
  First run interrupted by a session-resume after ~200 credits (chat 198,
  braindump 3); resumed under the same tag to finish the remaining ~1,576.
  email/goals/body = 0 (no data yet). Reversible via
  `revert backfill-all-2026-06-03`.
