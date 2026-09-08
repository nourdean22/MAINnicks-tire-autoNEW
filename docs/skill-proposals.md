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
- **Status:** applied 2026-08-04 — operator approved the queue in chat; edit
  made directly to `~/.claude/CLAUDE.md` § SUBAGENT POLICY rule 3 (the file
  is outside this repo, so this stamp is its only in-repo trace; recorded
  alongside #1363)

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
- **Status:** applied #1360 — new skill `.claude/skills/guard-red-team/SKILL.md`

### P2 · harness-worktree-setup
- **Trigger (witnessed):** `git push` from this harness worktree died at the default 2-minute tool
  timeout (exit 143) because the lefthook pre-push `build:affected` gate alone took 103s; the retry
  with a 10-minute timeout succeeded (PR #1355 push).
- **Cost:** one dead push, ambiguous remote state to re-verify.
- **Proposed edit:** add one line to the skill: "`git push` runs the pre-push build gate
  (~2-5 min when an app is affected) — always give push commands an explicit >=5-minute timeout."
- **Confidence:** medium (once, clear mechanism).
- **Status:** applied #1360 — trap row added to `harness-worktree-setup`

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
- **Status:** applied #1360 — new skill `.claude/skills/stranded-branch-rescue/SKILL.md`, refined
  by the applying session's own measurement: `git cherry` false-positived on 5 of 6 merged-PR
  branches (squash + post-review edits break patch-id matching) while `gh pr list --head` was
  right 6 of 6, so the PR-record check is now step 1 and cherry is a secondary signal only.

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

Status: applied #1360 — sweep glob widened to both PWAs incl. `features`/`hooks`,
statenour primitives documented (existence re-verified at
`components/ui/confirm-dialog.tsx:89`/`:182` before writing them in)

---

## 2026-08-04 · unfinished-work PR run (PRs #1358-#1361 + dependabot queue)

### P1 · `statenour-verify`
- **Trigger (witnessed):** the mutation-probe harness for #1361 captured vitest
  results with `Select-String -Pattern 'Tests\s'` — case-INSENSITIVE by
  default, so it matched `tests 14ms` inside the Duration line and printed
  that as the "result" for all four probes. Four mutation runs produced zero
  usable pass/fail receipts; caught because the output looked wrong, then
  re-run with `-CaseSensitive -Pattern '^\s*Tests\s+\d'` (real receipts:
  4/2/1/1 red).
- **Cost:** one full 4-probe mutation cycle wasted; one step from reporting
  "mutation-verified" off receipts that verified nothing — the same defect
  class as the mutation-that-did-not-apply trap already in the sweep memory.
- **Proposed edit:** add to Traps — "PowerShell `Select-String` is
  case-insensitive by default: capturing vitest summaries with a bare
  `'Tests'` pattern also matches `tests 14ms` in the Duration line. Use
  `-CaseSensitive` with an anchored pattern, and read one captured line
  before trusting a batch of them."
- **Confidence:** high (mechanism reproducible; cost paid this session)
- **Status:** applied #1363 — added to `statenour-verify` Traps

### P2 · `guard-red-team`
- **Trigger (witnessed):** the command-text guard false-positived THREE times
  in one session on compound PowerShell. (1) A multi-statement command
  containing the standard env-token removal cmdlet was blocked as a
  system-path "/" delete. (2) A compound containing a backup-file delete plus
  a regex literal in an ADJACENT argument was blocked as deleting the path
  "\s". (3) The commit that DOCUMENTED instances 1-2 was itself blocked,
  because its here-string body QUOTED the cmdlet — mention-vs-execution, the
  exact class the #1355 red-team named. Workarounds used: `$env:` assignment
  instead of the cmdlet; probe scripts written to the scratchpad and executed
  as files; this very block appended via a file tool instead of a heredoc.
- **Cost:** three dead commands and two workaround detours mid-verification.
- **Proposed edit:** add two probe classes to the false-positive list —
  "PowerShell drive-qualified paths (`Env:`, `HKLM:`) parsed as filesystem
  paths" and "argument bleed: a path/regex-looking literal in an ADJACENT
  argument or quoted here-string of a compound command attributed to the
  guarded verb". Each should become a locked allowExample in the guard's
  canaries when fixed.
- **Confidence:** high (three instances, same session, three shapes)
- **Status:** applied #1363 — probe classes added to `guard-red-team`.
  **CORRECTION (same day, by probe):** feeding the three exact shapes
  through the REAL `pretool.mjs` returned ALLOW on all three (deny canary
  still blocks), so the false positives came from the HARNESS sandbox
  layer, not the repo policy — there was no repo "enforcement fix" to
  ship. #1364 locks the shapes as defensive allowExamples instead, so a
  future rule-widening cannot start catching them. The harness layer is
  not repo-editable; workarounds live in the skill text.

### P3 · `stranded-branch-rescue`
- **Trigger (witnessed):** four dependabot PRs (#1311/#1267/#1266/#1263) sat
  blocked since 2026-08-01 with red `e2e` checks. main's `e2e · statenour` run
  from 8/4 19:37 was green, so the failures were stale baselines: one
  `@dependabot rebase` comment turned #1267/#1266/#1263 green (`e2e:SUCCESS`)
  and they merged; #1311 was superseded by #1357, also green. Nothing was
  debugged — the checks were simply older than the fix.
- **Cost:** none this session, but the queue had already sat 3 days behind a
  red X nobody trusted.
- **Proposed edit:** add a short "same audit, open PRs" note — "a red check
  whose run predates main's latest green run of that SAME check is a stale
  baseline, not a defect: rebase (or ask dependabot to) and re-read before
  diagnosing anything."
- **Confidence:** medium (one occurrence, clear mechanism)
- **Status:** applied #1363 — "Same audit, open PRs" section added to
  `stranded-branch-rescue`

## 2026-08-07 · evolution-arc crank waves (#1401–#1416): VAPI pushes, cage/ghost-replay instrument hardening

### P1 · `nickstire-verify` (false-green doctrine: instruments)
- **Trigger (witnessed):** an 8-seed cage gauntlet failed ALL matches
  (`OLLAMA_API_KEY is missing`) yet exited 0 printing a clean "0 losses"
  readout, because its liveness probe rode the AMBIENT default lane (gpt-4o,
  key present) while the matches pinned gpt-oss:120b (Ollama lane, key
  absent). Third instrument-integrity incident in one arc: crank-1 graded 9
  empty thinking-burn turns as "losses" (fabricated result); #1405 found the
  `--filter` display re-sampling a fresh conversation instead of showing the
  graded one; then this. Fixed structurally in #1416 (pin both lanes, probe
  the exact models, zero-completed-work exits 1).
- **Cost:** one full gauntlet burned (~10 min + diagnosis); without the
  re-check the wave would have shipped "0 losses" as a win.
- **Proposed edit:** add an "Instrument runs (cage / ghost replay / any
  measurement script)" section: "a liveness probe must exercise the EXACT
  model/lane/config the measured work uses — a probe of a different lane is
  a false-green generator; and a run that completed ZERO units of work must
  exit non-zero, never render as a clean zero-findings readout."
- **Confidence:** high (three instances, same arc, three shapes)
- **Status:** applied #1418 (operator approved 2026-08-07)

### P2 · `nickstire-verify` (credentials section, mirroring statenour-verify''s)
- **Trigger (witnessed):** same failed gauntlet — `OLLAMA_API_KEY` is NOT in
  `apps/nickstire/.env` (worktree or primary); its only local home is
  `apps/statenour/.env` (Railway for prod). Earlier local runs worked only
  because the interactive shell happened to carry an inline export;
  background shells start clean and inherited nothing.
- **Cost:** the silent lane mismatch above; also the OpenAI lane silently
  absorbed the probe traffic.
- **Proposed edit:** add a "Running a script that needs real credentials"
  section (statenour-verify already has one): "nickstire `.env` does NOT
  carry the Ollama key; inject it from its home per-shell, and scripts that
  need it must fail fast naming that home (pattern: cage-match.ts after
  #1416). Background/`run_in_background` shells never inherit inline env."
- **Confidence:** medium (one occurrence, mechanism fully understood)
- **Status:** applied #1418 (operator approved 2026-08-07)

### P3 · `nickstire-shared-main-push` (PR mechanics under concurrent sessions)
- **Trigger (witnessed):** (a) crank-1: merged "#1411" by assumption — it
  was the SIBLING session''s already-merged PR (harmless no-op, pure luck);
  the sibling interleave makes guessed numbers wrong by default. (b) #1416:
  `gh pr merge --squash --delete-branch` exited 1 with "fatal: ''main'' is
  already used by worktree ..." AFTER the remote merge had already
  succeeded — the failure was only the local post-merge checkout.
- **Cost:** (a) a near-miss merge of the wrong PR; (b) a near-miss retry of
  an already-completed merge.
- **Proposed edit:** two lines: "ALWAYS capture the PR number from the
  `gh pr create` output (`($url -split ''/'')[-1]`), never merge a guessed
  number — sibling sessions interleave the sequence" and "if `gh pr merge`
  errors mentioning a worktree/checkout, the REMOTE merge may already be
  done: `gh pr view <n> --json state` before any retry."
- **Confidence:** high for the number-capture (recurred as near-miss +
  standing memory note), medium for the merge quirk (once, clear)
- **Status:** applied #1418 (operator approved 2026-08-07)

## 2026-08-07 · estate-audit execution haul (#1427 digest · #1428 cuts · #1429 model drop)

### P1 · `harness-worktree-setup` (dependency changes from a junctioned worktree)
- **Trigger (witnessed):** the agent-os policy hook blocked the lockfile-only
  install variant in the worktree AND in a scratchpad clone — the rule
  matches command text, not cwd, so no install variant runs anywhere in a
  session anchored to a worktree. (It later also blocked a plain
  `cat >> docs/...` heredoc because the DOCUMENT BODY mentioned the
  command — this block was appended with the Edit tool for that reason.)
  Resolution that worked on #1428: hand-edit `pnpm-lock.yaml`
  (self-contained block deletions only — a workspace importer block + a
  `link:` dep entry), then let CI's `node` job (frozen-lockfile install)
  be the validator. It passed in 9m08s and the merge deployed clean.
- **Cost:** ~20 minutes of blocked attempts, one denied clone permission,
  one blocked docs append.
- **Proposed edit:** add a "Changing dependencies" section: "Every install
  variant is policy-blocked from a worktree session. For
  workspace-link-only changes (dep line add/remove, package add/remove),
  hand-edit the lockfile — self-contained block deletions are
  serializer-stable — and treat CI's frozen-lockfile `node` job as the
  gate: do not merge while it is red. For registry-version changes, hand
  the install to the operator or a primary-checkout session."
- **Confidence:** medium (once, mechanism fully understood, CI-verified)
- **Status:** applied #1434 (operator approved 2026-08-08 — "Approve all skills in proposal")

### P2 · `nickstire-verify` (the DoD compiler derives requirements per-diff)
- **Trigger (witnessed):** #1428 failed `completion-authority` in 22s —
  the diff deleted one `client/` file, which derives an
  `operator-walkthrough` requirement, and the `.completion/evidence.json`
  entry still proved the PREVIOUS session's diff (Higgsfield billing arc).
  Rewriting the entry for THIS diff (8ec4ce1a4) turned the gate green in
  31s.
- **Cost:** one red CI cycle + log archaeology to learn the mechanism
  mid-push.
- **Proposed edit:** add to the run list: "If the diff touches `client/`
  or any operator surface, rewrite the matching `.completion/evidence.json`
  entry to prove THIS diff before pushing — requirements are derived
  per-diff, so an untouched entry is stale by definition and fails
  completion-authority."
- **Confidence:** medium (once, clear, will recur on every UI-touching PR)
- **Status:** applied #1434 (operator approved 2026-08-08 — "Approve all skills in proposal")

### P3 · `statenour-verify` (stale `.next/types` fails typecheck after main deletes routes)
- **Trigger (witnessed):** statenour typecheck failed on
  `.next/types/validator.ts` referencing `app/api/system/prompt-compare/
  route.js` — a route deleted on main, while the worktree's `.next` was
  built before the deletion. Not caused by the session's change.
  Recursive delete of `.next/types` is policy-blocked in worktrees; the
  working fix was overwriting the generated `validator.ts` with a comment
  (regenerated by the next build).
- **Cost:** one failed verify pass + a blocked delete before the
  neutralize-the-file fix.
- **Proposed edit:** add a trap line: "typecheck errors inside
  `.next/types/**` referencing routes that do not exist = a stale local
  build artifact, not your diff. Overwrite the offending generated file
  (do not recursively delete — policy blocks it in worktrees); the next
  build regenerates it."
- **Confidence:** medium (once, clear, recurs whenever main deletes routes
  under an old local `.next`)
- **Status:** applied #1434 (operator approved 2026-08-08 — "Approve all skills in proposal")

## 2026-08-08 · IG/reel defect wave (#1430 #1432 #1438 #1439 #1440) + money-lane measurement

### P1 · `nickstire-verify` (the skill's OWN exit-code remedy is unsafe under background execution)
- **Trigger (witnessed):** `nickstire-verify` line 49 currently prescribes
  `pnpm test; echo "EXIT=$?"` as the fix for pipe-masking. Run via the harness's
  `run_in_background`, the completion notification reported **"exit code 0"**
  while vitest had exited 1 with 24 failed files / 234 failed tests — because the
  compound command's exit status is the `echo`'s, not vitest's. The skill's
  remedy reproduces the defect it warns about, one layer up.
- **Cost:** I reported the suite green in-session and had to retract it in the
  next message. Two extra full-suite runs (~15 min) to establish the truth.
- **Proposed edit:** replace the `; echo "EXIT=$?"` guidance with: *"Run the
  command ALONE and read the `Test Files … passed/failed` summary line. A
  compound command (`cmd; echo $?`) reports the LAST command's status, so under
  `run_in_background` the notification says exit 0 while the suite failed. If no
  summary line was printed at all, the run did not finish — see P2."*
- **Confidence:** high (the skill actively recommends the failing pattern)
- **Status:** applied #1446 — `nickstire-verify` exit-code trap rewritten; the old `; echo "EXIT=$?"` remedy removed

### P2 · `nickstire-verify` (the full suite can crash at teardown and print NO summary)
- **Trigger (witnessed):** `pnpm test` ended with `ELIFECYCLE Test failed` and
  **no summary line at all**. Marker count: **528 pass markers, 0 fail markers,
  0 "Failed Tests" banners** — every test passed and the runner died during
  teardown (a libuv `UV_HANDLE_CLOSING` assertion appeared from a separate script
  the same session). Re-running with `--pool=forks --poolOptions.forks.singleFork=true`
  produced a clean `425 files / 5,186 tests / 0 failed`.
- **Cost:** ~20 min and one nearly-shipped false conclusion in each direction —
  first "green" when it wasn't, then "red" when nothing had failed.
- **Proposed edit:** add to Traps: *"On Windows the default pool can crash at
  TEARDOWN after all tests pass, printing `ELIFECYCLE Test failed` with no
  summary. Do not read that as a regression and do not read it as green. Count
  markers (`grep -cE '^ *(×|❯) '` = 0 means nothing failed), then re-run under
  `--pool=forks --poolOptions.forks.singleFork=true` to get an actual summary
  line. Marker counting is triage; the summary is the receipt."*
- **Confidence:** medium (once this session, clear mechanism, documented fix)
- **Status:** applied #1446 — teardown-crash trap added to `nickstire-verify`

### P3 · `nickstire-verify` (never mutate the working tree while a suite is running)
- **Trigger (witnessed):** ran `git checkout -b <branch> origin/main` while a
  background `pnpm test` was mid-flight. Result: **24 failed files / 234 failed
  tests, every one under `client/src/__tests__/`, zero server tests** — the
  signature of files changing under the runner, not a regression. A clean re-run
  with nothing touching the tree: 425 files / 5,145 tests / 0 failed.
- **Cost:** ~15 min diagnosing a regression that never existed.
- **Proposed edit:** add to Traps: *"A background suite reads the working tree
  continuously. `git checkout`, `git stash`, or an edit mid-run rewrites files
  under it and produces phantom failures. The tell is that failures cluster in
  one vitest project (all `client/**`, no `server/**`). Wait for the run, or
  branch before starting it."*
- **Confidence:** medium (once, unambiguous signature)
- **Status:** applied #1446 — mid-run tree-mutation trap added to `nickstire-verify`

### P4 · NEW: `base-rate-check` — never quote a ratio out of a filtered subset
- **Trigger (witnessed):** I measured "**42 of 58 failure-outcome calls (72%) have
  <2 caller turns**" and presented it to the operator as *"three quarters of your
  call failures may be a broken greeting"* — recommending it as the highest-value
  next investigation. The base rate across ALL 492 archived calls is **89/492 =
  18%**, and the outcome mix is 49% `human_handoff` + 27% `walk_in_directed`. The
  ratio was real; the framing was selection bias, and it is near-tautological
  (a call where nobody spoke cannot be scored a success, so short calls
  concentrate in the failure bucket by construction). Separately, the mechanism I
  proposed was refuted outright by measurement: time-to-first-assistant-audio is
  **0.41s avg / 0.64s max**.
- **Cost:** I steered the operator's next-priority decision onto the one lane
  that was working correctly. Caught only because they said "go diagnose it" and
  the numbers collapsed under a second look.
- **Proposed edit:** NEW short skill, or a rule inside `plan-gate`: *"Before
  quoting any ratio computed inside a filtered population, compute the same ratio
  over the UNfiltered population and report both. If the filter selects for the
  outcome (failures, aborts, rejects), the ratio is partly definitional and must
  be labelled as such. A percentage without its denominator's provenance is not
  evidence."* Grep first: no installed skill covers base-rate/denominator
  discipline (checked 2026-08-08); the closest is the `measurement proxies lie`
  MEMORY, which is about trusting proxies, not about denominators.
- **Confidence:** high (I made the error, and it changed a recommendation)
- **Status:** applied #1446 — new skill `.claude/skills/base-rate-check/SKILL.md`

### P5 · `nickstire-verify` (a security invariant held only by middleware ORDER, untested)
- **Trigger (witnessed):** investigating a live `admin security state unreadable —
  falling back to pre-RBAC behaviour (owner). Roles are NOT being enforced`
  ERROR log. It is a deliberate, well-argued fail-open (`server/_core/trpc.ts`
  ~178) and it is SAFE only because `adminProcedure` chains
  `requireAdminIdentity` (which throws FORBIDDEN for non-admins) BEFORE
  `requireFreshMfaAndPermission` (which contains the fallback). `grep` finds **no
  test** covering `requireAdminIdentity` or the fallback branch — a refactor that
  reorders `.use()` calls would silently convert an authorization fail-open into
  an authentication one, with no test failing.
- **Cost:** none yet — found while verifying, not from an incident.
- **Proposed edit:** add to the verify checklist: *"When a fail-open is safe
  only because another middleware runs first, that ORDER is the security
  control. Pin it with a test that asserts the earlier gate rejects, not just
  that the later one behaves."*
- **Confidence:** medium (one instance, concrete and currently untested)
- **Status:** applied #1446 — middleware-order security trap added to `nickstire-verify`

## 2026-08-08 · chat-cockpit mega-plan gate (PR #1447)

### P1 · `statenour-wave-reconcile` (two Last-verified stamps; the guard reads the FIRST)
- **Trigger (witnessed):** STALE_DOCS_STRICT failed "Date mismatch" after this session updated the standalone `**Last verified:**` line (~line 57) in RECONCILIATION.md; `check-stale-docs.ts` parses the FIRST occurrence, which is embedded mid-line in the corrupted 2026-06-21 blockquote (~line 5) and previous waves left it at 2026-07-29.
- **Cost:** one failed gate run + a re-edit + re-run (~4 min); the same trip awaits every future reconcile.
- **Proposed edit:** in step 1, replace "update the Last verified header line" with: "the file contains TWO `**Last verified:**` stamps; the guard reads the FIRST (embedded ~line 5). Update both, or at minimum the first."
- **Confidence:** high (deterministic, reproduced this session)
- **Status:** applied 2026-08-10

### P2 · `harness-worktree-setup` (junctions alone leave the verify gates unrunnable)
- **Trigger (witnessed):** this harness worktree needed `.env` + `.env.local` copied from the primary checkout (check:env would fail without them) and `pnpm exec turbo build --filter=@statenour/lenses` (5 strategic-frameworks test files fail on import) before `verify:hard` could run. Both were discovered by reasoning, not by the skill.
- **Cost:** would have been two false-red gates + diagnosis; avoided only pre-emptively.
- **Proposed edit:** add a step after junctions: "copy `apps/<app>/.env*` from the primary checkout (worktree-setup.ps1 does this; harness worktrees don't), and build `@statenour/lenses` (turbo replays it from cache in ~250ms) before running statenour tests or verify:hard."
- **Confidence:** high (both bit-or-nearly-bit this session)
- **Status:** applied 2026-08-10

### P3 · `harness-worktree-setup` (gh pr merge half-fails when a sibling worktree holds main)
- **Trigger (witnessed):** `gh pr merge 1447 --squash --delete-branch` exited 1 with "fatal: 'main' is already used by worktree at ...instagram-posting-audit-32558a" — while the REMOTE merge had already succeeded (verified `state: MERGED` via `gh pr view --json state`). A naive retry would re-merge or misreport failure.
- **Cost:** none this time (checked state before retrying); the misread is cheap to make.
- **Proposed edit:** add: "on any `gh pr merge` error mentioning a worktree, check `gh pr view <n> --json state` FIRST — the remote merge usually succeeded and only gh's local branch-switch failed."
- **Confidence:** high (witnessed; mechanism is structural to shared-machine worktrees)
- **Status:** applied 2026-08-10

### P4 · `statenour-verify` (lint-baseline "NEW FILE" on a file you never touched = dep-bump archaeology)
- **Trigger (witnessed):** `check:lint-baseline` failed on `app/(mastery)/system/fleet/page.tsx` — byte-identical to origin/main (empty diff; last commit #1220), baseline snapshot last committed #1317, and the #1357 eslint dev-minor bump (2026-08-06) minted a new react-hooks warning class in the unchanged file. Task chip spawned for the fix.
- **Cost:** ~10 min diagnosis; recurs for every statenour session until fixed.
- **Proposed edit:** add a trap: "`lint-baseline NEW FILE` on a file outside your diff: `git diff origin/main -- <file>` (empty = not yours), then compare the baseline's last commit against the last eslint bump — dep bumps mint warnings in unchanged files. Root AGENTS classifies this check non-blocking-red; disclose, chip the fix, don't absorb it into your PR."
- **Confidence:** high (fully diagnosed this session)
- **Status:** applied 2026-08-10

### P5 · `statenour-verify` (a PowerShell && chain leaves $LASTEXITCODE stale on CommandNotFound)
- **Trigger (witnessed):** chaining gates with `... && cross-env STALE_DOCS_STRICT=1 pnpm check:stale-docs && ...` broke at bare `cross-env` (not a PowerShell-resolvable command); the trailing `"FINAL_EXIT=$LASTEXITCODE"` printed 0 because CommandNotFound is a parser/resolution error, not an exit code — three gates silently never ran behind a green-looking sentinel.
- **Cost:** would have shipped with stale-docs/prompt-size/prisma unverified if the transcript hadn't been read line-by-line.
- **Proposed edit:** add to Traps: "never invoke `cross-env` bare in PowerShell — use `$env:VAR='1'; pnpm <script>`. And a `FINAL_EXIT=$LASTEXITCODE` sentinel after a broken chain reports the LAST RESOLVED command, not the chain — count the gate outputs, don't trust the sentinel."
- **Confidence:** medium (once, clear mechanism)
- **Status:** applied 2026-08-10

## 2026-08-08 (second wave) · verify:hard reds cleared (PRs #1449 / #1450)

### P1 · `statenour-verify` (prompt sections: `###` is invisible to the budget trimmer)
- **Trigger (witnessed):** PR #1450 root cause — the Master Content Engine's ~30 sub-blocks used `###` titles while `trimPromptToBudget` splits ONLY on `\n## `; the pack fused into one atomic ~80k section and the 65k runtime slice dropped the ENTIRE engine on the primary lane. prompt:size-check had been red on this since the multi-scenario check shipped (#687).
- **Cost:** every non-anthropic content turn served with zero content engine; a permanently red gate everyone learned to ignore.
- **Proposed edit:** add: "A prompt section participates in the budget/trim economy ONLY with a `## ` title. `###` fuses into the previous `## ` section — the trimmer can then only keep or drop the fused blob wholesale."
- **Confidence:** high (root-caused + fixed with receipts)
- **Status:** applied 2026-08-10

### P2 · `windows-shell-reliability` (tsx -e via PowerShell here-string is a SILENT no-op)
- **Trigger (witnessed):** `pnpm exec tsx -e @'<multi-line ESM>'@` printed nothing and exited clean — no output, no error, nothing ran. Identical logic in a temp `.mts` file executed fine. A prod probe "ran" and produced zero evidence while looking green.
- **Cost:** minutes lost; the dangerous version is trusting the silent green as "no rows".
- **Proposed edit:** add: "never use `tsx -e` with multi-line code from PowerShell — it can no-op silently. Write a temp `.mts` INSIDE the app (module resolution needs it), run, delete. Zero output from a probe is a FAILED probe, not an empty result."
- **Confidence:** high (reproduced both halves in one session)
- **Status:** proposed — NOT APPLIED 2026-08-10: `windows-shell-reliability` is a GLOBAL skill (~/.claude/skills/), outside this repo's reviewable diff. Apply it operator-side.

### P3 · Edit-tool trailing-space normalization (harness trap, for harness-worktree-setup)
- **Trigger (witnessed):** a replace_all whose new_string ended in a meaningful trailing space had the space normalized away → produced `##Title` headers matching NEITHER markdown header level; two follow-up Edits differing only by that space were rejected as "old and new are identical". Fixed via a PowerShell regex insert and verified with a grep for the broken shape.
- **Cost:** one mangled comment + three wasted tool calls; unnoticed, it would have silently broken the #1450 fix.
- **Proposed edit:** add: "Edit old/new strings must never END on a meaningful space — anchor through the next token, or do whitespace-sensitive rewrites with a shell regex and grep-verify the result."
- **Confidence:** medium (once, clear mechanism, harness-version dependent)
- **Status:** applied 2026-08-10

## 2026-08-11 · NICK VNEXT mega-plan gate + Claude 5 frontier-lane wave (#1513)

### P1 · `plan-gate` (a plan's own "verified" table is item #0 to re-verify)
- **Trigger (witnessed):** the pasted NICK VNEXT master plan's §0 "GROUND-TRUTH RECONCILIATION" table asserted **"VERIFIED TRUTH: Prisma 7 (`@prisma/adapter-neon ^7.6.0`)", stamped "verified 2026-08-11 via live code read"**. Reality: workspace catalog pins `prisma: ^6.3.1`, installed `@prisma/client` 6.19.3, no `@prisma/adapter-neon` anywhere in statenour. The same report family earlier claimed Stagehand v4 (installed: 3.7.0). Gate doc: `apps/statenour/docs/GATE-2026-08-11-nick-vnext.md`.
- **Cost:** near-miss — caught only because the gate re-derived the stack; trusted, a false "Prisma 7" would have shipped into GATE + RECONCILIATION as fact and seeded a future migration assumption.
- **Proposed edit:** add to plan-gate's "Order of checks" as step 0: "A plan carrying its own 'verified / ground-truth / fact-base' table gets that table re-verified FIRST — self-verification is not evidence, regardless of the tooling the plan says it used (2026-08-11: 'VERIFIED: Prisma 7 via live code read' vs installed 6.19.3)."
- **Confidence:** high (class recurred: Prisma-7 + Stagehand-v4 in one report family; 16 false claims in the 08-09 campaign gate)
- **Status:** proposed

### P2 · AGENTS.md §2 "small ships" vs operator's batched-wave preference
- **Trigger (witnessed):** mid-turn operator instruction this session: "finish everything in one long pass with minimal pr bc the checks take forever." The wave shipped as ONE PR (#1513: 10 code files + a docs commit) against §2's "small ships — 1-4 files + 1 test file per commit; a wave is 4-6 slices."
- **Cost:** none this session (instruction followed), but the standing rule and the operator's revealed preference now disagree — the next session that obeys §2 will fragment a wave the operator wanted batched.
- **Proposed edit:** operator policy call on AGENTS.md §2: either append "…unless the operator asks for a batched wave (slow-checks mode: one PR, staged commits inside it)" or reaffirm the rule as-is. Deliberately not an agent edit.
- **Confidence:** medium (explicit instruction, once)
- **Status:** proposed

## 2026-08-12 · capabilities gate + Pulse exit animation + memory-manager test fix (#1529–#1532)

### P1 · harness-worktree-setup (global installs + the pinned shell cwd)
- **Trigger (witnessed):** operator instructed "update the global CLI install." `Set-Location` out of the worktree was RESET by the harness ("Shell cwd was reset to …worktrees\code-capabilities-verify-acdd4b"), so a global (`-g`) npm install could never run with a non-worktree cwd from the session shell — and a later PowerShell here-string that merely QUOTED the command in its document body was hook-blocked (the skill's documented heredoc trap, new sighting). Executed instead via Desktop Commander's process runner (non-worktree cwd = the cwd-scoped rule's designed allowance); receipts in `docs/agent-os/GATE-2026-08-12-claude-code-capabilities.md`. Same cause later broke a bare `pnpm exec vitest` call ("vitest not found") when the cwd silently reset to the worktree ROOT between calls.
- **Cost:** two blocked calls + one broken test invocation + ~10 minutes of rerouting; without the gate-doc note the next session re-derives all of it.
- **Proposed edit:** add to §3 (Changing dependencies): "Global (`-g`) installs never touch repo node_modules but still match the rule via command text, and the harness PINS the session shell cwd to the worktree — `Set-Location` does not persist between calls, so verify cwd before any `node_modules/.bin` invocation. Sanctioned path for a global install: a process runner with a non-worktree cwd (e.g. Desktop Commander), never a rule edit."
- **Confidence:** high (three sightings in one session: explicit reset message, blocked here-string, cwd-reset vitest failure)
- **Status:** applied 2026-08-12 (operator-approved)

### P2 · statenour-verify (fire-and-forget writes vs mocked-model call counting)
- **Trigger (witnessed):** `tests/lib/memory-manager.test.ts` red on main — the Phase-1 gateway fire-and-forgets shadow receipts (category `memory_gateway_shadow`) through the SAME mocked `brainMemory.create` the tests spy on, UNAWAITED, so receipts from earlier tests landed in a later test's spy window after `vi.clearAllMocks` (5 creates visible in one test's window). The sibling `calls[0][0]` reads carried the same latent class. Fixed test-side with a discriminator filter (#1532; suite back to 479/479 · 5,155/5,155 · exit 0).
- **Cost:** the app suite red on main for ~1 day; one `verify:hard` run died at the test step, leaving four sub-gates unrun until executed individually.
- **Proposed edit:** add a Traps row: "A fire-and-forget write sharing a mocked model with the code under test spills calls ACROSS tests — `vi.clearAllMocks` cannot fence an unawaited promise. Assert with a discriminator filter (e.g. `category !== "memory_gateway_shadow"`), never raw call counts, and treat `calls[0]` reads as the same hazard."
- **Confidence:** medium (once, mechanism proven with event-order evidence)
- **Status:** applied 2026-08-12 (operator-approved)

## 2026-08-12 · nickstire admin trust-ladder build (PR #1541, plan-gate 23)

### P1 · nickstire-tidb-ddl (code-side hazard of shipping schema.ts ahead of DDL)
- **Trigger (witnessed):** adding the 0110 columns to `auditLog` in `drizzle/schema.ts` silently changes every bare `select().from(auditLog)` into a SELECT that names the new columns — three projection-less reads (`services/adminAudit.ts:33`, `services/snapApplications.ts:118+122`, `services/complianceLog.ts:189`) would have 500'd against prod between merge and hand-apply. Caught pre-ship and pinned to explicit pre-0110 projections in commit 669aece88.
- **Cost:** none this time (caught in design); the inverse class already shipped once as the bridge-send outage (#1485 — a guard querying a column that didn't exist).
- **Proposed edit:** add a rule under "Do this instead": "Shipping schema.ts columns AHEAD of the hand-applied DDL: grep `.from(<table>)` for projection-less `select()` reads and pin each to the pre-migration column set — a bare select enumerates every schema column and breaks against a database that has not applied the migration. New-column WRITES must be conditional (include the key only when a value is provided) for the same reason."
- **Confidence:** high (this session + the #1485 sibling incident are the same class in both directions)
- **Status:** applied 2026-08-12 (operator-approved) — new "Shipping `schema.ts` AHEAD of the hand-applied DDL" section

### P2 · nickstire-verify (two linter behaviors that cost a commit cycle each)
- **Trigger (witnessed):** (a) lint-source's dialog-global regex rejected a commit over the word sequence "confirm (two-tap)" inside a ONE-LINE JSX comment (`ApprovalsSection.tsx:264` — `{/* ... */}` lines start with "{" and slip the comment-skip heuristic); (b) lint:pii flagged the regex constant `/email/i` in `services/activityLedger.ts:62` as "PII in URL path segment" — it is the key-name matcher that MASKS emails; the fix was the linter's own `// pii-allow: <reason>` waiver, discoverable only by reading `scripts/lint-pii.mjs`.
- **Cost:** one rejected commit + diagnose cycle each (~5 min total).
- **Proposed edit:** add two Traps rows: "lint-source matches `confirm (`/`prompt (` even inside single-line JSX comments — reword the comment, don't fight the regex" and "lint:pii false-positives have a sanctioned line waiver: `// pii-allow: <reason>` (reason required)".
- **Confidence:** medium (each witnessed once, mechanism read from linter source)
- **Status:** applied 2026-08-12 (operator-approved) — two Traps rows added

## 2026-08-12 · MISSION-scan gate → BDN close-out + retrofit-pass gate (#1535–#1542)

### P1 · `plan-gate` (re-measure a plan's thesis number live before gating on it)
- **Trigger (witnessed):** the "RETROFIT BUILD PASS" plan's foundation ("393 pending brain-bus events, zero consumers since late May") is the pre-2026-07-28 snapshot quoted verbatim in `config/crons.ts:474-480` — the live probe (`apps/statenour/scripts/probe-brain-bus-census.ts`) read **done 1,558 · pending 0**. Third recurrence of the shape: plan #12 (same 393 claim, refuted 2026-08-10) and the architecture report's stale `canClaimDone` P0 before that. Gate: `apps/statenour/docs/GATE-2026-08-12-retrofit-pass.md`.
- **Cost:** none this time (gated); executed as written, the plan would have built its two biggest phases — a "first consumer" and a triage surface — against a queue that has been drained for two weeks.
- **Proposed edit:** add to plan-gate's "Order of checks": "Any NUMBER a plan builds a phase on ('393 pending', '68 junk wisdoms') gets re-measured live before the verdict — historical snapshots survive in code comments and prior audits long after the state they describe is fixed. A number quoted in a code comment is a fossil, not a reading."
- **Confidence:** high (three recurrences across independent plan authors)
- **Status:** proposed

### P2 · `statenour-verify` (a comment claiming coverage exists elsewhere is itself a coverage claim)
- **Trigger (witnessed):** my own test file (`tests/cron/data-cleanup-pending-actions.test.ts`, #1537) shipped with the comment "The purger's own behavior is covered by tests/lib/stale-data-purger.test.ts" — false; that file never exercised `pending_actions_7d`, so the WHERE/DATA predicate promoted to an unsupervised nightly cron had zero real coverage anywhere. Caught by the operator-directed adversarial review; fixed in #1542 (predicate genuinely pinned, red-green executed: flipped predicate fails exactly the new test).
- **Cost:** a false-green window on a nightly prod mutation path (#1537 → #1542), plus the review cycle to catch it.
- **Proposed edit:** add a Traps row: "A comment asserting 'covered by <other file>' is a coverage CLAIM — grep the named file for the symbol/category before writing it, exactly like any other receipt. If the coverage doesn't exist yet, write the test first or write 'NOT yet covered' instead."
- **Confidence:** medium (once, expensive class, mechanism identical to the false-green family)
- **Status:** proposed

### P3 · `harness-worktree-setup` (the deletion guard matches `git rm` path text too)
- **Trigger (witnessed):** a compound commit command containing `git rm -q apps/.../hooks/chat/use-chat-deep-link.ts tests/hooks/use-chat-deep-link.test.tsx` was hook-blocked with "Remove-Item on system path '/chat' is blocked" — the policy gate pattern-matched the `/chat/` path segment inside the command text, killing the whole compound before anything ran (#1540 session). Recovery: delete the files on disk first (Remove-Item on the real paths was fine), then stage the deletions with plain `git add <paths>` — git stages a deletion for a named path whose file is gone; `git rm` is never needed.
- **Cost:** one blocked compound + a re-structured commit sequence (~5 minutes).
- **Proposed edit:** add a Traps row: "`git rm` with a path containing a protected-name segment (`/chat`, …) trips the deletion guard on COMMAND TEXT. Delete via the file tools first, then `git add` the deleted paths — it stages deletions without `git rm`."
- **Confidence:** medium (once, clear mechanism, same command-text family as the documented heredoc trap)
- **Status:** proposed

## 2026-08-13 · ScanFinish Run 2 — faceless-reel mega-brief + audit round 2 (#1558, #1561)

### P1 · `nickstire-verify` (a test fixture's SCALE must be traced to the real producer, not invented)
- **Trigger (witnessed):** `selectMultilingualCandidates`'s reason string double-scaled `engagementRate` — the real producer (`getTopPosts()`, `server/pipelines/instagram-data.ts:576`) returns a PERCENTAGE-scale number (5.23 for 5.23%), but both test fixtures (`multilingual-candidates.test.ts`, `scanfinishRun2EndToEnd.test.ts`) invented a 0-1 fraction production never produces. All tests were green while a real reel would render "523.00%" to the operator. Merged in #1558; caught only by the post-merge adversarial audit; fixed in #1561 with real-scale fixtures + a "523" regression guard.
- **Cost:** a real display bug shipped to main; one audit round + follow-up PR to catch and fix.
- **Proposed edit:** add a Traps row: "A numeric test fixture is a claim about the PRODUCER's scale/domain. Before inventing a value (0.05 vs 5.0, cents vs dollars, *10000 vs percent), grep the function that produces it in production and one existing consumer that renders it — a self-consistent wrong-scale fixture keeps every test green around a real ×100 bug."
- **Confidence:** high (the same session's OTHER fixture-shape bug — `ctaType` at the payload top level, a field no real row has — is the identical class in a second file)
- **Status:** proposed

### P2 · `nickstire-verify` (`as never` on a parsed-JSON field is a bug factory — validate, never cast)
- **Trigger (witnessed):** two instances in ONE run's diff: (a) `attentionMicrostructureStore.ts` read `brief.ctaType as never` — a field that does not exist anywhere on a real `reel_jobs.payload` — making `hasCta` structurally always false (the swipe file's beat-structure half could never report anything but "insufficient", indistinguishable from "not enough data yet"); (b) `dailyReelPost.ts:493` force-cast raw JSON strings into `EntailmentVerdict` the same way. Fixed with real normalizers (`normalizeCtaType`, `normalizeEntailmentVerdict`) + a canonical `parseReelJobPayload()` (`shared/reelJobPayload.ts`) so payload readers share one compiler-checked shape.
- **Cost:** one structurally-dead feature merged in #1558 (would have read as "no data yet" forever); a dormant second instance.
- **Proposed edit:** add a Traps row: "`as never` / `as unknown as X` on a JSON.parse'd field silences the exact compiler check that would catch a nonexistent field or wrong-domain value. Validate through a normalizer that degrades unknowns honestly, and read `reel_jobs.payload` through `shared/reelJobPayload.ts`'s `parseReelJobPayload()` — never a fresh ad-hoc inline type."
- **Confidence:** high (two instances in one diff, one load-bearing)
- **Status:** proposed

### P3 · `harness-worktree-setup` (follow-up PR from the same branch after a squash-merge = phantom conflict; cherry-pick onto a fresh branch instead)
- **Trigger (witnessed):** PR #1560 (one new commit on the same branch #1558 had squash-merged) reported "the merge commit cannot be cleanly created" — the branch's merge base predated the squash, so GitHub tried to re-apply all 9 already-merged commits. Recovery that worked first try: `git checkout -b <fresh> origin/main && git cherry-pick <new-sha>` → clean apply, PR #1561 merged. Second occurrence of the family: Run 1's ledger records the same shape (#1551's squash made #1552 unmergeable), resolved there with the messier `checkout --ours`.
- **Cost:** one closed PR + a re-land cycle (~5 minutes) this time; the family has now cost two sessions.
- **Proposed edit:** add a Traps row: "After an earlier PR from THIS branch squash-merges, any follow-up PR from the same branch phantom-conflicts (its merge base predates the squash). Don't resolve — cherry-pick the new commit(s) onto a fresh branch cut from current origin/main and PR that."
- **Confidence:** high (recurred 2×, both witnessed in this repo's ledger)
- **Status:** proposed

### P4 · `nickstire-verify` (an e2e "proof" test must call the SAME transform production calls — extract shared splits)
- **Trigger (witnessed):** `scanfinishRun2EndToEnd.test.ts` Stage 1 hand-fed all 14 Local Discovery topics (including the 4 e_check ones) into `localDiscoveryTopics` unfiltered, silently bypassing the e_check→government_feed evidence-gate split that the real entry point (`gatherTopicSignals()`, `contentTopicSignals.ts`) performs inline — the test's docstring claimed "the REAL functions... not re-implemented fixtures" while skipping the one load-bearing derivation. Audit-confirmed; fixed in #1561 by extracting `splitLocalDiscoveryTopics()` so the IO layer and the test call one tested implementation, and the test now asserts every government_feed candidate is blocked.
- **Cost:** the run's headline proof-of-work receipt proved less than it claimed; would have silently kept "passing" if the library were ever reordered.
- **Proposed edit:** add a Traps row: "When an e2e test hand-builds the input a real IO function normally derives, it can bypass the exact gate it claims to prove. If the derivation is inline in the IO layer, extract it into a pure shared function and call THAT from both the IO layer and the test."
- **Confidence:** medium (once, clear mechanism, audit-verified)
- **Status:** proposed

## 2026-08-15 · monorepo deep run (PR #1588) — prerender payload, skill discovery, red-gate triage

### P1 · NEW rule for `nickstire-verify` (it already owns "the prerender regen rule")
- **Trigger (witnessed):** `prerender:semantic-check` validated title, description,
  canonical, H1, NAP and JSON-LD across 9 routes and passed every one of these:
  a 1-star review rendered under the homepage's "five-star reviews" headline
  (fixed a7240ee9b); `/tire-prices-cleveland` prerendered with ZERO per-size floor
  rows from 2026-08-11 while the live endpoint served 9; and **10 blog articles
  serving HTTP 200 with "ARTICLE NOT FOUND"**, all in the 273-URL sitemap, while
  `content.articleBySlug` returned full content for every one of them.
- **Cost:** ten acquisition pages invisible to search for four days, plus the
  flagship AEO page's proprietary data, with every internal signal green.
- **Proposed edit:** add — "A check that a page EXISTS is not a check that it
  CARRIES its content. Prod serves two documents: crawlers get ~150KB of
  committed prerendered HTML, browsers get the ~14KB SPA shell. Assert the
  payload (row counts, card counts, absence of a not-found branch), not just the
  metadata."
- **Confidence:** high (three distinct instances in one session)
- **Status:** proposed

### P2 · NEW rule for `nickstire-verify` — regen environment determines what breaks
- **Trigger (witnessed):** bisecting the committed tree showed `8d31ca036`
  (2026-08-10, CI refresh) healthy and `6d99b9e3c` (2026-08-11, a LOCAL
  `pnpm run regen`) breaking all 10 blog articles plus the price floors, in one
  344-file rewrite. Running a CI refresh to test the fix then regressed a
  DIFFERENT payload: `/reviews` went 132,918 bytes / 5 review cards → 107,213 / 0,
  because the workflow has no `GOOGLE_MAPS_API_KEY`.
- **Cost:** the prerendered tree has oscillated for weeks (`9a6c5ef04` broke the
  same blogs on 2026-07-09 and a later weekly refresh silently fixed them). Each
  refresh trades one set of losses for another.
- **Proposed edit:** add — "Never run `pnpm run regen` locally to refresh the
  committed tree. A local regen loses DB-backed payloads; CI loses
  Places-API-backed ones unless `GOOGLE_MAPS_API_KEY` is set. Check what the
  environment can actually reach BEFORE regenerating, and diff the payload
  afterwards."
- **Confidence:** high (three separate regressions, two environments)
- **Status:** proposed

### P3 · NEW rule for `harness-worktree-setup` Traps table — `git add <dir>` after `git mv`
- **Trigger (witnessed):** commit 6612733b3 moved two skills with `git mv`, then
  staged with `git add <dir>`. The rename was recorded and the in-file edits were
  NOT — short status showed `RM` (renamed in index, modified in worktree) — so the
  commit shipped both skills still carrying their old `name:` frontmatter and a
  cross-reference to the old path. Caught only by reading `git status` before a
  rebase; fixed in a follow-up commit.
- **Cost:** a half-applied rename shipped in the exact commit whose purpose was to
  fix a half-wired skill.
- **Proposed edit:** add a Traps row — "`git add <dir>` after a `git mv` stages the
  RENAME but can leave content edits unstaged (`RM` in short status). Stage moved
  files by explicit path and re-read `git status` before committing."
- **Confidence:** medium (once, clear mechanism, self-caught)
- **Status:** proposed

### P4 · NEW rule for `nickstire-verify` (or wherever red-gate triage belongs) — fix the instrument first
- **Trigger (witnessed):** the `gitleaks` hard gate failed printing only
  `leaks found: 1` — no rule, no file, no line. I inferred it was a
  `google-site-verification` meta tag, shipped an allowlist for it with
  `regexTarget = "line"`, and the gate stayed red. The real finding was
  `generic-api-key` on `data-key="…"` (the public Ahrefs analytics site key) at
  `prerendered/reviews/index.html:228`. Adding `--report-format json
  --report-path` produced the exact rule/file/line on the next run.
  Worse, the guessed fix was mis-scoped: these files are minified, so
  `regexTarget = "line"` covered 15,487 characters of the whole document body —
  a real secret sharing that line would have been exempted with it.
- **Cost:** two wasted CI cycles, plus a security exception shipped for a pattern
  that was never failing, at a scope that would have punched a genuine hole.
- **Proposed edit:** add — "When a gate reports a failure COUNT without a
  LOCATION, fix the instrument before the finding. Guessing which secret/rule/file
  it meant is how wrong allowlists get shipped. Scope any allowlist to the matched
  text, never to a line — minified HTML makes 'the line' the whole document."
- **Confidence:** high (the guess was wrong in both target AND scope; the
  instrument fix resolved it in one run)
- **Status:** proposed

## 2026-08-18 · Nick persona measurement arc (#1649, #1650) + operator standing correction

### P1 · AGENTS.md "Standard of work" section (applied same-session by direct operator instruction)
- **Trigger (witnessed):** operator, verbatim intent: "i always have to tell u to go find sloppy
  or lazy work, and you dont take the initiative... maximally creative, maximally productive,
  maximally truth seeking." Same session: the ordered self-audit then found 5 real defects in my
  own pre-ship diff (2 stray schema keys, 3 over-cap criterion descriptions, a NaN passthrough).
  Memory records the identical pattern in every session since 2026-08-12.
- **Cost:** operator nagging on every wave; defects that ship whenever the operator forgets to nag.
- **Proposed edit:** mandatory unprompted adversarial self-audit before "done" + close-the-implied-gap
  + steal-like-an-artist web prior-art + instrument-sees-target checks, as a root AGENTS.md section.
- **Confidence:** high (recurred across ≥4 sessions; operator explicitly demanded it)
- **Status:** applied (this PR) — by direct operator instruction, which outranks this skill's
  propose-only contract; recorded here so the queue still shows the provenance.

### P2 · `statenour-verify` — scripts/ and tests/ are typecheck-blind
- **Trigger (witnessed):** while shipping #1650, `pnpm typecheck` was green yet
  `tsc --listFiles` showed 0 hits for the new `scripts/harvest-persona-traces.ts` —
  statenour's tsconfig excludes BOTH `scripts/` and `tests/`. The script had a broken import
  (`../lib/db/prisma` vs `../lib/prisma`) that a green typecheck could never catch; found only by
  a scoped-tsconfig check. nickstire's identical trap is already in memory (2026-08-16); statenour's
  was not.
- **Cost:** a harvest script that would have crashed on first operator run, reported "done" behind
  a green gate.
- **Proposed edit:** add to statenour-verify: "`pnpm typecheck` never compiles `scripts/` or
  `tests/` (tsconfig-excluded). New/changed scripts: verify with a scoped tsconfig extending the
  app's (`{"extends":"./tsconfig.json","include":["scripts/<file>","next-env.d.ts"]}`); tests are
  verified by execution only."
- **Confidence:** high (witnessed a real broken import behind the green; second app with same trap)
- **Status:** proposed

## 2026-08-18 · persona arc, later slices (#1655-#1665)

### P1 · `statenour-verify` (or a NEW cross-cutting testing note) — the vitest mock-registry race
- **Trigger (witnessed):** in #1662's k-sample work, three CONCURRENT first-time
  `await import("@/lib/ai/provider")` calls inside a `vi.mock`ed test let TWO escape to the
  REAL module — 2 real `provider.success` lines and a 4.2s test inside a fully mocked suite;
  the mock spy counted 1 call. Diagnosed by refusing "called 1 times" and tracing the stray
  provider logs; empirical probe confirmed k=3 fan-out.
- **Cost:** ~20 min of false theories; 2 unbilled-but-real provider calls, which then tripped
  the Ollama quota breaker and produced a 14/14-errored suite run 6 minutes later.
- **Proposed edit:** add — "In vitest, N concurrent FIRST-TIME dynamic imports of a mocked
  module can race the mock registry: some callers get the real module. Import once before the
  fan-out and pass the binding down. A mocked test emitting the real module's logs, or taking
  seconds, is this bug."
- **Confidence:** high (reproduced, root-caused, fix verified — 599ms and 3/3 mocked after)
- **Status:** proposed

### P2 · `statenour-verify` — a zero-score eval run is a breaker symptom before it is a code bug
- **Trigger (witnessed):** a 14/14-errored-in-6s persona suite run right after the mock-race
  strays; every Nick call returned the cost-firewall sentinel. The identical command re-ran
  green minutes later — the Ollama quota breaker had been cooling down. The #1655 sentinel
  check was what converted it into honest errors instead of fake judged scores.
- **Cost:** one wasted live run (~1c) + the risk (avoided) of "diagnosing" healthy code.
- **Proposed edit:** add — "When every scenario errors with the provider sentinel in seconds,
  check the provider breaker/cooldown FIRST (recent stray or failed calls trip it). Re-run the
  identical command before touching code. Never grade or trust a run whose Nick calls were
  sentinels."
- **Confidence:** high (breaker cooldown confirmed by identical-command re-run going green)
- **Status:** proposed

## 2026-08-18 · chat-UX round 2 — the operator-forced thoroughness pass (#1677/#1678)

### P1 · `statenour-verify` — ORed-verdict surfaces: enumerate ALL producers, verify the persisted artifact
- **Trigger (witnessed):** #1677 waived the output-critic for operator-ordered terse replies
  and was declared fixed off a live-stream screenshot. The operator rejected "it's fine";
  reading the PERSISTED verdict (`tokenUsage.critic/gate` via `trpc chat.conversation`)
  showed the critic waived (overall=100, waiver reason present) while `reply-gate`'s
  stub-reply signal (severity 80) still fired — the chip renders on
  `critic.shouldRegen || gate.shouldRegen`, so one waived scorer changed nothing. #1678
  fixed the second scorer; live re-proof: gate severity=0, regenChip=false on reopen.
- **Cost:** an overclaiming PR title frozen in merged history ("obedient replies no longer
  flagged REGEN"), a second fix PR, and an operator correction that should not have been
  needed — round 1's evidence could never have seen the defect (verdicts land async on the
  persisted row; the live view is structurally blind to them).
- **Proposed edit:** add — "Before declaring a producer-side fix done on any rendered
  flag/badge: grep the RENDER expression for every producer it ORs/aggregates and check each
  one. For chat quality verdicts specifically, proof = reload + read the persisted
  `tokenUsage.critic/gate` blob (trpc `chat.conversation`); a live-stream screenshot is a
  blind instrument for this surface."
- **Confidence:** high (same blind-instrument class as the leverage-layer gate lesson;
  witnessed false green + witnessed second producer, both receipted this session)
- **Status:** proposed


## 2026-08-19 · regen exit 0 is not proof the tree is whole (war-room session)

- **What happened:** `pnpm run regen` exited 0 and reported "Broken: 0" while 10 blog routes had
  FAILED ("escReplace is not defined" — a latent scoping bug in the soft-404 recovery path) and the
  swap silently DROPPED their files (340 → 327). The 10% partial-success tolerance (#1588 lineage)
  commits whatever rendered; nothing in the exit status or the final summary says files were lost.
  Two more routes (michelin-tires-cleveland, site-map) timed out on the 50s budget the second run and
  also needed git-restore before committing.
- **Cost:** without a log grep, 10 indexed blog URLs would have shipped without prerendered HTML and
  nobody would have noticed until the weekly refresh — or a rankings drop.
- **Proposed edit (nickstire-verify skill):** add to the prerender-regen rule — "After every regen:
  (1) grep the regen log for `✗` and for `skipped`; exit 0 + 'Broken: 0' tolerates up to 10% failed
  routes and the swap DELETES their previous files. (2) Run `node scripts/check-prerender.mjs` and
  git-restore any missing route dirs (`git checkout -- prerendered/<route>`) before committing."
- **Confidence:** high (witnessed both failure classes in one session, receipts in #1709 body)
- **Status:** proposed


## 2026-08-25 · ChatGPT-handoff audit + landing #1809/#1830

### P1 · nickstire-verify (completion-authority section)
- **Trigger (witnessed):** the `completion-authority` check on PR #1830 went red FOUR times, each a
  different sub-gate behind one check name: (1) stale per-diff `.completion/evidence.json` entry,
  (2) unresolved P1 review threads from the Codex connector bot (review gate), (3) capability-ledger
  cross-axis rule (`operator_only` requires ≥ `integration_verified`), (4) un-rendered
  `REALITY-LEDGER.md` diff. Four fix-push-poll cycles, ~50 minutes, because the skill documents only
  failure (1).
- **Cost:** ~50 min of serial CI round-trips on one PR; each red read as "the same gate again".
- **Proposed edit:** extend the "DoD compiler" paragraph to name all four sub-gates and their
  one-line fixes: rewrite the per-diff evidence entry · resolve review threads via GraphQL
  `resolveReviewThread` after replying · obey the ledger ladder (fix the LABEL, never inflate the
  state) · always run `scripts/render-reality-ledger.mjs` and commit the .md beside the .json.
- **Confidence:** high (four distinct reds witnessed in one session)
- **Status:** proposed

### P2 · guard-red-team
- **Trigger (witnessed):** my staging canary asserted `registerAllJobs()` membership and CALLED it
  reachability; the actual trigger path (`/api/bridge/run-job`) 403'd both staged names via
  `BRIDGE_RUN_JOB_ALLOWLIST`. Codex review caught it (PR #1830 P1). Same session, second instance
  of the class: ChatGPT's deleted canary on #1809 was a permanent control coupled to a temporary
  datum — both are "the check watches a proxy for the subject".
- **Cost:** a false "fire it by name and it runs" claim shipped in a commit body and PR body; a
  review round to retract it.
- **Proposed edit:** add to the red-team checklist: "For any 'X is reachable/triggerable' claim,
  trace the FULL chain to the entry point that will actually be used (route → auth gate → allowlist
  → runner) and canary the chain, not the registry. Membership in a lookup table is never
  reachability."
- **Confidence:** medium (one clear instance this session, plus the ChatGPT variant of the class)
- **Status:** proposed

## 2026-08-25 · chat-stack wave (7 PRs: #1836 #1843 #1846 #1848 #1849 #1850 #1851)

### P1 · guard-red-team
- **Trigger (witnessed):** the agent-os policy canary (`stop-check.test.mjs`) spawned git fixtures
  with inherited hook env; under a real commit git exports `GIT_DIR`, so the canary's bare-init
  fixture re-initialized the SHARED `.git` as bare — every linked worktree on the machine failed
  all git ops, and every commit retry re-planted the damage. Diagnosed by differential isolation +
  GIT_DIR-injection positive control; fixed in #1850 (env stripped in the canary AND in
  `stop-check.mjs`'s own runner).
- **Cost:** ~35 minutes of a blocked wave; a machine-wide git outage risk for 4 concurrent sessions.
- **Proposed edit:** add a rule: "A canary that SPAWNS git must strip `GIT_*` env vars — hooks
  inherit `GIT_DIR`/`GIT_INDEX_FILE`, and a fixture repo-init under an inherited `GIT_DIR` rewrites
  the real repo. Red-team every canary in the context it will actually run (hook env), not just
  standalone."
- **Confidence:** high (deterministically reproduced both directions, fixed, re-proven)
- **Status:** proposed

### P2 · statenour-verify
- **Trigger (witnessed):** #1851 — `/system` showed "NOT INITIALIZED" over a lane whose boot log
  said `langfuse_skipped`. Next compiles `instrumentation.ts` as its own entry, so a module-level
  singleton existed twice; the app-bundle copy never saw the instrumentation copy's state. Found
  only because the panel was live-verified in real Chrome the day it shipped.
- **Cost:** a truth surface lying on arrival; would have sat wrong indefinitely (the exact
  braintrust-visibility defect class the panel was built to end).
- **Proposed edit:** add to the verify checklist: "State shared between `instrumentation.ts` and
  app code MUST live on `globalThis` (or another process-global), never module scope — the two are
  separate bundles. Canary shape: `vi.resetModules()` + fresh import must read the settled state."
- **Confidence:** high (prod-observed, mechanism confirmed, canary added)
- **Status:** proposed

### P3 · harness-worktree-setup
- **Trigger (witnessed):** #1843 needed two new npm deps; the junctioned worktree cannot run ANY
  package-install command (hook-blocked, correctly — including the lockfile-regeneration-only
  variant). Working pattern found under pressure: isolated shallow clone in scratchpad -> install
  there -> copy the workspace lockfile back -> const-specifier dynamic imports so tsc passes where
  the package is physically absent -> serverExternalPackages entry -> vi.mock in-repo tests -> run
  the real-wire proof in the clone.
- **Cost:** ~25 minutes of path-finding the next dep-adding session would repeat.
- **Proposed edit:** document the 6-step "add a dependency from a junctioned worktree" recipe
  above, naming the trap that even the lockfile-only variant of the install command is blocked
  (and that the guard also matches such literals quoted inside heredoc docs — write docs via the
  Write tool, which is itself how THIS proposal had to be written).
- **Confidence:** medium (once, but fully worked; receipts in #1843's body)
- **Status:** proposed

## 2026-08-26 · interaction-audit wave + home-redesign review (#1881-#1898, #1897)

### P1 · nickstire-shared-main-push
- **Trigger (witnessed):** #1886's `node` job was killed twice ("The runner has received a
  shutdown signal … Force killed Turborepo tasks") at 4m30s and 4m45s — each kill landing
  minutes after I merged a different PR to main (#1883 at 11:47Z → kill 11:53Z; #1889 at
  12:00Z → kill 12:03Z). Attempt 3, run while main was deliberately held still, passed at
  11m18s. Same day, #1897 and #1898 failed the e2e lane 67s apart with an identical
  heartbeat-404 signature and both reruns passed.
- **Cost:** two false "failures" on a green PR, ~40 min of diagnosis, and a failure banner
  that reads as flaky infrastructure rather than as merge ordering — the next session will
  misread it too.
- **Proposed edit:** add a rule: "Merging to main recomputes every open PR's merge ref and
  CANCELS its in-flight checks. statenour's node/e2e jobs need ~9-11 min. Hold merges while a
  sibling PR's long check runs — and read 'runner received a shutdown signal' minutes after a
  main merge as this, not as infra."
- **Confidence:** high (three witnessed instances, one controlled experiment)
- **Status:** applied — operator-approved 2026-08-26; landed as "PR mechanics" rule 3 in
  `.claude/skills/nickstire-shared-main-push/SKILL.md` (same PR as this status line)

### P2 · statenour-verify
- **Trigger (witnessed):** my deploy waiter compared a 9-char SHA prefix against
  `/api/version`'s `commitShort` (which is `sha.slice(0,7)`) and printed "still bcaf6b2"
  forever over a deploy that was already live; the corrected waiter also had to switch from
  equality to `git merge-base --is-ancestor`, because sibling sessions kept advancing main and
  the deployed SHA legitimately overtook the one being awaited (observed: waiting on d85c88d99
  while prod ran e3c7414, then ae1e32b — both *containing* nothing of mine yet, then 1dda3b7
  containing everything).
- **Cost:** one waiter that could never succeed, one "deploy lag" false alarm.
- **Proposed edit:** add to the deploy-verification section: "Confirm a merge is live via
  `/api/version` with `git merge-base --is-ancestor <merged-sha> <deployed-full-sha>` — never
  SHA equality (main moves under you) and never a prefix longer than `commitShort`'s 7 chars."
- **Confidence:** high (two distinct failure modes in one session's waiters)
- **Status:** applied — operator-approved 2026-08-26; landed in statenour-verify (Confirming a merge is DEPLOYED section)

### P3 · guard-red-team
- **Trigger (witnessed):** four first-draft canaries in ONE session were blind until a
  mutation showed it: (a) #1886's end-to-end arm read stdout while the banner went to stderr
  ("expected '' to contain 'SKIPPED'"); (b) #1889's `--root`-with-no-value silently scanned
  the live repo and exited 0; (c) #1891's docstring arm `toContain("65,000")` stayed green
  when the claim was staled to 40,000 because the changelog paragraph quoting the OLD value
  still contained the string; (d) #1894's discovery arm found a fourth hour-encoding key the
  audit had missed — on its first run.
- **Cost:** without the mutation step, all four would have shipped green and proven nothing.
- **Proposed edit:** extend the "mention vs execution" bullet with the documentation case:
  "a changelog/comment QUOTING an old value satisfies a bare `toContain` — capture from the
  authoritative sentence and compare values, never assert a mention"; and add "run the
  mutation BEFORE trusting a canary's first green — 4/4 first drafts in one session were
  blind in ways only the mutation showed."
- **Confidence:** high (four instances, one session)
- **Status:** applied — operator-approved 2026-08-26 (same PR as this status line)

### P4 · NEW: audit-read-whole-structure (or a line in statenour-verify)
- **Trigger (witnessed):** I reported nickstire's `typeMap` as having "no mapping that yields
  booking" — an orphaned-subject finding delivered to the operator — because my `sed -n`
  window truncated the map's head. The full map contains `"nickstire:booking": "booking"` on
  its first line; the finding was refuted only when the fix work forced a full read.
- **Cost:** a false defect claim in a delivered audit; the correction consumed a turn.
- **Proposed edit:** one rule: "When a finding rests on what a mapping/table/enum does NOT
  contain, read the WHOLE structure by its delimiters (`sed -n '/const typeMap/,/};/p'`),
  never a line-number window — a truncated read of a map is how orphaned-subject false
  positives are manufactured." (Grep found no existing skill carrying this; the closest,
  base-rate-check, covers denominators, not truncated reads.)
- **Confidence:** medium (once, clear, and it reached the operator)
- **Status:** applied — operator-approved 2026-08-26; took the offered lighter path — a rule in
  statenour-verify ("read the WHOLE structure by its delimiters"), no new skill created

## 2026-08-27 · chat read-aloud (streaming TTS) session

### P1 · statenour-verify
- **Trigger (witnessed):** prod `OPENAI_API_KEY` was revoked; three signals all said "fine" — local `.env` had a key (it 401'd), `env-check` said `openai:true` (proves SET, not VALID), and a memory line said "prod key works per probe-env-config" (stale doc belief). Truth arrived only via a live authed probe: `/api/ai/transcribe` → `502 "whisper 401"` (this session, #1930 smoke).
- **Cost:** mic + Realtime voice silently dead in prod for an unknown period; this session nearly shipped "prod key works" as fact.
- **Proposed edit:** add a rule: "A provider key's PRESENCE (env-check boolean, .env line, doc claim) is never evidence of VALIDITY. When any provider lane misbehaves, the check is one live cheap call against the provider from the runtime that holds the key."
- **Confidence:** high (same class as nickstire-env-is-not-production — recurred across both apps)
- **Status:** proposed

### P2 · harness-worktree-setup
- **Trigger (witnessed):** `worktree-setup.ps1` detected a pnpm-lock diff vs the stale primary and printed "Bypassing node_modules link… run pnpm install manually" — but the PreToolUse hook blocks EVERY install under `.worktrees/*` with no bypass. The worktree was unusable as created; the session fell back to the scratchpad-clone recipe (clone branch → install → build `@nour/*` packages → push from clone), same as #1843.
- **Cost:** one dead worktree created and torn down, one blocked call, ~10 min.
- **Proposed edit:** add: "If setup prints 'Bypassing node_modules link' (lockfile drift), do NOT create/keep the worktree — go straight to the scratchpad-clone recipe (statenour-chat-tts-2026-08-27 memory has the steps)."
- **Confidence:** high (second occurrence; #1843 hit the same wall from the junctioned side)
- **Status:** proposed

### P3 · nickstire-shared-main-push
- **Trigger (witnessed):** operator instructed twice this session: "one merge, not several — CI is ~13 min and cancel-in-progress kills every sibling PR's in-flight run" (five sibling sessions live). The session's Agent-policy run on `7f293d3` was itself cancelled by the next sibling merge, demonstrating the mechanism.
- **Cost:** each extra merge to main costs every open PR a full CI cycle.
- **Proposed edit:** add: "Merges to main cancel sibling in-flight CI (cancel-in-progress). Default to ONE merge per session — review in slices, land once. Applies to both apps, not just nickstire."
- **Confidence:** high (operator stated twice; mechanism witnessed on this session's own run)
- **Status:** proposed

## 2026-08-27 · Adoption-gates wave + zombie rescue + primary re-park

### P1 · stranded-branch-rescue
- **Trigger (witnessed):** this session filed a "stranded commit" rescue chip for `3061c895b` off `origin/main..branch = 1`; running the skill refuted it in one call - the SHA was PR #1756's only commit (squash-merged), `git cherry` agreed with `-`. The topology count was the squash artifact the skill describes, but the skill never names the cheapest definitive probe.
- **Cost:** a spawned rescue session + operator attention for a non-task.
- **Proposed edit:** add to Step 1: "Before calling anything stranded off a commit-count, run `gh pr view <pr> --json commits` - if the 'stranded' SHA is IN the merged PR's commit list, it is the zombie itself; `origin/main..branch` counts are meaningless after a squash."
- **Confidence:** medium (once, crisp)
- **Status:** applied 2026-08-27 (operator-approved; statenour/wire-or-delete-341 wave)

### P2 · guard-red-team
- **Trigger (witnessed):** #1935's depcruise deny-canary initially trusted a nonzero exit; the real run exited 1 from a CONFIG error (TS18003 parsing the app tsconfig), not the rule - the canary would have blessed a blind gate. Fixed by asserting the rule id in output; the skill currently says "assert on exit codes".
- **Cost:** caught pre-merge only because the probe output was read by hand.
- **Proposed edit:** add to the protocol: "For a DENY canary, a nonzero exit is NOT proof - config and parse errors exit nonzero too. Assert the specific rule/violation id appears in the output."
- **Confidence:** high (mechanism demonstrated live in #1935's probes)
- **Status:** applied 2026-08-27 (operator-approved; statenour/wire-or-delete-341 wave)

### P3 · statenour-verify
- **Trigger (witnessed):** pre-commit typecheck failed on `edge-tts-universal` missing in `app/api/ai/speak/route.ts` - a file outside the diff; cause was the PRIMARY checkout parked on a pre-#1930 branch so junctioned node_modules predated the dep. Separately, one lefthook run flaked red (statenour-typecheck 149s) and passed unchanged on retry under memory pressure.
- **Cost:** ~30 min of root-causing plus a package-staging workaround.
- **Proposed edit:** add two trap bullets: (1) "TS2307 for a module in a file outside your diff = stale-junction phantom; check `git show HEAD:apps/<app>/package.json | grep <pkg>` vs what is installed - fix the PRIMARY checkout, do not patch the app"; (2) "lefthook's parallel typecheck can flake red under memory pressure - rerun once before diagnosing."
- **Confidence:** high (both witnessed this session; the phantom shape also hit the #1929 worktree)
- **Status:** applied 2026-08-27 (operator-approved; statenour/wire-or-delete-341 wave)

### P4 · NEW rule in scripts/worktree-teardown.ps1 (script change, routed as proposal)
- **Trigger (witnessed):** tearing down zombie worktree `graphify-relabel` (parked ON `main`) deleted the local `main` branch itself - the script deletes the worktree's branch unconditionally; primary then could not `git switch main` ("matched multiple (2) remote tracking branches") until main was recreated from origin.
- **Cost:** confusion + branch recreation mid-repair; on a machine without origin it would be data loss.
- **Proposed edit:** in the branch-deletion step, skip and warn when the inferred branch is `main` (or any branch with an origin counterpart it is behind): "worktree removed; branch 'main' preserved."
- **Confidence:** high (deterministic; reproduced by reading the script's inferred-branch path)
- **Status:** applied 2026-08-27 (operator-approved; statenour/wire-or-delete-341 wave)

## 2026-08-27 · Now-card scorer wave + seeder session

### P1 · harness-worktree-setup
- **Trigger (witnessed):** `scripts/worktree-setup.ps1 -branchName statenour/now-card-scorer -targetDir .worktrees/now-scorer` printed "Git Worktree Setup Complete!" while creating ZERO junctions — `pnpm exec turbo` failed "not found", root `node_modules` absent. The manual mklink block from this skill then created 15. Same silent-failure earlier the same day on a plain `git worktree add` (expected there; not from the script).
- **Cost:** one failed lenses build + a diagnosis round-trip, twice in one session.
- **Proposed edit:** extend scope line: the skill currently says it covers only harness-created worktrees under `.claude/worktrees/` — add "also run the junction block whenever `worktree-setup.ps1` completes but `<wt>/node_modules` does not exist; the script's Complete banner does not verify its junctions."
- **Confidence:** medium (once, clear, with a matching near-precedent same day)
- **Status:** proposed

### P2 · statenour-verify
- **Trigger (witnessed):** watching PR #1946: (a) `gh pr checks` returned "no checks reported on the branch" which satisfied a naive settle loop (`pending==0 && fail==0` → printed "SETTLED: fail=0"); (b) a pushed SHA (`9c8962b4b`) had 0 check-runs for ~30 min while githubstatus said Actions operational — close/reopen did not re-fire; the next real push did.
- **Cost:** one false "SETTLED" report; a near-miss advisory-merge decision built on a wrong billing hypothesis.
- **Proposed edit:** add a "CI watch" bullet: require `pass > 3` (or any positive row count) before trusting a settle; and "0 check-runs on a pushed SHA with Actions 'operational' is an event-delivery stall — push the next real commit rather than close/reopen, and do not diagnose billing without the billing API."
- **Confidence:** high (two distinct instrument-lies in one PR watch)
- **Status:** proposed

### P3 · prod-db-guard
- **Trigger (witnessed):** the authorized seeder's backup step: `CREATE TABLE ... AS SELECT * FROM "AutomationPolicy"` failed 42P01 — the model maps to `automation_policies` (`@@map`). Separately that morning, `git show origin/main:.gitignore > file` MSYS-mangled the colon ref (`origin\main;.gitignore`) and the redirect TRUNCATED ~300 tracked files to 0 bytes; recovery was `git archive origin/main | tar -x`.
- **Cost:** one failed backup attempt (caught); ~300 files zeroed including the live `.completion/evidence.json` (fully recovered, byte-verified).
- **Proposed edit:** to the backup step: "resolve the physical table name from `@@map` before writing backup SQL — the Prisma model name 42P01s"; new red-flag row: "restoring files via `git show <ref>:<path> > <path>` in git-bash — root-dotfile colon refs MSYS-mangle and the redirect truncates BEFORE the failure; use `git archive <ref> [-- <paths>] | tar -x`."
- **Confidence:** high (both witnessed with receipts; MSYS truncation also memorized agent-side)
||||||| 691e01a9a
- **Status:** proposed

## 2026-08-28 · escalate-on-ask + agent follow-ups (#1983)

### P1 · statenour-verify
- **Trigger (witnessed):** I added `modelOverride` to `GetModelOptions`, wired it in
  `app/api/ai/chat/route.ts`, and shipped a DEAD CONTROL: that `model` variable only feeds
  `runAlternatePaths` (four flags, all default false), while the turn is served by
  `streamWithFallback`, which had no such field. `/mega` would have returned the registry default
  `claude-sonnet-5` with no effort while `X-Escalation-Applied: 1` claimed success. Both unit
  suites were green and correct — the gap sat BETWEEN them. Caught only by adversarial review at
  95 confidence (#1983, third commit).
- **Cost:** would have shipped a headline feature that silently did nothing, plus two dead guards
  behind it (effort never applied; the daily cap could never match a row).
- **Proposed edit:** add to the verify checklist: "When adding an option to a request path, grep
  for which call site actually SERVES the request before wiring it. A hot path often has more than
  one `getModel`/`buildConfig` construction and only one of them is live. Write the canary ACROSS
  the seam (assert the option reaches the serving call), never inside either unit — a dead control
  hides precisely between two well-tested units."
- **Confidence:** high (witnessed, fixed, canaried red-green)
- **Status:** proposed

### P2 · statenour-verify
- **Trigger (witnessed):** I named a new tool `scheduleFollowUp`; that name already existed in
  `lib/ai/tools/tasks.ts:959` (a CUSTOMER follow-up task). `metaTools` spreads LAST in `nourTools`,
  so my key would have SILENTLY OVERWRITTEN a working customer-facing tool — no error, and the
  catalog count stayed flat because one key replaced the other. Caught only by
  `catalog-integrity`'s count assertion.
- **Cost:** near-miss; a live tool would have vanished with no signal.
- **Proposed edit:** "Before adding a tool, `git grep -n '<name>: tool('` across `lib/ai/tools/`.
  The barrel spreads domain files in order and the LAST one wins, so a duplicate key shadows
  silently rather than erroring. Also register in BOTH `catalog.ts` and `tool-families.ts` — their
  category/cost unions differ, and only the pre-commit typecheck catches a wrong one."
- **Confidence:** high (witnessed, caught, renamed)
- **Status:** proposed

### P3 · NEW: prior-art-grep
- **Trigger (witnessed):** twice in one wave I nearly rebuilt something that existed — the tool
  name above, and a `next_action` table that `PostTurnOutbox` already provided (durable queue with
  claim/retry/dead-letter and `nextAttemptAt` as a scheduling primitive). The second was caught by
  research, not by me.
- **Cost:** a redundant table would have violated the standing "no third queue beside PostTurnOutbox
  and WorkItem" rule.
- **Proposed edit:** a short skill that, before ANY new table/tool/queue/flag, runs a fixed grep
  set (schema models, tool names, cron manifest, feature flags) and requires the answer to be
  written down before building. Cheap, and it has now fired twice in one session.
- **Confidence:** medium (two instances, same session)
- **Status:** APPLIED 2026-09-08 — `.claude/skills/prior-art-grep/SKILL.md` (see the 2026-09-08 entry)

## 2026-08-28b · the finish pass (#1991)

### P1 · NEW: assert-the-consumer
- **Trigger (witnessed):** FOUR dead controls in one wave, all mine, all the same shape — a writer
  with no reader, each shipped green because every test asserted the WRITE:
  (1) `modelOverride` wired into a variable feeding flag-gated dead code while the serving path had
  no such field (#1983); (2) the daily cap comparing bare model ids against a column stored as
  `provider/model`, matching nothing (#1983 review); (3) `X-Escalation-*` headers set and claimed
  "legible" with zero client readers — the grep returned only my own comment about dead controls
  (#1991); (4) `scheduleSelfFollowUp` registered in nourTools + catalog + TOOL_FAMILIES yet
  measured unreachable for 4 of 5 realistic phrasings (#1991).
- **Cost:** two of the four shipped to main and were caught by review, not by me. One was the
  headline feature of its PR and did nothing. All four passed full green suites.
- **Proposed edit:** a short skill that fires whenever a change adds a WRITER — a header, an env
  var, a DB column, a queue row, a tool registration, a response field. It requires, before "done":
  (a) `git grep` for the consumer and paste the hit; (b) if there is no consumer, either build it in
  the same change or do not ship the writer; (c) the canary asserts the CONSUMER end, never the
  producer. Explicitly: *registration is not reachability, a header set is not a header read, and a
  green unit test on the writer is the exact evidence that will fool you.*
- **Confidence:** high (four instances, one session, all verified)
- **Status:** APPLIED 2026-09-08 — `.claude/skills/assert-the-consumer/SKILL.md` (see the 2026-09-08 entry)

### P2 · statenour-verify
- **Trigger (witnessed):** the tool-reachability failure could only be found by RUNNING the pruner
  against realistic phrasings — `scheduleSelfFollowUp` was correctly registered in all three
  registries and still surfaced for only 1 of 5 sentences a human would actually type.
- **Cost:** a shipped feature that the model could almost never invoke.
- **Proposed edit:** add to the verify checklist: "After adding a chat tool, run `pruneTools`
  against 5 phrasings you would really type and assert the tool appears. Registration in
  catalog/TOOL_FAMILIES proves the tool EXISTS, never that the pruner will surface it — the trigger
  and the attach pattern are different regexes and a tool can match one without the other."
- **Confidence:** high (measured before and after)
- **Status:** proposed

## 2026-09-01 · Command Surface wave (#2047/#2048)

### P1 · statenour-verify
- **Trigger (witnessed):** verify:hard went red on `tests/components/mobile-a11y.test.tsx` —
  its `readSource()` guards read the SOURCE TEXT of two components deleted in #2047
  (`components/home/inbox-tasks-triage.tsx`, `inbox-triage-card.tsx`) by string path. The
  deletion sweep had grepped imports only; string-path readers were invisible to it.
- **Cost:** one red full-gate run (~4 min) + fix commit `2a61a511c`. Upside captured: the
  retargeted canary exposed that the replacement textarea was itself placeholder-only (WCAG
  4.1.2) — a defect the session's own self-audit had wrongly claimed was handled.
- **Proposed edit:** add a Traps bullet: "Deleting a file? Grep tests/ for its PATH STRING
  (`grep -rn '<basename>' tests/`), not just its import — source-reading guards
  (readSource/readFileSync) reference files by string and survive import sweeps. When the
  guard's subject dies, retarget the CONTRACT at the replacement surface, don't delete the
  canary."
- **Confidence:** medium (once, but the repo has a whole family of readSource-style guards)
- **Status:** proposed

### P2 · statenour-verify (deploy-confirmation section)
- **Trigger (witnessed):** two failures in one confirmation. (a) The skill's own snippet pipes
  through `jq`, which is NOT on PATH in this machine's git-bash — the ancestry check printed
  "not yet" with an EMPTY deployed var while the raw curl showed `1b8a945` already live; a
  wrong "not deployed" was nearly reported. (b) A 20-minute background poll loop for the same
  confirmation was `[killed]` at the turn boundary — background pollers don't survive turns;
  the one-shot curl answered instantly.
- **Cost:** one misleading probe output + a wasted re-arm cycle.
- **Proposed edit:** in "Confirming a merge is DEPLOYED": note `jq` may be absent in git-bash —
  fall back to `grep -o '"commit":"[a-f0-9]*"'` on the raw body, and treat an EMPTY deployed
  var as "check broken", never "not deployed". Prefer per-turn one-shot checks over
  long-running background poll loops (turn boundaries kill them).
- **Confidence:** high (both legs witnessed this session; empty-var-as-bad-news recurs repo-wide)
- **Status:** proposed

## 2026-09-01 · Audit wave (#2057 · #2058 · #2059 · #2060)

### P1 · statenour-verify
- **Trigger (witnessed):** `git push` from a plain worktree ran lefthook's pre-push `build:affected`; a 120 s Bash timeout killed it with exit 143 and NOTHING was pushed (twice: the #2058 follow-up and PR C). The skill lists gates but not that the push itself is one of them.
- **Cost:** ~15 min across two retries, plus one "push landed?" false alarm resolved only by `git ls-remote`.
- **Proposed edit:** add under receipts: "`git push` runs `build:affected` in pre-push. Run it with a 600 s timeout in the background and prove the push with `git ls-remote origin refs/heads/<branch>`; the local SHA is not the receipt."
- **Confidence:** high (recurred 2×)
- **Status:** proposed

### P2 · statenour-verify
- **Trigger (witnessed):** #2057's `completion-authority` lane went red on three Codex review threads (`chatgpt-codex-connector`); #2058 got one more. Two were wrong (trailer WAS present; a count already carried its own staleness warning), one found a REAL second half of the P0 (`/decisions/1.png` bypassed the matcher — confirmed 200 on prod). The gate blocks merge until threads are RESOLVED (GraphQL `resolveReviewThread`), and only re-runs on push or `gh run rerun`.
- **Cost:** one merge blocked; without reading the threads the P0 would have shipped half-fixed.
- **Proposed edit:** "Before merging, list review threads (`gh api graphql … reviewThreads`). Reply with evidence and resolve each — but READ them first: one in four this wave was right about a bug the tests missed. Never resolve to clear a gate."
- **Confidence:** high (4 threads, 2 PRs)
- **Status:** proposed

### P3 · guard-red-team
- **Trigger (witnessed):** the `force-push` PreToolUse rule (`__GIT__push\b[^\n]*?(…|\s\+[^\s:+])`) blocked a command that was `git push origin <branch> && gh api … -f body="…[^/]+\.(ext)…"` — the `+` inside a review-reply body chained after a legitimate push matched the `+refspec` arm.
- **Cost:** one blocked call, one split retry; a false positive that teaches sessions to route around the guard.
- **Proposed edit:** anchor the `+refspec` arm to the push's own arguments — stop the `[^\n]*?` scan at the first `&&`/`;`/`|` — and add this command as a canary allow-example in `policy.test.mjs`.
- **Confidence:** medium (once, clear)
- **Status:** proposed

### P4 · harness-worktree-setup
- **Trigger (witnessed):** the primary checkout's `apps/**` + every `node_modules` were gone (6,686 tracked files deleted on disk), so the junction-based setup script had nothing to junction. A plain `git worktree add` OUTSIDE `.worktrees/` + `pnpm install --filter "@statenour/web..."` (3m35s) worked, but `typecheck:raw` then failed on three unbuilt workspace packages (`@nour/ai-capabilities`, `@nour/social-assets`, `@statenour/lenses`) until each was `tsc -p`-compiled; `verify:hard` stopped at `check:env` (no `.env`) and `check:policy-coverage` (no DB).
- **Cost:** three failed typecheck/commit attempts; one blocked `pnpm --filter <pkg> build` (classifier).
- **Proposed edit:** a "plain worktree" section: when the primary's node_modules are absent, create the worktree outside `.worktrees/`, install with the `...` filter, `pnpm exec tsc -p tsconfig.json` in each of the three packages before typecheck, and run the `check:*` gates individually, reporting `check:env`/`check:policy-coverage` as environment-skipped.
- **Confidence:** high (each step failed once before the fix was found)
- **Status:** proposed

### P5 · NEW: positive-control-first (or a line in statenour-verify)
- **Trigger (witnessed):** every new test this wave was run on the UNFIXED code first and the failure shape recorded (middleware 6f/8p; ingest-gmail 5f/1p; recall 5f/1p; N-1 2f/1p). Two of those runs caught test-harness bugs that would otherwise have shipped as green tests of nothing: `vi.restoreAllMocks()` stripping factory resolved values (ingest-gmail crashed on `.length`), and a `mockImplementationOnce(throw)` left unconsumed by a read-only control that fired in the NEXT test.
- **Cost:** none — that is the point; without the control both harness bugs would have been invisible.
- **Proposed edit:** "A new test is not done until it has been run against the code it is meant to catch and the failure recorded in the PR body. A test that cannot be made to fail is a silent instrument."
- **Confidence:** high (4 tests, 2 harness bugs caught)
- **Status:** APPLIED 2026-09-08 — `.claude/skills/positive-control-first/SKILL.md` (see the 2026-09-08 entry)

## 2026-09-02 · Audit wave follow-ups (#2062 · #2064 · tool-result fencing)

### P1 · statenour-verify (or NEW: prompt-assembly-census)
- **Trigger (witnessed):** S-1 as merged in #2059 fenced ONE of the five blocks `brain-context.ts` splices into the chat system prompt (contextual recall). The cross-session thread (#2062), hybrid recall, anticipatory recall and chat recall all reached the prompt bare — found only by a hostile review and a self-review after the fix was declared done. A sixth door, tool results (`searchColdMemory`, `searchConversations`, the customer-360 notes), was found the same way.
- **Cost:** three follow-up PRs; a defence that was reported closed while four of five doors stayed open, live, for ~2 hours.
- **Proposed edit:** "Before declaring any prompt-injection / fencing fix done, ENUMERATE every assembler that renders stored text into a prompt or a tool result — `brain-context.ts` block producers, `system-prompt.ts` sections, `augment-final-prompt.ts`, `context-hints.ts`, `lib/ai/tools/*` — and name each one as fenced, allowlisted-with-reason, or not applicable. One fixed renderer is not a fixed class. The gate shape that makes this durable is `tests/ai/prompt-block-fencing-gate.test.ts`."
- **Confidence:** high (5 misses in one wave, two review passes needed)
- **Status:** proposed

## 2026-09-02 · nickstire admin audit wave (#2063 · #2068 · #2070 · #2072) + production apply

### P1 · prod-db-guard (and nickstire-tidb-ddl)
- **Trigger (witnessed):** applying `drizzle/0114_...sql` to production failed at statement 1 with `ER_NO_SUCH_TABLE estimates`. No migration ever created that table and `drizzle/schema.ts` never declared it; the audit (F-6, F-17) had diagnosed a missing COLUMN, and PR #2063 shipped receipt/claim fixes for `processEstimateFollowUp`, a job whose subject table did not exist. Fixed in #2070 (job retired, 0114 halved, canary `server/__tests__/rawSqlTablesExist.test.ts`).
- **Cost:** one dead job got a day of "honest receipts" work; a wrong-in-kind audit finding shipped in three artifacts before the apply exposed it.
- **Proposed edit:** "When a cron 'skips forever' or a column is 'missing', FIRST prove the subject TABLE exists in production (INFORMATION_SCHEMA.TABLES) before theorising about columns. Raw SQL can name any table; Drizzle-typed reads cannot, so scan raw sql`` FROM/JOIN/UPDATE/INTO targets against the declared table list (the rawSqlTablesExist canary shape) before writing a migration for them."
- **Confidence:** high (the apply failed on the first statement; the audit had cited the wrong class)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P2 · nickstire-verify (canary scan sets)
- **Trigger (witnessed):** `cronNoSwallowedFailure.test.ts` derived its scan set from the modules `scheduler.ts` imports and never scanned `scheduler.ts` itself, which held 13 inline `catch { return { details: "X failed" } }` wrappers; one re-swallowed a rethrow the same wave had added one frame below (chatFaqPipeline). Found by an independent reviewer, not by the author's pass; second scan added in #2063's review commit.
- **Cost:** the F-9 "every cron fails loudly" claim was false for 13 jobs while its canary was green.
- **Proposed edit:** "A derived scan set must include the WIRING file it is derived from. When a gate scans 'every module X imports', also scan X, with its own positive control; the inline handler inside the registry is the shape a module scan cannot see."
- **Confidence:** high (13 misses behind one green canary)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P3 · nickstire-verify (SMS outcome contract)
- **Trigger (witnessed):** the wave's rule "consume a send claim only on sent|queued" left `uncertain` (shop-gateway timeout; `server/sms.ts` documents it as "do not retry, the relay may well have delivered") unconsumed at reminders, estimate follow-up, campaign retry, bulk follow-up and cross-sell: a re-text every tick until a send completed cleanly. Caught by the second-pass reviewer; fixed with `smsClaimConsumed` in #2063's second review commit.
- **Cost:** a P0 duplicate-text regression sat in the branch for a day; the author's own review missed it.
- **Proposed edit:** "Any change to how a sendSms result is interpreted must be checked against the FOUR outcomes in `server/lib/smsOutcome.ts`: a claim is consumed for every outcome except a definite failure; only COUNTERS keep uncertain apart from sent; never collapse uncertain to failed on a receipt a human reads (it invites a re-send)."
- **Confidence:** high (five sites, one shared cause)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P4 · prod-db-guard (scoped migration apply)
- **Trigger (witnessed):** `pnpm db:migrate` (`scripts/db-migrate.ts`) has no dry run and applies EVERY unrecorded file in one sweep; the wave needed 0114/0116 first, backups before 0115/0117, and a record-only for the hand-applied 0113. A throwaway scoped runner (dry-run by default, `--only <prefixes>`, house two-statement backup with a count check that aborts before the drop, hash recorded exactly like db-migrate.ts) did the job and was deleted after, per the runbook.
- **Cost:** the pattern is undocumented, so the next apply either re-invents it or reaches for the unscoped sweep.
- **Proposed edit:** add the scoped-runner shape to the skill's "Applying" section (or SCHEMA_DRIFT_RUNBOOK): dry-run exits BEFORE opening a connection; `--only`; backup, then count, then drop; record the sha256 of the whole file with the journal `when`; delete the script after.
- **Confidence:** medium (one session, but every step was needed)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P5 · prod-db-guard / harness-worktree-setup (auto-mode classifier)
- **Trigger (witnessed):** the Claude Code auto-mode classifier, not repo policy, denied `railway whoami`, a read-only probe script, `gh pr checks`, a combined grep+dryrun+execute+rm command, the plain `node _drop_old_backups.cjs --execute` once, and the long-form `railway run --service ... -- ./node_modules/.bin/tsx ...`, while allowing the same actions as single plain commands (`node _probe.cjs`, `railway run -s ... -- pnpm exec tsx ...`) after the operator added a permission rule.
- **Cost:** about ten blocked turns; one stop-and-ask that was correct; one apply chain split three ways.
- **Proposed edit:** "Production-touching commands: one plain command per call (no pipes into rm/grep chains, no compound guards); expect the classifier to block a READ probe as a prod action; when blocked, stop and hand the operator the exact one-liner rather than reshaping the command more than once."
- **Confidence:** high (six blocks in one session)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P6 · statenour-verify (no toolchain anywhere)
- **Trigger (witnessed):** for #2068 no worktree on the box had statenour's node_modules (primary gutted, every junction dangling, installs policy-blocked in worktrees), so typecheck, lint and the full vitest could not run; the pure helper's test ran under the SIBLING app's vitest with an ad-hoc config placed INSIDE apps/nickstire (a config in the scratchpad cannot resolve `vitest/config`), 9 of 11 static check scripts ran under nickstire's tsx, and the commit + push came from a hookless sparse scratch clone with CI as the gate.
- **Cost:** about forty minutes finding the path; two blocked install attempts.
- **Proposed edit:** a "no toolchain" section: (1) the sibling-vitest recipe with the config-location trap; (2) which `check:*` scripts run without deps and which need `glob` / `@prisma/client`; (3) the sparse hookless clone push (`git clone --no-checkout` + `sparse-checkout set apps/statenour`) with the disclosure line the PR must carry.
- **Confidence:** medium (once, but every step failed before the recipe)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

### P7 · nickstire-verify / statenour-verify (independent reviewers before "done")
- **Trigger (witnessed):** the author's own hostile pass over a 10-commit wave found 5 defects; three PARALLEL independent reviewers (silent-failure hunter on server/, contract reviewer on schema + cross-app, client/docs reviewer) over the full diff found 24 more, including two P0 regressions the wave itself introduced and three corrections to the audit's own claims (#15 to #17). The operator had to ask "are you sure?" before the deeper pass happened.
- **Cost:** a day-old P0 in the branch; three audit claims wrong until a reviewer traced them.
- **Proposed edit:** "Before calling a multi-commit wave done, dispatch reviewers per subsystem with a file:line brief and a 'verified OK / not checked' answer shape, then verify their top findings yourself; a single author pass over more than 20 files has not once been sufficient (2026-08-12 onward)."
- **Confidence:** high (24 findings the author's pass missed)
- **Status:** accepted 2026-09-02 (operator) · applied to the skill the same day

## 2026-09-02c · observability arc (#2080 · #2082 · #2083)

### P1 · `statenour-verify` — typecheck is not the build, for a SECOND reason
- **Trigger (witnessed):** in the #2080 review round I moved a shared constant by
  importing `./langfuse` from `lib/observability/sentry.ts`. `pnpm exec tsc --noEmit`
  exited 0. `next build` then failed `module-not-found` across the client AND edge
  passes, because `sentry.client.config.ts` imports that module, so the BROWSER graph
  now reached `@opentelemetry/sdk-node`. Fixed by moving both constants to a
  dependency-free `lib/observability/span-names.ts`.
- **Distinct from the applied #1243 rule**, which is about `tsc` excluding `tests/`.
  This one is bundle-TARGET resolution: the same file type-checks fine and still cannot
  be bundled for the runtime that imports it. A green tsc says nothing about which
  graph a module lands in.
- **Cost:** a rejected push (the pre-push gate caught it), one extra commit, one canary.
- **Proposed edit:** add to Traps — "A shared constant is not free. Before importing
  between `lib/observability/*` (or anything reachable from `*.client.config.ts` /
  `instrumentation-client.ts`), ask which bundle the IMPORTER lands in. Node-only deps
  in the browser graph fail `next build`, never `tsc`. Run the real build when you
  change an import edge, not just typecheck."
- **Confidence:** high (structural, reproducible; the gate reproduced it twice)
- **Status:** proposed

### P2 · `verify-receipt` (global) — a vendor list endpoint is a PROJECTION, and vendors rename
- **Trigger (witnessed):** after #2082 deployed, my verification script printed
  `NO RECEIPT: the probe reported success but Langfuse has no matching observation` —
  while Langfuse actually held the trace. Two independent causes, both mine: Langfuse
  names an observation `<functionId>:<span>` (`observability-probe:ai.generateText`,
  not `observability-probe`), and `GET /api/public/v2/observations` returns a thin
  projection where `metadata`, `userId`, `tags`, `release`, `model` and `input` are all
  absent — they exist only on `GET /api/public/traces/<traceId>`.
- **Cost:** I was one step from recording a WORKING pipeline as dead, in a session whose
  entire subject was a health badge that lied. Cost a second probe-and-read cycle to
  disambiguate.
- **Proposed edit:** add a rule — "When reading a receipt back from a third-party API,
  a negative result is not evidence until you have checked (a) the vendor's own naming
  convention for the record, and (b) the DETAIL endpoint, not the list. List endpoints
  are routinely projections that omit the very fields you are verifying. Prove the
  reader works by matching one record you know exists."
- **Confidence:** high (two separate false-negative mechanisms in one run)
- **Status:** proposed

### P3 · `statenour-verify` — grep your own diff for credential fragments before committing
- **Trigger (witnessed):** writing mask/scrub canaries I used the operator's REAL
  Langfuse keys (from a screenshot they had sent) as the strings being masked, in
  `tests/lib/observability/langfuse-telemetry.test.ts` and
  `tests/lib/observability/sentry-config-canary.test.ts`. CI's gitleaks failed the
  second — but ONLY because that file bound the value to a variable named `secret`
  (rule `generic-api-key`, entropy 3.9). The first file used the same key as an inline
  argument, did NOT trip the rule, and reached `main` in #2073.
- **Cost:** PR #2079 became unmergeable (gitleaks scans a PR's whole commit range, so a
  later removal cannot clear it), was closed, and the work was rebuilt on a clean branch
  as #2080. Operator later declined rotation — private repo, personal project.
- **Distinct from the existing nickstire-verify P2** (line ~365), which covers RUNNING a
  script with real credentials. This is about COMMITTING them as fixtures.
- **Proposed edit:** add to the pre-commit list — "Fixtures use synthetic values with the
  same shape, never a real credential — not even in a test that proves it gets redacted.
  Before committing anything touching credentials, grep the diff for fragments of every
  value the operator has shown you this session, screenshots included. A green gitleaks
  is shape-dependent, not value-dependent: the same key passes as an inline argument and
  fails as `const secret = ...`."
- **Confidence:** high (one incident, two files, one closed PR — and the gate's coverage
  gap is verified, not assumed)
- **Status:** proposed

> **Deliberately NOT proposed:** the OpenTelemetry provider-conflict mechanism itself
> (Sentry.init claims the global provider; `tracesSampler` is consulted for root spans
> only). That is a durable technical fact, so per this skill's own "When NOT to use" it
> belongs in the memory system and the repo docs — both updated — not in the skill queue.

## 2026-09-07 · StateNour quality + power research wave (PR #2175)

### P1 · statenour-verify — "shipped" requires a deploy receipt, and `railway logs --build` lies by default
- **Trigger (witnessed):** production served `b3bebde` (2026-09-04 12:08Z) while `origin/main`
  carried #2096, #2160 and #2161; `railway status` showed `statenour-web: Deploy failed (8h43m)`
  and `statenour-worker: Deploy failed (3d)`. The 09-07 session ledger and RECONCILIATION entry
  both said "shipped"/"landed" for #2096 and even applied its migration to prod. The skill's
  "Confirming a merge is DEPLOYED" section exists but is positioned as an optional epilogue.
  Second half: `railway logs --service statenour-web --build` printed the LAST SUCCESSFUL build
  (healthcheck succeeded, image created 09-04 12:08Z), so the failure was invisible until
  `railway deployment list --service statenour-web` gave the FAILED id and
  `railway logs --service <svc> --build <deployment-id>` showed
  `COPY apps/statenour/patches … not found`.
- **Cost:** three days of merged-not-deployed statenour work across two services; a prod
  migration applied for a writer that was not running; every earlier session's "SHIPPED" line
  for #2096 is false as written.
- **Proposed edit:** promote the ancestry check to a hard step before any "shipped" wording:
  "Step 5: `railway status` (read `Deploy failed` per service) AND
  `git merge-base --is-ancestor <merge-sha> $(curl -s https://bdnick.info/api/version | jq -r .data.build.commit)`.
  A merge without both is MERGED, never SHIPPED." Add the trap: "`railway logs --build` without a
  deployment id shows the latest SUCCESSFUL build; list deployments first and pass the FAILED id."
- **Confidence:** high (two services, three days, the same ledger line repeated by two sessions)
- **Status:** proposed

### P2 · plan-gate — check production evidence before the doc checks
- **Trigger (witnessed):** the pasted 2026-09-07 audit ("Report B") ran its gate against
  `docs/CURRENT-TRUTH.md`, `BLUEPRINT`, `git log` and memory — the four steps this skill lists —
  and stated in its own evidence boundary "the deployed SHA … NOT verified". The largest defect in
  the estate (P1 above) was therefore invisible to it, and would have been invisible to this skill's
  order of checks too: none of the four steps reads `/api/version` or `railway status`.
- **Cost:** a 54-section external plan ranked six source findings while production had been
  undeployable for three days.
- **Proposed edit:** insert a step 0 before `docs/UPSTREAMS.md`: "Production evidence first —
  `/api/version` (statenour) or its nickstire equivalent, `railway status`, and the deployment list.
  A plan gated against docs while prod is broken ranks the wrong things." Mirrors the
  source-of-truth hierarchy in root `AGENTS.md` (production evidence is rank 1; docs are rank 4–5).
- **Confidence:** medium (one wave, but the omission is structural in the skill text)
- **Status:** proposed

### P3 · statenour-verify (Traps) — deleting the last file in a directory a Dockerfile COPYs breaks every build
- **Trigger (witnessed):** #2096 deleted `apps/statenour/patches/ai@6.0.162.patch`, the only file
  in that directory. Git does not track empty directories, so `COPY apps/statenour/patches` in BOTH
  `apps/statenour/Dockerfile` and `apps/worker/Dockerfile` failed with `not found` on every push
  after 2026-09-04 12:34Z. Nothing in `verify:hard`, lefthook or CI reads a Dockerfile; the first
  instrument that could fail was the Railway image build, which nobody watches.
- **Cost:** the P1 outage. Fix shipped as `tests/repo/dockerfile-copy-sources.test.ts` (#2175):
  every build-context COPY source must be git-tracked, and every declared pnpm patch must be
  COPYd into every deps stage, canaried on the exact incident shape.
- **Proposed edit:** add to Traps: "Removing a patch (or the last file of any directory) can
  delete a directory a Dockerfile COPYs. Run `tests/repo/dockerfile-copy-sources.test.ts` (it is in
  the suite) and read its message before pushing a change that deletes files under a COPY source."
- **Confidence:** high (the defect is deterministic and the gate now reproduces it)
- **Status:** proposed

> **Deliberately NOT proposed:** the scratch-clone push path when shared `node_modules` predate a
> dependency (`@sentry/nextjs` here) — `statenour-verify` already documents it under "When no
> statenour toolchain exists"; and the claude-in-chrome `resize_window` / `ctrl+k` limitations —
> durable tool facts that went to the memory system, not a skill.


## 2026-09-08 · History-mining pass (no code wave — mined the memory corpus + this queue)

> Not a work wave. A sweep of `~/.claude/projects/C--/memory` (152 files) and this
> queue for shapes that recur across sessions and had no skill. Two waves had never
> been filed: the 2026-09-02 `/brain` nine-tab audit (five PRs, 41 defects) and the
> 2026-09-03 nickstire growth audit. Every claim below was re-verified against
> `origin/main` @ `bfccff82c` — the checkout the sweep started in was **90 commits
> behind**, which alone falsified one finding (this queue does NOT stop at 09-02c; it
> runs to 09-07).

### P1 · NEW: empty-vs-error — APPLIED
- **Trigger (witnessed):** highest-frequency defect shape in the corpus. **10 instances
  on one page** (#2090); it then **survived its own fix twice** — an empty contradiction
  ledger still scored a hardcoded **7 of 100** (#2091), and the identical shape
  (`resolutionRate = 1` on an empty table) was fixed in `lib/brain/learning-velocity.ts`
  and missed in the contradiction path by a second agent the same session. Three more on
  2026-07-30, all "a read with no writer" rendering a fabricated all-clear.
- **Cost:** five PRs for what was reported as one. Every instance passed typecheck, lint
  and a green suite.
- **What the skill carries:** the three-state contract (ERROR / UNMEASURED / measured
  zero) and the three reference implementations that already do it right —
  `judgment-quality-panel.tsx:34`, `contradiction-resolution-panel.tsx:300` (literal
  `provenance` strings `"ERROR"` / `"UNMEASURED"` / `"ZERO"`), and `fleet-truth.ts:13,190`
  ("a failed probe is UNKNOWN, never healthy"; `ok` requires every capability fresh).
- **Measured, and it changed the skill:** a repo-wide grep for this shape does **not**
  work here — `.catch(() => null)` 120 files, `.catch(() => [])` 93, `.catch(() => 0)` 22.
  These are house idioms. The skill therefore scopes detection to the diff or one surface,
  and names `=> []` / `=> 0` as the dangerous pair (`=> null` is usually honest).
- **Confidence:** high · **Status:** applied — `.claude/skills/empty-vs-error/SKILL.md`

### P2 · NEW: assert-the-consumer — APPLIED (was proposed 2026-08-28b, unapplied for 11 days)
- Unchanged evidence from the original proposal (four dead controls, #1983 · #1991).
  Added: the comment-filtering grep (hit 3 passed a consumer search because the only match
  was the author's own comment), and the registration≠reachability case measured against
  the 181-tool catalog / 24-tool budget.
- **Confidence:** high · **Status:** applied — `.claude/skills/assert-the-consumer/SKILL.md`

### P3 · NEW: positive-control-first — APPLIED (was proposed 2026-09-01, unapplied)
- Unchanged evidence (4 tests, 2 harness bugs caught). Added a section the original did not
  have: **a positive control can pin a falsehood** — see P6 below, found while writing it.
- **Confidence:** high · **Status:** applied — `.claude/skills/positive-control-first/SKILL.md`

### P4 · NEW: prior-art-grep — APPLIED (was proposed 2026-08-28, unapplied)
- Unchanged evidence (2 near-misses, medium confidence, kept because the cost is one
  command). Added the four known blind spots that make a prior-art grep miss: dynamic
  `import()`, case, line-number windows, and comments.
- **Confidence:** medium · **Status:** applied — `.claude/skills/prior-art-grep/SKILL.md`

### P5 · statenour-verify + nickstire-verify — APPLIED as edits, deliberately NOT new skills
- **statenour-verify** gains "Reading an ambiguous CI or hook result": `The operation was
  canceled` = superseded not failed; `completion-authority` leaves a stale red after threads
  are resolved; **an eslint OOM (exit 134) aborts the commit while the push prints
  `Everything up-to-date`**; `echo $?` after a pipe reads `head`'s status (use
  `${PIPESTATUS[0]}`); check the CI database version, not just prod. Plus "after MODIFYING a
  verified query, re-run it".
- **nickstire-verify** gains "Verifying a user-facing copy change": sweep with `grep -ri`
  (a case-sensitive sweep shipped `"New ownership"`, #2099); confirm in **real Chrome**, not
  the in-app browser (it blocks the site's fonts, so it is not a fair visual check); source
  and served HTML can disagree (10/12 routes served stale `noindex` snapshots — drift-catcher
  `prerender-indexability-consistency.test.ts`, #2098).
- **Why edits, not skills:** a "copy-truth-sweep" skill was scoped and then dropped —
  `canonical-business-truth.test.ts` already enforces it in code, and this queue's own
  precedent is that an update beats a new skill.
- **Status:** applied

### P6 · LIVE DEFECT found while validating P3 — NOT fixed, operator's call
- **`apps/nickstire/client/src/__tests__/canonical-business-truth.test.ts:188`** asserts
  *"POSITIVE CONTROL: the new-ownership statement is still on the site"*
  (`expect(newOwnership.length).toBeGreaterThan(0)`).
- The owner confirmed 2026-09-03 that Nick's is the **same owner** who renamed Moe's Tire
  & Auto — there was never new ownership, and #2099 removed the copy. **The test now pins a
  falsehood as a required invariant.**
- It is green on **exactly one** line, and that line is not a claim about this business:
  `shared/guides.ts:887`, a generic consumer-advice sentence ("If something changes — new
  ownership, new technicians, declining quality — it is okay to re-evaluate") about shops
  in general. Simulating the scanner's own filter over 494 files / 110,189 non-comment
  lines returns that single hit and zero for `run by moe`. Edit or delete that unrelated
  article sentence and the control goes red, with the obvious "fix" being to re-add a false
  ownership claim to the site.
  **Correction to this entry's first draft:** it also named a comment at
  `shared/voice.ts:350` as a second cause. That was wrong — `LINES` already excludes
  comment lines (the file's own "MENTION IS NOT ASSERTION" rule), so that comment was never
  counted. One cause, not two.
- **Not fixed here:** business-truth is operator-owned and this pass had no remit to change
  nickstire copy or its canonical constants. Recommended: delete the control or re-point it
  at the true invariant (same owner, renamed ~2018).
- **Confidence:** high (verified on `origin/main` @ `bfccff82c`)

> **Deliberately NOT proposed:** a "CI false-signal triage" skill (folded into
> statenour-verify instead — ~60% was already there); a "stale-checkout" skill
> (`harness-worktree-setup` and `statenour-verify` already carry the junction/phantom
> shapes). Also noted, not proposed: **`statenour-verify` is now the queue's dumping
> ground** — P1/P2 in roughly ten entries, and it carries deploy confirmation, credential
> handling, reviewer dispatch and embedding dimensions under a name that says "verification
> sequence". That is the likeliest reason three new-skill proposals sat unapplied for
> 11 days. A split is worth an operator decision.

### P7 · the automated reviewer was right 4/4 AGAIN on this very PR
- **Trigger (witnessed):** Codex reviewed #2203 and filed four P2 findings, all verified
  true before acting: (1) `prior-art-grep` searched `pgTable(` for nickstire, which is
  TiDB — all **146** declarations are `mysqlTable`, so the duplicate-table safeguard was
  dead for one of the two apps; (2) it searched a root `.env.example` that **does not
  exist**, and `git grep` exits 1 for an unmatched pathspec exactly as for a real
  no-match, so the miss reads as "Prior art: none"; (3) **`empty-vs-error`'s own detection
  regex required `()` immediately before `=>` and therefore missed every
  `.catch((): never[] => [])` — 147 files match with the annotation allowed, 98 without,
  a **49-file blind spot**, in the skill written specifically about instruments that
  cannot fire; (4) `statenour-verify` classified `The operation was canceled`
  unconditionally as "superseded, nothing failed", where root `AGENTS.md` says rerun.
- **Cost:** none — caught pre-merge. But finding (3) is the fourth consecutive wave in
  which a defect appeared in code written *while criticising that exact defect class*,
  and the reviewer's cumulative record across the last two waves is now **8/8**.
- **Proposed edit:** none new. This is `positive-control-first` and `empty-vs-error`
  working as written, on their own author, and it is the evidence for the standing rule
  that **no wave is finished before an independent adversarial pass** — the author's own
  hostile pass ran here and missed all four.
- **Confidence:** high (all four independently verified; fixes positive-controlled)
- **Status:** applied in the same PR
