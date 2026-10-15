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
- **Stop** (`stop-check.mjs`) blocks ending a turn with uncommitted work while ON `main` —
  one precise invariant, nothing else. A Stop hook that blocks routine turns trains the
  operator to disable it; widen only behind a canary.
- **UserPromptSubmit** (`skills-first-reminder.mjs`) prints a reminder on every prompt to search every skill source
  (repo, account, plugin) and load the best matches before any work. It is advice, not enforcement: it has no path
  to exit 2, so it never blocks a prompt, and it cannot make the model comply. `skillsFirstReminder.test.mjs` runs
  the configured command verbatim and asserts the reminder text, the skill sources it names, and exit 0.
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
  PR where the diff is reviewable.

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
the four SQL text rows are judged by `destructive-sql` alone (`onlyRules`, below), because their text is SQL.

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

**Optional row fields.** Each is validated at run time and pinned by a canary. A malformed `clientHint`, `skipWhenTrue`
or `expandDirectory` skips that row with a stderr line; a malformed `exceptRules`, `onlyRules` or `rawText` is reported
and that field alone is ignored:

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
  as a shell command. Every id must exist in `policy.json`; a malformed list or an unknown id is reported on stderr
  and the field is ignored, so EVERY rule applies (only ever more denials). A row with a valid `onlyRules` also judges a
  field whole up to `SQL_FIELD_CAP` (1,000,000 characters), because only the anchored, bounded rule runs on it.
- `rawText`: a strict boolean `true` (only on a Bash row) judges the text as given: no shell neutraliser and no
  read-only-search skip. The four SQL rows have it: the neutraliser erases the quoted argument after ` -m`, ` -t`,
  ` -b`, `--message`, `--title` and `--body`, which in SQL can hold statements (`SELECT ' -m "'; DELETE FROM leads; SELECT '
  " '` passed), and SQL that merely starts like a search command (`rg DELETE FROM leads`) is still SQL. Anything but
  `true` is reported and ignored (the shell treatment stays on). The shell door is unchanged: a commit message that
  mentions SQL is still data there.
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
  rules backtrack, and a hook timeout fails open silently, which is why the cap exists. A row with a valid `onlyRules`
  (the SQL rows) runs `destructive-sql` alone, whose scans are anchored or bounded, so it judges a field whole up to
  `SQL_FIELD_CAP` (1,000,000) and slices (500,000 each end) only beyond that. The unjudged middle of a field over its cap
  is a slip window. Native Bash and PowerShell commands are not capped (every scan of `destructive-sql` is bounded, so
  its cost is linear in their length; the other rules were never measured on megabytes).
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

- **Quoted identifiers, any spelling.** `TRUNCATE` and `UPDATE` accept a first identifier in plain, `"double"`, `` `back` ``
  or `[bracket]` form, schema-qualified, with the escapes a shell adds around the quote: `\"Task\"` (bash), `` `"Task`" ``
  and `""Task""` (PowerShell), `` \`leads\` ``. This matters because statenour's 15 PascalCase Prisma models exist ONLY as
  quoted names such as `"Task"`.
- **Written-out whitespace.** Between keywords, and before a `WHERE`, a literal backslash-n, -r or -t (`printf 'a;\nb'`,
  `$'DELETE\nFROM'`), a PowerShell `` `n ``, `` `r ``, `` `t `` or a backslash-newline counts as whitespace, and a keyword may
  start right after one.
- **Where a missing WHERE is decided.** A `DELETE FROM` or `UPDATE ... SET` is denied unless a `WHERE` appears before the
  end of ITS statement. The scan stops at: `;`, `&&`, a lone `|` (not `||`, which is SQL string concatenation), and a
  following `-c`, `-e`, `-f`, `-q`, `-Query`, `--command`, `--execute` or `--file` flag. It does NOT stop at a newline
  (a multi-line statement is normal), at `||`, at a single `&` (`'AT&T'`) or at the closing quote of the shell argument
  (that cannot be found linearly), and it gives up after 5,000 characters: a `WHERE` farther than that from its `DELETE
  FROM` or `SET` does not count (denied; the safe direction). So a WHERE in a later `-c`, a chained `&&` command or a
  piped command no longer rescues a bare write, while `UPDATE t SET a = b || c WHERE id = 1` and a multi-line
  `DELETE FROM leads` + newline + `WHERE id = 3` pass. A `||` chain is not a boundary by itself (a second `-c` after it is).
  The `ALTER TABLE ... DROP` scan uses the same stops and gives up after 1,500 characters; `DROP COLUMN` and `DROP
  CONSTRAINT` are denied anywhere by the DROP-kind arm, so only the other `ALTER TABLE ... DROP` forms depend on it.
- **Cost.** Every scan is bounded, so a text costs at most about its length times 5,000 (1,500 for ALTER) steps. Measured on
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
  10x its measured time). A separate canary pins that the pattern is anchored (structurally) and
  that the unanchored form is at least 20x slower on the same benign text (a ratio, so a fast runner cannot turn it
  red for a non-defect).

### Native ask rules (2026-10-15)

Railway, Neon, Vercel and Prisma Postgres mutation tools carry no command text: the tool name and its arguments ARE
the operation (Railway `set-variables`, Neon `delete_project`, Vercel `create_project_env`), so the PreToolUse hook has
nothing to judge. `permissions.ask` in `.claude/settings.json` makes Claude Code prompt before each one: 135 entries,
one `mcp__*__<leaf>` glob per protected tool, grouped Railway, Neon, Vercel, Prisma and sorted inside each group (a leaf
two families share, `update_project`, is listed once).

- **Why native rules and not hook code.** The Claude Code docs (`code.claude.com/docs/en/permissions`, read 2026-10-15
  by the manager; the lane could not re-read them) document that a tool matched by an explicit ask rule still prompts in
  `bypassPermissions` mode, which is how this repo is usually run, and that a prompt nobody can answer (`claude -p`,
  Night Shift) is denied, the intended failure direction. Documented, not proven live: step 7 of the live check below is
  the proof. There is no JavaScript to crash: a hook fails OPEN on its own bugs and on timeout, a rule does not. A hook
  `ask` is not documented to prompt in bypass, and a hook deny cannot honour "explicit operator instruction".
- **No UUID, no plugin name.** Connector UUIDs are per account and change on reconnect. The `mcp__16f59cb5-...` allow
  entries already in `settings.json` never match today's Railway connector (`7f852746-...`): proof that UUID-pinned rules
  rot. They are left as found and flagged: delete them, or replace them with `mcp__*__<leaf>` read rules.
- **What prompts.** Deletes and removals; deploys, redeploys, restarts, promotes and rollbacks; credentials, keys,
  secrets and connection strings (`rotate_credential`, `reset-bucket-credentials`, `create_prisma_postgres_connection_string`,
  `create_sdk_key`); env and service config writes (`set-variables`, `create_project_env`, `update-service`,
  `update_project`); DNS, domain, certificate and firewall changes; arbitrary execution (`railway-agent`,
  `run_session_command`, `write_session_files`); schema changes (`complete_database_migration`,
  `execute_prisma_postgres_schema_update`: both are ALSO judged by text). What does NOT prompt: reads, additive creates,
  and the SQL text tools (`run_sql`, `run_sql_transaction`, `explain_sql_statement`, `execute_sql_query`), which the hook
  judges by text because a prompt per query would train the operator to tap through.
- **Adding a name.** (1) Resolve the full tool name with ToolSearch `select:` and read its definition. (2) Add the leaf to
  the right fixture (protected or allowed) in `scripts/agent-os/mcpAskRules.test.mjs`. (3) Add `mcp__*__<leaf>` to
  `permissions.ask`, in the group's sorted position. (4) Run `node --test scripts/agent-os/mcpAskRules.test.mjs`.
- **Known and deliberately not prompted.** `KNOWN_UNCLASSIFIED` in the canary names the live writers and
  secret-bearing reads nobody has classified yet (Vercel `create_sandboxes_v2` to `v4`, `create_drain`, `update_drain`,
  `get_shared_env_var`, `filter_project_envs`, Neon `presign_storage_object` and the others in "Still unguarded"). It is
  disjoint from the protected and allowed lists (asserted) and asserted NOT asked, so not prompting them is a recorded
  decision and a later edit is a conscious one.
- **The drift caveat, exactly.** A mistyped or missing name gives NO warning from Claude Code (MCP tool names contain
  underscores, so a typo is just a rule that never matches). The canary compares `settings.json` to the fixtures in
  `mcpAskRules.test.mjs`, and to nothing else: it asserts every protected leaf is asked on every server form (four
  connector UUIDs, the Prisma-Remote plugin, two synthetic reconnect forms) and that no read, additive create or other
  connector's tool is, with BREAKS arms that name the exact leaf. It CANNOT see a tool a connector renamed or ADDED
  after the fixtures were taken (snapshot: 2026-10-15). Refresh recipe, when a connector updates: (1) list the live
  tools of the four connectors; (2) run ToolSearch `select:` over every leaf of every fixture list (protected, allowed,
  known-unclassified) with its full tool name, and treat a name that does not resolve as stale; (3) diff the live
  names against the fixtures; (4) classify each new name as protected, allowed or known-unclassified and edit the
  fixtures and `permissions.ask` together. The 2026-10-15 pass found one stale allowed name that way: `list_edge_configs` is gone, the live name is `get_edge_configs`.
- **What the canary cannot prove.** That Claude Code itself applies a glob in the SERVER segment of an ask rule. The
  docs' own example is `mcp__*`; `mcp__*__<leaf>` rests on "deny and ask rules accept glob patterns in the tool-name
  position", and the canary runs an emulation of that. "Live check after merge" below proves it with two Deny taps. If it
  fails, replace the globs with exact names.

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
  moved directory are not seen (the walk and the list reader each print one stderr line when they stop early). A hook that times out (10 s) or crashes fails OPEN; the native ask rules have no such window. Canaries
  pin each of these.
- **context-mode plugin runners** (`ctx_execute`, `ctx_batch_execute`). They run code and commands, and the
  manager's probe on 2026-10-15 exited 0 through both. They were not in this session's tool list, so their field
  names were not read from a live definition and no row was invented. Follow-up: read the live schema, then add a
  row per tool (the "Adding a runner" steps below).
- **What the SQL rule still misses.** The SQL text tools are judged now (adapter table above); `destructive-sql` is text
  matching, so by design: a write that has a WHERE passes, including `WHERE true`, a WHERE in a comment, a string
  literal or a subquery, and a CTE whose outer query holds the WHERE; keywords split by a comment (`DELETE/**/FROM`) are
  not seen; MySQL multi-table `DELETE t1 FROM ...` and `UPDATE a JOIN b ... SET` are not parsed; DROP kinds outside the
  list (DOMAIN, AGGREGATE, ROUTINE, RULE, PUBLICATION, SUBSCRIPTION, FOREIGN TABLE ...) pass; `MERGE ... WHEN MATCHED
  THEN DELETE` is not read; SQL run from a file or script (`psql -f cleanup.sql`) has no text to judge; and a DB client
  word outside the list (`sqlcmd`, `sqlite3`, `mariadb`, `usql`) turns the shell gate off. Accepted false positives, in
  the safe direction: `ALTER COLUMN ... DROP NOT NULL` or `DROP DEFAULT`, a bounded `UPDATE ... ORDER BY ... LIMIT` with
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
- **Infrastructure beyond the ask list.** The 135 protected leaves prompt (previous section). Still open: the CLI door
  (`railway`, `vercel`, `neonctl` commands typed through Bash or a runner carry mutations the text rules do not know);
  secret-revealing reads (Railway `list-variables` and `get-bucket-credentials`, Neon `get_connection_string`, Vercel
  `get_project_env`); additive creates, unprompted on purpose (Railway `create-project`, `create-volume`,
  `create-bucket`, `create-webhook`, `generate-domain`; Neon `create_branch`, `create_project`; Vercel `create_project`,
  `create_flag`); and the unclassified tools below.
- **Unclassified infrastructure tools** (in the live tool lists on 2026-10-15, in neither the protected nor the allowed
  fixture; the writers and secret-bearing reads among them are the `KNOWN_UNCLASSIFIED` fixture and are deliberately NOT
  prompted until someone decides; the plain reads, analytics and docs tools are not listed). Neon:
  `presign_storage_object`, `get_ai_gateway`, `get_neon_auth_config`, `list_auth_oauth_providers`,
  `list_auth_trusted_domains`, `list_branch_computes`, `list_functions_custom_domains`, `list_log_fields`,
  `list_log_field_values`, `list_project_permissions`, `get_doc_resource`, `list_docs_resources`. Prisma:
  `get_prisma_composer_topology`, `list_prisma_github_installations`, `list_prisma_github_repositories`. Vercel writers:
  `create_drain`, `update_drain`, `test_drain`, `create_git_project`, `create_kms_issuer`, `create_kms_issuer_policy`,
  `create_sandboxes_v2`, `create_sandboxes_v3`, `create_sandboxes_v4`, `update_sandbox`, `update_session_network_policy`,
  `kill_session_command`, `stop_session`, `invalidate_by_tags`, `invalidate_by_src_images`, `upload_file`,
  `upload_artifact`, `create_storage_stores_blob`, plus the toolbar, CI and observability writers; Vercel secret-bearing
  reads: `get_shared_env_var`, `filter_project_envs`, `get_edge_config_token`, `get_edge_config_tokens`,
  `get_project_deletion_link`. Decide each, then add it to the fixtures and `settings.json` together.
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
step 7 the native ask rules. Three result words are used below. PASS: the stated refusal or prompt appears before
anything is sent. FAIL: the call reached the tool and came back with the tool's own output or a provider error, while
the control behaved as stated. INCONCLUSIVE: a control did not behave as stated, or the session did not load the merged
files, so nothing can be concluded: fix the precondition and repeat. This section is a procedure; whoever runs it
records the result, and nothing here says it has been run.

0. Precondition: fast-forward the PRIMARY checkout to the merged commit (on this machine
   `C:\Users\nourd\NattyNour\nicks-tire`): `git -C <primary> fetch origin main`, then `git -C <primary> merge --ff-only origin/main`,
   never `reset --hard` (a sibling session's work may be in that tree). Confirm `git -C <primary> log -1 --format=%H`
   is the merged commit and that `node -e "console.log(require('./.claude/settings.json').permissions.ask.length)"`, run
   inside the primary, prints 135. Then open a FRESH session whose directory is the primary checkout, run `/permissions`
   and confirm the `mcp__*__delete-service` ask rule is listed; if it is not, stop: INCONCLUSIVE. A worktree session
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
7. Ask probe, with its precondition and positive control first.
   - Mode: run it in `bypassPermissions` (the mode shows under the input box; Shift+Tab cycles it). Ask rules are
     documented to prompt there, so a prompt is attributable to the rule. In the default mode an MCP tool prompts anyway
     and a prompt proves nothing.
   - Positive control: ask Claude to call Railway `list-projects` and Neon `list_projects` (reads, both MUST-ALLOW
     fixtures). They must run with NO prompt. If either prompts: INCONCLUSIVE (wrong mode, or an entry that is too broad:
     run `node --test scripts/agent-os/mcpAskRules.test.mjs`).
   - Probe: ask Claude to call Railway `delete-service` with `projectId: "guard-live-check-nonexistent"` and
     `serviceId: "00000000-0000-0000-0000-000000000000"`, then Neon `delete_project` with
     `project_id: "guard-live-check-nonexistent"`.
   - PASS: the control ran silently and each probe shows a permission prompt BEFORE anything is sent; you answer Deny.
     FAIL: the control ran silently and a probe returns a provider error such as "not found" with no prompt: the
     server-glob form is wrong, so replace the `mcp__*__<leaf>` entries with exact tool names (and keep the fixtures in
     step). INCONCLUSIVE: the control also prompted, or a connector is not connected (its tools are absent).
   - The ids are nonexistent, so even a failed check deletes nothing.

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
