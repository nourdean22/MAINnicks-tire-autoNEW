# Skeptic pass: skill-forge

reviewer: `lane-research` subagent, read-only, 2026-10-15 (52 tool calls, about 19 minutes). It tried to refute the skill on six
fronts: ten should/should-not prompts, name and path resolution, following the procedure, overlap, attacks on `forge.mjs check`,
and every checkable claim in `gates.md` and `baseline.md`. It returned 26 items; each is closed below, in 32 lines (an item that
needed more than one change has a line per change). The last 4 lines come from the manager's later hostile review of #3050, not from
this reviewer. A line ends in its disposition: `fixed`, or `rejected: <why>`.

## Findings

- compiled-skill route could not be followed (step 2 put a baseline in the slug directory and `scaffold.mjs` refuses an existing non-package directory); step 1 now says scaffold first, then continue at step 2. fixed
- steps 6 and 7 contradicted each other (`check` needs `invocation.json`, which the later step wrote); the proof is now step 6 and the check is the last step. fixed
- held-out set chosen by wording (53 variants moved 24 queries into it); a mined row is now assigned by its origin id, so re-wording a real prompt cannot move it. fixed
- a written row can still be re-rolled by changing its words; rejected: the change is visible in review and the row says `written`, a limit `gates.md` states
- `--git` order check gameable with a hollow baseline rewritten after the skill; `check --git` now fails on a baseline edited after `SKILL.md` was added, and a hollow baseline no longer passes the content rules. fixed
- `tx:` origins checked for shape only; `verify-origins` re-derives each id from the transcripts on the author's machine (14 of 14 resolve for this skill). fixed
- `tx:` origins cannot be verified in CI; rejected: the transcripts are private, so CI can only check the shape, and `gates.md` says so
- a hollow `baseline.md` passed (zero date, rows of bars, empty failure shape); a real past date, two rows of three cells of real length and a failure shape of 100+ characters are now required. fixed
- `invocation.json` was typeable by hand and survived a description edit; it now carries the description's SHA-256 and the claude version, so an edit makes it stale. fixed
- a hand-typed `invocation.json` with a computed hash still passes; rejected: `prove` takes 15 seconds and `gates.md` lists this as a limit
- a one-word description and a skeptic line saying "not fixed" passed; the description needs 80 characters and a "Not for" clause, and a finding must end in `fixed`, `rejected: <why>` or `none found after trying: <what>`. fixed
- the private-shape filter let 9 of 12 shapes through and `mine` redaction had the same gaps; bare and parenthesised phones, forward-slash and `/c/` paths, obfuscated emails, VINs, street addresses, IPs, domains, SSNs and `sk_live_` tokens are now caught by both `redact` and `check`, with tests. fixed
- names inside a query cannot be detected; rejected: no pattern finds a name, and the skill tells the author to read every query
- bundled files could be linked yet never read (nested files, other folders, a link in an HTML comment, `./references/x`); files are listed recursively including `assets/`, links in fences and comments do not count, and `./` is normalised. fixed
- the description overlapped `source-to-skill`, `session-observer` and the global `writing-skills`; the "Not for" clause names the first two, the compiled-source route is spelled out, and SKILL.md says to follow these gates when `writing-skills` also loads. fixed
- the description summarised its own workflow, which makes agents follow it and skip the body; it now states triggers and one line of purpose. fixed
- two prompts ("add a step to stranded-branch-rescue", "apply proposal P2 to a skill") were predicted to miss; rejected: editing the steps inside an existing skill is declared out of scope, and both are should-not rows in the trigger set
- `score --set` treated any unknown value as train and labelled it held-out; an invalid set now throws and the CLI exits 64, with a test. fixed
- "check applies the same rules in Node" was false (YAML validity, keys Claude Code uses); the wording is corrected, duplicate keys and a plain description with a colon and a space are caught, the Claude Code keys are accepted, and SKILL.md says `check` does not parse YAML. fixed
- tuning an existing skill had no route; `check --existing` waives only the "Use when" start, and the baseline rows for a tune are the prompts that misfired. fixed
- "25 of 57 start Use when" was wrong; the measured figures are 10 of 57 for "Use when", 15 with "whenever", 25 with any "Use", in `gates.md` and the test header. fixed
- the `--git` check had no caller and the header omitted `score`; manager step 11 runs `check <dir> --git` before the squash and the header lists every subcommand. fixed
- baseline wording (a denominator-free "6 of 6", an "at least twice" rule met by a historical row, a firing count that omitted `anthropic-skills:skill-creator`); corrected in a baseline commit made before `SKILL.md` existed, and step 2 now reads "at least once fresh plus any recorded incident". fixed
- three of the eleven `tx:` rows were verbatim real prompts in a public repo; they are paraphrased with their ids kept. fixed
- the trigger set was thin and not independent; the reviewer's own prompts were added, including negatives for `source-to-skill`, `session-observer` and a fire-audit bug, giving 40 rows with 14 real and a held-out set of 13 with 4 positives. fixed
- 13 held-out rows is still a smoke test, not a measurement; rejected: more real data does not exist on this machine (9 real prompts mention "skill" in 400 days), and `trigger-evals.md` says so
- `evals/skeptic.md` had no template; a template is in `gates.md`. fixed
- step 3 sent the agent into skill-creator's description loop, which reports a clean score for a crashed run on Windows; step 3 now says to skip those scripts here. fixed
- the command blocks used bash syntax while the repo CLI is PowerShell; a note maps `$TMP` to `$env:TEMP`. fixed
- `score` ran with a 4-turn cap and ignored `error_max_turns`, so a miss could be a cap; the cap is 6 and capped runs are counted and reported separately, with a test. fixed
- `prove` might treat an unknown skill name as loaded; rejected: probed on 2026-10-15 in a scratch project, a nonexistent skill returns `is_error: true` ("Unknown skill"), which `parseInvocation` reads as not loaded, and `prove` now also stops with exit 2 when `SKILL.md` is missing
- `anthropic-skills:skill-creator` may not be the copy at the plugin path used for the official scripts; rejected: step 3 invokes the skill by name, and the plugin path appears only in notes on the official loop, which this machine cannot run
- (hostile review of #3050) `mine` read a missing `origin` field as "human", so headless `claude -p` runs, including this tool's own score runs, counted as operator prompts and 4 of 14 `tx:` rows were not real prompts; operator turns are now an allow-list on `turnOrigin`, the 4 rows are replaced with prompts that resolve, and every run passes `--no-session-persistence`. fixed
- (hostile review of #3050) `check --existing --git` compared the baseline with the commit that created SKILL.md, so tuning an old skill could never pass; it now uses the first commit on the branch that changes SKILL.md, and a branch that leaves SKILL.md alone has nothing to order. fixed
- (hostile review of #3050) the path redaction needed whitespace or a bracket before a path, so one behind a backtick, `=` or `[` leaked into a committed query; the lookbehind is now "not a word character, dot, hyphen or at sign" (which also catches `file:///opt/x/y`). fixed
- (hostile review of #3050) a code fence behind `> ` or a list marker was not stripped, so a link inside it counted as a link; the fence pattern now allows those prefixes. fixed
