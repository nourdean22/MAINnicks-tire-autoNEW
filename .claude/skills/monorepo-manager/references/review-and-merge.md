# Review before the PR opens, and the merge protocol (steps 10 and 13)

## Review (step 10)

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

Optional: `lenses` (a list of `{ key, task }`) replaces the defaults, `skeptics` changes the count of 2. Write the `change` and
`accepted` text carefully: reviewers know only what you tell them, and an accepted limit left out comes back as a finding.

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
   (6 finders plus 2 skeptics per finding) and ask once, or run the six lenses as parallel `lane-research` calls in ONE
   message, each told to return findings with file, line and evidence, then judge the findings yourself.
2. Read every surviving finding against the real file before you act; spot-check one refuted finding too. A skeptic that
   cannot confirm a finding from the real file counts it as refuted. A finding is dropped only if a MAJORITY of the CONFIGURED skeptics refute
   it (with two, a split vote keeps it), and one whose skeptics all failed to answer is kept.
3. A finding goes back to the owning lane as the exact input or line, never as a vague worry.
4. The workflow logs what it dropped and what each lens checked. Copy both into the PR body: silence reads as "covered everything".
   The composed findings are in the workflow's task output file, not in its journal: read them there before the file is cleaned up.

## Merge protocol (step 13)

Merge only when authorized. Then run ONE command, which re-verifies every condition in the same process as the merge:

```bash
node scripts/agent-os/merge-gate.mjs <pr> --sha <full head sha you verified> --merge
```

What it does, and the incident behind each part:

| Part | Why |
|---|---|
| number comes from the `gh pr create` output, never a guess | a guessed number merged a sibling's PR (2026-08-07, no harm by luck) |
| holds while ANOTHER open PR (the list is capped at 200, not gh's default 30) has a `node` or `e2e` check in flight, in one bounded wait (default 30 min; a non-numeric value is refused) | a merge redeploys and kills those runs (`AGENTS.md` > Branching); a polling loop of model turns burns usage |
| refuses unless OPEN, not draft, `CLEAN`, at exactly your SHA, at least one check reported, every check finished and none failed | a head that moved after your review is a different PR; an empty check list right after a push means CI has not started, and this repo has no branch protection to stop the merge |
| `gh pr merge --squash --match-head-commit <sha>` | GitHub itself refuses if the head moves between the check and the merge |
| deletes the branch through the API only after the PR reads `MERGED`, and never for a cross-repository PR | deleting the head branch of an unmerged PR closes it (#2948); `--delete-branch` also fails locally after a successful remote merge; a fork's branch name deleted in the base repository could remove an unrelated branch |

Run it with `run_in_background` when the hold may be long; the harness wakes you when it exits. Exit codes: 0 merged or
READY, 2 blockers, 3 held past the wait, 4 merge did not read MERGED (branch kept: `gh pr view <n> --json state` first, the
remote merge may still have happened). Without `--merge` it only judges. After MERGED: `git fetch origin main` and
`git merge --ff-only`, never `reset --hard`. Report the merge SHA, not "merged".
