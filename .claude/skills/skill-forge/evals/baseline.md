# Baseline: skill-forge

recorded: 2026-10-15

Question: what goes wrong when a skill is made for this repo with ONLY the official skill-creator, and which repo gates does
the result fail? Recorded before `SKILL.md` was written; `forge.mjs check --git` verifies that order on the branch.

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: a Sonnet subagent given only the official skill-creator `SKILL.md` and the task "create pr-body-receipts", scratch root outside the repo, 8 tool calls, 147 s | Followed the instructions literally. Produced `SKILL.md`, `evals/evals.json` and `.claude/skills/pr-body-receipts-workspace/trigger-eval.json`: the workspace is a sibling of the skill because the official text says so. Its description was "pushy" (`Make sure to use this skill whenever ...`). It stopped after the draft. | `forge.mjs check` on that output: 6 problems, one per gate (description not "Use when", workspace beside the skill, no baseline, no trigger queries inside the skill, no skeptic record, no invocation proof). One run of one subagent: an existence proof of the gap, not a rate |
| T2: the same agent's 20 trigger queries | Invented from the model's context (it was given no transcript access, which is the point: the official text offers no other source): they carry real PR numbers and branch names, none comes from a transcript. The trigger set sat in the workspace, outside the skill. `run_loop.py` re-splits train and test at run time (60/40, seed 42), so no held-out set is recorded anywhere in the repo. | the T1 file listing: `trigger-eval.json` only under `-workspace/`; skill-creator `scripts/run_loop.py` `split_eval_set` |
| T3: the first compiled skill (#3035, 2026-10-14) | Scaffolded to `.claude/skills/generated/<slug>/`: it validated and Claude Code never loaded it. Found by hand after merge, fixed in #3041. No step proved the skill loads by its exact name. | ledger rows `2026-10-14-reel-hook-mechanism`, `2026-10-15-skill-compiler-flat-path` |
| T4: the official and the repo's own measuring tools on this machine | `quick_validate.py` needs PyYAML: `python -c "import yaml"` gave `ModuleNotFoundError`. `fire_audit.py --days 60` crashed with `WinError 3` on a transcript path over 260 characters. Neither can be the only gate here. | commands run 2026-10-15 in this worktree |
| T5: how much real data exists to draw trigger queries from | 1,981 transcript files in 60 days; 59 distinct skills fired in 1,273 invocations; the skill-making skills fired at least 8 times (source-to-skill 4, writing-skills 4, as counted then; anthropic-skills:skill-creator also fired and was not in the top-40 cut I read). Over 400 days, 9 real human prompts mention "skill" at all. | `forge.mjs mine` and a Skill tool_use count over `~/.claude/projects`, 2026-10-15 |

## Failure shape

A skill made by following skill-creator alone looks finished and fails every repo gate that is not a file-format check:
the official instructions themselves put the workspace beside the skill in `.claude/skills/`; the trigger evidence is
invented and stored outside the skill; no held-out set is fixed; nothing records the failure the skill is meant to
prevent; nothing proves it loads by exact name (the one skill that did not load, #3035, cost a hand-found merge defect);
and the official validator does not run on this machine. The earlier fire audit says config prose does not cause
invocation (46 of 1,307 names ever fired, 3.5%, 2026-08-03), so the description and an invocation proof are the only
routing that counts. Real transcript data for skill-making prompts is scarce, so the trigger set must say honestly which
queries are mined and which are written.
