# Subagent brief (paste into the Agent tool prompt; one brief per lane)

Rules from CLAUDE-OPERATING-PROFILE.md > SUBAGENT POLICY: inherit the stance, brief like a colleague,
scope tight. The manager reads your diff before anything ships, so report facts, not intent.

```
LANE: <lane name>   JOB ID: <yyyy-mm-dd-short-slug>   BASE SHA: <origin/main sha>   CONTRACT: <version or none>
GOAL: <one sentence: the outcome for this lane only>
ACCEPTANCE: <the test or observable result that means done>
WHY: <what Nour is trying to achieve overall, one or two sentences>
KNOWN: <facts already established, with file:line>
RULED OUT: <approaches already rejected and why>
YOU MAY EDIT: <exact paths or globs>. Anything else: report it back, do not touch.
YOU MAY NOT: push, merge, deploy, write to prod, send to customers, install packages, start subagents or other CLIs.
DATA: test fixtures only; never a production DATABASE_URL or real API keys in your shell.
BUDGET: <max tool calls or minutes>. STOP WHEN: acceptance passes, or you hit the budget, or you are blocked.
FIRST: if your cwd is under .claude/worktrees/ and tsc/vitest are "not recognized", run skill harness-worktree-setup.
SKILLS TO INVOKE FIRST: karpathy-guidelines, <lane skills, playbook skills>
VERIFY WITH: <exact command(s) and what passing looks like>
RETURN (exactly):
  1. Status: DONE | BLOCKED (on what) | PARTIAL (what is left)
  2. Files changed (paths) and a one-line why per file
  3. Verification receipts (command, summary line, exit code)
  4. Cross-lane needs (anything another lane must do)
  5. One lesson worth keeping, or "none"
```
