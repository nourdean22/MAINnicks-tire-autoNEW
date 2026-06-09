# NEXT-INTELLIGENCE-WAVE — Statenour

> **Status:** Truth cleanup + first intelligence pass SHIPPED to `main` `c4716a90`.
> The **Useful Function Wave** (F1–F5) below is now **BUILT + verified on branch
> `statenour-truth-intelligence-wave`, NOT pushed** (awaiting owner deploy decision):
> F1 session-importer `a38f2d98` · F2 change-digest `ff2d4cb6` · F3 task-rescue
> `b4c5505e` · F4 receipt-feed `63edff7b` · F5 command-shortcuts `faca5995`.
> Gates: typecheck 0 · 225 files/3155 tests · build green · guards clean.
> Current truth: [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md).

## Re-scope rationale

The first pass shipped the *measurement + trust* foundation (truth scoreboard,
runbooks, the `ActionReceipt` contract). What it did NOT do is reduce Nour's
daily operating friction. This wave replaces the remaining abstract upgrades
with five functions that each **reduce friction, improve execution, or prevent
wrong AI behavior** — services + tests first, minimal UI, reuse existing models.

### Deprioritized (removed from the roadmap)
- Generic generative-UI confirm cards (P9).
- A new system-jobs dashboard — `/system/crons` already exists; improve via runbook.
- Broad visual polish · big governed-memory migration · new DB tables (unless unavoidable).
- The broad knowledge→action converter (`8cdf3a87`) shipped as additive lib code.
  The Wiring Wave (below) gave it ONE narrow, suggestion-only surface — a `/convert`
  command — rather than extending it into a broad auto-acting feature.

## Top 5 useful functions (this wave)

Build order favors services the command registry (#5) will call. Reuse existing
models; **no new DB table unless clearly necessary**; every mutation path is
explicit-confirmation or receipt-backed; no duplicate audit/task/chat logic.

### F1 · Claude Session Importer / Work Session Digest — `feat(statenour): add Claude session importer`
- **What:** parse a pasted Claude Code session log → structured digest (title, repo/branch, commits[], phases, files changed, tests/checks run, failures/blockers, migrations, prod-actions-needed, warnings/risks, next steps).
- **Store:** the best EXISTING pattern (SessionReport / BrainMemory / AuditEvent / SystemMetric — decided in the Understand phase). No new table unless necessary.
- **Surface:** `POST /api/system/session-import` (owner) and/or a `/import-session` command. Follow-up tasks suggested, **never silently created**.
- **Acceptance:** SHAs extracted · "needs owner approval" detected · "prod migration/deploy pending" detected · tasks suggested not created · no memory spam · parser tests.

### F2 · "What Changed?" system digest — `feat(statenour): add system change digest`
- **What:** one call answers "what changed since last time?" — latest commits (if readable), latest RECONCILIATION entry, `eval:memory` score, stale-doc result, runbook-check result, pending-migration notes, rollout state, unresolved risks, next owner decision.
- **Reuse:** `runMemoryEvals`, the stale-doc scanner, the runbook checker — call them, don't re-implement.
- **Surface:** `getSystemChangeDigest` service + `/what-changed`.
- **Acceptance:** crisp "since last reconciliation" digest · NEVER hallucinates deploy status (says "not deployed"/"unknown" when unverified) · tests with mocked inputs.

### F3 · Task/Mission Inbox Rescue scanner — `feat(statenour): add task rescue scanner`
- **What:** read-only scan for: tasks in old inboxes · no mission · in a GENERAL/domain anchor but likely belong to a specific mission · stale (untouched) · `pendingClassification` · missing `nextPhysicalAction`. Each finding carries a reason + confidence + a suggested fix (move/add-action/archive/keep).
- **Reuse:** the domain backbone + `isInboxMission()` + the classifier the sibling session just shipped; **GENERAL anchors protected** — real projects are not generic buckets.
- **Surface:** `POST /api/system/task-rescue` (read-only) + a small card or chat tool. **No auto-move without confirmation.**
- **Acceptance:** read-only default · suggestions reasoned/confident · GENERAL protected · tests for old-inbox / no-mission / GENERAL→specific / stale.

### F4 · Action Receipt Feed — `feat(statenour): add action receipt feed`
- **What:** read-side feed answering "what did Nick/system actually DO?" — action · status · entity · when · source · success/failure · undo-available. High-value entities: task create/complete/move · mission create/archive · memory pin/update · decision log · correction capture · session import.
- **Reuse:** **integrate the existing `lib/ai/receipts/action-receipt.ts` normalizer** (`toReceipt`/`canClaimDone`) + existing audit/action records (AuditEvent etc., mapped in Understand). Do NOT duplicate receipt logic; do NOT invent a new audit store if one exists.
- **Surface:** `getActionReceiptFeed` service + `/receipts` + optional small card.
- **Acceptance:** failed actions visible · no false "done" · uses existing audit logs · normalization tests.

### F5 · Personal Command Shortcuts — `feat(statenour): add personal command shortcuts`
- **What:** a SMALL command registry (not a framework) for daily-use commands that call the services above: `/today` (today's 3 + next action + current mission + one warning) · `/rescue` (F3) · `/what-changed` (F2) · `/import-session` (F1) · `/receipts` (F4) · `/stale` (stale docs/tasks/memories).
- **Rules:** commands call EXISTING services · **no duplicate logic in the chat route** · unknown command → suggestions · routing/intent is pure + testable.
- **Acceptance:** registry exists · ≥3 commands work end-to-end on the services above · chat route not bloated · routing + unknown-fallback tests.

## Wiring Wave (Wires 1–5) — making F1–F5 reachable

After F1–F5 shipped as services, this wave connected them to real surfaces, one
wire at a time, each committed + verified separately (typecheck 0 · targeted +
full suite · guards · build green). No new tables, no prod mutation, no autonomy.

- **Wire 1 — receipts ← real chat actions.** `persist-assistant-turn` writes an
  `action_receipt` AuditEvent per side-effecting executed action (via the existing
  `ActionReceipt` contract); `action-receipt-feed` merges that source. Failed actions
  are visible; advisory only (never blocks chat).
- **Wire 2 — /missions rescue strip + GENERAL anchors.** `task.missionsHygiene`
  (read-only) returns `buildTaskRescue` + `buildDomainAnchors`; a self-hiding strip
  shows rescue findings + per-domain open-counts. Suggestion-only — never auto-moves.
- **Wire 3 — /system read-only cards.** `system.{changeDigest,memoryEvals,receiptFeed}`
  + a `/system/digest` page with three read-only cards (what-changed · truth evals ·
  recent receipts). No duplicate feed.
- **Wire 4 — DAILY stat XP credit.** DAILY check-offs (updateTask→WAITING) never hit
  the DONE credit block, so they earned 0 XP. `isDailyCheckoff` gates a per-day
  idempotent `creditTaskStats` on that path; the reward is returned + toasted. ONCE/
  WEEKLY/PROMISE unchanged; no double-credit.
- **Wire 5a — knowledge→action `/convert`.** `convertToAction` (pure, was zero-caller)
  now has one suggestion-only surface: a `/convert <thought>` command that proposes a
  next move and flags sensitive intents `requiresApproval`. Never writes.
- **Wire 5b — people→stats: already wired, not rebuilt.** `lib/mastery/people-credit.ts`
  already credits relationships/networking/persuasion on ledger deposits + power-plays
  (callers: `power-plays-runner`, `power-atlas`, `comprehensive-backfill`), via the
  idempotent `creditStatXp` seam. Audited + left as-is — rebuilding would be redundant
  and risk the people-intelligence layer.

## Wave rules (binding)
- Stay on the branch; **do not push to main** without owner approval.
- No prod data mutation · no migrations unless unavoidable.
- Services + tests before UI; keep UI minimal.
- Reuse existing models/audit/task/chat seams; no duplication; no hidden autonomy.
- **Verify after each function:** typecheck · targeted tests · `check:stale-docs` · `check:runbooks` (if runbooks touched) · `eval:memory` (if truth/runbook docs touched). Final: full suite + build if feasible, then reconcile AGENTS + RECONCILIATION.
