# Trigger queries: mine, paraphrase, split, score

Goal: a description that loads the skill on the prompts that need it and stays quiet on the near-misses, measured on prompts
the author did not choose. Real data on this machine is thin (2026-10-15: 1,981 transcripts in 60 days, at least 8 firings of the
skill-making skills, 9 real prompts mentioning "skill" in 400 days), so the file says which queries are real and which are not.

## 1. Mine (writes nothing; stdout only)

```bash
node .claude/skills/skill-forge/scripts/forge.mjs mine \
  --keywords "new skill,create a skill,SKILL.md,skill description" \
  --skills "skill-creator,writing-skills,source-to-skill" \
  --adjacent "find-skill,skill-fire-audit,session-observer" \
  --days 120 --limit 30 > "$TMP/mined.json"
```

- `sibling`: the turn fired a skill like yours. Likely positives.
- `adjacent`: the turn fired a neighbour your skill must not collide with. Real near-miss negatives. Do not use a skill that
  fires on every turn (`using-superpowers`, `ponytail`): every prompt is adjacent to it and it tells you nothing.
- `keyword`: the prompt mentions the topic. Label each by hand.
- It reads the same transcripts as `skill-fire-audit` (`~/.claude/projects`, Skill tool_use), skips harness-injected text
  (`isMeta`), sub-agent turns, tool results, slash commands and continuation summaries, and redacts emails, phone numbers,
  URLs, absolute paths and long tokens. `fire_audit.py` itself crashes on transcript paths over 260 characters on Windows
  (`WinError 3`, 2026-10-15), which is why `mine` has its own reader.

## 2. Paraphrase and label

Write `evals/trigger-queries.json` as an array of `{ "query", "should_trigger", "heldOut", "origin" }`.

- Keep each mined prompt's `origin` (`tx:` and eight hex digits) after paraphrasing it. `forge.mjs verify-origins .claude/skills/<slug>` re-derives
  every id from the transcripts on your machine and fails on one that resolves to nothing. It cannot run in CI (the transcripts are private), so run it
  before you push and put its line in the PR body.
- Invented queries get `"origin": "written"`. At least a third of the file must be `tx:`; if you cannot reach that, mine
  more or say in the PR body that the evidence is thin. Do not relabel.
- Half should be near-misses: share words or concepts with the skill but need something else. "Write a fibonacci function"
  tests nothing. Include casual spelling and abbreviations; real prompts have them.
- 20 to 400 characters, unique, no names, numbers, URLs, paths or tokens. `check` rejects the common shapes (emails, phone and ID numbers,
  addresses, IPs, domains, paths, tokens) and cannot see a name: you read every query. Paraphrase mined prompts even when they look harmless.

## 3. Split

```bash
node .claude/skills/skill-forge/scripts/forge.mjs split .claude/skills/<slug> --write
```

`heldOut` is about 40% of the rows and is assigned by hash: of the origin id for a mined row (so re-wording a real prompt cannot move it), of
the text for a written row (so only a visible change of words can, and the row says `written`). Each of train and held-out needs at least 3
queries of each label: add queries until it does; never edit the flag.

## 4. Score

The commands are bash (Git Bash on Windows); in PowerShell use `$env:TEMP` for `$TMP`.

```bash
node .claude/skills/skill-forge/scripts/forge.mjs score .claude/skills/<slug> --set train   --model haiku --runs 2 --out "$TMP/train.json"
node .claude/skills/skill-forge/scripts/forge.mjs score .claude/skills/<slug> --set heldout --model <the session model> --runs 3 --out "$TMP/heldout.json"
```

`score` sends each query to a fresh `claude -p` session in this repo, where the draft is installed under `.claude/skills/` like
any other skill, and counts a trigger when the model calls the Skill tool for it. That measures the real routing against the
whole library, with no temporary command files. A positive control runs first (an explicit request must load the skill) and a
crashed run is VOID, never a quiet miss; the exit code is 1 for either. Pass is a trigger rate of at least 0.5 for a
should-trigger query and under 0.5 for the rest, the official threshold. Tune the description on the TRAIN score by hand; score
the held-out rows once with the final description.

Why not the official `scripts/run_eval.py` / `run_loop.py`: found while building this skill (2026-10-15, claude 2.1.296, Windows),
they cannot run here and say nothing. `Popen(["claude"])` fails with `WinError 2` because `claude` is a `.cmd` shim; with
`claude.exe` on `PATH` it fails with `WinError 10038` because `select.select` is called on a pipe. Both are caught by a bare
`except` that prints one stderr warning per query, counts the query as "did not trigger", and exits 0 with `Results: 6/9
passed`: every should-not-trigger query passes and every should-trigger query fails. `select` on a pipe works on Linux and
macOS, so the official loop should run in cloud sessions (not tried here). If you use it, run it from the repo root so the
trial sees this library, with the plugin directory on `PYTHONPATH`, and read its stderr first (any `Warning: query failed`
voids the run):

```bash
SC="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
PYTHONPATH="$SC" python -m scripts.run_loop --eval-set "$TMP/train.json" --skill-path .claude/skills/<slug> \
  --model <the model id of this session> --holdout 0 --max-iterations 5 --verbose
```

`--holdout 0` stops `run_loop` from re-splitting your train rows. It writes temporary files into `.claude/commands/`; `forge.mjs
check` fails on a leftover `<name>-skill-<hex>.md`. Each query costs a `claude -p` turn: use `--model haiku` for the train loop.

## 5. Read the result

- Report `held-out: N of M correct` with the label counts. A pass rate on 9 queries is a smoke test, not a measurement.
- Report every held-out miss in the PR body, with the query. Change the description for a miss only if the TRAIN rows show the
  same pattern. If you change it after seeing a held-out result, say so: that number is no longer clean, and you do not re-split.
- A query that triggers an overlapping skill instead is a routing conflict: fix the other skill's "not for" line or yours.
