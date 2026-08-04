---
name: guard-red-team
description: Use whenever authoring or modifying ANY deny-list, guard regex, lint rule, policy file, or enforcement hook (config/agent-os/policy.json, pretool hooks, lint-source rules, CI gates). A guard that goes green on its own canaries is unproven - adversarially probe the REAL binary end-to-end before trusting it.
---

# Guard Red-Team

An enforcement layer that has only passed its own happy-path canaries is
**unproven, and worse than nothing** — it reads as safety while providing
none. The first draft of `config/agent-os/policy.json` went green on its
own canaries; a 4-lens adversarial review then ran 31 end-to-end probes
through the real `pretool.mjs` and proved **22 bypasses and 7 false
positives** (PR #1355).

## The rule

**Never trust a green first run of a guard you just wrote.** The check may
be mis-scoped, the regex may anchor wrong, the harness may not even be
invoking it. Green proves the test ran; only adversarial probes prove the
guard guards.

## Protocol

1. **Probe the REAL binary end-to-end.** Feed candidate commands through
   the actual hook/linter process and assert on **exit codes**, not on
   your reading of the regex. A regex you reason about is a regex you
   excuse. **Attribute before fixing:** this machine runs MULTIPLE guard
   layers (repo pretool + the Claude-harness sandbox), and a block banner
   without the repo's "BLOCKED by repo policy: <id>" attribution is NOT
   the repo policy. Witnessed 2026-08-04: all three false positives that
   session were the harness layer — the repo policy probed clean and the
   only correct repo change was defensive allowExamples (#1364), not a
   "fix" to a rule that never fired.
2. **Run the minimum probe set** — every class below produced a verified
   bypass or false positive in the #1355 red-team:
   - **Tool global-option prefixes** — `git -C <path> push origin main`
     defeated every git rule at once (rules anchored on `git push`).
   - **Implicit / default arguments** — `git push` with no refspec, or
     `HEAD`, reaches the current branch's upstream unnamed; a ban that
     needs the word `main` never fires.
   - **Flag families and bundled short flags** — `prisma migrate reset`
     slipped past a ban written for `--accept-data-loss`; `-rf` is not
     `-r -f` to a naive matcher.
   - **Quoting, here-strings, heredocs** — content smuggled through
     PowerShell `@'...'@` and bash heredocs; also the top FALSE-POSITIVE
     source (the hook blocked its own author three times on
     mention-vs-execution: an e2e test command, a commit message quoting
     a flag, a proposals-file append).
   - **Chaining** — `;`, `&&`, `|`, subshells: does the guard see the
     second command in a compound line?
   - **Mention vs execution** — text that only QUOTES a forbidden string
     (docs, commit messages, test fixtures) must pass. A guard that
     blocks its own documentation will be disabled by a frustrated
     human, and then it guards nothing. Witnessed at its purest
     2026-08-04: the commit DOCUMENTING two false positives was itself
     blocked because its here-string quoted the cmdlet.
   - **Drive-qualified paths** — PowerShell `Env:`, `HKLM:`, `Cert:` are
     provider paths, not filesystem paths. Witnessed 2026-08-04: a
     compound command containing the standard env-token removal cmdlet
     was blocked as a system-path "/" delete.
   - **Argument bleed across a compound** — a path/regex-looking literal
     in an ADJACENT argument or statement must not be attributed to the
     guarded verb. Witnessed 2026-08-04: a backup-file delete plus an
     unrelated `'^\s*Tests'` regex in the same command was blocked as
     deleting the path "\s".
3. **Lock every verdict.** Every verified bypass becomes a permanent
   deny-example test; every false positive becomes a permanent
   allow-example test. The probe set only grows.
4. **Re-run the full probe set after ANY edit to the guard** — a fix for
   one bypass routinely reopens another (the #1355 matching-layer rebuild
   took an hour precisely because fixes interacted).

## Red flags

- "The regex obviously covers that" — probe it anyway; 22 bypasses were
  all "obviously covered".
- "I'll add probes after it ships" — an unprobed guard in the merge is
  false safety at its most trusted moment.
- "The canaries pass" — canaries the author wrote test the author's
  imagination, not the adversary's.

## When NOT to use

Pure display/formatting lint (no security or policy consequence), or
guards you are deleting. For verifying a FIX against a bug, use the
mutation-verification discipline in the per-app verify skills instead —
this skill is specifically for enforcement surfaces whose failure mode
is silent permission.
