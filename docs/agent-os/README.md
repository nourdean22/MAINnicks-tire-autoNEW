# Agent OS — the repository's agent control plane

**Started 2026-08-04.** One canonical policy → thin vendor adapters → executable checks.

A markdown file can *influence* an agent; it cannot *guarantee* behavior. So this repo separates
the two: `AGENTS.md` carries judgment, and code carries enforcement.

## Layers, and what each one can actually promise

| Layer | Artifact | Promise |
|---|---|---|
| 1 · Canonical policy | [`AGENTS.md`](../../AGENTS.md) + `apps/*/AGENTS.md` | The single place a rule is written. Read by Claude, Codex, Copilot, Cursor, Gemini and humans. |
| 2 · Vendor adapters | `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `.antigravityrules`, `apps/*/CLAUDE.md` | Route their agent to layer 1. Thin and pointer-only **by construction** — line-capped by the parity check, so a second policy cannot quietly fork into existence. **Every** adapter must be in that check; the one that wasn't is the one that forked (see Known gaps). |
| 3 · Executable parity | `scripts/agent-os/check-adapters.mjs` | Adapters exist, point at their `AGENTS.md`, stay under cap; retired claims (`.husky/pre-*`, `push-main.sh`, "no CODEOWNERS", live `apps/voice`) stay deleted. |
| 4 · Local enforcement | `.claude/settings.json` hooks + `scripts/agent-os/` | Deny unsafe tool calls before they run; gate completion claims. Claude-only — see "Honest limits". |
| 5 · CI | [`.github/workflows/agent-policy.yml`](../../.github/workflows/agent-policy.yml) | Runs layers 3–4's checks on every PR, for every author, including humans. |
| 5b · CI, config scan | [`.github/workflows/agentshield.yml`](../../.github/workflows/agentshield.yml) | Scans layer 4's own config (`.claude/`) with `ecc-agentshield` (268 rules: hooks, MCP, permissions, secrets, agents). Advisory since 2026-10-16; the job goes red only when the planted fixture (`scripts/agent-os/fixtures/agentshield-canary/`) stops being flagged. Canary: `agentshieldCanary.test.mjs`. |

## Execution framework

`NOUR-COMMAND.md` is the default execution framework for non-trivial work; it is **not** a second engineering policy.
Root `AGENTS.md` remains authoritative on safety, branching, verification, and app routing. Claude and Gemini import
NOUR COMMAND directly; Copilot, Cursor, and Antigravity route to it from their always-loaded adapters. The parity checker
and its canary suite fail if the file, root route, or required imports/pointers disappear.

Detailed task routing lives in `docs/agent-os/NOUR-COMMAND-MODES.md`; Claude also exposes the explicit
`.claude/skills/nour-command/SKILL.md` router. Domain-specific skills still win when their narrower trigger applies.

## One command

```bash
pnpm agent:verify
```

`scripts/agent-os/verify.mjs` runs adapter parity, then **auto-discovers** every
`scripts/agent-os/*.test.mjs` and runs it under Node's built-in test runner.

That discovery is deliberate. Editing anything under `.github/workflows/**` flips `test.yml`'s
path filter and escalates CI from a ~1-minute security job to a full turbo sweep plus every
nickstire and statenour validator (~50 minutes). Adding a new guard should cost a file, not an
hour of CI — so new checks are dropped in as `*.test.mjs` and the workflow never changes.

**GitHub API budget.** CI's `GITHUB_TOKEN` gets ~1,000 requests/hour per repo, shared by every
workflow. verify.mjs prints `GitHub API requests this run: N` from the meter in
`github-client.mjs`. A LIVE canary that costs more than a handful of requests must be gated
through `scripts/agent-os/live-gate.mjs`: it runs only when the diff touches its own code (import
closure), on `workflow_dispatch`, or when forced (`AGENT_OS_LIVE_SWEEP=1`, `AGENT_OS_LIVE_RESCUE=1`,
`AGENT_OS_LIVE_GHCLIENT=1` for the sweep, repo-rescue and github-client canaries). The ungated
full-sweep canary cost 657 requests per run and 403'd every PR's CI on 2026-09-23; the 2-request
github-client canaries 403'd every PR whenever another workflow had spent the budget.

## Adding a rule

1. Write it in `AGENTS.md` (repo-wide) or `apps/<app>/AGENTS.md` (app-specific). **Not** in an adapter.
2. If it must be *guaranteed* rather than *followed*, add the check:
   - a structural invariant → extend `check-adapters.mjs`
   - a forbidden command or file-write → add a rule to `config/agent-os/policy.json`. Every rule
     MUST carry `why`, `fix`, ≥1 `denyExamples`, ≥1 `allowExamples` — `policy.test.mjs` fails
     otherwise, so an untested or undocumented rule cannot ship.
   - anything else → add `scripts/agent-os/<name>.test.mjs`
3. Run `pnpm agent:verify`.

## Layer 4 — what is actually wired (2026-08-04)

`.claude/settings.json` hooks, all engine logic in `scripts/agent-os/`:

- **PreToolUse** (`pretool.mjs`, matcher `Bash|PowerShell|Write|Edit|NotebookEdit`, plus a second matcher group for
  MCP and native runners and the SQL text tools, and a third that runs `lease-check.mjs` for the runners and writers,
  see "MCP and native-runner coverage") evaluates
  `config/agent-os/policy.json` (v2) and blocks with exit 2: pushes to `main` in any spelling,
  pushes with an **implicit destination** (bare `git push`, `origin`-only, `HEAD`/`@` refspec —
  they resolve to the current branch, which may be main), force-push (incl. bundled `-uf` and
  `+refspec`), `git add -A`/`--all`/`.`, `--no-verify`, the destructive-restore family
  (`reset --hard`, `checkout -- <path>`, worktree-writing `git restore`, `git clean -d/-f/-x`),
  `stash pop/apply/branch`, `git worktree remove` AND `rm -r`/`Remove-Item -Recurse` aimed at a
  worktree, the destructive-Prisma family (`--accept-data-loss`, `--force-reset`,
  `migrate reset`), destructive SQL *with a DB client on the line* (DROP and TRUNCATE, a `DELETE FROM` or an `UPDATE ... SET` with no
  WHERE, `ALTER TABLE ... DROP`), `pnpm install` inside a
  junctioned worktree, and writes to `.env*` files. Git rules expand a `__GIT__` macro so global
  options (`git -C <path> push …`) cannot slip between `git` and the verb — that exact shape
  defeated every git rule in the first draft (red-team, 2026-08-04, 22 verified bypasses → 0).
  **Chain boundary (2026-10-25):** a rule about ONE command's arguments scans `[^;|&\n]*?` after the verb, so it
  neither reaches into a later command nor lets a later command's text exempt this one (push-to-main, force-push,
  push-implicit-dest, add-all, destructive-restore, night-shift-push-scope, night-shift-no-merge). Rules that cross a
  chain ON PURPOSE: destructive-sql (the client and the SQL sit on either side of a pipe or heredoc),
  worktree-recursive-delete (destructive; the path can come from a subshell holding `;`), the night-shift shell-write
  rule's inline-script arm (`node -e "a; b"` holds `;`), infra-approvals-store-shell (any mention of the store path).
  **Doors (2026-10-25):** a file dirty for line endings only: `node scripts/agent-os/eol-restore.mjs <path>` (refuses a real
  edit); a stash entry you tagged `manager-*` or `session-*`: `node scripts/agent-os/stash-drop-tagged.mjs <tag>`, never by index.
- **PreCompact** (`precompact-handoff.mjs`, 2026-10-16) writes a handoff note BEFORE the context is compacted: branch,
  HEAD, ahead/behind `origin/main`, the Session Authority lease, uncommitted paths, the last 5 commits. It lands outside
  the repo (`~/.claude/agent-os/handoffs/<cwd slug>/`, newest 10 kept; `AGENT_OS_HANDOFF_DIR` overrides) so the tree
  `stop-check.mjs` judges stays clean. **SessionStart** with matcher `compact` runs the same script with `--recall`
  and prints the newest note (capped at 4,000 chars); other SessionStart sources print nothing. Mechanism taken from
  affaan-m/ECC ("persist everything else"); neither mode can block. Canary: `precompactHandoff.test.mjs`.
- **Operator asks** (`operator-asks.mjs`, 2026-10-17). A compaction summary is written from the model's memory and drops
  Nour's own words, above all a message typed while a turn runs: the transcript stores that as a `queued_command`
  attachment, not a user message. What it records: every operator message verbatim with its timestamp, typed prompts
  (origin, else `turnOrigin`, human; not meta, sidechain, tool result, compaction summary, or text that opens with a
  machine tag once `<system-reminder>` blocks are removed; a slash command as `/name args`) and `queued_command`
  attachments whose `origin.kind` is `human`. Where: `%LOCALAPPDATA%/nourcity/asks/<session_id>.md`
  (`OPERATOR_ASKS_DIR` overrides), one line per message, `- <timestamp> <typed|mid-turn> "<JSON string>"`, deduped on
  the text, append-only; a `<session_id>.state.json` beside it holds the byte offset already read. When:
  UserPromptSubmit and PreCompact run `--refresh` (silent); SessionStart with matcher `compact|resume` runs `--recall`,
  which refreshes and prints "Operator asks this session (verbatim, oldest first; N total; full list: <path>)": every
  ask within 24 h of the newest one (anchored on the asks, so a session resumed days later still shows its last day),
  each cut at 240 chars, under 6 KB, plus a count of the rest. How to read it: open the full-list path. **Privacy:** the
  file is machine-local and never enters git; nothing calls the network. Fails open (exit 0, a stderr note). Measured
  2026-10-17 on the manager's 43 MB transcript: first full scan 412 ms of script time, each later refresh 6-8 ms
  (wall about 520 ms, node start-up on a machine short of RAM). Across 288 local transcripts: 659 asks, 117 mid-turn,
  no machine text. Canaries: `operatorAsks.test.mjs` (15/15 mutants killed) and `hookCommand.test.mjs`.
- **Stop** (`stop-check.mjs`) blocks ending a turn with uncommitted work while ON `main` —
  one precise invariant, nothing else. A Stop hook that blocks routine turns trains the
  operator to disable it; widen only behind a canary.
- **Stop** (`skills-check.mjs`, 2026-10-17; Nour: "i dont have to ask why u arent using skills"). The reminders above
  only print; this one acts at the end of the turn. It reads the transcript from the end back to the turn's prompt
  (the last user entry that is not a tool result, meta, compaction summary, sidechain or task notification). If the
  turn ran a tool other than Skill (`mcp__ccd_turn__*` bookkeeping excluded) and no Skill call happened since the prompt,
  or, after a compaction, no always-on skill since it, the stop is blocked (exit 2) with a stderr line naming the
  always-on set plus the skills `skill-recall` printed for this prompt. Once per prompt (state:
  `%LOCALAPPDATA%/nourcity/skills-check/<session>.json`); `stop_hook_active` always passes; a skill loaded by a typed
  `/command` counts; conversation turns are silent; it fails open and never blocks when it cannot record the one-shot.
  This widens Stop on purpose, behind its canary (`skillsCheck.test.mjs`, 13/13 mutants killed, and
  `hookCommand.test.mjs`). Cost: 5-9 ms of script time on 36-45 MB transcripts; a compaction search over a whole
  16 MB file took 96-151 ms; past 24 MB it stops and allows.
  Turn truth (2026-10-22, job `2026-10-22-manager-skill-best`; Nour: "fix it forever"): the hook also sends a REPLY back,
  tools or not, once per reply START (the newest prompt or task notification: a notification-driven night is one prompt and
  many replies), when a `Skills:` line (also `Skill:`, `Skills used:`) names a real skill, case ignored, with no Skill
  call since the start (clauses holding a negation, "already" or "earlier", text after "used earlier" / "skipped" and after
  the first sentence claim nothing), when a clause calls CI, checks or a PR green, passing or mergeable with no CI read since
  the start (a command running `gh pr checks|view|status`, `gh run`, `gh api` on check runs or `node merge-gate.mjs <pr>`, or
  `ccd_pr get_status`; local, preflight and pre-commit runs are not CI), or when it calls something live or deployed with
  no production read (a command or WebFetch hitting `/api/health`, a heartbeat or either production domain, a Railway
  status/logs/deployment read, or a deployment or log MCP tool). Reading or grepping a file is never a read. The reply text
  is the Stop payload's `last_assistant_message` (the hooks docs: the transcript may not hold the final message at Stop).
  Replayed over 155 real manager turns: 22 of 128 `Skills:` lines, 1 stale CI tally and 3 relayed "is live" claims sent
  back, every one true; the 7 false alarms two replays and a skeptic found are now allow-examples.
- **Stop** (`health-first.mjs`, 2026-10-22, same job). A SessionStart `[health] ... FIX FIRST:` line is the session's
  first task: a stop is sent back once per such line unless a call that RUNS or EDITS something names one of its fixes (a
  script, config file, task or cmdlet; a read or grep of the script does not count) or a reply line starting `Health:` says
  fixed or why not. It reads only the bytes after the offset it last judged (state
  `%LOCALAPPDATA%/nourcity/health-first/<session>.json`), fails open, never blocks when it cannot save the offset. The
  manager session of 2026-10-21/22 ran with graphify DOWN for about a day past this exact line.
  Canaries: `healthFirst.test.mjs` and `hookCommand.test.mjs`.
- **SubagentStop** (`subagent-receipt-check.mjs`, same job; asked for by the manager session from its setup benchmark).
  Matcher `^lane-` (the agent's frontmatter `name`); for a lane agent, a final report with no receipt line (a command and
  its exit code on one line), no commit SHA and no diff is sent back to the LANE once (exit 2: the subagent keeps running
  with the stderr line as its next instruction, per the hooks docs read 2026-10-22). The research lane may cite
  `path:line` or a URL instead. It checks that evidence is present, not that it is true: the manager still re-runs one
  receipt. One-shot per `agent_id` (state `%LOCALAPPDATA%/nourcity/receipt-check/`), `stop_hook_active` passes, fails
  open. Canaries: `subagentReceipt.test.mjs` (a planted always-true copy of the gate lets the bare report through, so a
  gate that stops checking turns the file red) and `hookCommand.test.mjs`.
- **PreToolUse** rule `brief-shop-data` (same job): an Agent, Task or `mcp__ccd_session__start_session` brief that reads
  Nick's Tire records (a record noun such as invoice, estimate, decline or customers, a place such as nickstire or a
  nickstire lane, and a reading cue such as count, how many, SELECT or TiDB; file names are taken out first) must carry a
  line STARTING `SHOP DATA:` (a mid-paragraph label is a pointer, not the block; the Do: text says so since 2026-10-25) whose block (to the next field or blank line) names invoices and estimates; every .md or .txt
  file the prompt names is read too (up to 5, under 512 KB, the blank template skipped). A scout reported "0 declines ever
  captured" from a brief without these meanings. Canaries: `agentDispatch.test.mjs` (one feeds the real USER.md meanings
  to the rule). Not covered: SendMessage follow-ups to a running session, and agents a Workflow script starts.
- **UserPromptSubmit** (`skills-first-reminder.mjs`) prints one line on every prompt: invoke the skills the recall
  lines name before any work. It is advice, not enforcement: it has no path to exit 2, so it never blocks a prompt,
  and it cannot make the model comply. `skillsFirstReminder.test.mjs` runs the configured command verbatim and
  asserts the line, the sources it names, and exit 0.
- **UserPromptSubmit** (`skill-recall.mjs`, 2026-10-16, runs after the reminder) scores the prompt against the flat
  `<root>/<slug>/SKILL.md` files under the two roots the Skill tool provably resolves, `.claude/skills` and
  `~/.claude/skills` (58 repo names plus whatever the user root holds), and prints at most five
  `[skill-recall] invoke: <name> (<matched words>)` lines, or `none beyond the always-on set`. Not indexed: the plugin
  trees under `~/.claude/plugins` (on disk a loaded plugin and a catalog copy look the same, and a name taken from there
  was a failed Skill call for the reader, review round 3b) and any SKILL.md nested deeper than the slug directory (a
  draft or a reference, not loadable, round 5). BM25 over the description, name and `triggers:` tokens with a 3x
  boost, 1.5x for repo skills, term statistics from the repo cohort alone so a repo result never moves when user skills
  are installed, the seven names other hooks force every turn filtered out (scoped skills such as monorepo-manager and
  antislop score), a prompt capped at 2000 distinct terms taken from both ends, and one rule for both roots (review
  rounds 1 to 4): the floor, 7.5, plus a hit on a real name token or two matched terms, because one generic word
  inside a trigger phrase printed a skill on its own. Every repo SKILL.md carries a `triggers:` frontmatter line
  written from its own body; triggers score like name tokens. The numbers and why are comments on the constants. Also a CLI
  for lane briefs: `--text`, `--file <brief>` (lines that appear verbatim in the brief template are dropped first),
  `--json`, and `--scope global` for the user-level entry (silent inside a project whose own settings run the hook,
  never silent in the home directory itself, whose settings file is the user file; outside a repo the term
  statistics fall back to the user cohort, since a repo-only table with no repo scores every skill under zero).
  The index is cached in the OS temp dir, keyed by the roots' mtimes and the script's own source; nothing is written
  inside the repo. `skillRecall.test.mjs` runs the real script on hook-shaped stdin against a fixture home (so the
  suite reads the same on every machine): positive controls, the none line, the always-on filter, 500 synthetic user
  skills that must change nothing, five mutants, a corrupted cache, and a 2 s latency bound
  (measured 70 to 100 ms warm on the operator machine).
  **Why fail-open:** any error prints `[skill-recall] off: <reason>` and exits 0. Exit 2 on UserPromptSubmit blocks
  the prompt itself, so a bug in a recall helper would stop the operator from typing; a missing recall line costs one
  turn of routing and nothing else. The off line keeps the failure visible in the transcript instead of silent.
  What the docs settle (code.claude.com/docs/en/hooks, read 2026-10-16): UserPromptSubmit stdout is added to context;
  the hook fires on typed prompts, scheduled tasks, a background subagent reporting back, and cross-session messages.
  A subagent's own brief is not in that list, so lane agents get recall through the brief template instead.
- **UserPromptSubmit** (`tool-recall.mjs`, 2026-10-18, runs after skill-recall) scores the prompt against
  `config/agent-os/tool-recall.json` (MCP servers, plugins, lane agents, CLIs) with skill-recall's own exported scorer
  and floor, and prints at most four `[tool-recall] use: <name> (<kind>; <matched words>) <use>` lines, `[native: x]`
  when a repo skill already does the job; no match prints nothing. Fails open: `[tool-recall] off: <reason>`, exit 0.
  Canary `toolRecall.test.mjs` (real script, configured command verbatim, broken registry, no-floor mutant).
- **UserPromptSubmit** (`memory-recall.mjs`, 2026-10-22, runs right after tool-recall) searches the agent-memory notes
  themselves, not the MEMORY.md titles: every `*.md` in the machine-local `~/.claude/projects/<primary checkout>/memory`
  with a frontmatter `description` (the same directory check-memory-index guards, found from a harness worktree through
  `git --git-common-dir`; indexes, `_bak_*` copies and description-less files skipped), scored with skill-recall's exported
  scorer and floor. Prints at most three `[memory-recall] read: <file> (<matched words>) <description> [<N>d old]` lines;
  the age is the file's modified time, so a stale note reads as stale. No match, or no memory directory (a cloud session,
  another machine), prints nothing. Fails open: `[memory-recall] off: <reason>`, exit 0. Canary `memoryRecall.test.mjs`
  (planted memory directory, real script, configured command verbatim, three mutants: no floor, `_bak_` copies indexed,
  no line cap; plus a consumer check that the default resolution finds the real directory where one exists).
- **Always-loaded size** (2026-10-22): `CLAUDE.md` and `GEMINI.md` import `docs/agent-os/NOUR-RUNTIME-KERNEL.md` (4 KB),
  not the full `NOUR-COMMAND.md` (11.7 KB), which AGENTS.md still routes to for non-trivial work; `check-adapters.mjs`
  requires the kernel import and refuses a re-import of the full file. The skill-discovery and subagent essays live in
  `.claude/skills/find-skill/references/` and `.claude/skills/monorepo-manager/references/`; the profile keeps the rules.
- **SessionStart** (`session-surface.mjs`, 2026-10-18, every source) prints one `[surface]` line: user+project hook
  events, MCP names (user, local, `.mcp.json`; claude.ai connectors are "not readable here"), enabled plugins, and
  rtk/uv/gh/railway on PATH (looked up, never run). Each segment reads on its own; a failed read is `UNKNOWN (<reason>)`,
  never 0 or none. Exit 0 always. Canary `sessionSurface.test.mjs` (fixture home, missing files, PATH controls, mutant).
- **SessionStart** (`session-health.mjs`, 2026-10-19, every source, right after session-surface) prints one `[health]`
  line for the local code-intelligence setup in `config/agent-os/local-services.json` (hosts, servers, clients, tasks,
  plus the machine and site inventory): graph freshness (primary `graphify-out/graph.json`, build commit vs
  origin/main, STALE over 50 behind), each MCP server (TCP 300 ms), each client's MCP entry (`~/.claude.json`,
  `~/.codex/config.toml`, VS Code `mcp.json`), PowerShell hooks missing `-ExecutionPolicy Bypass`, and the scheduled
  tasks (Windows). Each FAIL is followed by its fix under `FIX FIRST:`; a failed read is `UNKNOWN (<reason>)` with no
  guessed fix; a host not in `hosts` prints one not-expected line; budget 1.5 s; exit 0 always, own errors print
  `[health] off: <reason>`. Tailscale presence is information only (`TAILNET-MCP.md`). Canary `sessionHealth.test.mjs`
  (healthy and broken fixtures, real sockets, a 55-commit fixture repo, mutants); `hookCommand.test.mjs` asserts every
  PowerShell hook carries Bypass (Windows PowerShell 5.1 on NATTYNOUR is Restricted, so the graphify briefing was
  silently off until 2026-10-19).
  - Scripts it names as fixes: `scripts/local-mcp-servers.ps1 -Start|-Status|-Stop` (the shared graphify HTTP server on
    the MAIN checkout; Serena was trialled and rejected, `docs/UPSTREAMS.md`), `scripts/register-local-mcp-task.ps1`
    (AtLogOn task NOURCITY-Local-MCP), `scripts/graphify-sync-launcher.ps1` and `scripts/register-graphify-sync-task.ps1`
    (daily 04:00; brain ingest only with `-IngestBrain`).
- **Session workflow (2026-10-16, job session-workflow-upgrade PR 1).** All machine-local state lives in
  `%LOCALAPPDATA%/nourcity/`, outside the repo. Tested, not live until merged: hooks load from the primary checkout.
  - `heavy.mjs run -- <cmd>`: one machine-wide lease for heavy runs (20 min expiry, dead-pid takeover); waits while the
    `chrome` slot is held (`take`/`release --slot chrome`, 30 min) or free RAM is under 1500 MB. lefthook's
    agent-os-verify, both typechecks and build:affected go through it with `--max-wait 90s`: a hook waits at most
    90 s, then fails the hook ("heavy lease busy: retry the commit", exit 1, no child; since 2026-10-21, after four
    unleased fall-throughs ran out of memory on 2026-10-19). A hook that cannot get the lease fails the commit: retry,
    never bypass. A plain `heavy run`
    waits up to 35 min, then exits 3. Its own errors (an unwritable lock dir) fail open: it runs unleased. A signal
    kills the child before the lease is released. `heavy.mjs status` shows the holders.
  - `board.mjs` (UserPromptSubmit `hook`): at most 3 lines of what changed since this session last looked (main moved,
    a PR went red, the heavy holder), from `board/board.json`; a cache over 60 s starts a detached refresh (one
    `gh pr list`); over 10 min old it prints STALE; a failing `gh` prints `PR list unavailable: <error>` once per error. `node scripts/agent-os/board.mjs` prints the whole board.
  - `stuck-watch.mjs` (PostToolUse and PostToolUseFailure `--post`, PreToolUse `--pre`, every tool, matcher `""`): the
    same call with the same result on an unchanged tree nudges on the 3rd and 4th repeat and is denied on the 5th. A
    failed call (non-zero Bash exit) fires PostToolUseFailure, and its `error` is the result. State is keyed on
    `agent_id`, else `session_id`, so parallel lanes do not reset each other. Durations and timestamps are ignored;
    Monitor-style tools are exempt; read-only polling (Read, Grep, Glob, an unchained `gh` or `curl`) is nudged, never
    denied; it fails open. A call denied before it runs fires neither post event, so it is not counted. Cost: about
    100 ms per call, plus a `git status` only on a repeat. The call's identity is its input minus `description`,
    `action_summary` and `timeout` (2026-10-17): the model rewrites those on every retry, and while they were hashed,
    5 identical failing commands scored a streak of 1 each in a live session.
  - `lane-dispatch-brief` (policy.json, `Agent|Task` routed to pretool.mjs): a `lane-*` dispatch needs `model`, a brief
    file (a token whose basename contains `brief` and ends `.md`; not a URL, not the word in prose) and a
    `MODEL / EFFORT` line. Not checked: the Agent tool's own `effort` field (the lane line carries `model` only).
  - `session-dispatch-brief` (policy.json, 2026-10-25, job session-rules-mechanical): a `mcp__ccd_session__start_session`
    call needs `model`, `effort`, a brief file and a `MODEL / EFFORT` line, the file and the line in `prompt` or
    `background`. start_session inherits the parent's model and effort when they are omitted; four sessions ran on Fable
    that way on 2026-10-25. Judged on `session-start model= effort= brief= model-effort-line= shop-data=`. A fork needs
    them too, though the tool applies `model` and `effort` to fresh sessions only (the Do: text says start fresh when the
    tier must differ). A `proposal_id`-only start and a title-only offer carry no brief and pass: the brief was judged
    when proposed, or is judged when it is sent with `proposal_id`. Canaries: `agentDispatch.test.mjs`. Not checked:
    that the named brief file exists, that the model value is a real id, `target: cloud` (the tool ignores both fields).
  - Limits, not built: no heartbeat while a long heavy run holds the lease (only the 20 min expiry ends a hung one);
    a headless `claude -p --agent <lane>` dispatch never passes through the Agent tool, so the lane rule cannot see it.
- **Failure posture is asymmetric on purpose:** a matched rule fails CLOSED; a bug in the hook
  itself fails OPEN with a stderr warning. Bricking every tool call is worse than missing one
  check, and Claude Code fails open on hook crash/timeout anyway — pretending otherwise is theatre.
- **Mention ≠ execution — handled, narrowly.** Quoted `-m/--message/--title/--body` arguments are
  replaced with `<ARG>` before matching (a commit message *discussing* `git push origin main` is
  data), and a single **unchained** read-only command (`rg`, `grep`, `git log/show/diff/grep`,
  `cat`…) skips command rules entirely — any chaining character disarms the skip, so
  `rg x && git push origin main` still blocks. Everything else is still matched as text: an
  `echo` quoting a forbidden string gets blocked (safe direction — `sh -c "…"` quoting IS
  execution); put test payloads in files and pipe them. Discovered live when this layer's own
  e2e test blocked itself.
- **There is deliberately no bypass env var.** Changing a rule means editing `policy.json` in a
  PR where the diff is reviewable. That includes `infra-mutation-tool` ("Infra tools: deny by name" below): an override for it
  was built first and removed after review, and a canary asserts that an `AGENT_OS_INFRA_OVERRIDE` in the environment changes nothing.

### Shared deps: one store, one install (2026-10-17)

Every worktree's `node_modules` is a junction into the primary checkout's. On 2026-10-17 a session in the primary ran
`pnpm --filter @statenour/web add ts-fsrs`; pnpm pruned vite from the shared store and every worktree's nickstire tsc
and vitest broke at once. Two layers now cover it:

1. **Rule `shared-deps-mutation`** (policy.json, Bash, PowerShell, the Terminal MCP and Monitor, any cwd): denies
   `pnpm|npm|yarn` add, remove/rm/uninstall, update/up/upgrade, prune, and any install carrying `--filter`/`-F`, the
   filter before or after the verb. Allows the full unfiltered `pnpm install [--frozen-lockfile]`, scripts, exec,
   global (`-g`) installs, and a mention (echo, grep, a commit message). No cwd condition: in a worktree
   `install-in-junctioned-worktree` is checked first and keeps its verdicts, and this rule also catches the
   filter-before-verb shape that rule never matched. A "while any linked worktree exists" condition was skipped: on this
   machine one always exists, and it would need a git or fs probe on every tool call.
   The sanctioned path for new or changed deps: the scratchpad-clone recipe in
   `.claude/skills/harness-worktree-setup/SKILL.md` section 3, then a full unfiltered `pnpm install --frozen-lockfile` in
   the primary by the operator or a primary-checkout session when no sibling session is mid-run.
   Desktop Commander's `start_process` / `interact_with_process` rows are exempt (`exceptRules`), as they already were from
   the worktree rule: DC runs in its own cwd, and it is the runner the scratchpad-clone recipe installs through.
   **Recorded decision, not a hidden hole (fix round 1, 2026-10-17):** Desktop Commander pointed at the primary checkout
   can still run a filtered or package-changing command, including the incident command, because the hook cannot see a
   process's cwd. Kept because closing it would close the only working path for new deps; `deps-check.mjs` reports
   the result at the next session start if it happens.
   Linear by construction: each option token has one parse, the option chain is capped at 12 and every scan is
   bounded (the first draft split `--x` two ways and went exponential; `sharedDepsRule.test.mjs` > LINEAR pins it).
   Fix round 1 also denies `npm install <pkg>` / `npm i <pkg>` (a positional package; `npm install` alone and `npm ci`
   stay allowed), `pnpm dedupe` / `npm dedupe`, and `yarn workspace <x> add|remove`.
   Not covered (text-only judge): `Start-Process pnpm -ArgumentList ...`, and a heredoc body line (denied, a false
   positive: write the file with the Write tool). AGENTS.md > Commands, the CIITTY skill and both `agent-os/*/tech-stack.md`
   files now say the same thing; `sharedDepsRule.test.mjs` fails if any of them recommends `--filter "<app>..."` again.
2. **`scripts/agent-os/deps-check.mjs`** (SessionStart, matcher `startup`): one line about the PRIMARY's tree (from a
   worktree it follows the `.git` file). For the root, `apps/*` and `packages/*`, every `dependencies` and
   `devDependencies` entry must resolve to `node_modules/<name>/package.json` in the workspace or an ancestor up to the
   repo root. `[deps] OK (N workspaces, M deps)` · `[deps] FAILED: <ws> missing <pkgs>; <fix>` · `[deps] UNKNOWN: <why>`
   (a read error, no package.json, no node_modules at all). Never OK on an error; exit 0 always. Median 198 ms
   (2026-10-17, 7 runs; `node -e 0` was 103 ms). Run it by hand any time: `node scripts/agent-os/deps-check.mjs`.
   Canaries: `scripts/agent-os/depsCheck.test.mjs` and `sharedDepsRule.test.mjs`.

### Worktree sweep: finished worktrees clean themselves up (2026-10-17)

About 64 lane worktrees had piled up under `.claude/worktrees/`; each was torn down by hand after proving its HEAD was in
a merged PR. That proof is now one command, added to `scripts/agent-os/repo-status.mjs` (the script that already reads
every local worktree, its lease and its dirty state), and the remover is still `scripts/worktree-teardown.ps1`:

    node scripts/agent-os/repo-status.mjs --sweep             # dry run: counts per class, then class + reason per worktree
    node scripts/agent-os/repo-status.mjs --sweep --execute   # tears down LANDED only

Every worktree under `.claude/worktrees/` and `.worktrees/` (never the primary checkout) gets one class. Only `agent-*`
children of `.claude/worktrees/` and worktrees under any `.worktrees/` (nested ones inside a session worktree too) can
ever be LANDED. Desktop session worktrees carry no harness lock and commit on PR branches in their own cwd, so an idle
session whose PR merged looked LANDED to the first draft (manager review 2026-10-17); SESSION closes that.

| Class | Means | Removed by `--execute` |
|---|---|---|
| LANDED | a MERGED PR whose head is HEAD or whose commit list holds HEAD (`gh pr view <n> --json state,commits,headRefOid`); clean tree | yes |
| OPEN_PR | the branch has an open PR | no |
| NO_PR | no open or merged PR (closed-only PRs are named in the reason) | no |
| DIRTY | uncommitted or untracked files | no |
| ACTIVE | the caller's own worktree, a harness lock (`locked claude agent ...`), any tracked or untracked file or the branch reflog modified in the last 2 h, or a live Session Authority lease (local marker or GitHub) | no |
| DETACHED_UNKNOWN | detached HEAD: no branch to find a PR by | no |
| SESSION | a direct child of `.claude/worktrees/` not named `agent-*`: a Claude Desktop session's own cwd (e.g. `musing-ramanujan-25e4e3`). Checked before any read; the app's archive removes it | no |
| UNKNOWN | gh, the lease read or any local read failed, or a merged PR does not hold HEAD (work after the merge) | no |

`git cherry` and ahead counts are never consulted: squash merges make both lie. With `--execute`, each LANDED worktree is
re-classified immediately before its teardown, then removed through `worktree-teardown.ps1 -ForceDirtyRelease` (needed
because the remote branch is gone after the merge), one at a time, run from the primary checkout. The known libuv crash in
`agent-finish.mjs` gets one retry; any other failure keeps the worktree and says why. "Removed" means the worktree is no
longer registered with git, read back after the teardown. Exit 1 only when a LANDED worktree could not be torn down.

`merge-gate.mjs --merge` runs the same sweep, with `--execute`, for the worktree(s) holding the head it just merged, once
the PR reads MERGED, and prints `SWEEP: removed ...` or `SWEEP: kept ...: <class> (<reason>)`. A sweep failure is logged
and never changes the merge's exit code. A lane worktree that committed less than 2 h before the merge is ACTIVE and is
kept; the next `--sweep --execute` removes it. A Desktop session worktree holding the merged head is kept as SESSION.
Remaining risk: the SESSION rule is a naming convention. A session worktree named `agent-*`, or one placed directly
under a `.worktrees/` folder, gets no SESSION protection. Only the lock, the 2 h window and the lease guard it there.

**Codex wait (2026-10-18).** #3134 and #3141 merged on green CI about 3 minutes before Codex posted P1 findings, and the
agent-policy CI gate runs too early to see them. `merge-gate.mjs` now also reads Codex's `codex-review-state:v1` marker
for the head SHA and the PR's review threads (`assessCodex`): `running` or no marker yet is NOT READY (exit 7), unresolved
findings or any unresolved `chatgpt-codex-connector` thread is BLOCKED (exit 2), and a marker that does not parse holds
like `running`. A marker for an older SHA counts as none, and Codex did not re-review the fix push on #3139. Two
fail-opens, both timed from the head's first CI start (or PR open if later; the commit's committedDate only as a WARNed
fallback, since it can predate the push, #3142): no marker after `--codex-wait-minutes`
(default 25) logs `WARN: Codex never reported on <sha>; merging without its review`, and still `running` at twice that
(default 50, a stall: Codex finishes in 3 to 9 min) logs `WARN: Codex review still running on <sha> after <n> min; merging
without its result`. Findings and unresolved Codex threads never time out. Without `--merge` the WARN says `would merge`.
Comments are read newest page first through GraphQL, stopping at the marker that decides the head: `gh pr view --json
comments` returns only the first 100, which hid a later marker (Codex P2 on #3144). Past 2,000 comments it is BLOCKED.

Canaries: `scripts/agent-os/worktreeSweep.test.mjs` (real fixture repos: a bare origin, a primary, worktrees; fake `gh`,
lease and clock; one arm runs the real teardown script) and the sweep arms of `mergeGate.test.mjs`.

## MCP and native-runner coverage (2026-10-15)

**The gap this closes.** `pretool.mjs` used to be registered only for
`Bash|PowerShell|Write|Edit|NotebookEdit`, and every rule in `policy.json` carries a `tools` allowlist, so
the same forbidden command sent through any other tool that runs commands or writes files was never judged.
Probed through the real hook on 2026-10-15: `git push origin main` exited 0 through the Terminal MCP, Desktop
Commander and the native `Monitor` tool, and a `.env.local` write exited 0 through an MCP file tool.

**How it works.** `mcpAdapters` in `config/agent-os/policy.json` maps a tool call onto the logical tool the rules
already understand (Bash or Write). `adaptToolCall()` in `policy.mjs` does the mapping, `pretool.mjs` judges each
mapped call with the unchanged `evaluate()`, and a second `PreToolUse` matcher group in `.claude/settings.json`
routes those tool names to `pretool.mjs` (a third group runs `lease-check.mjs` for the runners and writers, below). No
rule text is duplicated: every existing rule applies through the adapters, judged with the session cwd. Two row-level
narrowings: the two Desktop Commander process rows skip `install-in-junctioned-worktree` (`exceptRules`, below), and
the four SQL text rows are judged by `destructive-sql` alone (`onlyRules`, below), because their text is SQL. One row, `infra-name`,
judges the tool NAME instead of a field (`nameAsText`, below): the infra mutation tools carry no text at all.

| Adapter | Tools (matched by name SUFFIX, so both Desktop Commander registrations hit) | Judged as | Field read |
|---|---|---|---|
| `terminal-run` | Terminal MCP `run_in_terminal` | Bash | `command`; the tool's `cwd` is judged too |
| `process-start` | Desktop Commander `start_process` | Bash | `command`; exempt from the worktree-install rule (`exceptRules`) |
| `process-input` | Desktop Commander `interact_with_process` | Bash | `input`, with a `psql` hint (`clientHint`) so bare SQL typed into a REPL is judged; EVERY rule applies, so ordinary prose typed into a REPL that holds a denied statement shape (`DELETE FROM` or `UPDATE ... SET` with no WHERE, `DROP`/`TRUNCATE`, `ALTER TABLE ... DROP`) is denied too; same exemption |
| `monitor` | native `Monitor` | Bash | `command` (the `ws` form has none) |
| `file-write` | `write_file`, `edit_block`, `write_pdf` | Write | `path`, `file_path`, `outputPath` |
| `file-edit` | filesystem MCP `edit_file` | Write | `path`; a strict `dryRun: true` is not judged (`skipWhenTrue`) |
| `file-move` | `move_file` | Write | `source`, `destination`, and the files below a moved directory (`expandDirectory`) |
| `neon-sql` | Neon `run_sql`, `explain_sql_statement` | Bash | `sql`, judged as SQL sent to a `psql` client (`clientHint`) |
| `neon-sql-transaction` | Neon `run_sql_transaction` | Bash | each element of the `sql_statements` list on its own, never joined, within the list budget (`ARRAY_MAX`, `ARRAY_CHAR_BUDGET`) |
| `neon-migration-apply` | Neon `complete_database_migration` | Bash | `migration_sql` (`prepare_database_migration` runs on a temporary branch and is not judged) |
| `prisma-sql` | Prisma Postgres `execute_sql_query`, `execute_prisma_postgres_schema_update` (connector and Prisma-Remote registrations) | Bash | `query` |
| `infra-name` | the Railway, Neon, Vercel and Prisma infra mutation tools listed under "Infra tools: deny by name" (matched on the last name segment, whatever the server) | Bash | none: the tool NAME (`nameAsText`), judged by `infra-mutation-tool` alone |

**Optional row fields.** Each is validated at run time and pinned by a canary. A malformed `clientHint`, `skipWhenTrue`
or `expandDirectory` skips that row with a stderr line; a malformed `exceptRules` or `onlyRules` is reported and that
field alone is ignored (every rule applies); a malformed `rawText` is reported and the text is judged both ways, as a
shell command and as raw SQL, and denied if either denies. Each fails toward MORE denials, never fewer:

- `cwdField`: an input field that names the directory the command runs in (`run_in_terminal.cwd`). It is judged in
  addition to the session cwd, so a decoy value can add a judgment but never remove the session's. Accepted
  over-blocking: a worktree session's install through the Terminal MCP with an explicit non-worktree `cwd` is still
  denied, because the session cwd is judged too; the sanctioned global-install path is Desktop Commander.
- `exceptRules`: rule ids that are NOT applied to the calls a row produces. Only `process-start` and `process-input`
  have one, and only for `install-in-junctioned-worktree`. That rule protects a worktree's junctioned `node_modules`
  and is keyed to the cwd a PROCESS runs in; Desktop Commander runs processes in its own cwd, not the session's, so the
  rule would deny the sanctioned global-install path (`.claude/skills/harness-worktree-setup/SKILL.md`, lines 86-87).
  The night-shift rules are session-scoped (they restrict the unattended session wherever its shell runs), so they
  keep judging the session cwd on those rows. Every id must exist in `policy.json`: a malformed list or an unknown id
  (a typo) is reported on stderr and the row's whole exemption is ignored, so the rule APPLIES. A mistake here can only
  add denials.
- `clientHint`: a word prefixed to the field text before the rules run, so text typed into a client is judged as if
  sent to it. `process-input` and the four SQL text rows have one (`psql`): bare `DROP TABLE x;` typed into a psql REPL
  that an earlier call started, or sent to Neon `run_sql`, meets `destructive-sql`. On `process-input` a single read-only
  search (`grep -rn "DROP TABLE" docs/`) is left alone. Any other typed text that holds a statement shape the rule denies
  (the listed DROP kinds, `TRUNCATE`, a `DELETE FROM` or `UPDATE ... SET` with no WHERE, `ALTER TABLE ... DROP`) is denied,
  ordinary prose and an `echo` of it included: with the hint on, a mention cannot be told from an execution.
- `skipWhenTrue`: field names whose strict boolean `true` means the tool previews and writes nothing (`dryRun`).
  `"true"`, `1` and `{}` still judge. Only `file-edit` has it: no other file tool documents `dryRun`, and a server
  that ignores an unknown one would write anyway.
- `expandDirectory` (`{from, to}`): when `from` is a directory, each file below it is judged as `to/<relative path>`,
  so `.env*` files or night-shift judge files inside a moved directory meet the path rules. Names only.
- `onlyRules`: the ONLY rule ids a row's calls are judged by (the reverse of `exceptRules`, an allowlist, so a rule added
  later does not silently apply). The four SQL rows have `["destructive-sql"]`: before it, every shell rule judged SQL
  text, so an `INSERT` of the words `git push origin main`, `npm install`, `git stash pop` or `--no-verify` was denied
  as a shell command. Every id must exist in `policy.json` AND be able to judge the row's tool (`secret-file-write` is
  Write-only: on a Bash row it would judge nothing, so a typo could switch the row off); a malformed list, an unknown id
  or such an id is reported on stderr and the field is ignored, so EVERY rule applies (only ever more denials). A row
  whose `onlyRules` is exactly `["destructive-sql"]` also judges a field whole up to `SQL_FIELD_CAP` (1,000,000
  characters), because only that rule's scans are anchored, bounded and match each character one way (the hyphen,
  ambiguity, class and quadratic axes pin it); any other list keeps `FIELD_CAP`.
- `rawText`: a strict boolean `true` (only on a Bash row) judges the text as raw SQL: no shell neutraliser and no
  read-only-search skip. The four SQL rows have it: the neutraliser erases the quoted argument after ` -m`, ` -t`,
  ` -b`, `--message`, `--title` and `--body`, which in SQL can hold statements (`SELECT ' -m "'; DELETE FROM leads; SELECT '
  " '` passed), and SQL that merely starts like a search command (`rg DELETE FROM leads`) is still SQL. Absent or `false`
  keeps the shell treatment. A `rawText` row also reads `&`, `|` and `-` as SQL, not shell (see "How `destructive-sql`
  reads SQL"), which erases `--force`, `--no-verify` and `-A` as well: that is only sound for `destructive-sql`, so a
  canary requires every row with `rawText` true to have `onlyRules` exactly `["destructive-sql"]`. A value that is
  declared but malformed (the string `"true"`, `1`, `null`) on a Bash row is reported and judged BOTH ways, as a shell
  command (neutraliser, every rule of the row) and as raw SQL, and denied if EITHER denies: ignoring it would switch the
  neutraliser ON, and reading it as `true` alone would erase the flags of a shell row, each hiding what the other
  reading sees, so a typo can only add denials (on a shell row it may add a false one). The shell door is unchanged: a
  commit message that mentions SQL is still data there.
- `nameAsText`: a strict boolean `true` (only on a Bash row) makes the judged text the TOOL NAME instead of an input field, so a row
  needs no `commandFields`. Only `infra-name` has it, with `onlyRules` exactly `["infra-mutation-tool"]`; it carries no `rawText`, because
  `rawText` replaces `-` and the Railway names are made of hyphens. A value that is declared but malformed (`"true"`, `1`, `null`) is
  reported and the name is judged anyway; a bad optional `commandFields` list on such a row is reported and ignored, never the row. Toward
  denial again. With only `infra-mutation-tool` running, the name is judged whole up to `SQL_FIELD_CAP`: the rule is one anchored
  alternation of literals after a single `.+`, linear in the name (the hyphen, underscore and 100,000-character sweep in
  `mcpInfraDeny.test.mjs` pins it, with a nested-quantifier positive control). A row whose rule id does not exist is reported and the `onlyRules` ignored.
- A named field may hold a **list of strings** (`neon-sql-transaction`: `sql_statements`). Each element is judged on
  its own, never joined with its neighbours, with provenance `<row>.<field>[i]` (the index in the original list).
  Elements are judged in order until `ARRAY_MAX` (2,000) elements or `ARRAY_CHAR_BUDGET` (1,000,000) characters in
  total have been judged, then ONE stderr line says the rest were not. An element larger than what is left of the
  budget is judged as head and tail slices of the remainder (a huge statement after a small one is judged, not
  skipped), and then nothing is left. Null, numbers, objects and nested lists are ignored (the tools' schemas reject
  them). A plain string given for a list field is judged as a string. The reader serves every named field, so a list
  in a command field is judged too, which can only add denials. Measured cost: see "How `destructive-sql` reads SQL".

Design rules, each pinned by `scripts/agent-os/mcpCoverage.test.mjs`:

- **Only the named fields are read.** File content, `old_string`, `new_string` and every other string are never
  scanned, so Gmail, Linear and any tool that merely carries text stay untouched. A tool with no adapter row is
  not judged at all.
- **Native tools are never adapted.** `Bash`, `PowerShell`, `Write`, `Edit` and `NotebookEdit` short-circuit
  before the table is read, so no table edit can change how they are judged.
- **Same posture as the rest of the hook.** A matched rule exits 2. A malformed row is skipped with a
  `[agent-os] pretool MCP adapter problem` stderr line and costs only that row. Any other bug in the new code
  fails open with a stderr line. Missing, non-string and malformed fields never throw.
- **Oversized fields.** A row that runs every rule judges at most `FIELD_CAP` (20,000) characters of a field; a longer
  field is judged as two slices, the first and the last 10,000 characters, each on its own: joining them would build a
  command the field never held (a client word at the end of the head plus a statement at the start of the tail). Some
  rules backtrack, and a hook timeout fails open silently, which is why the cap exists. A row whose `onlyRules` is exactly
  `["destructive-sql"]` (the SQL rows) runs that rule alone, whose scans are anchored, bounded and match each character one
  way, so it judges a field whole up to `SQL_FIELD_CAP` (1,000,000) and slices (500,000 each end) only beyond that. The
  unjudged middle of a field over its cap is a slip window. Native Bash and PowerShell commands are not capped
  (`destructive-sql` costs at most about their length times 5,000 steps, and about their length on text with no
  `DELETE FROM` or `UPDATE ... SET`; the other rules were never measured on megabytes).
- **Directory moves** are walked read-only: names only (no file content), breadth-first, at most 2,000 entries and
  depth 6, symlinks and junctions never followed, and any filesystem error means no extra judgments. Over the cap,
  what was walked is judged and one stderr line says the rest was not (`directory too large to inspect fully`).
- **The matchers.** The pretool group is `^(?:Monitor|mcp__.+__(?:run_in_terminal|start_process|interact_with_process|write_file|edit_file|edit_block|write_pdf|move_file|run_sql|run_sql_transaction|explain_sql_statement|complete_database_migration|execute_sql_query|execute_prisma_postgres_schema_update))$`;
  the lease group is the same without the six SQL suffixes.
  Claude Code reads a matcher with any character beyond letters, digits, `_`, `-`, space, `,` and `|` as a
  JavaScript regex tested unanchored (code.claude.com/docs/en/hooks), so the pattern carries its own `^...$` and
  means the same anchored or unanchored. The canary checks both readings agree on every sample tool name, and
  that the pattern routes the intended names and nothing else.
- **`lease-check.mjs` also fires for the runners and writers (2026-10-15).** A third `PreToolUse` group, whose matcher
  is the runner and writer matcher without the SQL suffixes, runs `lease-check.mjs` ONLY; the pretool group keeps
  `pretool.mjs` and the original group is untouched. The script is unchanged: it reads `payload.cwd` and
  `tool_input.command`, which the runners carry. A foreign unexpired lease marker now blocks a Terminal MCP, Desktop
  Commander, `Monitor` or filesystem-MCP call exactly as it blocks Bash, and the `agent-finish.mjs` recovery command
  still passes through `run_in_terminal`, `start_process` and `Monitor`. `interact_with_process` has no `command`
  field, so the recovery exemption cannot apply to it (it is not how the block message says to recover). The SQL text
  tools are not routed to it: they never touch the worktree. Cost: throttled no-marker warnings on these calls.
  **Accepted limits: `lease-check.mjs` is a session-level tripwire, not a path guard.** It reads only `payload.cwd` (the
  session's directory) and `tool_input.command`. So (1) a session that holds its own lease can run a Terminal MCP
  command in a worktree held by a FOREIGN lease through `run_in_terminal`'s own `cwd` argument, and (2) a writer payload
  that carries a `command` field is judged by the recovery-command exemption (a `write_file` call with
  `command: "node scripts/agent-os/agent-finish.mjs"` passes). Neither is fixed (no change in `lease-check.mjs`);
  `lease-check.test.mjs` pins both as documented limits. The authoritative guarantee stays the ref compare-and-swap at
  `agent-start.mjs` time.

**Adding a runner or file tool.** (1) Read the live tool definition and copy the exact field names. (2) Add a row
to `mcpAdapters` with at least one real tool name in `exampleTools`. (3) Add the tool-name suffix to BOTH matchers in
`.claude/settings.json`: the pretool group and the lease-check group (a runner or writer runs `pretool.mjs` and
`lease-check.mjs`). The registration canaries fail until the table, both matchers and the shapes agree (`routingProblems()`
names every tool whose pair of hooks is wrong). (4) Add the tool to `COMMAND_SHAPES` or `FILE_SHAPES` in
`mcpCoverage.test.mjs` with the live field names. (5) Run `node --test scripts/agent-os/mcpCoverage.test.mjs
scripts/agent-os/lease-check.test.mjs`.

**Adding a SQL text tool.** Read the live tool definition, add a row with `clientHint: "psql"`, `rawText: true` and
`onlyRules: ["destructive-sql"]` that names its SQL field (a list field works too), add the tool-name suffix to the
PRETOOL matcher only (never the lease matcher), and add the tool to `SQL_SHAPES` in the canary so every registration runs
end to end through the real hook.

### How `destructive-sql` reads SQL (2026-10-15)

One rule id, one anchored pattern (`^`), gated on a DB client word (`mysql`, `psql`, `railway run`, `prisma db execute`,
`Invoke-Sqlcmd`) or on the `psql` hint of an MCP SQL row. It reads text, so it is built to see through what a shell or a
client does to that text:

- **Quoted identifiers, most spellings.** `TRUNCATE` and `UPDATE` accept a first identifier in plain, `"double"`, `` `back` ``
  or `[bracket]` form, schema-qualified, with the escapes a shell adds around the quote: `\"Task\"` (bash), `` `"Task`" ``
  and `""Task""` (PowerShell), `` \`leads\` ``, and nested shells (`\\\"Task\\\"` is three backslashes and a quote, seven
  for a third level, a run of PowerShell backticks): up to 12 quote-like characters on each side of the name. This
  matters because statenour's 15 PascalCase Prisma models exist ONLY as quoted names such as `"Task"`. The spellings that
  still pass are listed under "What the SQL rule still misses".
- **Written-out whitespace.** Between keywords, and before a `WHERE`, a literal backslash-n, -r or -t (`printf 'a;\nb'`,
  `$'DELETE\nFROM'`), a PowerShell `` `n ``, `` `r ``, `` `t `` or a backslash-newline counts as whitespace, and a keyword may
  start right after one.
- **Where a missing WHERE is decided.** A `DELETE FROM` or `UPDATE ... SET` is denied unless a `WHERE` appears before the
  end of ITS statement. The scan stops at: `;`, `&&`, a lone `|` (not `||`, which is SQL string concatenation), and a
  following `-c`, `-e`, `-f`, `-q`, `-Query`, `--command`, `--execute` or `--file` flag, or a short-flag CLUSTER that ends
  in one of c, e, f or q (`-tAc`, `-qc`, `-Xc`, `-1c`, mysql `-Ne`). It does NOT stop at a newline
  (a multi-line statement is normal), at `||`, at a single `&` (`'AT&T'`) or at the closing quote of the shell argument
  (that cannot be found linearly), and it gives up after 5,000 characters: a `WHERE` farther than that from its `DELETE
  FROM` or `SET` does not count (denied; the safe direction). So a WHERE in a later `-c`, a chained `&&` command or a
  piped command no longer rescues a bare write, while `UPDATE t SET a = b || c WHERE id = 1` and a multi-line
  `DELETE FROM leads` + newline + `WHERE id = 3` pass. A `||` chain is not a boundary by itself (a second `-c` after it is).
  The `ALTER TABLE ... DROP` scan uses the same stops and gives up after 1,500 characters, and its `DROP` may follow a
  written-out whitespace like every other keyword; `DROP COLUMN` and `DROP CONSTRAINT` are denied anywhere by the
  DROP-kind arm, so only the other `ALTER TABLE ... DROP` forms (`DROP phone`, `DROP FOREIGN KEY`) depend on it.
  **On the SQL tool rows only `;` ends a statement.** There is no shell there: `||`, `&&`, a lone `|`, `?|` and a
  leading minus are SQL operators, so the engine replaces `&`, `|` and `-` by a neutral non-word character before it
  judges text of a `rawText` row (every `\b` keeps its meaning) and none of them is a boundary. The shell door keeps every
  boundary above, so `psql -c "UPDATE t SET p = p | 4 WHERE id = 1"` typed through a shell is still denied (an accepted
  false positive).
- **Each character is consumed exactly ONE way.** Bounded is not enough: a scan that can tile the same text two ways
  costs 2^k whatever its bound, and the first version of the WHERE scan did (a hyphen not preceded by whitespace and not
  starting a flag word matched two branches, so a UUID list or a dashed comment ran past the hook's 10 s timeout, which
  fails OPEN). Now the three consuming alternatives of the scan start with three different characters (`[^;&|]`,
  `&(?!&)`, `\|\|`) and every stop is a zero-width guard in front of the character, never a second branch. The other
  groups: the pair `\b` or a written-out-whitespace lookbehind before each keyword is two zero-width alternatives that
  cannot both lead to a keyword (a letter follows, so exactly one holds); the written-out-whitespace group starts with a whitespace character, a backslash then `n`/`r`/`t`, a backtick
  then `n`/`r`/`t`, or a backslash then a newline (disjoint); the DROP kinds, the DELETE and UPDATE modifiers and the
  client words differ in their first one to three characters; an identifier is a quote run, a `[` or a word character
  (disjoint), its bracket form excludes `[` so a scan from one `[` ends at the next, and its quote runs are bounded at 12:
  an opening run is followed by a class that cannot start with a quote character, and a closing run that is followed by
  a written-out whitespace has exactly one split that reaches it (a shorter or longer run leaves a character that
  starts nothing). Three spots CAN be matched two ways, each on a
  path that succeeds at once or is bounded and not nested: `TRUNCATE` before `TABLE`/`ONLY` (skipping the word lets
  `\w` match its first letter, which is a deny anyway), an `AS` that is also a valid alias name, and a word that is both
  a modifier (`ONLY`, `IGNORE`) and a table name. Reasoning missed the hyphen once, so the AMBIGUITY AXIS canary
  generates a run of 53 character sequences at the scan position of all 8 arms and the CLASS SWEEP runs every character
  class through the real hook.
- **Cost.** Every scan is bounded AND matches each character one way, so a text costs at most about its length times
  5,000 (1,500 for ALTER) steps, and about its length when it holds no `DELETE FROM` or `UPDATE ... SET`. The hyphen
  defect, through the real hook on the first version: a 3-UUID `IN` list 0.4 to 0.8 s, 6 UUIDs or a 30-dash comment
  killed at the 4 s and 9 s kill lines. After the fix: 19 hyphen shapes (3, 6, 10 and 30 UUIDs, 30 ISO dates, 30- and
  300-dash comments, an `a-a-...-a` literal of 40 hyphens, `ALTER TABLE` with 30 UUIDs) through both doors, 38 calls,
  slowest 0.7 s; the CLASS SWEEP (14 character classes x 30, 300 and 3000 repeats x 10 prefixes x 2 doors, 840 calls, 6 at
  a time): median 0.22 s, slowest 1.1 s, node start included; the QUADRATIC AXIS (each arm's own keyword repeated to 240,000
  characters, 18 units): slowest 0.09 s, where the first version's unbounded bracket class (`UPDATE [` repeated) needed
  8 to 21 s. The size axis, measured on
  this machine, 2026-10-15, three runs: through the real hook, typical SQL and 25,000 benign characters 0.1 to 0.25 s
  including node start; 2,000 statements of 497 characters 0.2 to 0.35 s; and the WORST text found, one built so that every
  occurrence of `DELETE FROM` has its WHERE within reach but far away (a keyword every 14 characters), 1.3 to 1.8 s for
  50 elements of 20,000 characters (the character budget) and 1.5 to 2.9 s for one 996,512-character field judged
  whole. In process, 1,000,000 benign characters take 10 ms and the same worst text 1.6 s (`DELETE FROM`), 1.3 s
  (`UPDATE ... SET`), 0.7 s (`ALTER TABLE`). That is real text nobody writes, and it stays inside the hook's 10 s
  timeout (a timeout fails OPEN) with about 3x margin on a quiet machine, which is not the 10x a bound should have. So the
  real-hook canary for those worst shapes asserts the verdicts and ONE generous bound, 9 s (the hook timeout less a
  second: the failure that matters is a timeout, which fails open), and REPORTS the measured times instead of asserting a
  tighter number a loaded runner cannot hold; only the benign 25,000-character field has a tight bound (3 s, more than
  10x its measured time). The size shapes are hyphen-free text, which is why they could not see the ambiguity; they stay,
  and the HYPHEN AXIS (the 19 shapes, 9 s kill line), the AMBIGUITY AXIS (a child process per arm, the old two-branch scan
  as its positive control), the CLASS SWEEP and the QUADRATIC AXIS (the old bracket class as its positive control)
  replace picking axes by hand. A differential canary pins that the tempered scan draws the same boundaries as the one it
  replaced. A separate canary pins that the pattern is anchored (structurally) and that the unanchored form is at least
  20x slower on the same benign text (a ratio, so a fast runner cannot turn it red for a non-defect).

### Infra tools: deny by name (2026-10-15)

**Status: DENIED by name.** The Railway, Neon, Vercel and Prisma MCP tools that delete, redeploy, restart or change variables,
credentials, domains, DNS or schema (the table below) are refused by rule `infra-mutation-tool`, a PreToolUse hook deny
(exit 2). It judges the TOOL NAME, by its last segment, whatever server segment it has. It replaced 135 native
`permissions.ask` entries that did nothing. There is NO override. The rewritten step 7 has run once, from a worktree (evidence only, see the last paragraph of "Live check after merge");
the official run is still owed.

- **Why: the live FAIL.** Job 2026-10-15-guard-sql-lease-infra wrote 135 `mcp__*__<leaf>` ask entries to make Claude Code prompt before
  each of these tools. They FAILED their live check at 17:56Z on 2026-10-15, in a fresh `bypassPermissions` session: Railway
  `delete-service` (nonexistent ids; a provider permission error), Vercel `pause_project` (`invalid_project_id`) and Prisma
  `delete_prisma_postgres_database` (`not_found`) each reached the provider with NO prompt, while the positive control (Railway
  `list-projects`) ran silently. The cause was not separated: a glob in the SERVER segment of an ask rule that does not
  match, UUID server names, or ask not honoured in this app. A hook deny does not depend on any of that, and it was proven
  live on this machine in the same session (push-to-main and the Neon SQL rows were refused), so the ask entries were removed
  and replaced by the deny.
- **How it works.** The tools carry no command text, so the tool name is the text: adapter row `infra-name` (`nameAsText: true`, `onlyRules`
  exactly `["infra-mutation-tool"]`) hands the name to the rule, whose pattern is `^mcp__.+__(?:leaf|leaf|...)$`, anchored at both ends
  and matching the LAST segment only. A connector UUID changes when a connector is re-added, so the server segment is never
  matched: the connector UUID, the plugin form (`mcp__plugin_prisma_Prisma-Remote__...`), a `claude_ai_` name and a made-up UUID all
  deny. `.claude/settings.json` routes exactly these names to `pretool.mjs` (the pretool-only MCP matcher group; `lease-check.mjs` does not
  run for them, they never touch the worktree) and routes no read. The denial tells an agent to state the exact action to Nour, who runs it
  himself in the provider dashboard or CLI, or changes the rule in a PR. The leaf list is the classification in `scripts/agent-os/mcpInfraDeny.test.mjs`;
  that file pins both patterns to it and probes every leaf on four server forms through the real hook.
- **The denied tool list (135).** Derived from `policy.json`; `mcpInfraDeny.test.mjs` fails if a leaf is missing here. `update_project` exists on both Neon
  and Vercel and is listed once.

| Provider | Denied tools (the last segment of the MCP tool name) |
|---|---|
| Railway | `accept-deploy`, `connect-service-source`, `create-deployment`, `create-function`, `create-service`, `delete-bucket`, `delete-domain`, `delete-feature-flag`, `delete-service`, `delete-tcp-proxy`, `delete-volume`, `delete-webhook`, `deploy-template`, `railway-agent`, `redeploy`, `reset-bucket-credentials`, `restart-service`, `set-feature-flag`, `set-variables`, `update-bucket`, `update-domain`, `update-function-source-code`, `update-service`, `update-volume`, `update-webhook` |
| Neon | `add_auth_oauth_provider`, `add_auth_trusted_domain`, `complete_database_migration`, `complete_query_tuning`, `create_credential`, `delete_auth_oauth_provider`, `delete_auth_trusted_domain`, `delete_auth_user`, `delete_branch`, `delete_data_api`, `delete_function`, `delete_functions_custom_domain`, `delete_postgres_database`, `delete_postgres_endpoint`, `delete_postgres_role`, `delete_project`, `delete_snapshot`, `delete_storage_bucket`, `delete_storage_object`, `delete_storage_objects_by_prefix`, `delete_trigger`, `deploy_function`, `disable_auth`, `finalize_branch_restore`, `reset_from_parent`, `reset_postgres_role_password`, `restart_postgres_endpoint`, `restore_snapshot`, `revoke_credential`, `rotate_credential`, `set_default_branch`, `suspend_postgres_endpoint`, `update_auth_config`, `update_auth_oauth_provider`, `update_auth_user_role`, `update_branch`, `update_data_api`, `update_function`, `update_postgres_database`, `update_postgres_endpoint`, `update_project`, `update_snapshot`, `update_trigger` |
| Vercel | `accept_project_transfer_request`, `activate_kms_signing_key`, `add_project_domain`, `add_route`, `approve_rolling_release_stage`, `assign_alias`, `buy_domain`, `cancel_deployment`, `complete_rolling_release`, `create_deployment`, `create_edge_config_token`, `create_kms_signing_key`, `create_or_transfer_domain`, `create_project_env`, `create_record`, `create_sdk_key`, `edit_project_env`, `edit_route`, `issue_cert`, `patch_edge_config_items`, `patch_url_protection_bypass`, `pause_project`, `put_firewall_config`, `replace_domain_dns_records`, `request_promote`, `request_rollback`, `restore_edge_config_backup`, `restore_redirects`, `revoke_kms_signing_key`, `run_session_command`, `stage_redirects`, `stage_routes`, `start_rolling_release`, `unpause_project`, `update_attack_challenge_mode`, `update_bulk_redirect_version`, `update_connector`, `update_edge_config`, `update_firewall_config`, `update_flag`, `update_flag_segment`, `update_flag_settings`, `update_kms_issuer`, `update_kms_issuer_policy`, `update_project_protection_bypass`, `update_record`, `update_rolling_release_config`, `update_route_versions`, `upsert_connector_project_connection`, `write_session_files` |
| Prisma | `create_object_store_bucket_key`, `create_prisma_postgres_connection_string`, `create_prisma_postgres_recovery`, `delete_object_store_bucket`, `delete_object_store_bucket_key`, `delete_prisma_compute_app`, `delete_prisma_compute_deployment`, `delete_prisma_compute_env_var`, `delete_prisma_postgres_connection_string`, `delete_prisma_postgres_database`, `execute_prisma_postgres_schema_update`, `link_prisma_github_repository`, `promote_prisma_compute_deployment`, `rollback_prisma_compute_app`, `set_prisma_compute_env_var`, `start_prisma_compute_deployment`, `stop_prisma_compute_deployment` |

- **No override.** There is no environment variable, setting or flag that lifts `infra-mutation-tool`. A first version had an operator override
  (`AGENT_OS_INFRA_OVERRIDE`); review showed that any non-blank value turned the rule off for every tool and target for the whole session, and
  for later sessions when stored in `.claude/settings.local.json`, which contradicts "explicit instruction for the specific action, every
  time" (AGENTS.md > Protected operations). It was removed, and `mcpInfraDeny.test.mjs` now asserts the opposite through the real hook:
  with `AGENT_OS_INFRA_OVERRIDE` set to a reason, or the look-alikes `AGENT_OS_INFRA_OVERRIDES` and `INFRA_OVERRIDE`, a denied tool is still denied.
  An infra deny cannot wedge a session the way `lease-check.mjs` can, so nothing needs a way around it. When Nour wants one of these actions he runs it
  himself in the provider dashboard or CLI, or he edits the rule in a PR where the diff is reviewable. The denial message says exactly that.
- **What is NOT affected.** Bash `railway run`, `railway variables` (a read), `railway logs`, `railway status`, `gh`, `git` and every other
  command: they are Bash and the name rule never sees a command. MCP reads, logs, docs and analytics tools (Railway `list-projects`,
  `get-logs`; Neon `list_projects`, `run_sql`; Vercel `list_deployments`, `get_runtime_logs`; Prisma `list_prisma_projects`), additive creates
  (Railway `create-project`, `create-volume`; Neon `create_branch`, `create_project`; Vercel `create_project`, `create_flag`) and the
  SQL text tools, which the hook judges by text (a prompt or a denial per query would train the operator to override). Two tools are both:
  `complete_database_migration` and `execute_prisma_postgres_schema_update` are denied by name AND judged by text.
- **Collisions.** A leaf is generic (`update_project`, `delete_branch`, `create_record`) and the rule never looks at the server, so a
  non-infra server that exposes the same leaf would be denied too. Checked 2026-10-15 by name against the tool list of every non-infra MCP
  server that listed tools in that session (Linear, Gmail, Calendar, Drive, Sheets, Shopify, Canva, Figma, Higgsfield, Clipkit, Sentry, ads, travel,
  documents, browsers and the harness's own tools): no denied leaf was found on any of them, so there is NO known collision today. The nearest
  names, `create_project` (Higgsfield, Clipkit, Neon, Vercel) and the many `update_*` tools, are not on the list: `create_project` is a MUST-ALLOW
  additive create. Servers that needed authorization and listed no tools (GitHub, Datadog, Slack, PagerDuty and others) were NOT checked: a GitHub
  `delete_branch` would be denied, and the pattern test pins that as the shape of the risk. Re-run the check whenever a connector is added. To allow a colliding non-infra tool, narrow the rule (a negative
  look-behind on its server segment in both patterns, with an exact-name MUST-ALLOW fixture in `mcpInfraDeny.test.mjs`) rather than
  dropping the leaf.
- **Adding a name.** (1) Resolve the full tool name with ToolSearch `select:` and read its definition. (2) Add the leaf to the right fixture
  (protected or allowed) in `mcpInfraDeny.test.mjs`. (3) Regenerate both patterns in `policy.json` (`infra-mutation-tool.pattern` and
  `infra-name.toolPattern`: they must be identical) and the matcher in `.claude/settings.json`, and add the leaf to the table above.
  (4) Run `node --test scripts/agent-os/mcpInfraDeny.test.mjs`.
- **Known and deliberately not denied.** `KNOWN_UNCLASSIFIED` in the canary names the live writers and secret-bearing reads nobody has classified
  yet (Vercel `create_sandboxes_v2` to `v4`, `create_drain`, `update_drain`, `get_shared_env_var`, `filter_project_envs`, Neon
  `presign_storage_object` and the others in "Still unguarded"). It is disjoint from every other list (asserted) and asserted NOT denied,
  so not denying them is a recorded decision and a later edit is a conscious one.
- **The drift caveat, exactly.** The canary compares `policy.json` and `settings.json` to the fixtures in `mcpInfraDeny.test.mjs`, and to nothing
  else. It CANNOT see a tool a connector renamed or ADDED after the fixtures were taken (snapshot: 2026-10-15): a new leaf is neither denied
  nor reported. Refresh recipe, when a connector updates: (1) list the live tools of the four connectors; (2) run ToolSearch `select:` over
  every leaf of every fixture list (protected, allowed, known-unclassified) with its full tool name, and treat a name that does not resolve
  as stale; (3) diff the live names against the fixtures; (4) classify each new name as protected, allowed or known-unclassified and edit the
  fixtures, both patterns and the matcher together. The 2026-10-15 pass found one stale allowed name that way: `list_edge_configs` is gone, the live name is `get_edge_configs`.
- **Limits.** (a) A hook fails OPEN on its own bug or a timeout (10 s); the in-process matrix over every leaf, the real-hook probes and the 100,000-character
  sweep are the guard, and the name rule is linear. (b) A Bash command that is exactly a denied tool name is denied too (the rule is typed Bash so the row can
  hand it text): no real command looks like that, a canary pins it. (c) An empty server segment (`mcp____delete_project`) is not a registered tool and does
  not match. (d) The CLI door (`railway`, `vercel`, `neonctl` through Bash or a runner) is not judged by this rule. (e) The in-process matrix and the real hook
  call the same functions `pretool.mjs` calls; a canary compares their verdicts on a sample so the two cannot drift apart unseen.

### Infra tools: approve one call (2026-10-20)

**Status: BUILT, canaried, live check owed.** Nour asked for the agent to do the Railway work and chose this design (job
2026-10-20-infra-approve-per-action). It keeps "explicit instruction for the specific action, every time" and moves the click from
his dashboard to his chat. It is not an override: it lifts one call of one tool on one target, and only after Nour typed it.

- **How Nour approves.** He types a line of its own in a prompt: `APPROVE <tool> <target>`, for example `APPROVE redeploy statenour-web`
  or `APPROVE update_branch br-dark-poetry-amzuf3je`. The keyword is any case; the tool is the last segment of the MCP name. Within
  30 minutes exactly one call of that tool whose id fields all name that target passes; a second call, another tool, another target or a
  call after 30 minutes is denied with the usual `infra-mutation-tool` reason plus one line on how to approve.
- **Writer.** `scripts/agent-os/infra-approve.mjs`, a UserPromptSubmit hook in `.claude/settings.json`, reads only the prompt text and
  appends `{id, tool, target, at, session_id, used:false}` to `%LOCALAPPDATA%/nourcity/approvals/<session>.json`. A line that is not
  an infra tool name ("APPROVE the plan") records nothing; a never-approvable tool records nothing and prints "`<tool>` is never
  approvable; do it in the provider dashboard". It prints what it recorded. It is idempotent per delivery: the same prompt text at the
  same transcript size (one hook event delivered twice) adds no second record.
- **Reader.** `pretool.mjs`, only when `infra-mutation-tool` is the one rule denying an MCP call, calls `consumeApproval()`. It needs all
  of: an unused record of THIS session for that tool (case-insensitive); the target, or one of its `aliases` in `policy.json` >
  `infraApprovals`, equal to EVERY identifying field of the input (case-insensitive whole value, never a substring); the record
  0 to 30 minutes old (the window is a code constant, inclusive, a future date fails); the same APPROVE line in a genuine operator
  message of the session transcript, 0 to 30 minutes old (`operator-asks.mjs` > `operatorAsk`: a tool result, a message from another
  session, an sdk-started prompt, a /loop re-fire or a lane brief does not count); and two exclusive creates, of the record's lock
  `<session>.<id>.used` and of the lock of the operator message behind it `<session>.msg-<hash of its timestamp and text>.used`. So
  when two calls race on one approval exactly one passes, and ONE typed message spends ONE approval however many records a duplicate
  hook run or a /loop re-fire produced (Codex P1 on PR 3193); two separate APPROVE messages allow two calls. The pass prints a notice naming the approval it spent.
- **What "target" means.** An identifying field is a key at any depth that is `id` or ends in `_id`, `-id`, `Id` or `ID` (`branch_id`,
  `serviceId`, `deploymentId`, `endpoint_id`), except the scope keys `project_id`/`projectId`, `environment_id`/`environmentId`,
  `org_id`/`orgId`, `workspace_id`/`workspaceId` and `team_id`/`teamId`. The input needs at least one, and every one must equal the
  target or an alias: free text (`name`, `message`, `description`) never counts, so `APPROVE update_branch br-dark-poetry-amzuf3je` does
  not pass an `update_branch` on another branch whose `name` echoes that id (manager probe, 2026-10-20). A call whose input has only scope
  ids is denied with "needs an id-bearing target". A redeploy that also names a `deploymentId` needs that id to match too, so approve the
  plain service redeploy.
- **Never approvable.** `neverApprovable` in `policy.json`: `railway-agent` (it can do anything), `delete_project`, `delete-service`,
  `set_default_branch`, `accept_project_transfer_request`, `buy_domain`, and every project-level leaf: `update_project`, `pause_project`,
  `unpause_project`, `add_project_domain`, `create_project_env`, `edit_project_env`, `update_project_protection_bypass`,
  `upsert_connector_project_connection` (their input names only a project id, a scope id no approval can name, and pausing or
  reconfiguring a whole project is outage-class: Nour does it in the dashboard; Codex P2 on PR 3193). A malformed list makes NOTHING approvable; a malformed alias
  map adds nothing. An approval never lifts another rule: a destructive migration stays denied by `destructive-sql` and spends nothing.
- **The store is out of the agent's reach.** Rule `infra-approvals-store-write` denies Write, Edit, NotebookEdit and the MCP file tools
  on any path with a nourcity segment followed by an approvals segment (either slash, any case, 8.3 short names, trailing dots, `./` and
  `../`). Rule `infra-approvals-store-shell` denies a shell or MCP runner command that names both pieces in any order or form, or that
  runs `infra-approve.mjs` with node. A single read-only command (`cat`, `rg`) passes.
- **It fails closed.** A missing, unreadable, malformed or directory-shaped store, a missing transcript, a reader that throws or a
  reader module that does not load all mean no approval: the call stays denied (the rest of `pretool.mjs` still fails open on its own bugs).
- **Limits.** (a) A command that builds the path from pieces (`'nour'+'city'`) or writes a forged transcript line is not caught: this is a
  guard rail against an agent doing it by accident, not a security boundary. (b) LOCALAPPDATA only locates the store. (c) A message typed
  while a turn runs may not fire UserPromptSubmit: type the APPROVE line as its own message. (d) A project id is a scope id, never a
  target: name the resource's own id (service, branch, endpoint). Canaries: `scripts/agent-os/infraApprove.test.mjs`.
- **Live check owed.** In a fresh session Nour types `APPROVE redeploy <a service id>`; the next redeploy of that service passes with the
  notice, the same call again is `BLOCKED by repo policy: infra-mutation-tool` with the approve line.

### Still unguarded

Inventory of 2026-10-15. Names come from this machine's tool lists; "name only" means the schema was not read.

- **Persistent shell cwd.** The hook is stateless, so it cannot know the cwd of a persistent shell across calls: a
  `cd` into a worktree in one Desktop Commander call followed by an install typed in a later call is not caught, and
  neither is `cd <worktree>; pnpm install` on one line from a session that is not in a worktree. Native Bash has the
  same blind spot, so this is no worse than before the PR. A canary pins it and fails the day it is fixed.
- **Slip windows.** The unscanned middle of a field over its cap (20,000 characters on a row that runs every rule,
  1,000,000 on a SQL row; the same per element of a list field), the elements of a list field beyond the 2,000th or
  beyond 1,000,000 judged characters in all, a WHERE farther than 5,000 characters from its `DELETE FROM` or `SET`
  (denied, not a slip), and the directory walk cap: files past the first 2,000 entries, or deeper than 6 levels, of a
  moved directory are not seen (the walk and the list reader each print one stderr line when they stop early). A hook that times out (10 s) or crashes fails OPEN, the infra name rule included (it is linear; "Infra tools: deny by name" above). Canaries
  pin each of these.
- **context-mode plugin runners** (`ctx_execute`, `ctx_batch_execute`). They run code and commands, and the
  manager's probe on 2026-10-15 exited 0 through both. They were not in this session's tool list, so their field
  names were not read from a live definition and no row was invented. Follow-up: read the live schema, then add a
  row per tool (the "Adding a runner" steps below).
- **What the SQL rule still misses.** The SQL text tools are judged now (adapter table above); `destructive-sql` is text
  matching, so by design: a write that has a WHERE passes, including `WHERE true`, a WHERE in a comment, a string
  literal or a subquery, and a CTE whose outer query holds the WHERE; keywords split by a comment (`DELETE/**/FROM`) are
  not seen; MySQL multi-table `DELETE t1 FROM ...`, `UPDATE a JOIN b ... SET` and the comma form `UPDATE t1, t2 SET` are
  not parsed; on the SHELL door a later WHERE after a newline, `||` or a single `&` still rescues a bare write (a
  verification `SELECT ... WHERE` on the next line passes; they are not boundaries because a newline is normal inside a
  statement, `||` is concatenation and `&` is text, and a linear fix is not trivial: pinned); other spellings pass,
  none of them an accident to expect: hex and octal escapes (`printf '\x0aDELETE FROM t'`, `\012`, `\x20`), no
  whitespace around a quoted identifier (`UPDATE"Task"SET`), and a doubled quote inside one (`"a""b"`); DROP kinds
  outside the list (DOMAIN, AGGREGATE, ROUTINE, RULE, PUBLICATION, SUBSCRIPTION, FOREIGN TABLE ...) pass; `MERGE ... WHEN MATCHED
  THEN DELETE` is not read; SQL run from a file or script (`psql -f cleanup.sql`) has no text to judge; and a DB client
  word outside the list (`sqlcmd`, `sqlite3`, `mariadb`, `usql`) turns the shell gate off. T-SQL through `Invoke-Sqlcmd`
  (a listed client word) has two forms the rule does not read, pinned as known limits: `DELETE dbo.leads`
  (FROM is optional in T-SQL) and `UPDATE TOP (100) PERCENT dbo.leads SET ...`. They are not widened: an optional FROM
  would also match the DDL clause `ON DELETE CASCADE` (every foreign-key migration would be denied), and nothing in this
  stack runs SQL Server (TiDB, Neon and Postgres take neither form). Accepted false positives, in
  the safe direction: on the shell door only, SQL operators before a WHERE that look like shell (`psql -c "UPDATE t SET p =
  p | 4 WHERE id = 1"` stops at the lone `|`, a spaced minus before a word ending in c, e, f or q such as ` -fee` reads as a
  flag cluster; the SQL rows have neither), `ALTER COLUMN ... DROP NOT NULL` or `DROP DEFAULT`, a bounded `UPDATE ... ORDER BY ... LIMIT` with
  no WHERE, a `;` inside a string literal ending the statement early, SQL words inside a string literal OR a SQL
  comment sent through a SQL tool (`SELECT 1 -- drop table later` denies), `explain_sql_statement` with `analyze: false`
  (it is judged exactly like `run_sql`), an `apply_changes: false` discard of `complete_database_migration` that
  re-sends destructive SQL (discard it in the Neon console), a CHAINED read-only search that names a DB client and
  `DELETE FROM` or `UPDATE ... SET` (`rg -n "DELETE FROM" apps/ | rg mysql` denies: the pipe defeats the read-only skip;
  run two unchained searches), and prose in a commit or PR message body that mentions the SQL arms next to a client
  word when it is not a quoted `-m`, `--message`, `--title` or `--body` argument (a heredoc body, `-F -`): put the text
  in a file with the Write tool and use `git commit -F <file>`. Neon `complete_query_tuning` carries `suggested_sql_statements`, a
  list of DDL: asked per call, not text-judged. `destructive-sql` is also an honour rule for a write that has a WHERE. A
  canary pins each of these, so one that gets fixed fails loudly. The deny and allow probes of the DELETE, UPDATE, ALTER
  TABLE and DROP-kind arms are `denyExamples` and `allowExamples` of the rule in `policy.json`;
  `docs/agent-audit/CONTROL-CANARY-COVERAGE.md` states the `denyExamples` total (`coverage-doc.test.mjs` fails when it
  drifts), so change that number in the same commit as any example.
- **Prisma-Local MCP** (`migrate-reset`, `migrate-dev`; name only, the server failed to connect on 2026-10-15).
  The tool name is the whole command, so there is no text to match. Follow-up: an adapter field that supplies a
  fixed command string such as `prisma migrate reset` to `destructive-prisma`.
- **Infrastructure beyond the deny list.** The classified leaves are denied by name (previous section). Still open: the CLI door
  (`railway`, `vercel`, `neonctl` commands typed through Bash or a runner carry mutations the text rules do not know);
  secret-revealing reads (Railway `list-variables` and `get-bucket-credentials`, Neon `get_connection_string`, Vercel
  `get_project_env`); additive creates, allowed on purpose (Railway `create-project`, `create-volume`,
  `create-bucket`, `create-webhook`, `generate-domain`; Neon `create_branch`, `create_project`; Vercel `create_project`,
  `create_flag`); and the unclassified tools below.
- **Unclassified infrastructure tools** (in the live tool lists on 2026-10-15, in neither the protected nor the allowed
  fixture; the writers and secret-bearing reads among them are the `KNOWN_UNCLASSIFIED` fixture and are deliberately NOT
  denied until someone decides; the plain reads, analytics and docs tools are not listed). Neon:
  `presign_storage_object`, `get_ai_gateway`, `get_neon_auth_config`, `list_auth_oauth_providers`,
  `list_auth_trusted_domains`, `list_branch_computes`, `list_functions_custom_domains`, `list_log_fields`,
  `list_log_field_values`, `list_project_permissions`, `get_doc_resource`, `list_docs_resources`. Prisma:
  `get_prisma_composer_topology`, `list_prisma_github_installations`, `list_prisma_github_repositories`. Vercel writers:
  `create_drain`, `update_drain`, `test_drain`, `create_git_project`, `create_kms_issuer`, `create_kms_issuer_policy`,
  `create_sandboxes_v2`, `create_sandboxes_v3`, `create_sandboxes_v4`, `update_sandbox`, `update_session_network_policy`,
  `kill_session_command`, `stop_session`, `invalidate_by_tags`, `invalidate_by_src_images`, `upload_file`,
  `upload_artifact`, `create_storage_stores_blob`, plus the toolbar, CI and observability writers; Vercel secret-bearing
  reads: `get_shared_env_var`, `filter_project_envs`, `get_edge_config_token`, `get_edge_config_tokens`,
  `get_project_deletion_link`. Decide each, then add it to the fixtures, `policy.json` and `settings.json` together.
- **Customer-facing sends through connector tools** (Gmail `send_message`, `reply`, `forward`; ad launches
  `launch_*`; calendar invites). They are not command, file or SQL tools: permission prompts only.
- **Desktop Commander `set_config_value`** can empty its own `blockedCommands` or widen `allowedDirectories`. It
  edits another guard's configuration, not the repo. Also `create_directory`, `kill_process`, `force_terminate`:
  no protected operation.
- **Worktree removal by the harness**: native `ExitWorktree` and the host tools `clean_up_worktrees` and
  `discard_kept_worktree` remove worktree directories without `git worktree remove`, so `worktree-remove` never
  sees them. They are harness-owned; whether they unlink the NTFS junctions first was not verified.
- **Browser and desktop automation** (`javascript_tool`, `computer`) can type into a terminal window or run page
  script. There is no command text to judge.
- **Remote sandboxes** (Higgsfield `sandbox_exec`, `scene_builder_3d_run_python`) run code off this machine with no
  repo access.
- **Reads.** MCP read tools are not judged, and `secret-file-write` is write-only, as it is for the native `Read`.

### Live check after merge

Five minutes, in a FRESH Claude Code session started from the PRIMARY checkout after step 0. Hooks and settings load when
a session starts, and a worktree session takes both from the primary checkout, so a session that began before the merge,
or one that runs in a worktree, proves nothing. Steps 1 to 4 prove the runner adapters, steps 5 and 6 the SQL rows,
step 7 the infra name rule. Three result words are used below. PASS: the stated refusal or prompt appears before
anything is sent. FAIL: the call reached the tool and came back with the tool's own output or a provider error, while
the control behaved as stated. INCONCLUSIVE: a control did not behave as stated, or the session did not load the merged
files, so nothing can be concluded: fix the precondition and repeat. This section is a procedure; whoever runs it
records the result under "Recorded result" at its end (the 2026-10-15 run is there: steps 1 to 6 PASS, the ask version of step 7 FAIL; the rewritten step 7 ran once after the merge, from a worktree (evidence only), and its official run is owed, see the last paragraph of that section).

0. Precondition: fast-forward the PRIMARY checkout to the merged commit (on this machine
   `C:\Users\nourd\NattyNour\nicks-tire`): `git -C <primary> fetch origin main`, then `git -C <primary> merge --ff-only origin/main`,
   never `reset --hard` (a sibling session's work may be in that tree). Confirm `git -C <primary> log -1 --format=%H`
   is the merged commit and that `node -e "console.log(require('./.claude/settings.json').permissions.ask ?? 'no ask list')"`, run
   inside the primary, prints `no ask list`. Then open a FRESH session whose directory is the primary checkout. A worktree session
   cannot test a `settings.json` that is not merged: its own worktree's copy is not the one it loads.
1. Ask Claude to run `git push --dry-run origin main` through the Terminal MCP (`run_in_terminal`), then through
   Desktop Commander (`start_process`), then through the native `Monitor` tool. It is harmless: a dry-run push sends nothing even if the guard fails.
   For a benign control, run `git status` through the Terminal MCP and through Desktop Commander. On this machine
   Desktop Commander's default shell `pwsh.exe` is not on its PATH, so pass `shell: "powershell.exe"`; the error
   `pwsh.exe was not found on PATH` is an environment fault, not a guard refusal.
2. PASS: each call is refused before anything runs, the refusal starts `BLOCKED by repo policy: push-to-main`, and
   the last line reads `Judged through MCP adapter terminal-run.command on tool mcp__terminal__run_in_terminal`
   (or `process-start.command`). No terminal tab opens and no process starts.
3. FAIL: the tab opens or the process starts and prints dry-run output, or only a permission prompt appears with
   no `BLOCKED by repo policy:` line. A permission prompt is the permission system, not this guard, and a block
   banner without the repo's rule id is not this guard either (this machine runs more than one layer).
   INCONCLUSIVE: the benign control did not run (for example `pwsh.exe was not found on PATH`), or the session began
   before step 0.
4. On FAIL: restart the session and repeat, then run `node --test scripts/agent-os/mcpCoverage.test.mjs`. The
   registration canaries (matcher, verbatim configured command) say whether the hook is routed.
5. SQL probe: ask Claude to call Neon `run_sql` with `sql: "DROP TABLE guard_live_check_probe"` and
   `project_id: "guard-live-check-nonexistent"`. PASS: refused before anything is sent, with
   `BLOCKED by repo policy: destructive-sql` and the last line `Judged through MCP adapter neon-sql.sql on tool ...run_sql`.
   FAIL: a provider error (for example "project not found"), which means the call reached Neon unjudged.
6. For the list reader, ask for Neon `run_sql_transaction` with `sql_statements: ["SELECT 1", "DELETE FROM guard_live_check_probe"]`
   and the same bogus `project_id`. PASS: `BLOCKED by repo policy: destructive-sql` and a last line that names
   `neon-sql-transaction.sql_statements[1]`. FAIL: a provider error.
7. Infra probe, with its precondition and positive control first. There are no operator taps: a denial is a hook, so nothing waits for an answer.
   - Mode: run it in `bypassPermissions` (the mode shows under the input box; Shift+Tab cycles it), the mode in which the ask rules
     failed.
   - Positive control: ask Claude to call Railway `list-projects` and Neon `list_projects` (reads, both MUST-ALLOW fixtures). They must run
     with NO prompt and NO refusal. A refusal naming `infra-mutation-tool` on a read is a FAIL of the allow side (a read matched); a
     connector that is not connected (its tools are absent) is INCONCLUSIVE.
   - Probes, each with a nonexistent id: Railway `delete-service` (`projectId: "guard-live-check-nonexistent"`, `serviceId:
     "00000000-0000-0000-0000-000000000000"`), Neon `delete_project` (`project_id: "guard-live-check-nonexistent"`), Vercel `pause_project`
     and one Prisma tool, `delete_prisma_postgres_database`.
   - PASS: the control ran, and each probe is refused before anything is sent, with `BLOCKED by repo policy: infra-mutation-tool` and the last
     line `Judged through MCP adapter infra-name.toolName on tool <the full tool name>`; no permission prompt and no provider error. FAIL: a
     probe returns a provider error ("not found", a permission error) or only a permission prompt: the hook did not see the tool, so run
     `node --test scripts/agent-os/mcpInfraDeny.test.mjs` (the registration canaries say whether the matcher routes it) and restart the session.
     INCONCLUSIVE: the control was refused or a connector is absent.
   - The ids are nonexistent, so even a failed check deletes nothing.
**Recorded result, 2026-10-15 17:56Z.** A fresh session started from the primary checkout at `b6faf90d9` after the
fast-forward, in `bypassPermissions`. Steps 1 to 4 PASS: `git push --dry-run origin main` was refused with `BLOCKED by
repo policy: push-to-main` through the Terminal MCP `run_in_terminal`, Desktop Commander `start_process` and `Monitor`
(last lines `Judged through MCP adapter terminal-run.command`, `process-start.command` and `monitor.command`); no push
ran. Steps 5 and 6 PASS: Neon `run_sql` with `DROP TABLE guard_live_check_probe` was refused with `destructive-sql` (last
line `neon-sql.sql`) and `run_sql_transaction` was refused (last line `neon-sql-transaction.sql_statements[1]`); the allowed
`SELECT 1` control was inconclusive, because the Neon connector had been invalidated. **Step 7 FAIL:** the control
(Railway `list-projects`) ran with no prompt, and then Railway `delete-service` (nonexistent ids; a provider permission
error), Vercel `pause_project` (`invalid_project_id`) and Prisma `delete_prisma_postgres_database` (`not_found`) each ran
with NO permission prompt. The recorded probes were Railway, Vercel and Prisma; the Neon connector was invalidated in that
session. That FAIL led to job 2026-10-15-infra-deny-by-name: the ask entries were removed and replaced by the hook deny described
under "Infra tools: deny by name", whose probes are the rewritten step 7.

**Recorded result, rewritten step 7, 2026-10-15 (after the merge at `00e919e58`).** Evidence only, not the official step-7 run: the session ran from the worktree `hello-23f8b4`, and step 0 requires a fresh session started in the primary checkout. In `bypassPermissions`, the merged rule fired on three probes. Railway `delete-service`, Vercel `pause_project` and Prisma `delete_prisma_postgres_database` (nonexistent ids) were each refused before anything was sent. Each banner is `BLOCKED by repo policy: infra-mutation-tool` inside a `PreToolUse` hook-error line, and its last line is `Judged through MCP adapter infra-name.toolName on tool <full tool name>`; no permission prompt, no provider error. Railway `list-projects` ran with no prompt. `git push --dry-run origin main` through `run_in_terminal` was refused with `push-to-main`. **Neon not run:** the Neon connector was absent, so the Neon control and the `delete_project` probe did not run. Step 7 says INCONCLUSIVE when a connector is absent, so the official step 7 is INCONCLUSIVE and still owed: a fresh session from the primary checkout, with the Neon connector connected. The rule is in the primary checkout's and `main`'s `config/agent-os/policy.json`; this worktree's older base lacks it, which is why the banners show the merged rule fired. The raw tool results were not readable from the child's transcript; the banner text is the child session's verbatim quote.

## Writing a check that actually catches something

The parity script's `forbidLine()` has a comment worth repeating: a whole-file text search for a
retired term flags **the sentence that retires it**. Guarding "`push-main.sh` must not appear"
deletes the note explaining why nobody should use it — and the next agent reinvents it.

So: forbid the *prescriptive* form, not the mention. `.husky/pre-` (a claim about where the hook
lives) is always wrong; the words "`.husky/` is retired" are always right. Where the distinction
can't be encoded structurally, an explicit "correction marker" exemption is used — narrow, and
documented at the call site.

Corollary, learned here: **the first version of a check that goes green may just be mis-scoped.**
This one's first run flagged two real stale lines and one false positive. Read what a failing
check is actually pointing at before "fixing" the file.

## Honest limits

- **This repo has no branch protection or rulesets.** `gh pr merge --squash` succeeds over a red
  check. CI here is advisory; red means stop by convention only. Making checks *required* is a
  repo-settings change only the operator can make (Settings → Branches → protect `main` →
  require `Agent policy` + `CI`).
- **Layer 4 is Claude-only.** Claude Code hooks do not constrain Codex, Cursor, Copilot or a
  human. Anything that must hold for *every* author belongs in layer 5 (CI) or in repo/production
  permissions — never only in a hook or a markdown rule.
- **`@modelcontextprotocol/server-filesystem` has no read-only mode.** Its write tools are always
  exposed; the version is pinned in `scripts/start-codebase-mcp.ps1`. Restrict at the client or
  with a Docker `ro` mount — see [`docs/codebase-memory-mcp.md`](../codebase-memory-mcp.md).

## Known gaps (deliberate, not forgotten)

None open. The list below is kept as lineage — each entry names what was wrong and what closed it.

**Closed 2026-08-10 — the Antigravity fork.** The layer ran to 885 lines across `.antigravityrules`
(346), `docs/ANTIGRAVITY-PROFILE.md` (382) and `docs/ANTIGRAVITY-RULES.md` (157), against peer
adapters of 7–33 lines. It was not merely fat, it was **forked**: 55 of 69 lines of its persona
block were byte-identical to `AGENT-OPERATING-PROFILE.md`, and the profile instructed "never merge
without explicit owner approval" while `AGENTS.md` grants autonomous merge. **Root cause: it was
the only adapter absent from `check-adapters.mjs`, so it was the only one with no line cap** — the
"thin by construction" guarantee held everywhere it was enforced and failed where it wasn't.
Fixed by promoting the two genuinely-canonical sections into `AGENTS.md` ("Data handling — time and
PII" — timezone and PII rules that existed in *no* `AGENTS.md`), archiving the profile with a
supersession banner, reducing `.antigravityrules` to a 40-line pointer, and **adding the cap**
(60 lines) plus a guard forbidding the contradictory merge instruction from reappearing in a live
adapter. Net 885 → 197 lines. The cap was red-teamed, not assumed: padding the file to 72 lines
produces `FAT .antigravityrules is 72 lines (cap 60)` and exit 1.

**Closed 2026-08-10:** the `pnpm-lock.yaml` `apps/voice` importer entry is gone (verified: zero
matches); `ANTIGRAVITY_MASTER_PLAN.md` moved to `docs/90-archive/superseded-plans/` with a
supersession banner, so opening it directly no longer reads as policy;
`docs/00-current-truth/architecture.md` no longer diagrams `apps/voice` as a live ring — the
section is now a tombstone that names where the capability actually lives.
