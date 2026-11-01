# Review before the PR opens, and the merge protocol (steps 12 and 15)

## Review (step 12)

Five Codex findings landed on #3040 after it was open, and four on #3041. Each cost a push, a CI run and a round trip. A
review that runs BEFORE the PR opens is cheaper and, with skeptics, less noisy. The shape below is taken from a working
five-lens review of the 2026-10-15 guard PRs (read-only lenses, structured findings, skeptics per finding).

`.claude/workflows/adversarial-review.js` runs one finder per lens over the branch, then skeptics per finding whose only job is
to refute it, each in a different role (reproduce it; argue it is not a defect; read what the cited files really say).

```
Workflow({ name: "adversarial-review", args: {
  worktree: "<absolute path of the branch's worktree>",
  base: "origin/main", head: "HEAD",
  change: "<what the branch does, in a few lines, including what it claims to enforce>",
  accepted: ["<documented limit that is not a finding>", "..."]
} })
```

Optional: `lenses` (a list of `{ key, task }` with unique keys) replaces the defaults, `skeptics` (an integer 1 to 5) changes the
count of 2; anything else throws before an agent runs. A `preflight` agent first checks that `base` and `head` resolve and that the
diff has files; if not, the workflow returns `aborted: true`, logs `NOT A REVIEW` and runs no lens, so an empty range cannot come back
as six clean `checked` lines. Write the `change` and `accepted` text carefully: reviewers know only what you tell them, and an
accepted limit left out comes back as a finding.

| Default lens | Looks for |
|---|---|
| bypass | the real binary accepts what the change says it refuses (and refuses realistic input); boundaries, ordering, encodings |
| silent-instrument | a test or canary that cannot fail: asserts presence, shares a path with the code, never ran red |
| consumer | a writer nothing reads: registration without reachability, a rule id no output prints, settings the consumer never loads |
| scope | files outside the owned paths, unrelated edits, a path exception nobody authorized |
| docs-vs-code | a count, number, path or sentence in docs, comments, the ledger or the PR body that the code contradicts |
| names-and-facts | an identifier, tool, flag, rule or URL that does not resolve, or an external claim with no quote |

For a change with one dominant risk (a guard, a parser, a migration) replace the defaults with lenses written for it, as the guard
review did: hook code, the regex, registration and wiring, silent instruments, docs truth. A finding carries a severity (P0 ships a
wrong result or silently disables a protection; P1 a bypass, a false positive on realistic input or a test that cannot fail; P2 a
misleading claim or weak test; P3 a nit), a file, a line, evidence and a repro. Each lens also returns `checked`, what it actually looked at.

Rules for using it:

1. The workflow tool needs Nour's explicit opt-in ("use a workflow", ultracode). Without it, say what it costs
   (a preflight, 6 finders and 2 skeptics per finding) and ask once. Or run the six lenses yourself as `lane-research` calls, at most
   2 at a time (reviewers count toward the heavy-run limit in SKILL.md), each told to return findings with file, line and evidence,
   then judge the findings yourself. A lens that must run code (the silent-instrument lens mutates copies and runs tests) goes to a
   `general-purpose` agent told to write scratch files to the OS temp dir only and to leave the repo and the worktree untouched; a
   `lane-research` agent never edits files.
2. Read every surviving finding against the real file before you act; spot-check one refuted finding too. A skeptic that
   cannot confirm a finding from the real file counts it as refuted. A finding is dropped only if a MAJORITY of the CONFIGURED skeptics refute
   it (with two, a split vote keeps it), and one whose skeptics all failed to answer is kept.
3. A finding goes back to the owning lane as the exact input or line, never as a vague worry.
4. The workflow logs what it dropped, what each lens checked, any `NOT COVERED` lens (its agent returned nothing) and any `DEGRADED`
   finding (judged by fewer skeptics than configured). Copy all four into the PR body: silence reads as "covered everything".
   The composed findings are in the workflow's task output file, not in its journal: read them there before the file is cleaned up.

Restarts and quota days (2026-10-16 and 2026-10-18):

- Three process restarts in one night killed the running review workflow and two lane rounds; only committed work and scratchpad
  notes survived (about 2 hours of repeated agent work). Write every lane brief and every review brief to the session scratchpad
  before dispatch and re-dispatch from the file after a restart. Prefer two read-only lens agents over a multi-agent workflow when
  the machine is below 2 GB free. Lane CHECKPOINTS (commit per deliverable) landed in brief v3 (#3064).
- A Codex usage-limit notice on a PR is not a day-long condition: quota reset the same evening and Codex reviewed #3157 and #3159 in
  full (8 and 4 findings, one a false P1). After a notice, post `@codex review` once more on the final head if the PR is still open an
  hour later; a merge on the fail-open path (`--codex-wait-minutes 0`, with Nour's go) gets the read-only skeptic lens as the
  substitute, recorded in the ledger row with the WARN line.

## Integrate a lane (step 13)

Two traps on 2026-10-25. PR 3270 was first pushed holding only the ledger commit: a second `git fetch` overwrote `FETCH_HEAD`
before `checkout -B ... FETCH_HEAD`. And a lane RETURN gave a wrong full SHA (`87b53cf6727be...` for the real
`87b53cf6723b7ac6...`); cherry-picking by it in the sparse push clone failed "not our ref", then "bad object". So: take the lane
by BRANCH name into a NAMED ref (no later fetch moves it), take main from GitHub (a clone of the primary checkout has the
primary's stale local main as `origin/main`, and an unpushed lane branch exists only in the primary), use the RETURN's SHA only
to compare, and count the commits before you push. In the push clone:

```bash
git fetch https://github.com/nourdean22/MAINnicks-tire-autoNEW.git "+refs/heads/main:refs/remotes/github/main"
git fetch <primary checkout path> "+refs/heads/<lane-branch>:refs/lanes/<lane-branch>"
git rev-parse refs/lanes/<lane-branch>
git rev-list --count github/main..refs/lanes/<lane-branch>
git checkout -B <integration-branch> github/main
git cherry-pick github/main..refs/lanes/<lane-branch>
git rev-list --count github/main..HEAD
```

The resolved SHA must equal the RETURN's; if not, the RETURN is wrong or the lane moved: ask the lane, do not pick. The last
count must equal the first (plus your own ledger commit once you add it); if it does not, stop and do not push. Never name
`FETCH_HEAD` or a SHA copied from a RETURN as an operand. A lane branch that also carries commits main already has as a squash
(it was cut from another PR's branch) would re-apply them: replace `github/main..` with `<lane base sha>..` in the first count
and in the cherry-pick.

## Merge protocol (step 15)

Merge only when authorized: a change Nour asked for in words (his policy, guard and skill edits included), a pasted-report
job, or a docs-only PR; on green, merge with no second question. A change he did not ask for (a `session-observer`
proposal, an unasked loosening of a guard) waits for his go. Then run ONE command, which re-verifies every condition in the same process as the merge:

```bash
node scripts/agent-os/merge-gate.mjs <pr> --sha <full head sha you verified> --merge
```

What it does, and the incident behind each part:

| Part | Why |
|---|---|
| number comes from the `gh pr create` output, never a guess | a guessed number merged a sibling's PR (2026-08-07, no harm by luck) |
| holds while ANOTHER open PR (the list is capped at 200, not gh's default 30) has a `node` or `e2e` check in flight, in one bounded wait (default 30 min; a non-numeric value is refused) | a merge redeploys and kills those runs (`AGENTS.md` > Branching); a polling loop of model turns burns usage |
| refuses unless OPEN, not draft, `CLEAN`, at exactly your SHA, at least one check reported, every check finished and each `SUCCESS`, `SKIPPED` or `NEUTRAL` (an allow-list: a conclusion GitHub adds later blocks until someone reads it) | a head that moved after your review is a different PR; an empty check list right after a push means CI has not started, and this repo has no branch protection to stop the merge |
| waits for Codex on your SHA: `running` or no marker yet exits 7, an unresolved Codex finding or thread exits 2; no marker after `--codex-wait-minutes` (default 25), or still running at twice that, merges with a `WARN` line | #3134 and #3141 merged on green CI 3 minutes before Codex posted P1 findings |
| `gh pr merge --squash --match-head-commit <sha>` | GitHub itself refuses if the head moves between the check and the merge |
| deletes the branch through the API only after the PR reads `MERGED`, and never for a cross-repository PR | deleting the head branch of an unmerged PR closes it (#2948); `--delete-branch` also fails locally after a successful remote merge; a fork's branch name deleted in the base repository could remove an unrelated branch |

Run it with `run_in_background` when the hold may be long; the harness wakes you when it exits. Exit codes:

| Code | Means | You |
|---|---|---|
| 0 | merged, or READY without `--merge` | report the merge SHA |
| 2 | blocked: failed check, draft, behind, wrong head, not open | fix it; re-verify the new head |
| 3 | held past the wait: another PR's node or e2e run is in flight | re-run later; nothing was merged |
| 4 | the merge call returned but the PR does not read MERGED (branch kept) | `gh pr view <n> --json state` first; the remote merge may still have happened |
| 5 | a gh call failed BEFORE the merge call | nothing was merged; re-run |
| 6 | a gh call failed AT or AFTER the merge call | the merge happened or may have: read the PR before any retry; delete the branch by hand once it reads MERGED |
| 7 | not ready YET: CI not started, a check running, GitHub computing | re-run in a minute |
| 8 | blocked by the PR body bar (#3494): a section missing (self-review, kill criterion with a `YYYY-MM-DD` live-check date, 10x, second reader), an empty body, or a body gh did not return; docs-only and dependabot PRs are exempt | a body edit, no push: `gh pr edit <n> --body-file <file>`, then re-run; 2 outranks 8, 8 outranks 7 |
| 64 | bad usage | fix the command; a short or upper-case `--sha` that is a prefix of the PR's head prints the full head as a paste-ready retry (the gate never resolves it for you: the full SHA is the head you verified) |

Without `--merge` it only judges. After MERGED: `git fetch origin main` and
`git merge --ff-only`, never `reset --hard`. Report the merge SHA, not "merged".
