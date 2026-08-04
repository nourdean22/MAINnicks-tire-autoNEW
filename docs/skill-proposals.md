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
- **Status:** applied #1243 — added to `statenour-verify` Traps

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
- **Status:** applied #1243 — folded into `statenour-verify` as the
  "Before shipping any report / diagnostic section" rule rather than a
  new skill (the proposal offered both; an update beats a new skill when
  the existing one is the right bucket)

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
- **Status:** applied #1243 — added to `statenour-migration` Hard rules

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
- **Status:** applied #1243 — added to `statenour-migration` Hard rules

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

---

## 2026-07-30 · first `session-observer` run (skill-library gap-close)

Three candidates survived the evidence filter. Dropped without logging:
the Bash-cwd-reset trap (already in `AGENTS.md` § Environment) and a
line-numbers-go-stale-after-your-own-edits note (cost one wasted tool
call — below the bar).

### P6 · `statenour-verify`
- **Trigger (witnessed):** the operator declined a gate finding ("leave
  purple" — the `stats/page.tsx` gradient). The `check:anti-slop` gate
  wired hours earlier in #1237 would have stayed permanently red.
- **Cost:** near-miss. A gate that always fails is the "documented check
  everyone ignores" pattern this whole arc existed to remove.
- **Proposed edit:** add a rule — "when the operator declines a gate
  finding, make the waiver **explicit and signature-scoped** (marker on
  the offending line, dated reason) so the gate returns green and stays
  live. Never waive by filename — that blinds the check to every future
  violation in that file. Verify red-green: the waiver in place is green,
  a fresh violation in the same file still fails." Shipped as #1239.
- **Confidence:** high
- **Status:** applied #1243 — added to `statenour-verify` as the
  "When the operator DECLINES a gate finding" section

### P7 · `statenour-verify`
- **Trigger (witnessed):** operator-approved probe of
  `apps/statenour/data/skills-registry.json` — `generatedAt`
  **2026-05-07** (84 days stale), 1,426 entries, `totalSkills: 1424`
  (the file's own header disagrees with its array by 2). Disk today
  holds **979** skill directories. Cross-check: **453 ghosts**
  (recommendable but not installed) and **6 invisible** (installed but
  unrecommendable — including `graphify`, which the operator has a
  `/graphify` slash command for).
- **Cost:** not yet paid, but ~32% of the recall index points at skills
  the operator cannot use — the same "reader pointing at things that
  aren't there" class as #1228.
- **Proposed edit:** add to the verify gate — "check
  `data/skills-registry.json` freshness; if `generatedAt` is >30 days old
  or its entry count diverges from `~/.claude/skills`, the recall layer
  is recommending from a stale snapshot. Regenerate with
  `scripts/embed-skills.ts`." *(Product-side fix is a separate operator
  call: regeneration means embedding spend + prod writes.)*
- **Confidence:** high
- **Status:** applied #1243 — added to `statenour-verify` "Extra checks",
  **with the claim corrected** (below)

> **CORRECTION (2026-07-30, same day).** The "453 ghosts / ~32% of the
> index is unusable" framing above was **wrong**, and the fix run refuted
> it. `build-skill-registry.ts --merge --dry-run` reports those entries as
> `preserved (in registry · not on this machine)` — the registry is a
> deliberate multi-machine superset, and the script's own header warns
> that `--force` "drops entries not present on this machine … other
> machines' skills silently vanish." `audit-skill-embeddings.ts` then
> confirmed **0 orphaned embeddings**. The real defect was much smaller
> and is now fixed: **8 skills were missing from the registry entirely**
> (`graphify`, `verify-receipt`, `docx`, `pdf`, `pptx`, `xlsx`,
> `prompt-engineering-expert`, `template-skill`) plus 54 with drifted
> metadata. Registry regenerated by merge — 1,426 → **1,434 entries**,
> `generatedAt` now current, and the file's own `totalSkills` header
> (which disagreed with its array, 1424 vs 1426) is consistent again.
>
> **RESOLVED same day — it was an env gap, not a billing wall.** The first
> run failed on HuggingFace (402, credits depleted) and OpenAI (429, quota),
> which read as "no funded embedding provider". Wrong: the chain is
> **Cohere → HuggingFace → OpenAI → OpenRouter**, and Cohere — the
> *preferred* lane, pinned to `output_dimension: 1024` precisely "so vector
> spaces don't desync on fallover" — never ran because `COHERE_API_KEY` is
> absent from the local `.env.local`. It **is** set on Railway. Running
> `railway run --service statenour-web pnpm tsx scripts/embed-skills.ts`
> embedded all 8 in 1s (`8 new · 1426 skipped · 0 failed`).
>
> Verified in prod: all 1,434 skill embeddings are `embedding_dim = 1024`
> (no mixed-dimension corpus), and `audit-skill-embeddings.ts` reports
> **0 missing · 0 orphaned · verdict: IN SYNC ✓**. `graphify` and
> `verify-receipt` are now recall-visible.
>
> Two traps worth keeping: OpenAI is the only chain member that would have
> returned **1536-dim** vectors, and its branch has no length guard (the
> Cohere branch rejects anything `!== 1024`) — so "succeeding" on the
> OpenAI fallback would have silently poisoned a 1024-dim corpus. And a
> provider failure cascade is not proof of a billing problem until you
> check which lanes actually had keys.
>
> Lesson logged: the proposal asserted a defect size from a directory diff
> without reading the generator that owns the semantics. Reading it first
> would have shown "preserved" is a designed state, not rot.

### P8 · `CLAUDE.md` § SUBAGENT POLICY *(proposal only — this skill does not edit that file)*
- **Trigger (witnessed):** two read-only mapper agents flagged
  discriminators as having "no writer" from code-grep alone. Prod probes
  refuted **both, in opposite directions**: `situation_logs.context LIKE
  'trigger:%'` had **241 real rows** (an unseen free-form caller), and
  `decision_replay_due` had **2** rows where the agent said zero.
- **Cost:** near-miss — trusting the first would have deleted a live read
  with 241 rows behind it.
- **Proposed edit:** extend rule 3 (VERIFY, DON'T TRUST) — "for any claim
  that a value/table/path is unused, code-grep is **not** evidence in
  either direction. Confirm against the running system before deleting,
  and before believing a 'no rows' claim. Agents get no prod credentials;
  the orchestrator runs the probe."
- **Confidence:** high (2 instances, same session, opposite directions)
- **Status:** proposed

## 2026-08-04 · Agent OS v1 (canonical policy + adapters + enforcement hooks) — PRs #1355, #1354

### P1 · NEW: guard-red-team
- **Trigger (witnessed):** the first draft of `config/agent-os/policy.json` went green on its own
  canaries, then a 4-lens adversarial review ran 31 end-to-end probes through the real
  `pretool.mjs` and proved **22 bypasses + 7 false positives** — a `git -C <path>` global-option
  prefix defeated every git rule at once, an implicit-destination push (`HEAD`/bare) reached main
  unnamed, `prisma migrate reset` slipped past the `--accept-data-loss` ban, and branch names
  containing `main` (`chore/shared-main-push`) were wrongly blocked. Separately, the hook blocked
  its own author three times on mention-vs-execution (e2e test command; commit message in a
  PowerShell here-string; this very proposals-file append via heredoc). All fixed in v2
  (PR #1355); every verified bypass is now a locked denyExample.
- **Cost:** without the red-team pass, an enforcement layer providing false safety would have
  merged; with it, ~1 hour of matching-layer rebuild mid-run.
- **Proposed edit:** a skill triggered whenever authoring/modifying any deny-list, guard regex,
  lint rule, or hook: (1) never trust a green first run — the check may be mis-scoped; (2) spawn
  an adversarial reviewer that probes the REAL binary end-to-end (exit codes, not regex reasoning),
  trying at minimum: tool global-option prefixes, implicit/default arguments, flag families and
  bundled short flags, quoting/here-strings/heredocs, chaining, and mention-vs-execution false
  positives; (3) every verified bypass becomes a locked deny test, every false positive a locked
  allow test.
- **Confidence:** high (three independent instances in one session: red-team 22×, canaries' first
  run caught 2 defects, the new parity guard's first run caught a 4th "main (protected)" instance).
- **Status:** proposed

### P2 · harness-worktree-setup
- **Trigger (witnessed):** `git push` from this harness worktree died at the default 2-minute tool
  timeout (exit 143) because the lefthook pre-push `build:affected` gate alone took 103s; the retry
  with a 10-minute timeout succeeded (PR #1355 push).
- **Cost:** one dead push, ambiguous remote state to re-verify.
- **Proposed edit:** add one line to the skill: "`git push` runs the pre-push build gate
  (~2-5 min when an app is affected) — always give push commands an explicit >=5-minute timeout."
- **Confidence:** medium (once, clear mechanism).
- **Status:** proposed

### P3 · NEW: stranded-branch-rescue
- **Trigger (witnessed):** `nickstire/admin-health-strip-and-guards` sat with 11 unmerged commits,
  walkthrough + capability evidence, and no PR — the authoring session died before `gh pr create`
  (same stranding class as the nickstire-admin-waves-breakage memory). Rescued as PR #1354 via:
  `git cherry origin/main <branch>` (11x `+` = genuinely unmerged) → no attached worktree → PR with
  provenance note → merge only on CI-green + SHA-unchanged. The same cherry check exposed three
  OTHER branches (`statenour/render-queue-lease`, `statenour/wire-reviews-cron`,
  `chore/record-render-lease-migration`) as `-` = content already merged — zombie branches that
  would otherwise invite a duplicate-merge mistake.
- **Cost:** a finished, evidence-carrying arc invisible on main for ~6 hours; three zombie branches
  inviting re-merges.
- **Proposed edit:** a skill encoding the rescue protocol: cherry-check FIRST (a `-` branch is a
  zombie, never re-merge it), require no-attached-worktree + SHA-stability before touching a
  sibling's branch, put provenance in the PR body, and resolve `.completion/evidence.json`
  conflicts by its own documented last-writer-wins rule (the merging branch's walkthrough wins).
- **Confidence:** medium (one full occurrence, but the stranding class is memory-documented as
  recurring).
- **Status:** proposed

---

## 2026-08-04 · UI/UX improvement pass (worktree ui-ux-improvement-pass)

### P1 · `nickstire-ios-pwa-primitives`

**Witnessed trigger:** the definitive cross-app sweep this session found exactly
ONE live `window.prompt` call — `apps/statenour/features/chat-v2/components/operator-conversation-drawer.tsx:85`
(Rename silently no-oped on the phone; fixed this wave). It survived 5 prior
sweep waves because it lives in `features/` — a fourth statenour source root
that is OUTSIDE the `{app,components,lib}` glob the skill's sweep command and
every prior audit used. 113 raw grep hits, 1 real finding, and the 1 was in
the 1 hit outside the documented glob.

**Proposal:** widen the skill's sweep command to cover
`apps/statenour/{app,components,lib,features,hooks}` alongside
`apps/nickstire/client/src`, and note that statenour's replacement primitives
are `useConfirmDialog`/`usePromptDialog` in `components/ui/confirm-dialog.tsx`
(nickstire's remain `confirmDialog` + sonner). Without the glob fix the next
`features/` regression is structurally invisible to the audit.

Status: proposed
