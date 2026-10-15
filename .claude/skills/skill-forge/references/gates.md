# The gates, and the incident behind each

Each gate is enforced by `forge.mjs check` unless it says "process". A gate with no incident behind it is decoration;
if you cannot name the incident, propose removing the gate. Where a gate only checks the SHAPE of an artifact, the right-hand
column says what binds the artifact to something the author cannot type.

| Gate | Enforced by | Incident or fact | Bound to |
|---|---|---|---|
| name equals directory, kebab-case, at most 64 characters | `check`, and a library-wide test (`scripts/agent-os/skillForge.test.mjs`) | A skill is invoked by its exact name; a mismatch is not loadable by it. 57 of 57 repo skills complied when measured (2026-10-15) | the directory name |
| flat layout `.claude/skills/<slug>/` | `check` | #3035: a package under `generated/` validated and was never loaded; found by hand after merge | the path |
| description starts "Use when", has a "Not for" clause, 80 to 1,024 characters, no angle brackets, quoted if it holds a colon and a space | `check` | Routing lives in the description. 10 of 57 repo skills start "Use when" (15 with "whenever", 25 with any "Use"; measured 2026-10-15), so this is the rule for a forged skill, not a library invariant; `--existing` waives only the start. A neighbour with a better fit wins only if this one says what it is not for. The length and bracket limits are the official `quick_validate.py` rules | the text |
| frontmatter keys the official validator knows, plus the ones Claude Code reads (`argument-hint`, `disable-model-invocation`, `user-invocable`); no duplicate key | `check` | `quick_validate.py` needs PyYAML, which this machine lacks, and rejects keys Claude Code uses. `check` does NOT parse YAML: it catches the duplicate key and the plain description with a colon and a space, and nothing else | the text |
| every `references/`, `scripts/` and `assets/` file, at any depth, linked from `SKILL.md` by its exact relative path outside code fences and comments; every link resolves | `check` | "Config prose does not cause invocation" (`skill-fire-audit`): a file named only in prose is never read. A link to a missing file is a silent no-op | the links |
| no `<name>-workspace` beside the skill, no leftover `.claude/commands/<name>-skill-<8 hex>.md` | `check` | The official skill-creator text places the workspace "as a sibling to the skill directory"; its `run_eval.py` writes and deletes command files in the project's `.claude/commands/`, and leaves one if killed. Both seen in the baseline run | the directory |
| `evals/baseline.md`: a real past date, two task rows of three filled cells, a failure shape of 100+ characters; committed ALONE before `SKILL.md`, never edited after it | `check`; the order by `check --git`, on the branch | `positive-control-first`: a control never seen failing proves nothing. A baseline can be hollow and still match a shape, so the cells have a minimum length, and a baseline rewritten after the skill records nothing | the git history (a squash merge erases it, so the manager runs `--git` before the squash) |
| `evals/trigger-queries.json`: 12+ queries, a held-out flag assigned by hash (of the origin id for a mined row, of the text for a written one), 3+ of each label in train and held-out, no private shapes, an origin on every row, a third from transcripts | `check`; `verify-origins` proves the ids on the author's machine | The official text has the model invent the queries and re-splits at run time. A held-out set the author can choose is not held out; re-wording a mined row cannot move it, a written row can (and says `written`). The repo is public; transcripts hold real names and numbers | the origin id, re-derivable from a transcript only on the author's machine |
| the trigger score comes from `forge.mjs score`, which has a positive control and voids a crashed run | process; `score` is tested against a fake claude | Found while building this skill (2026-10-15): the official `run_eval.py` cannot start `claude` on Windows (`WinError 2`, then `WinError 10038` on `select` over a pipe), counts each crashed query as "did not trigger", and still exits 0 with `Results: 6/9 passed`. A zero is not a result until the instrument has fired once on a known positive (`AGENTS.md` > Standard of work) | the live routing |
| `evals/skeptic.md`: every finding ends in its own disposition clause: `. fixed`, `: fixed`, `rejected: <why>` or `none found after trying: <what>` ("not yet fixed" is not one) | `check` (shape); the refutation itself is process | Every adversarial review since 2026-08-12 found real defects in the author's own diff (`AGENTS.md` > Standard of work). The skeptic on this skill found 20+ | the reviewer, not the author |
| `evals/invocation.json` from a fresh `claude -p` session | `check`; `prove` produces it | The only evidence that the skill loads by exact name. It carries the description's SHA-256 and the claude version, so editing the description makes the proof stale | the description's hash |
| compiled skills pass `validate.mjs` | `check` runs it when `provenance/source.json` exists | `source-to-skill` step 8; CI also runs it over every package | the validator |
| SKILL.md at most 500 lines | `check` | Official progressive-disclosure limit; the manager skill is held to 120 as a router | the line count |

What the gates still cannot do: a hand-typed `invocation.json` with a computed hash passes (rerun `prove`, it takes 15 seconds);
a written query that borrows the description's own words passes (read the held-out rows); a name inside a query is not detectable.
`verify-origins`, `check --git` and the manager's own reading are the controls for those.

## Template: `evals/baseline.md`

```markdown
# Baseline: <skill name>

recorded: yyyy-mm-dd

Question: what fails when this task is done WITHOUT the skill?

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: <task, who ran it, how long> | <the failure, concretely> | <command output, file, transcript id> |
| T2: ... | ... | ... |

## Failure shape

<two to five sentences: the failure in general terms, and the step of the skill that must prevent it>
```

Two task rows is the floor; a task that succeeded without the skill is a row too (it narrows what the skill is for). Say whether
a row is one fresh run (an existence proof) or a rate.

## Skeptic brief (step 5)

```
Read-only. You are trying to REFUTE the skill at .claude/skills/<slug>. Do not edit anything in the repo; scratch copies in the OS temp dir are fine.
1. Write five prompts a real operator would type that SHOULD load it and five near-misses that should NOT. Name the existing skill
   each near-miss belongs to (ls .claude/skills). Judge the description against all ten and say which it gets wrong.
2. Resolve every skill name, path, command and flag the skill mentions. Report any that do not exist or do not behave as written.
3. Follow the procedure as written on a made-up example. Report the first step you cannot do, or that contradicts another.
4. Find the existing skill it overlaps most with and say whether the two fight for the same prompt.
5. Attack `forge.mjs check`: find an input that passes it while violating a gate's intent. Report the exact input and exit code.
Return findings as "- <finding>: <evidence>" lines, most severe first, or "none found after trying: <what you tried>" per item.
```

## Template: `evals/skeptic.md`

```markdown
# Skeptic pass: <skill name>

reviewer: <agent type, date>

## Findings

- <finding, short>: fixed
- <finding, short>: rejected: <why it is not a defect>
- none found after trying: <what the reviewer tried>   (only if there really were none)
```
