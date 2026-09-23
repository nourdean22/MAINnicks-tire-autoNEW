# 2026-09-23 branch rescue runbook

One-time cleanup for the 13 branches an account-wide session audit found sitting
dirty/unpushed on the operator's Windows machine, now that live GitHub state has
been checked (not assumed). This is the immediate action; the standing system it
motivated (Session Authority, `repo:status`, `repo:rescue`, the weekly branch
sweep) is documented in the **session-authority** skill and
[`docs/agent-os/BRANCH-SWEEP.md`](./BRANCH-SWEEP.md) (machine-generated, refreshed
weekly by `.github/workflows/branch-sweep.yml`).

**Everything below runs on the Windows PC.** No cloud session can reach that
filesystem — that is a hard boundary of this account's session model, not a gap in
this runbook.

## A — the 7 branches with a merged PR (ref already deleted on origin)

`claude/nicks-eval-coverage-2026-09-18` (#2460) ·
`nickstire/session-ledger-2026-09-11` (#2325) ·
`chore/prerender-refresh-rebase-2026-09-08` (#2199) ·
`statenour/hard-delete-guard-wiring` (#2050) ·
`nickstire/reel-publish-approval-write-path` (#2042) ·
`nickstire/dua-concept-engine` (#2014) ·
`docs/statenour-08-21-wave-reconcile` (#1756)

These landed. The only open question is whether a LATER session kept working in
the same local worktree after the merge — check per branch, don't assume:

```powershell
$env:GITHUB_TOKEN=$null
gh pr view <PR#> --json state,mergeCommit   # confirm MERGED, get the merge SHA
git diff --stat <mergeCommitSha> <branchName>   # empty/trivial => nothing left behind
```

If the diff is non-trivial, treat the branch as case B below (extract the
post-merge delta, don't discard it blind). If it's clean, tear the worktree down
normally — `worktree-teardown.ps1` now releases the branch's Session Authority
lease as its first step and will refuse (loudly, before touching anything) if the
worktree turns out to be dirty after all:

```powershell
powershell scripts/worktree-teardown.ps1 -targetDir <path>
```

## B — the 4 genuinely stranded branches (no ref, no PR trace anywhere on GitHub)

`claude/nicks-tire-camera-gaps-36762d` · `claude/statenour-tire-systems-plan-865840` ·
`claude/statenour-bdnick-research-4f6b70` · `chore/primary-parked-post-cleanup`

Nothing exists for these on GitHub, so the *only* possible recovery source is this
machine's own git object database:

```powershell
git branch --list "*camera-gaps*" "*tire-systems-plan*" "*bdnick-research*" "*parked-post-cleanup*"
git reflog --all | Select-String -Pattern "camera-gaps|tire-systems-plan|bdnick-research|parked-post-cleanup"
git fsck --unreachable --no-reflog
git stash list
```

Anything found → push it to origin under its original name immediately, so it
exists somewhere durable and auditable:

```powershell
git push -u origin <branchName>
```

Then run the normal rescue procedure — `.claude/skills/stranded-branch-rescue/SKILL.md`
by hand, or once a session has leased and worked through one branch as practice,
`node scripts/agent-os/repo-rescue.mjs --branch <branchName>` (dry-run first:
add `--dry-run` to see the PR it would open without opening it).

**If nothing turns up** in reflog, dangling objects, or stashes for a branch — say
so plainly. The work is most likely genuinely gone. Do not imply recoverability
that a real search didn't find.

## C — `nickstire/reel-generate-schedule` (the messy one)

This branch exists on origin (7 ahead / ~402 behind `main`), but its "ahead"
commits reference PRs (#2201, #2205, #2209) that were squash-merged **into this
branch**, not toward `main` — and the originating session separately reported 17
unpushed local commits while only 7 reached origin, meaning roughly 10 more
commits likely still sit only on this machine.

**Recover everything local first, before any merge-direction decision:**

```powershell
git worktree list   # find this branch's worktree, if it still exists
git log --oneline origin/nickstire/reel-generate-schedule..nickstire/reel-generate-schedule
git push origin nickstire/reel-generate-schedule   # get every local commit onto origin
```

Only once all local commits are safely on origin should a human decide the merge
strategy. At 402 commits behind `main`, a straight merge/rebase of the whole
branch is unlikely to be right — extracting the specific feature commits onto a
fresh branch off current `main` is the more probable safe path, but that is a
content/conflict judgment call this repo's own rescue procedure deliberately does
not make silently. `node scripts/agent-os/classify-branch.mjs`-style evidence
already flags this branch as `hasMergedPrButStillAhead` rather than ordinary
`SALVAGE` — see `docs/agent-os/BRANCH-SWEEP.md` for its current live classification.

## Going forward

Every worktree created via `worktree-setup.ps1` now acquires a Session Authority
lease automatically, and `worktree-teardown.ps1` refuses to release one that's
still dirty. A branch sitting abandoned the way these 13 did should no longer be
possible without an explicit `-ForceDirtyRelease` and a written reason. See the
**session-authority** skill for the manual path (cloud sessions, which
`worktree-setup.ps1` never runs for).

## Phase 5 — GitHub ruleset, ready but blocked

`config/agent-os/ruleset-required-checks.json` is written and ready to apply the
moment this repository is on a paying GitHub plan — the rulesets API 403s on a
private repo at the Free tier today (`scripts/night-shift/README.md`), which no
session can change. Once upgraded:

1. Verify the two `context` strings in the JSON against the **live** check-run
   names on a recent commit (`gh api repos/<owner>/<repo>/commits/<sha>/status`)
   — do not trust the names as written without that check, since a workflow or
   job rename would silently break the match.
2. `gh api -X POST repos/<owner>/<repo>/rulesets --input config/agent-os/ruleset-required-checks.json`

This is a human billing decision, not an engineering task.
