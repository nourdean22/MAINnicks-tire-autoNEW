# Subagent brief v2 (paste into the Agent tool prompt; one brief per lane)

Rules from CLAUDE-OPERATING-PROFILE.md > SUBAGENT POLICY: inherit the stance, brief like a colleague,
scope tight. The manager reads your diff and runs its own probes before anything ships, so report facts with
labels, not intent. v2 (2026-10-15) adds DESIGN, FIXTURES, PITFALLS, PATH EXCEPTIONS, SELF-AUDIT and labelled
receipts; each came from a defect in the 2026-10-15 guard job (`.claude/skills/monorepo-manager/references/replay-2026-10-15.md`).
Fill every field. "none" is an answer only after you looked.

```
LANE: <lane name>   JOB ID: <yyyy-mm-dd-short-slug>   BASE SHA: <origin/main sha>   CONTRACT: <version or none>
GOAL: <one sentence: the outcome for this lane only>
ACCEPTANCE: <the test or observable result that means done>
WHY: <what Nour is trying to achieve overall, one or two sentences>
KNOWN: <facts already established, each with file:line and FACT or CLAIM>
RULED OUT: <approaches already rejected and why, so the child does not rediscover them>
DESIGN: <decisions already made, with the reason. Implement them; do not reopen them. Name anything left open for you to propose.>
FIXTURES: <exact inputs, sample payloads, golden files and the REAL entry point (hook command, CLI, endpoint) to test through, as paths>
PITFALLS: <traps this job or the repo's skills already name, each with what it looks like when it bites>
YOU MAY EDIT: <exact paths or globs>. Anything else: report it back, do not touch.
PATH EXCEPTIONS: <"none", or each extra file with why and the exact lines or values you may change there. Only the manager grants one, here. Without one, an out-of-path edit is rejected. List every out-of-lane file the lane must commit (census files, truth docs, .completion fragments, config baselines): a pre-commit hook can run app-wide checks, and a lane that cannot commit should leave the work uncommitted and say so.>
YOU MAY NOT: push, merge, deploy, write to prod, send to customers, install packages, start subagents or other CLIs.
DATA: test fixtures only; never a production DATABASE_URL or real API keys in your shell.
BUDGET: <max tool calls or minutes>. STOP WHEN: acceptance passes, or you hit the budget, or you are blocked.
FIRST: if your cwd is under .claude/worktrees/ and tsc/vitest are "not recognized", run skill harness-worktree-setup.
SKILLS TO INVOKE FIRST: karpathy-guidelines, <lane skills, playbook skills>
VERIFY WITH: <exact command(s) and what passing looks like>
SELF-AUDIT (before you return): re-read your full diff as a hostile reviewer. Run every new test or gate RED against the
  unfixed code first and record the failure shape (Nf/Mp, and why it failed). Mutate each rule you added and report how many
  mutants the tests kill. List what you did not check. A diff with no self-found defects is an extraordinary claim: say what you tried.
RETURN (exactly):
  1. Status: DONE | BLOCKED (on what) | PARTIAL (what is left)
  2. Files changed (paths) and a one-line why per file; mark any file covered by PATH EXCEPTIONS
  3. Verification receipts (command, summary line, exit code), each labelled FACT (you ran it; receipt attached),
     INFERRED (follows from facts; name them) or NOT CHECKED (say why). An unlabelled line counts as NOT CHECKED.
  4. Self-audit: defects found in your own diff and what you did; red-first result per new test; mutation result
  5. Cross-lane needs (anything another lane must do)
  6. One lesson worth keeping, or "none"
```
