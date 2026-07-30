# Skill improvement proposals — review queue

Append-only queue written by the `session-observer` skill
(`.claude/skills/session-observer/SKILL.md`). **Nothing here is applied.**
Each block is a proposal an operator approves, rejects, or defers.

**Rules**
- Every proposal cites a **witnessed trigger** from the session that wrote
  it. No trigger, no proposal.
- Append only. Rejected ideas stay visible — an idea that reappears every
  wave is itself a signal.
- To act on one: edit the target skill directly, or hand the block to the
  global `skill-improver` skill. Then mark `Status: applied <PR>` or
  `Status: rejected <reason>`.

---

## 2026-07-30 · observability truth arc (PRs #1228–#1239)

### P1 · `statenour-verify`
- **Trigger (witnessed):** in #1238, `tests/lib/services/system-change-digest.test.ts`
  omitted a newly-required `DigestParts` field. `pnpm typecheck` returned
  exit 0; only `vitest` caught it. `tsc --noEmit` does not cover `tests/`.
- **Cost:** a green typecheck was briefly treated as proof the change was
  complete.
- **Proposed edit:** add to the Traps section — "`typecheck` does NOT cover
  `tests/`. A green tsc says nothing about test-fixture correctness; only a
  test run does."
- **Confidence:** high (structural fact, reproducible)
- **Status:** proposed

### P2 · NEW: `vacuous-source-check` (or a rule inside `statenour-verify`)
- **Trigger (witnessed):** the same defect shape landed three times in one
  day — `/diagnose` read `apiRequestLog` for a route that never writes it
  (#1228); `system-pulse` counted `ai_generations.status='failed'`, a value
  no writer emits (#1235); the same file counted `error_logs.level='fatal'`,
  likewise never written (#1235).
- **Cost:** ~2 months of a diagnostic printing "none in the last hour" during
  real outages, plus six permanently-green orb fields.
- **Proposed edit:** a standing rule — "before shipping any report section,
  prove with a prod query that its source table receives rows from the path
  it claims to observe. A filter whose discriminator value has no writer is
  a fabricated all-clear."
- **Confidence:** high (recurred 3×)
- **Status:** proposed

### P3 · `statenour-migration`
- **Trigger (witnessed):** #1231 removed the apply endpoint's
  `_prisma_migrations` write; #1232 fixed the `migrations-pending/README.md`
  that still taught the old "it records it for you" contract.
- **Cost:** the README would have told the next agent to expect recording
  that no longer happens.
- **Proposed edit:** state the current contract — "the apply endpoint applies
  DDL but never writes the ledger. Recording = promote the SQL to
  `prisma/migrations/<name>/` then `prisma migrate resolve --applied <name>`."
- **Confidence:** high
- **Status:** proposed

### P4 · `statenour-migration` (second rule)
- **Trigger (witnessed):** #1233 found the apply endpoint's
  `20260618000000_consolidated_models` registry entry would have re-created
  `content_nodes` / `financial_transactions` / `investment_holdings` —
  tables deliberately dropped when their models were purged 2026-06-21.
- **Cost:** one POST would have resurrected three retired tables; timeline
  evidence suggests it already fired once.
- **Proposed edit:** "a deliberate table drop must also prune every re-apply
  path — endpoint registry entries, one-shot scripts, parked SQL — or
  `IF NOT EXISTS` machinery quietly resurrects it."
- **Confidence:** high
- **Status:** proposed

### P5 · `session-observer` (this skill, self-referential)
- **Trigger (witnessed):** the operator pasted a 5-skill plan; a gate found
  4 of 5 already installed, and one name (`adhx`) looked like a match but was
  an unrelated X/Twitter fetcher.
- **Cost:** near-miss — building 5 skills would have added a fourth
  slop-stripper and a fifth skill-finder.
- **Proposed edit:** already encoded in the Traps section ("grep before
  proposing NEW"). Logged here as the precedent, not a pending change.
- **Confidence:** high
- **Status:** applied (in the skill as written)
