# statenour · People-gate + custom recurrence + chat-honesty fix

**Date:** 2026-06-06 · **Branch:** `statenour/people-tasks-fix` (worktree) ·
**Base:** `origin/main` `59c3927c` · **Lens:** brainstorming + clarity-gate
+ kaizen + DATABASE-ARCHITECT (recurrence) + prompt-engineering (chat).

## Understanding (operator-reported, all VERIFIED on live bdnick.info)
1. **Last Nick chat** had: a VERIFIER ⚠ on an unbacked claim (Nick asserted
   push-up completion status with **no tool call**), low self-scores (66/76/68),
   naggy/negging tone ("If you did them, you'd know. You didn't."), topic-
   policing ("That's the drift."), and a 43s response.
2. **People page** held 2 junk profiles among 9 (the "2 NEEDS INFO"):
   `Fernando Romero · UNKNOWN` ("urgent lead that came in at 7am" — a tire-shop
   lead in personal Power Atlas) and `her · UNKNOWN` (a pronoun ghost with a
   real personal note mis-logged to it).
3. **Tasks** only supported `ONCE`/`DAILY` (verified `LoopKind` enum + the
   2-option editor select) — no way to do "every Thursday."

### Root causes (VERIFIED by reading the code)
- **(a) shop-contact leak:** `summarizeAndStoreConversation` (the background
  chat digest, `lib/brain/conversation-memory.ts`) extracted every name from
  the transcript and called `resolvePersonByName(..., create-on-miss)` with no
  shop/personal filter → any name Nick read (e.g. via `findCustomer`) became a
  personal profile. It also overwrote curated `relationship` with the latest blurb.
- **(b) pronoun ghost:** `resolvePersonByName` (`lib/brain/person-profile-fuzzy.ts`)
  skips fuzzy matching for names < 4 chars and **creates on no-match** with no
  guard → `person.update { name: "her" }` created a ghost. Identity is keyed on
  `name` only (no phone/email/source).
- **(c) recurrence:** `LoopKind` had no `WEEKLY`; no `recurringDays` field.
- **(d) fabrication:** Nick had `task.create`/`task.complete` but **no query
  action** — asked "did I do X?", it had nothing to call, so it guessed.

## Decision log
- **D1 · People auto-add = "ask first" (operator choice).** Background digest →
  **match-only, never create**. In-chat → `person.update` is edit-only; new
  `person.create` exists but the catalog tells Nick to ASK before using it.
  Alt rejected: silent create + review-queue (operator wants to be asked).
- **D2 · Pronoun guard at the one chokepoint** (`resolvePersonByName`) so ALL
  paths (digest, agent, operator) are protected, not just one.
- **D3 · Recurrence = new `WEEKLY` kind + `recurringDays Int[]`** (0=Sun..6=Sat),
  reusing the existing `WAITING`+`snoozedUntil`+task-resurface-cron mechanism.
  Alt rejected: RRULE lib (overkill), overloading DAILY (breaks semantics).
- **D4 · Migration is additive + idempotent + column-first**, applied via the
  guarded endpoint (no prod creds in dev). Operator-gated (prod write).
- **D5 · Chat fix = real `task.status` tool + always-on HONESTY+RESPECT rule**
  (don't assert unverified, don't scold topic changes). Tone nudge is additive,
  not a persona rewrite — keeps the tough-love coach the operator built.

## What shipped (3 batches, in the worktree)

### Batch 1 — People-creation gate (bugs a + b)
- `lib/brain/person-profile-fuzzy.ts`: `isNonName()` guard (pronouns/descriptors
  → never create); `createIfMissing` option (default true); `ResolveResult.person`
  now nullable (`no_match` / `rejected_nonname` tiers).
- `lib/brain/conversation-memory.ts`: digest passes `createIfMissing:false`
  (match-only) + stopped overwriting curated `relationship`.
- `lib/ai/agent-actions/person-actions.ts`: `person.update` = edit-existing-only
  (errors with "ask first" on no-match); new `handlePersonCreate`.
- `lib/ai/nick-agent.ts`: `person.create` dispatch + ACTION_CATALOG rows + a
  "People rule — ask before adding · never add shop callers" block.
- `lib/trpc/routers/task/power-atlas.ts`: `createPerson` null-guard.
- Test: `tests/brain/person-profile-fuzzy.test.ts` (5).

### Batch 2 — Custom weekday recurrence (bug c)
- `prisma/schema.prisma`: `LoopKind += WEEKLY`; `Task.recurringDays Int[] @default([])`.
- Migration `prisma/migrations-pending/0008_task_weekly_recurrence/migration.sql`
  + registry entry in `app/api/system/apply-pending-migration/route.ts`.
- `lib/validators/tasks.ts`: `loopKindValues += WEEKLY`; `recurringDays` zod.
- `lib/loops/weekday.ts`: pure `nextWeekdayOccurrence()` helper.
- `lib/services/task-actions.ts`: `checkTask` WEEKLY branch — on completion,
  snooze to next listed weekday (`WAITING`+`snoozedUntil`); lazy-loads
  `recurringDays` only for WEEKLY (deploy-safe). DAILY unchanged.
- `components/missions/task-edit-sheet.tsx`: `WEEKLY` option + 7-button weekday
  picker (44px touch targets) + `recurringDays` through state/validation/submit.
- Test: `tests/loops/weekday.test.ts` (5).

### Batch 3 — Chat honesty + tone (bug d + tone)
- `lib/ai/agent-actions/task-actions.ts`: `handleTaskStatus` — looks a task/habit
  up by title, returns real done-today/streak/last-completed.
- `lib/ai/nick-agent.ts`: `task.status` dispatch + catalog row ("never answer
  'is it done' from memory").
- `app/api/ai/chat/finalize-system-prompt.ts`: always-on **HONESTY + RESPECT**
  block (don't assert unverified completion; don't scold topic changes).

## Migration apply (OPERATOR-GATED · prod write)
Additive · idempotent · zero data loss. **Apply BEFORE/with the deploy** (full-row
Task queries select `recurring_days`):
`POST /api/system/apply-pending-migration { "name": "0008_task_weekly_recurrence" }`
from an authed bdnick.info tab. Then deploy.

## Batch 4 — Cleanup (PENDING operator input)
Delete `Fernando Romero`; **re-home the `her` note to the real person** (need the
name) then delete the ghost. Prod deletes only on explicit operator go-ahead.

## Verification
- `pnpm typecheck` = 0 (all 3 batches).
- 907 relevant tests pass + 10 new assertions. The 12 unhandled-rejections in
  `tasks-auto-inherit.test.ts` are pre-existing test-mock debt (untouched code).
- `next build` gate: run before push.
- Runtime: confirm on bdnick.info (Claude-in-Chrome) after deploy + migration.

## Above-and-beyond recommendations (not yet done)
- **PersonProfile identity:** add `phone`/`email` + a `source` field — make
  shop-vs-personal structural and dedup reliable (today it's name-only).
- **Suggested-people inbox** on /people for names Nick noticed (so the
  match-only digest doesn't silently drop genuinely new contacts).
- **Latency:** 43s response = local `ollama-glm5`; review provider routing.
- **Tone A/B:** consider a per-mode tone (Master = direct, Friend = warm) audit.
