# Machine sync: one agent setup on every PC

Started 2026-11-03 (job `2026-11-03-machine-sync`, branch `chore/machine-sync-runbook`), from Nour: "i want my graphify n
brain and skills mcps etc synced across all my computers, shop pc, and nicksmax". This page is the contract: what syncs,
through which channel, what each machine has today, and the steps only Nour runs. Labels as in
`MACHINE-RUNBOOK-2026-11.md`: FACT (measured, command named), INFERRED, NOT CHECKED.

Machines are the ones in `config/agent-os/local-services.json` `machines`: NATTYNOUR (operator laptop, agent host),
NicksMax (always-on camera and recovery edge, 2 cores, 8 GB, 40 GB C:), MECHANICS (shop front-desk PC).

## What syncs, and through what

| Piece | Lives in | Channel to every PC | Per-PC step |
|---|---|---|---|
| Repo skills (88), agents (6), commands, PreToolUse/SessionStart/UserPromptSubmit hooks, `scripts/agent-os/`, `config/agent-os/` | `.claude/`, `scripts/`, `config/` in this repo | git: a current clone. A **sparse** clone must list `.claude`, `scripts`, `config`, `docs` in `git sparse-checkout list`, or the hooks and skills are simply not on disk and nothing says so (FACT, NicksMax below) | `git pull --ff-only origin main` |
| Machine half: `~/.claude/hooks/*.mjs`, always-on skill copies in `~/.claude/skills/`, the `~/.claude/CLAUDE.md` block, global `settings.json` hooks | repo copies, installed per machine | `node scripts/agent-os/bootstrap-machine.mjs` (`--check` reports; without it installs, backs up, idempotent) | after every ff-sync |
| Plugins | claude.ai account (synced) or per-machine `/plugin` | account ones follow the login; the three marketplace ones are per machine | `bootstrap-machine.mjs --check --hook` names the missing ones with the enable line |
| Cloud MCP connectors (Gmail, Calendar, Drive, Docs, Neon, Sentry, context7, Railway) | claude.ai account | follow the login | none |
| Graphify code graph + MCP | NATTYNOUR only, `127.0.0.1:8765/mcp` (job 2026-10-19, W9 `chore/graphify-always-on`) | other PCs become **clients over the tailnet**, never builders: `docs/agent-os/TAILNET-MCP.md` | Nour: `tailscale serve 8765` + ACL on NATTYNOUR; repo: per-host URL (follow-up 1) |
| BrainMemory (the brain) | Neon, canonical (`apps/statenour/docs/KNOWLEDGE-ENGINES.md`) | it is the cloud | none |
| Obsidian vault | NATTYNOUR, `OneDrive\Documents\Obsidian Vault` (default in `scripts/install-cockpit-plugins.ps1`, NOT CHECKED live) | not synced to other PCs today | Nour's decision (step 5) |
| Personal layer: skills, settings, hooks, MCP entries, CLAUDE.md rules | `config/agent-os/user-layer.json`, `.claude/skills`, `config/agent-os/global-claude-md-block.md` | git, then `node scripts/agent-os/bootstrap-machine.mjs`; `--check` names each missing or drifted item. Audit below ("Personal layer") | after every ff-sync |
| Agent memory (`~/.claude/projects/*/memory`) | per machine | not synced; the shared part is `.claude/agent-memory/` + `MEMORY-INDEX-GUARD.md` | NOT CHECKED whether the shop PCs need any of it |

## Where each machine is (2026-11-03)

| Check | NATTYNOUR | NicksMax | MECHANICS |
|---|---|---|---|
| Clone | primary `C:\Users\nourd\NattyNour\nicks-tire`, serves the graph (ledger 2026-10-19, FACT then) | sparse partial clone `C:\Users\nourd\NicksMax\repos\NOURCITY`; was 109 behind main at 09:40, **ff-synced to 9e456b645 at 09:51** on Nour's go, no camera-bridge file in the delta (FACT) | **was none** (0 `.git` directories on C: to depth 6; `C:\NOURCITY` holds hash-pinned downloads for the office lane and lot-vision f195f99a6). **Sparse clone made 09:50-09:58** on Nour's go in its session: `C:\Users\Nick's Tire\NOURCITY` at main 9e456b645, `--filter=blob:none`, sparse set `.claude config docs scripts` (FACT, its session) |
| `.claude` on disk | yes | **was absent**: sparse list was `.github apps/... camera-bridge config docs scripts`; `git sparse-checkout add .claude` done 09:43, 88 skills, 6 agents, settings.json now present (FACT) | yes since the clone; before it `~/.claude/CLAUDE.md` was missing, `settings.json` 71 bytes with no hooks, `~/.claude/skills` empty (FACT) |
| `bootstrap-machine.mjs --check` | ok per W9 | 15 MISSING before; 13 installed 09:50, prompt-sharpen hook added after the ff-sync; the last 2 (`find-skills`, `steal-like-an-artist`) installed 2026-11-05 07:46 after #3535 merged, with W9's graph hooks and the `mcpServers.graphify` entry from #3533: **`[bootstrap] clean`** (FACT) | **Node.js LTS v26.13.0 installed** (winget, machine scope, hash verified); bootstrap applied 14 items 2026-11-03, and on 2026-11-05 07:45 its session read every item ok including the two vendored skills, **`[bootstrap] clean`**, `[health] machine ok | bootstrap ok | plugins ok (7 required)` (FACT, its session) |
| Required plugins not enabled | NOT CHECKED | hook line says agentic-council, receipts-check, desktop-commander, avoid-ai-writing, pr-review-toolkit, hookify; the first three are loaded in the session that ran it, so the detector misses account-synced plugins in the desktop app (INFERRED); the three marketplace ones are really absent | Claude Code CLI 2.1.317 installed (npm, user), marketplaces claude-plugins-official + claude-code-workflows added, pr-review-toolkit, hookify, avoid-ai-writing installed (user scope) on Nour's go, 10:00 (FACT, its session). The check still names agentic-council, receipts-check, desktop-commander as MISSING while all three load in its desktop-app session (FACT): follow-up 4. 30 known MCP connect failures as of 11/01 |
| Graphify | server on loopback, graph current via merge-gate rebuild + daily task (W9) | none, by policy (`local-services.json`: "no heavy services"); `session-health` prints `local services: not expected on this host` (FACT) | none; client only, no serve, no build |
| Tailnet | `nattynour-1` 100.127.185.69, online, DERP relay; ports 22, 2222, 3389, 8765 closed from NicksMax (FACT 09:38) | `nicksmax` 100.95.169.54, sshd on the tailnet interface | **Tailscale 1.104.5 installed and signed in as nourdean22, 100.98.25.123** (FACT, its session); `local-services.json` still says "Chrome Remote Desktop" for MECHANICS: update it with the per-host URL work (follow-up 1), so this PR stays docs-only |
| Reach for an agent | its own sessions | its own sessions; SSH from NATTYNOUR | its own session only ("Fresh session 10/26") |

## Steps for Nour

1. **NicksMax ff-sync** (changes the camera-bridge code the supervisor runs, so your go in the NicksMax session):
   `git -C C:\Users\nourd\NicksMax\repos\NOURCITY pull --ff-only origin main`, then
   `node scripts/agent-os/bootstrap-machine.mjs` again. The supervisor restarts the sign edge when the code fingerprint
   changes (`.nicksmax-supervisor-state.json` `edge-code-version`), so expect one restart.
2. **Serve the graph on the tailnet, on NATTYNOUR**: the three commands in `TAILNET-MCP.md` (`tailscale serve 8765`,
   the ACL rule to your own devices, `tailscale serve status`). Until then no other PC can query the graph.
3. **Plugins**: enable the account ones at claude.ai > Settings > Plugins if the detector is right that any is off;
   install the marketplace three where you want them (`/plugin install pr-review-toolkit@claude-plugins-official`,
   `hookify@claude-plugins-official`, `avoid-ai-writing@claude-code-workflows` after `/plugin marketplace add wshobson/agents`).
4. **The two personal skills**: say whether `find-skills` and `steal-like-an-artist` may be vendored into
   `.claude/skills` (then every PC gets them by git) or stay personal.
5. **Obsidian vault**: say where it should live for all PCs. Google Drive for desktop in streaming mode is on NicksMax
   since today; a vault on Drive needs its folder marked "Available offline" on each PC, or Obsidian sees placeholders.
6. **MECHANICS**: done 09:50-09:58 on your go in its session (Node.js LTS, the sparse clone, the bootstrap, Tailscale
   signed in). Left there: restart the Claude app once so new sessions' hooks find `node`; re-run
   `node scripts/agent-os/bootstrap-machine.mjs` after each `git pull --ff-only origin main`.

## Harness control (2026-11-06)

Agents can ask a PC to run a NAMED read-only check and read the answer; nothing else. Job
2026-11-06-harness-control-nick-node. Pull only: bdnick holds a queue, the PC fetches from it, bdnick never reaches a PC.

| Piece | Where |
|---|---|
| What can run (names, exact argv, which PCs, poll interval and output cap per PC class) | `config/agent-os/harness-actions.json` |
| The doors (`HARNESS_CONTROL_KEY` only; the snapshot keys never open them) | `apps/statenour/app/api/devices/harness/actions/` (enqueue + read, `claim/`, `result/`) |
| Queue, audit rows, Nick's node | `apps/statenour/lib/services/harness-control.ts`, table `harness_actions`, `AuditEvent` `harness.action.*` |
| The PC side (one action per tick, no shell, argv from its own checkout) | `scripts/agent-os/harness-poll.mjs`, task `NOURCITY-Harness-Poll` via `scripts/register-harness-poll-task.ps1` |
| Claude sessions | `node scripts/agent-os/harness-run.mjs --list`, `--pc <pc> --action <name> --wait`, `--result <id>` |
| Nick | `getHarnessStatus` (nodes, Nick included, and the last actions), `runHarnessAction`, `getHarnessActionResult` |

Turning it on is per PC and is Nour's step: add `"controlKey": "<HARNESS_CONTROL_KEY>"` to
`%LOCALAPPDATA%\nourcity\harness-snapshot.json`, then run the register script from the primary checkout. Without the
task, an action queued for that PC expires after 10 minutes and never runs late. The task is deliberately NOT in
`local-services.json` `tasks`: that list makes `session-health` report MISSING on every PC, and control is opt-in.
Remove it with `Unregister-ScheduledTask -TaskName 'NOURCITY-Harness-Poll' -Confirm:$false`.

When something looks wrong on a PC: `%LOCALAPPDATA%\nourcity\harness-poll-last-failure.txt` holds the last failed tick
(a refused key, "not migrated", a dead network; `pc-status` prints it too), and `harness-poll-unsent-result.json` is a
result that ran but could not be posted, resent first on the next tick. States a reader sees: DONE, FINDINGS (it ran
and reported problems, e.g. `bootstrap-check` exit 1), FAILED, EXPIRED (no PC took it in 10 min), LOST (taken, no
answer). `harness-run.mjs` exits 0 DONE, 3 FINDINGS, 1 FAILED/EXPIRED/LOST, 2 not finished.

Adding an action is one allowlist entry plus its line in `HARNESS_ACTIONS` (a test fails when the two drift) and in
Nick's `runHarnessAction` enum. v1 holds read-only actions only; an action that writes or restarts anything gets
`needsGo: true`, which every door refuses until an approval path exists.

## Follow-ups in the repo

1. Per-host client URL for graphify: `local-services.json` grows a hosts map (keyed on NATTYNOUR's tailnet node name,
   `nattynour-1` today), read by `mcp-adapters.mjs` and `session-health.mjs`, after W9 merges. Then a client PC's
   `bootstrap-machine.mjs` writes `mcpServers.graphify` with that URL instead of 127.0.0.1.
2. `bootstrap-machine.mjs --check` and `session-health.mjs` say nothing when the project half is missing: on a sparse
   clone without `.claude` they reported "ok" for the machine half and "not expected on this host", and the hooks did
   not exist. Add one line: `project: .claude MISSING from sparse checkout, fix: git sparse-checkout add .claude`.
3. DONE in #3535 (2026-11-03): `find-skills` and `steal-like-an-artist` vendored into `.claude/skills` with SOURCE.md and
   licence; NicksMax and MECHANICS both read `[bootstrap] clean` on 2026-11-05. The wider job (Nour's "yes, everything",
   2026-11-03 10:04) is the "Personal layer" section below.
4. DONE in #3543 (2026-11-04): `plugin-index.mjs` reads Claude Desktop's own account-plugin store, so the false
   agentic-council / receipts-check / desktop-commander MISSING is gone on both machines (MECHANICS line 2026-11-05:
   `plugins ok (7 required)`). Still truly per-machine: the three marketplace plugins and `nourcity-harness` (#3545),
   installed on NicksMax at user scope 2026-11-05 07:47 on Nour's go.

## Personal layer

Job `2026-11-03-personal-layer-into-repo`. Nour: "Yes, everything", "I want all my rules and everything across all comps"
(2026-11-03), "Yes, start it" (2026-11-05). The audit of NATTYNOUR's `~/.claude` against what `bootstrap-machine.mjs` installs,
read 2026-11-05. Decisions: **vendor** (copied into the repo, bootstrap installs it), **generate** (bootstrap writes it from
`config/agent-os/user-layer.json`), **skip** (with the reason), **Nour decides** (nothing installs until he says yes). Item names
only: nothing here is a secret, a token, an absolute path or a private address.

Ruling: Nour, 2026-11-05 09:55 EST, relayed by the manager session, on the first five open cells with their defaults: "approved all go".
Cells he ruled on read "(Nour, 2026-11-05)". The three skills with a Bash grant came after that list: Nour, 10:45 EST, relayed the same way: "yes i want it too those are good skills needed".

### Skills in `~/.claude/skills` (47 folders, FACT)

The registry `apps/statenour/data/skills-registry.json` lists 1,434 skills from an older generation on another machine
(generated 2026-07-30; 129 critical, 25 offensive). This machine holds 47 folders, so the 1,434 is not this layer (FACT).
All of them stay in skill-recall (see "Recall time" below).

#### Already installed by bootstrap (9, no change)

| Item | Kind | Decision | Reason |
|---|---|---|---|
| using-superpowers, ponytail, karpathy-guidelines, i-have-adhd, verification-before-completion, find-skills, prompt-gallery, steal-like-an-artist, antislop | portable | keep | The always-on set; repo copies exist and bootstrap installs them today. |

#### In the repo, not installed at user level (16)

These work inside NOURCITY on every PC through `.claude/skills`, and are missing in any other project on a PC that never had
them. Bootstrap adds all 16 to its install list. An existing machine `description:` is kept, as for the always-on set.

| Item | Kind | Decision | Reason |
|---|---|---|---|
| antislop-code, antislop-copywriting, antislop-layoutmobile, antislop-ui | portable | generate (install) | Machine copies differ from the repo copies; the repo wins and the old file goes to the backup folder. |
| ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review | portable | generate (install) | Differ only by the repo's `triggers:` line. |
| brainstorming, systematic-debugging, test-driven-development | portable | generate (install) | Differ by the `triggers:` line and, for brainstorming, two script files. |
| reverse-engineer-anything | portable | generate (install) | Differs only in SOURCE.md. |
| antislop-human, differential-review, supply-chain-risk-auditor | portable | generate (install, Nour, 2026-11-05) | Each grants itself Bash in `allowed-tools`. His words: "yes i want it too those are good skills needed". `BASH_GRANTS` in `bootstrap-machine.mjs` names exactly these three folders and exactly these grants; any other shell grant still refuses. |

#### Not in the repo (22)

| Item | Kind | Source, licence (FACT, `gh api` or the local clone) | Registry risk | Decision | Reason |
|---|---|---|---|---|---|
| diagnosing-superpowers | portable | obra/superpowers, MIT | not listed | vendor | Byte-identical to upstream 8ca22dba. |
| dispatching-parallel-agents | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| executing-plans | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; ships two shell scripts, read before the copy. |
| receiving-code-review | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| requesting-code-review | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| subagent-driven-development | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; ships three shell scripts, read before the copy. |
| writing-skills | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; `skill-forge` names it as the TDD doctrine for skills. |
| finishing-a-development-branch | portable | obra/superpowers, MIT | **critical** | skip (Nour, 2026-11-05) | The guardrail skips any skill the registry marks critical or high. The label comes from the registry's text scan, and `commit` and `bash-pro` carry it too (FACT), so it may be a false alarm (INFERRED). |
| using-git-worktrees | portable | obra/superpowers, MIT | **critical** | skip (Nour, 2026-11-05) | Same. |
| writing-plans | portable | obra/superpowers, MIT | **critical** | skip (Nour, 2026-11-05) | Same. |
| anti-slop-writing | portable | adenaufal/anti-slop-writing, MIT (LICENSE in the folder and the local clone at 104fae8c) | not listed | vendor | Upstream reads 404 today (FACT, 2026-11-05): the clone and the kept LICENSE are the provenance. The MIT grant does not lapse. |
| ad-creative, ads, social, video | portable | coreyhaines31/marketingskills, MIT | unknown or not listed | vendor | Junctions into `~/.agents/skills` on NATTYNOUR; bootstrap replaces a junction with a real folder and leaves its target alone. The always-on hook tells every PC to use them for ad and reel work, so a PC without them is told to invoke a skill it lacks (FACT). |
| ads-creative, ads-meta, ads-tiktok | portable | agricidaniel/claude-ads, MIT | not listed | vendor | Same reason. |
| humanizer | portable | blader/humanizer, MIT | not listed | vendor | Junction into `~/.agents/skills`; the upstream `.github/` folder stays out. |
| graphify | machine | Graphify-Labs/graphify, Apache-2.0 | no risk field | skip | Installed by its own tool and needs the Python package; other PCs are graph clients by policy (`local-services.json`). The repo profile already says what to do when it is absent. |
| video-cutter | machine | house | not listed | skip | Names NATTYNOUR's own folders and drives tools that exist only there. Not portable until those are parameterised. |
| synced | machine | account bucket | n/a | skip | 733 files that follow the login. Not a skill folder. |

### Hooks

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `~/.claude/hooks/always-on-skills.mjs`, `find-skills-turn.mjs` | portable | keep | Byte copies from `scripts/agent-os/`, installed today. |
| SessionStart `always-on-skills.mjs` | portable | keep, moved to user-layer.json | Installed today. |
| SessionStart `graph-ensure-mcp.mjs --scope global` | portable | keep, moved to user-layer.json | Installed today. |
| UserPromptSubmit `skill-recall.mjs`, `find-skills-turn.mjs`, `prompt-sharpen.mjs`, `graph-recall.mjs` | portable | keep, moved to user-layer.json | Installed today. |
| PreToolUse Bash `rtk hook claude` | needs a tool | generate, only where `rtk` is on PATH | Not installed today. A hook naming a missing binary errors on every Bash call, so it is written only where the lookup finds `rtk`. No binary is installed on any PC (Nour, 2026-11-05). |

### `~/.claude/CLAUDE.md`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| Output style rules 1-10, exceptions | portable | vendor into the block | The rules every PC should have. The opening sentence is personal and stays out; the skill names stay. |
| Always-on invocation rules (using-superpowers, ponytail, brainstorming order) | portable | vendor into the block | Short form; the install history stays out. |
| `@RTK.md` import | needs a tool | generate, only where `rtk` is on PATH | With `~/.claude/RTK.md`, vendored at `config/agent-os/RTK.md`. |
| Machine layout | machine | skip | Absolute paths and folders of one PC. |
| Three-missing-skills substitution note | portable | skip | `CLAUDE-OPERATING-PROFILE.md` already carries it. |
| graphify pointer | machine | skip | The profile already carries it. |
| The `nourcity-always-on` block | portable | keep | Installed today; this job adds to its source file. One fenced block, no `@import`: the import would point at a path that differs per PC. |

NATTYNOUR keeps its own copy of the output rules and the import above the block. Bootstrap never edits text outside its markers,
so it drops from the block any `## ` section or `@RTK.md` line already present outside them. Nothing reads twice.

### `~/.claude/settings.json` keys

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `skillListingBudgetFraction` | portable | generate | Keeps skill descriptions in the listing. |
| `outputStyle`, `theme` | portable | generate | His setup. |
| `skipWorkflowUsageWarning`, `precomputeCompactionEnabled`, `switchModelsOnFlag`, `inputNeededNotifEnabled`, `agentPushNotifEnabled` | portable | generate | His setup. |
| `extraKnownMarketplaces` (`claude-code-workflows`, `nourcity`) | portable | generate | Public GitHub sources. Listing a marketplace installs nothing. |
| `cleanupPeriodDays`, `effortLevel`, `autoContinueAtUsageLimit` | portable | skip (Nour, 2026-11-05, for the first) | Owned by the Global preferences job, which set 365, xhigh and true on this PC on 2026-11-05. Not in the bootstrap allowlist, so bootstrap never touches them. |
| `enabledPlugins` | account | skip (Nour, 2026-11-05) | 112 on, 69 off across 3 marketplaces, against 7 required (FACT). Copying the list would enable about 105 plugins on a 2-core PC. Bootstrap writes nothing here; `required-plugins.json` stays the check. |

### Permissions

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `~/.claude/settings.json` `permissions` | n/a | nothing to copy | The key is absent: 0 allow, 0 deny, 0 ask (FACT). |
| `~/.claude/settings.local.json` | n/a | nothing to copy | Absent (FACT). |
| `~/.claude.json` per-project `allowedTools` | n/a | nothing to copy | 84 projects, 0 entries (FACT). |
| `allowed-tools: Read Write Edit Glob Grep` in antislop, antislop-code, antislop-copywriting, antislop-layoutmobile, antislop-ui | portable | install | File tools only, active only while the skill runs. `antislop` installs this way today. Anything else in `allowed-tools` refuses: only Read, Write, Edit, MultiEdit, Glob and Grep pass, plus the three exact `BASH_GRANTS`. |
| Primary checkout `.claude/settings.local.json`, entry: one skill by name | machine | skip (Nour, 2026-11-05) | Untracked, per machine. Bootstrap installs no permission entry. |
| Same file, entry: one scheduled-tasks read tool | machine | skip (Nour, 2026-11-05) | Same. |
| Same file, entries: two connector read tools (connector ids stay out of this page) | machine | skip (Nour, 2026-11-05) | Same; the ids are per account. |
| Same file, entries: two `curl` reads of the live sites | machine | skip (Nour, 2026-11-05) | Same; written for one long-past check (INFERRED). |

Bootstrap refuses a `permissions` key in `user-layer.json` outright. A yes here is a code change in a PR, never a table edit
alone.

### Auto-mode layer (2026-11-06)

`config/agent-os/auto-mode-layer.json` holds classifier prose (`autoMode.environment`, `allow`, `soft_deny`) and
`permissions.ask` rules for Railway config commands. Nour runs `node scripts/agent-os/auto-mode-layer.mjs` on each PC
(`--check` reports); bootstrap never applies it. Why a separate script: the classifier reads `autoMode` only from
`~/.claude/settings.json` or managed settings, never from a repo's `.claude/settings*.json` (code.claude.com/docs/en/auto-mode-config,
read 2026-11-06), and an agent in auto mode cannot write settings (Self-Modification). The script refuses any key but those
two, any list without `"$defaults"` (dropping it removes the built-in force-push and exfiltration rules), and any ask rule
that is not one `Bash(...)`/`PowerShell(...)` prefix. It never writes `permissions.allow`: broad allow rules are dropped
in auto mode anyway, and a prefix cannot tell a review-thread resolve from a branch delete. Entries it installed and the
layer later drops are removed (`~/.claude/auto-mode-layer.installed.json`). Probes: the PR body of this job.

### MCP entries in `~/.claude.json`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `graphify` | portable | keep | Installed today (#3533). |
| `vapi-docs` | portable | generate | A public docs URL with no key. |

### Everything else in `~/.claude`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `.credentials.json` and its temp file | secret | skip | Never read, never copied. |
| Agents, commands at user level | n/a | nothing to copy | The folders do not exist (FACT). The repo's lane agents and commands already travel by git. |
| `output-styles/nour.md` | portable | vendor (2026-11-06) | Source `config/agent-os/output-styles/nour.md`, selected by `outputStyle: "nour"`. Written from his last 50 sessions (26 of 230 typed replies were a bare "?" after a message that ended mid-step). `FILE_SRC` allows one subfolder under `config/agent-os` and no all-dots segment. A desktop session reads the file at start: restart open sessions. |
| `RTK.md` | needs a tool | vendor | See the CLAUDE.md table. |
| `session-skills.md` | machine | skip | A generated index from 2026-10-08, already stale; the profile says it is not a source of truth. |
| `scheduled-tasks/nourcity-heartbeat-*` (4) | machine | skip | They must fire on one PC. Copies on three PCs would run the heartbeat three times. |
| `dev-mods/` | machine | skip | The mod is `.claude/mods/nourcity-harness` (#3545), installed by plugin. |
| `.claude.json` inside `~/.claude` | machine | skip | Ids and migration flags of this install. |
| `projects/` (agent memory and transcripts) | machine | skip | Per machine; may hold private text. |
| `agent-os/`, `backups/`, `bootstrap-backup/`, `cache/`, `debug/`, `file-history/`, `plugins/`, `session-env/`, `sessions/`, `shell-snapshots/`, `state/`, `telemetry/`, `uploads/`, `mcp-needs-auth-cache.json`, `.last-cleanup`, `remote-settings.json.synced-at`, `settings.json.bak*` | machine | skip | Runtime state and backups. |

### Recall time

Budget: about 2 s per prompt on a 2-core box. No curated subset is needed.

- FACT: `skill-recall.mjs` over 106 repo, 5 user and 1,031 plugin skills took 561 to 1,621 ms cold and 398 to 1,702 ms warm on this 8-core
  laptop under load. The tree before vendoring (90 repo skills) took 773 to 2,403 ms cold and 331 to 788 ms warm in the same two rounds, so
  the 16 added skills are inside the noise. They are 1.4% of the index.
- FACT: `bootstrap-machine.mjs --check --hook` with the gate took 620 ms here.
- NOT CHECKED: NicksMax itself. INFERRED under budget there: plugins are 90% of this index, and it enables a fraction of them.

### Plugin read on the other PCs

Acceptance item 4 of the brief is already done: PR 3544 (b4ccd15e64) taught `plugin-index.mjs` the Desktop stores, and MECHANICS
reads `plugins ok (7 required)` live. Not redone here.

## Receipts (NicksMax, 2026-11-03, this session)

- `git sparse-checkout add .claude` (09:43): `.claude/` materialized, tracked tree clean.
- `node scripts/agent-os/bootstrap-machine.mjs` (09:50): 13 installed, 2 MISSING; `~/.claude/settings.json` gained the
  SessionStart always-on hook and the two UserPromptSubmit hooks; backup in `~/.claude/bootstrap-backup/`.
- `git pull --ff-only origin main` (09:51, Nour's go): 570633c25 -> 9e456b645, no camera-bridge change, no edge
  restart; bootstrap re-run added the prompt-sharpen hook.
- Not done on NicksMax: no graph build (policy), no tailnet client (blocked on step 2).
