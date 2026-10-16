# Subagent brief v3 (paste into the Agent tool prompt; one brief per lane)

Rules from CLAUDE-OPERATING-PROFILE.md > SUBAGENT POLICY: inherit the stance, brief like a colleague, scope tight.
The manager reads your diff and runs its own probes before anything ships, so report facts with labels, not intent.
v2 (2026-10-15) added DESIGN, FIXTURES, PITFALLS, PATH EXCEPTIONS, SELF-AUDIT and labelled receipts
(`.claude/skills/monorepo-manager/references/replay-2026-10-15.md`). v3 (2026-10-15, three lanes later) adds
MODEL / EFFORT, MODEL TRAILER, CHECKPOINTS, COST, RESUME, ANTISLOP MODE, CODEMOD RULE, CONTROLS RULE and RETURN item 7:
two lanes lost 40 to 76 minutes of uncommitted edits to a process restart, one codemod left labels lowercase, one commit
named the wrong model, and each lane cost 450k to 570k tokens. Fill every field. "none" is an answer only after you looked.

```
LANE: <lane name>   JOB ID: <yyyy-mm-dd-short-slug>   BASE SHA: <origin/main sha>   CONTRACT: <version or none>
MODEL / EFFORT: <haiku|sonnet|opus|fable> / <low|medium|high|xhigh|max>, reason: <one line; table below>
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
BUDGET: <max tool calls or minutes; default 120 tool calls or 45 minutes>. STOP WHEN: acceptance passes, or you hit the budget, or you are blocked. At the budget, return PARTIAL; never continue silently.
MODEL TRAILER: Co-Authored-By: <the model named in your harness system prompt> <noreply@anthropic.com>. Never a model the brief author guessed.
CHECKPOINTS: commit each finished deliverable at once; never more than ~20 minutes of edits uncommitted. A process restart keeps only commits.
COST: read a file once; git diff -U0 and targeted Grep over whole-file reads; batch independent tool calls; at most one heavy process (tsc, eslint, vitest over many files) at a time; NODE_OPTIONS=--max-old-space-size=8192 only after a native OOM (exit 134).
RESUME: if a RESUME message arrives, run git status and git log on your branch first and continue from the last commit; do not redo finished steps.
ANTISLOP MODE: <during|after|n/a> (<session override|global preference>) for any UI, copy or mobile work.
CODEMOD RULE: after any class or attribute sweep, re-read each element's rendered text children and fix what the removed class used to hide (case, spacing, separators).
CONTROLS RULE: a numeric control (threshold, distance, cap) is calibrated per viewport or per input size, never copied from another.
FIRST: if your cwd is under .claude/worktrees/ and tsc/vitest are "not recognized", run skill harness-worktree-setup.
SKILLS TO INVOKE FIRST: the lane file's frontmatter list by exact name, then <lane skills, playbook skills>, plus the `skill-recall --file <brief>` output
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
  7. Token and tool-call count (from your harness if visible, else "UNKNOWN") and the MODEL / EFFORT you ran under
```

## Picking model and effort

The manager fills MODEL / EFFORT per dispatch and sets the Agent tool's `model` and `effort` from it; a lane never picks its own.

| Tier | Model / effort | Work |
|---|---|---|
| tier A | haiku or sonnet / low to medium | read-only lookups, name resolution, path checks, ledger and metrics rows, docs lines, regex sweeps with a clear spec |
| tier B | sonnet / medium to high | codemods and sweeps over many files, fixtures, tests for a given spec, workflow YAML, copy edits under a style rule |
| tier C | opus or the session model / high to xhigh | new UI composition and design decisions, guards, parsers, hooks, migrations, anything that decides who acts (claim, lease, dedupe), security, the skeptic role in reviews |
| max | the session model / max | a cross-cutting incident only |

Unsure: the next tier up for correctness-critical work, the next tier down for mechanical work. Research lane default: sonnet / medium.
