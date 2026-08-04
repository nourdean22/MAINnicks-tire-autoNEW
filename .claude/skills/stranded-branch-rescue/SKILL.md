---
name: stranded-branch-rescue
description: Use when a pushed branch looks finished but has no merged PR (authoring session died before gh pr create), or when auditing origin branches for unlanded work. Encodes the rescue protocol - PR-record check FIRST (cherry lies across squash merges), worktree-attachment and SHA-stability gates, provenance in the PR body, and the zombie rule (never re-merge).
---

# Stranded-Branch Rescue

Sessions on this machine die mid-arc. A branch can sit on origin with
walkthrough evidence, capability entries, and 11 unmerged commits — a
finished arc invisible on `main` — because the authoring session died
before `gh pr create`. `nickstire/admin-health-strip-and-guards` sat that
way ~6 hours and was rescued as PR #1354. The same audit exposed the
opposite hazard: **zombie branches whose content already merged**, which
invite a duplicate-merge mistake.

## Step 1 — PR record, not cherry

```powershell
$env:GITHUB_TOKEN=$null
gh pr list --head <branch> --state all --json number,state,title
```

- **A MERGED PR = zombie. Stop. Never re-merge**, whatever `git cherry`
  says.
- Measured 2026-08-04: `git cherry origin/main <branch>` reported `+N`
  (unmerged) on **5 of 6 branches whose PRs had in fact merged** — squash
  merges plus post-review edits break patch-id matching, so cherry
  false-positives constantly here. The PR record was right 6 of 6.
- Use cherry only as a SECONDARY signal for branches with **no PR ever**:
  `+0` there means an empty branch (nothing to rescue); `+N` means real
  unlanded commits.

## Same audit, open PRs — stale-baseline red checks

A red check whose run PREDATES main's latest green run of that same
check is a stale baseline, not a defect. Witnessed 2026-08-04: four
dependabot PRs sat 3 days behind red `e2e` checks; main's e2e had gone
green since; one `@dependabot rebase` comment turned every one
`e2e:SUCCESS` with zero debugging. Compare run dates before diagnosing
anything on an old PR.

## Step 2 — is it truly abandoned?

Only rescue when ALL of these hold:

1. **No attached worktree** — `git worktree list` **on the primary
   checkout** (`C:\Users\nourd\NOURCITY`). A branch checked out in a
   sibling's worktree may be live work; leave it, note it. (A worktree
   at that commit in DETACHED state does not count as attachment.)
2. **SHA-stable** — record the tip SHA at discovery and re-check before
   merging; any movement means a live session owns it.
3. **The arc reads finished** — evidence/walkthrough commits at the tip
   are the strong signal; a branch ending mid-refactor is not yours to
   complete silently. Rescue ships THEIR work, never your additions.

## Step 3 — rescue

1. PR from the branch as-is, with a **provenance note** in the body:
   authored by a prior session, rescued unmodified, tip SHA named.
2. Merge only on CI-green AND the tip SHA unchanged from discovery.
3. `.completion/evidence.json` conflicts resolve by its own documented
   rule: the merging branch's walkthrough wins, every other key
   preserved.

## Zombie hygiene

A `-`-cherry or MERGED-PR branch left on origin invites the next session
to "finish" it. Do not delete sibling branches on your own initiative —
record the zombie verdict (memory / PR body / report) so the next audit
starts from the answer. Known zombie set as of 2026-08-04:
`statenour/render-queue-lease`, `statenour/wire-reviews-cron`,
`chore/record-render-lease-migration`, plus every `+N`-cherry branch
whose PR shows MERGED (see the agent-os memory).

## When NOT to use

- The branch's session may still be alive (recent commits, attached
  worktree) — wait or hand to the operator.
- Content conflicts with `main`'s evolution — that is a REBASE decision
  with judgment calls, not a rescue; surface it instead of resolving
  silently.
