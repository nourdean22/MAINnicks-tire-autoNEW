# ADR-0017 · Task subtasks · semantic decisions

**Status:** AMENDED · 2026-05-23 (PM · post Elon's-lens critique)
**Companion:** `prisma/migrations-pending/20260523_task_parent_task_id/`

## ⚠ Amendment (2026-05-23 PM)

Elon's-lens critique (via `/elon-musk`) surfaced 3 real issues with
the original ADR. Each is addressed below before the original
decisions section. **Do not apply the parked migration until items
1-3 have been resolved.**

### A1. Question the requirement BEFORE migrating · the gate

The original ADR jumped to step 3 of the 5-step engineering process
(simplify the design) without doing step 1 (question whether
subtasks need to exist at all). Tasks already have `missionId` ·
Missions already have `goalId` · that's two hierarchy levels paid
for. The agent's #7 work flagged subtasks as a hypothetical
follow-up, not a proven need.

**Gate (must clear before applying the migration):** find TWO
specific recent tasks in the operator's brain where a subtask would
have helped. Real ones · with task ids · written down here:

- [ ] Real subtask candidate 1: `<task id> · why a subtask helped`
- [ ] Real subtask candidate 2: `<task id> · why a subtask helped`

If both can be found · the feature is justified · apply the migration
and proceed to Rule fixes below.

If they can't be found in 20 minutes of looking · DELETE this ADR
+ the parked migration. Saves 4-6 commits of UI work · the existing
mission/goal hierarchy is sufficient. The schema migration is
trivial · the build effort isn't.

### A2. Rule 1 reverses · the half-state is incoherent

Original Rule 1 said "no completion cascade · children stay open
when parent is DONE." The lens flagged this as a data-integrity bug:
if parent says DONE and 5 children say OPEN, what does the data
actually MEAN? The operator's intent is ambiguous · and the
scoreboard rollup (Rule 6) breaks in the same incoherent way.

**Amended Rule 1:** Either CASCADE or FORBID the half-state · pick
one · stop sitting on the fence:

- **Option A · cascade with confirm:** Completing a parent triggers
  a UI prompt "complete N open children too?" · default yes ·
  operator can cancel-and-just-mark-parent if they actually mean
  to leave the children open (rare case). The data is always
  consistent · the model handles the rare divergence.

- **Option B · forbid the half-state:** A parent cannot transition
  to DONE while any child is in {OPEN, READY, DOING, WAITING}.
  The complete action on parent surfaces a "complete children
  first" or "cancel children" prompt. The data is always
  consistent · the operator handles the divergence.

Pick **Option A** as the default unless implementation surfaces a
reason to prefer B. Option A respects operator workflow (one click
to close a chunk of work) while keeping data coherent.

### A3. Rule 6 formula fixes · weight by effort or drop

Original Rule 6 said scoreboard rollup = `done / all`. The lens
flagged this as misleading: a parent with one easy DONE child +
one hard OPEN child would claim 50% complete · the operator's
mental model of "this parent is half-done" is wrong because the
hard work is the work that matters.

**Amended Rule 6 · effort-weighted rollup:**
```
parent.progressPct =
  sum(EFFORT_RANK[child.effort] · (child.status === DONE ? 1 : 0))
  / sum(EFFORT_RANK[child.effort])
```
where `EFFORT_RANK` is the existing `{M5:1, M15:2, M30:3, H1:4,
H2PLUS:5}` map from `lib/ai/strategic-frameworks/frameworks/` (or
the equivalent existing constant). A heavy child counts more in
the denominator than a light one · finishing a hard child moves
the needle further than finishing an easy one.

If implementation finds the effort-weighted formula too noisy
(missing effort estimates · operator preference for raw count),
**drop the rollup entirely** · show only direct task status on the
scoreboard. Half-measure rollups (the original `done / all`) are
worse than no rollup because they look authoritative while being
silently wrong.

### A4. Implementation checklist collapses · 9 → 4 items

The original 9-item checklist was process worship. A self-FK is
fundamentally one column. Collapsed:

1. Write the migration SQL (done · `migrations-pending/20260523_task_parent_task_id/`)
2. Apply the migration to prod (operator-run)
3. Add field to `prisma/schema.prisma` + `Task` TypeScript interface · `pnpm prisma generate`
4. Ship the UI slice in ONE PR · `parentTaskId` input on `task.create` mutation · indented children in `loop-row-item.tsx` · effort-weighted rollup in `derive-mission-matrix.ts` · tests for cascade + inheritance + rollup

The old 9-step list (in the Implementation checklist section below)
stays for reference but is superseded by this 4-step version.

### A5. Original decisions kept (rules 2 · 3 · 4 · 5)

- Rule 2 (field inheritance · missionId + goalId at create only ·
  dueDate + loopKind don't inherit) · KEEP
- Rule 3 (inline-nested UI with collapsible chevron) · KEEP
- Rule 4 (1-level depth) · KEEP
- Rule 5 (mixed-kind nesting allowed) · KEEP

The original critique on hedge-frequency stands · the "reversible at
code layer" phrasing appears 6 times below · post-implementation
each rule should be encoded with conviction (not toggles). But
during DESIGN (now) hedging is appropriate because the operator
hasn't decided yet.

---

(original ADR-0017 follows · do not edit · the amendment above is
the authoritative current state · the section below documents what
the agent originally proposed)

---

## Context

Task #22 — true subtasks on /tasks — surfaced from the agent's #7
visual-hierarchy slice. The schema change is trivial (one nullable
self-FK + index) but the semantic rules around nesting are six
distinct decisions, each with valid alternatives. Shipping default
semantics into a feature operators didn't explicitly opt into is the
kind of design-by-committee move that produces "I'll change this in
a month" tech debt.

This ADR captures the conservative defaults so the next time #22
unblocks (operator-applied migration), the implementation slice can
proceed without re-litigating the contract.

## Decision

Six rules · all reversible at the code layer (none of them are
encoded in the schema itself · the schema only adds the relation).

### 1. Completion cascade — children stay open when parent is marked DONE

**Why:** auto-completing children destroys data signals. The
operator's intent in marking a parent DONE may be "I'm done with
the main thing, children are no longer mine" or "everything tied to
this is done." We can't tell from one click. Leaving children open
makes the choice explicit · operator deletes/cancels children
they don't want anymore.

**Reversibility:** in `lib/services/task-actions.ts checkTask()`, add
optional `cascade: boolean` parameter · default false · operator can
toggle in settings later.

### 2. Field inheritance — `missionId` + `goalId` inherit at create only

**Why:** when an operator creates a subtask of a task in mission
X, the subtask naturally belongs to mission X too. Same for goal.
The "at create only" qualifier means: inheritance happens once,
when the subtask is first persisted · subsequent edits to the
parent's mission/goal do NOT cascade to existing children (no
silent data drift).

`dueDate` does NOT inherit · subtasks frequently have earlier or
later deadlines than parents (a "ship the launch" parent with a
"book photographer" subtask due 3 weeks before).

`loopKind` does NOT inherit · a DAILY parent loop ("morning
routine") can legitimately have a ONCE child ("buy new coffee
maker"). See rule 5.

**Reversibility:** the inheritance logic lives in
`lib/services/createTask.ts` · adding/removing fields from the
inheritance list is a one-line change.

### 3. UI surfacing — inline-nested with collapsible chevron

**Why:** Todoist · Things 3 · ClickUp all use inline nesting.
Drilldown views add tap-friction and break the operator's flow.
The collapsible chevron preserves the scannable parent-row density
when children are hidden.

Indent magnitude: 16px per level (matches the existing pinned-band
+ kind-section visual rhythm).

**Reversibility:** the indent + chevron live entirely in
`components/actions/loop-row-item.tsx` + `loop-stream.tsx`.
Swapping to a drilldown route would require re-routing
`/tasks/[id]` but doesn't touch the data layer.

### 4. Depth limit — 1 level (parent + direct children only)

**Why:** multi-level nesting creates cognitive load (which level am
I on?) and edge cases (what happens to grandchildren when
grandparent is deleted? do they orphan up or stay tied to parent?).
Single-level covers 95% of practical use cases (the morning-routine
+ coffee-maker example, "ship launch" + "book photographer" /
"design hero image" / "write copy" trio).

Schema-level enforcement: NONE (no constraint that
`parent.parentTaskId IS NULL`). UI-level enforcement: the New
Subtask button only renders on rows where `task.parentTaskId IS
NULL`. If an operator manually edits via raw SQL to create a
grand-child, the UI renders it as a regular child of its direct
parent (graceful degradation, no crash).

**Reversibility:** removing the UI gate enables N-level nesting.
The LoopStream walk would need to become recursive · scoreboard
rollup is already recursive-ready (see rule 6).

### 5. Mixed-kind nesting — ALLOWED

**Why:** real-world tasks mix kinds. A DAILY loop "morning routine"
can have a ONCE subtask "buy coffee maker." A ONCE parent "ship
the launch" can have a DAILY subtask "post 1 daily marketing
nudge for 2 weeks." Forbidding the mix would push operators to
work around the constraint (e.g., creating a fake sibling instead
of a subtask).

**Reversibility:** if mixed-kind proves chaotic in practice, gate
in `createTask.ts` (reject the subtask if `kind !== parent.kind`).
One conditional.

### 6. Scoreboard rollup — parent progress counts descendants

**Why:** operator's mental model of "how complete is mission X" is
"how much WORK has been done", and subtasks ARE work. If 80% of a
parent's children are DONE, the parent contributes meaningfully to
the mission's progress even if the parent itself is still OPEN.

The exact formula in `derive-mission-matrix.ts`:
```
mission.progressPct =
  (count of descendants where status = DONE) /
  (count of all descendants where deletedAt IS NULL)
```
where "descendants" includes the parent itself + all direct
children (1-level today; recursive when rule 4 is lifted).

**Reversibility:** the rollup formula lives in
`computeMissionMetrics()` · swapping to "only direct task status"
is a one-line change of the count predicate.

## Consequences

### Positive
- Six decisions made up-front · no design-by-PR-comment when the
  migration lands
- Schema migration parked · production is safe until operator
  applies it deliberately
- Each rule is a one-or-two-line change at the CODE layer · the
  operator can flip any rule without touching the schema or the
  data
- The rollback path is documented (DROP COLUMN + DROP INDEX · no
  data loss because the column is nullable from inception)

### Negative
- Six rules to remember when next-session picks up #22 · this ADR
  is the canonical reference · check it BEFORE implementing
- "Inheritance at create only, never cascade" requires operator to
  re-assign children if they re-mission a parent · documented but
  may surprise

### Neutral
- Performance: one nullable indexed column · row size grows by ~24
  bytes (cuid TEXT + null bitmap). Negligible at the operator's
  task volume (~thousands of rows lifetime).

## Open follow-ups (not blockers)

- Settings toggle for rule 1 (cascade on/off · operator preference)
  — defer until operator surfaces the need
- Recursive descent in rules 4 + 6 once 1-level proves out — also
  deferred
- Subtask-aware NextMove signal: "you've completed 3 of 5 subtasks
  · the parent moves closer to done" — feature opportunity but
  outside the migration slice

## Implementation checklist (post-migration apply)

When operator runs the parked migration successfully:

- [ ] Add `parentTaskId` + `parent` + `children` + `@@index` to
      `Task` model in `prisma/schema.prisma`
- [ ] Run `pnpm prisma generate` to refresh the client
- [ ] Add `parentTaskId?: string | null` to `Task` interface in
      `components/actions/shared.ts`
- [ ] Extend `createTask.ts` with the inheritance rules from rule 2
- [ ] Add the `parentTaskId` input to `task.create` tRPC mutation +
      Zod schema
- [ ] Build `<SubtaskRow>` indent + chevron in `loop-row-item.tsx`
      per rule 3
- [ ] Walk children in `loop-stream.tsx` per rule 4 UI gate
- [ ] Update `computeMissionMetrics` rollup per rule 6
- [ ] Tests covering each rule + the "graceful degradation" case
      (grand-child created via raw SQL)
- [ ] Update `apps/statenour/docs/RECONCILIATION.md` with the ship
      entry

Each step is a separate commit. Total slice estimate: 4-6 commits.
