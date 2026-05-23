# ADR-0017 · Task subtasks · semantic decisions

**Status:** ACCEPTED · 2026-05-23 · operator-deferred-but-documented
**Companion:** `prisma/migrations-pending/20260523_task_parent_task_id/`

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
