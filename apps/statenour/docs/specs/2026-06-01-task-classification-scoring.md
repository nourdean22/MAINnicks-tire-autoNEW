# Task Classification & Scoring — Ambition-Aware Creation

**Date:** 2026-06-01
**Status:** Design approved (operator), pre-implementation
**Author:** statenour session
**Related:** `2026-05-30-ambition-engine.md` (the goal→stat spine this builds on)

---

## 1. Problem (code-verified, not assumed)

The operator's report: *"When statenour creates a task it just auto-classifies whatever the task is to a generic Inbox or Missions bucket. It doesn't read the task to see if it correlates to a mission or goal, or whether it should feed stats."*

This is accurate. The Ambition Engine (goals ↔ stats ↔ missions) exists, but **task creation barely engages it**:

1. **The classifier is mission-only.** `classifyTaskToMission` ([lib/ai/classify-task-mission.ts:21](../../lib/ai/classify-task-mission.ts)) takes `{ taskTitle, missions[] }` and returns only `{ missionId, confidence, rationale }`. It is never given LifeGoals or stats, so it structurally cannot correlate a task to a goal or decide which stat it feeds.

2. **It runs in exactly one place, the least-used path.** Only the `/missions` quick-add box calls it ([app/(mastery)/missions/page.tsx:360](<../../app/(mastery)/missions/page.tsx>)), asynchronously after the task already exists. The dominant path — **Nick creating tasks in chat** via the `createTask` tool ([lib/ai/tools/tasks.ts:103](../../lib/ai/tools/tasks.ts)) — does zero classification; `missionId` is a required arg and `goalId` optional, both left to the LLM. REST `/api/tasks`, tRPC `task.create`, `scheduleFollowUp`, and phase auto-spawn also skip it. These paths call `prisma.task.create` **directly**, bypassing the service.

3. **`goalId = null` ⇒ no goal progress, no stat XP, ever.** `liftGoalOnTaskComplete` ([lib/services/tasks.ts:770](../../lib/services/tasks.ts)) and `creditGoalStatsForTask` ([lib/mastery/goal-stats.ts:138](../../lib/mastery/goal-stats.ts)) early-return on null goalId. The only automatic goalId inheritance is the narrow sibling-scan ([lib/services/tasks.ts:392](../../lib/services/tasks.ts)) — fires only when active siblings under the same mission share exactly one goal. So most completions credit nothing to the character sheet. Tasks feel generic because, to the scoring system, they are inert.

4. **Two scoring stores that don't reconcile.**
   - Character-sheet stat XP → `BrainMemory(category="mastery_xp_event")` via `creditStatXp`, **flat `1.0 × weight`**, requires goalId.
   - Auto-learn → `prisma.masteryScore` ([lib/services/auto-learn.ts:240](../../lib/services/auto-learn.ts)), keyed on the **raw Mission domain string** ("PERSONAL", "BUSINESS") — a different namespace from the 33 stat keys in [lib/mastery/config.ts](../../lib/mastery/config.ts).
   - **Verified constraint:** `MasteryScore` is NOT dead. It is read by `lib/ai/page-data.ts` (AI context, 3 sites), `lib/trpc/routers/operator.ts:202` (lifetime XP sum), and `lib/services/goals-snapshot.ts` / `app/api/goals/snapshot/route.ts`. Reconciliation must keep these readers coherent — not delete the store.

5. **Two real bugs.**
   - **DAILY tasks never lift goals.** `liftGoalOnTaskComplete` is only in the ONCE/PROMISE path of `updateTask`; the DAILY branch of `checkTask` ([lib/services/task-actions.ts:137](../../lib/services/task-actions.ts)) runs only auto-learn. A daily habit tied to a fitness goal credits nothing to that goal.
   - **XP decay is dead code** — `decayXp` defined, no cron wired ([lib/mastery/leveling.ts:106](../../lib/mastery/leveling.ts)). Out of scope here; noted for follow-up.

6. **Everything hardcoded** — thresholds, weights, stat-mappings scattered across files. No central config.

---

## 2. Goals / Non-goals

### Goals (operator-locked decisions)
- **Full-spine classification:** on creation, read the task and pick best-fit **mission + goal + which stat(s) it feeds**. Auto-link all three; confirm only low-confidence picks.
- **All creation paths** run classification (chat tool, quick-add, REST, tRPC, follow-ups, auto-spawn).
- **Scale scoring by effort/ROI/difficulty** (not flat), and make the two stores coherent.
- **Central tunable config** module (defaults = today's values); no live settings UI this round.
- Fix the DAILY goal-lift bug.

### Non-goals (YAGNI)
- No auto-creation of missions/goals — chip-suggest "link a goal?" instead.
- No live settings UI (config module only).
- No change to the streaming chat core.
- XP-decay cron (separate follow-up).

---

## 3. Architecture (Approach B — async enrichment at the service chokepoint)

### 3.1 The chokepoint principle
Today 5 call sites do `prisma.task.create` directly. The fix is to funnel **all** creation through the existing service core (`createTaskFromAPI` / `runCore` in `lib/services/tasks.ts`) so classification + scoring linkage is inherited once, not re-wired per caller. The AI tool `createTask`, `scheduleFollowUp`, and phase auto-spawn are refactored to call the service.

### 3.2 Creation flow (per task)
```
create(payload)
  └─ service core:
       1. deterministic FIRST-PASS linkage (instant, never blocks):
            - missionId: payload → else domain/keyword match → else Inbox
            - goalId:    payload → parent goalId → sibling-scan (existing)
            - statHints: goal's GoalStats → else MISSION_DOMAIN_TO_STAT
       2. prisma.task.create (instant, task appears now)
       3. fire-and-forget enrichTaskLinkage(taskId)   ← shared async hook
```
`enrichTaskLinkage(taskId)` — **gap-fill only, never override** (review refinement #1):
```
  - load task + active missions + active goals + stat catalog
  - SKIP the AI call entirely when linkage is already explicit
       (goalId set AND mission != Inbox AND statHints non-empty)
       → no redundant cost, respects Nick's/operator's deliberate choice
  - else classifyTaskLinkage(...) → { missionId, goalId, statHints, confidence, rationale }
  - COMPARE-AND-SET: only write a field that is still null / Inbox / empty
       (never clobber a value Nick or the user already set, incl. an edit
        made in the 1-2s window before enrich lands)
  - low-confidence (mission or goal < threshold) → emit confirm-chip signal
  - no-goal-match → emit optional "link a goal?" affordance signal
  - AI failure → keep the deterministic first-pass, no error surfaced
```
"Inbox" is treated as **unclassified** for mission purposes (review #5), so quick-add tasks (missionId=null → Inbox) still get a real mission proposed. The classifier result is cached by title-hash with a short TTL (review #6) — goals don't change minute-to-minute, so brief staleness on a fire-and-forget enrich is acceptable.

Fire-and-forget for v1 (mirrors today's quick-add async-PATCH; snappy UX, no new cron). Upgrade seam: swap the call for an Inngest job if durability is later wanted.

### 3.3 Components

**A. `lib/mastery/scoring-config.ts` (new)** — single source of tunables, defaults = current values so behavior is controlled:
- `CONFIDENCE` thresholds (silent-attach vs chip; default 0.6).
- `SIGNAL_XP` base per signal type (task 1.0, etc. — moved from leveling.ts).
- effort / ROI / streak / goal-link multipliers (moved from auto-learn.ts).
- `GOAL_DOMAIN_TO_STAT` (moved from goal-stats.ts).
- `MISSION_DOMAIN_TO_STAT` (**new** — bridges the Mission-domain ↔ stat-key namespace gap).

**B. `lib/ai/classify-task-linkage.ts` (new; absorbs classify-task-mission.ts)**
- Input: task `{ title, nextPhysicalAction?, context? }` + `missions[]` + `goals[]` + stat catalog.
- Output: `{ missionId: string|null, goalId: string|null, statHints: string[], confidence: number, rationale: string }`.
- One gpt-4o-mini call (`tracedAiChat` "reason"), title-hash cached, ≤30 missions / ≤30 goals capped.
- Deterministic keyword/domain fallback on any failure or empty input. Hallucinated ids → dropped (verified against provided lists, as the old classifier does).
- The old `classifyTaskToMission` becomes a thin wrapper (or its single caller is migrated) to avoid a dangling export.

**C. Service chokepoint changes (`lib/services/tasks.ts`)**
- Extract the deterministic first-pass into a pure helper.
- Add `enrichTaskLinkage(taskId)` and fire it post-create.
- Refactor `createTask` tool / `scheduleFollowUp` / auto-spawn to route through the service.

**D. Scoring — scale + coherence**
- Stat-credit selection priority at completion: **goal's `GoalStat` rows → task `statHints` → domain inference.** This is the "even goal-less tasks feed a stat" behavior.
- **Stat XP** is **scaled** by effort/ROI (reuse the auto-learn multiplier, now sourced from `scoring-config`) — abstract mastery points, safe to scale.
- **Goal `currentValue` stays flat +1** per ONCE/PROMISE completion (review #2). It is a concrete real-world unit ("$15K", "10 workouts"); scaling it by task effort produces fractional nonsense. Flat is the correct semantic.
- **Coherence WITHOUT double-counting (review #4 — the #1 risk):** before wiring, confirm what `computeCharacterSheet()` reads vs what `operator.ts:202` lifetime-sum reads. The scaled credit must increment the character sheet **exactly once**. Plan: one credit call writes stat XP (`mastery_xp_event`) and, separately, the domain delta to `MasteryScore` via `MISSION_DOMAIN_TO_STAT` for the AI-context/snapshot readers — but the **character-sheet aggregation reads only ONE of these**, never both for the same event. A dedicated test asserts a single completion moves the character-sheet total by exactly the expected amount (no double-count).
- **DAILY fix (review #3):** DAILY check-off now **credits stat XP** (fixes the operator's actual complaint — "daily workout tied to fitness goal credits nothing"). It does **NOT** auto-increment goal `currentValue` (a habit firing daily would inflate concrete goal progress). currentValue increment stays ONCE/PROMISE-only. Stat credit is idempotent on a per-day key (`goal-task:<taskId>:<stat>:<yyyy-mm-dd>`).

**E. Schema — one change**
- `Task.statHints String[] @default([])` — lets completion crediting be deterministic/auditable and the UI show "this builds: Discipline · Business".
- Applied via the creds-free `POST /api/system/apply-pending-migration` registry path. **Migration FIRST, then deploy the field** (the ambition-engine "column does not exist" lesson). Idempotent `ADD COLUMN IF NOT EXISTS`.

**F. UX (preserve + extend the existing pattern)**
- Low-confidence mission/goal → existing "attach to X?" chip on `/missions`, extended to goals.
- No-goal-match → optional "link a goal?" affordance (chip, not auto-create).
- Chat-created tasks: tiny toast/return-field noting the linkage (the tool already returns `goalLinked`).

---

## 4. Error handling & idempotency
- Creation never blocks on the classifier; AI failure falls back to the deterministic first-pass.
- `enrichTaskLinkage` is idempotent via a **derived check** (no new column): if `goalId` set AND mission != Inbox AND `statHints` non-empty, the task is already linked → return early. Re-fires don't thrash.
- **Compare-and-set writes:** enrich only fills a field still null/Inbox/empty; it never overwrites a value the agent or user already set (guards the 1-2s create→enrich race).
- Stat credit stays idempotent via the `goal-task:<taskId>:<stat>` xpEvent key (ONCE/PROMISE) and a per-day variant `…:<yyyy-mm-dd>` for DAILY.

## 5. Testing
- Unit: deterministic fallback (mission/goal/stat picks), scoring math (effort/ROI scaling), stat-selection priority order, MISSION_DOMAIN_TO_STAT mapping, DAILY goal-lift idempotency.
- The existing ~2896 vitest suite must stay green; `pnpm typecheck` 0; `pnpm lint` no new errors.
- Push gate: `.husky/pre-push` turbo `next build`. Stop the dev server / `rm -rf .next` before pushing (ambition-engine `.next` lock lesson).

## 6. Phasing
- **P1 — Classification spine:** scoring-config module, classify-task-linkage, service chokepoint + enrichTaskLinkage, route all paths, statHints column. (Tasks now correlate to mission+goal+stats on every path.)
- **P2 — Scoring scale + coherence:** effort/ROI scaling, store reconciliation, DAILY goal-lift fix.
- **P3 — UX polish:** goal confirm-chip, "link a goal?" affordance, chat toast.

## 7. Decision log
- **Approach B over A/C:** A (sync classify) hurts quick-add latency; C (agent self-classify) is what's broken now. B keeps instant UX + reliable coverage via one seam. (Operator approved.)
- **Fire-and-forget over Inngest for v1:** simplest, matches existing quick-add behavior, no new cron; easy upgrade later. (Operator: proceed.)
- **statHints persisted (not recomputed):** auditable + UI-visible + deterministic completion crediting; cost is one small idempotent migration.
- **MasteryScore kept, made coherent (not unified-by-deletion):** verified 4 live readers; deleting it would break AI context + lifetime-XP + goals snapshot.
- **No auto goal/mission creation:** chip-suggest instead — avoids noise.

## 8. Excellence-review refinements (self-review, 2026-06-01)
Stress-tested the v1 design before implementation; six corrections folded in:
1. **Enrich is gap-fill only** — skip the AI call when linkage is already explicit; compare-and-set so it never overrides Nick's/the user's choice or races a fresh edit. (Was: re-classify every task → redundant cost + clobbered deliberate links.)
2. **Stat XP scales, goal `currentValue` stays flat +1** — currentValue is a concrete unit; scaling it is a units error.
3. **DAILY credits stat XP, not currentValue** — fixes the real complaint without inflating goal progress from a daily habit.
4. **Double-count guard promoted to #1 risk** — explicit single-increment rule + dedicated test (was a vague "decide in plan").
5. **"Inbox" treated as unclassified** for enrich, so quick-add tasks get a real mission.
6. **Classifier cache** keyed on title w/ short TTL — staleness acceptable for fire-and-forget enrich.

## 9. Implementation-review outcome (code-reviewer pass, 2026-06-01)
Adversarial correctness review over the diff. Double-count invariant **HOLDS** (MasteryScore domain-bucket vs mastery_xp_event stat-key are separate namespaces; task stat XP credited exactly once via the idempotent sourceKey). Hallucinated-id rejection HOLDS. Three findings, all addressed:
1. **`liftGoalOnTaskComplete` not idempotent (REAL).** Adding the lift to `checkTask` newly exposed a possible double-count of goal `currentValue` on a re-completion. FIXED — a one-time `goal_lift:<goalId>:<taskId>` marker via the BrainMemory (category,key) unique constraint makes the increment fire exactly once. (Stat XP was already idempotent.)
2. **`creditTaskStats` goal-keyed namespace when goal relation missing (latent).** FIXED — a goal-linked task always uses the `goal-task:` key even if the goal row didn't resolve, so it can't be credited under two key schemes. (Unreachable today: FK is onDelete:SetNull.)
3. **enrich mission compare-and-set vs null missionId (unreachable).** TypeScript proves `missionId` is a non-nullable FK; "unset" == Inbox. Kept the correct simple form.
- Cache deviation: the spec's title-cache (#6) was **omitted** — enrich runs once per creation, so a title-only cache risks stale goal links for negligible benefit (YAGNI).
- Decision held: fire-and-forget enrich (not Inngest) for v1.
