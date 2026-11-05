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
| Personal skills, 1,434 in `~/.claude/skills` on NATTYNOUR (`apps/statenour/data/skills-registry.json`, 2026-07-30) | NATTYNOUR home folder, outside the repo | **not synced**. Two of the always-on eight (`find-skills`, `steal-like-an-artist`) have no repo copy, so bootstrap leaves them MISSING on every other PC (FACT) | vendor them into `.claude/skills` (owed since the 2026-10-26 ledger) or a private `claude-home` repo (follow-up 3) |
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

## Follow-ups in the repo

1. Per-host client URL for graphify: `local-services.json` grows a hosts map (keyed on NATTYNOUR's tailnet node name,
   `nattynour-1` today), read by `mcp-adapters.mjs` and `session-health.mjs`, after W9 merges. Then a client PC's
   `bootstrap-machine.mjs` writes `mcpServers.graphify` with that URL instead of 127.0.0.1.
2. `bootstrap-machine.mjs --check` and `session-health.mjs` say nothing when the project half is missing: on a sparse
   clone without `.claude` they reported "ok" for the machine half and "not expected on this host", and the hooks did
   not exist. Add one line: `project: .claude MISSING from sparse checkout, fix: git sparse-checkout add .claude`.
3. DONE in #3535 (2026-11-03): `find-skills` and `steal-like-an-artist` vendored into `.claude/skills` with SOURCE.md and
   licence; NicksMax and MECHANICS both read `[bootstrap] clean` on 2026-11-05. The wider "personal layer into the
   repo" job (manager W12, Nour's "yes, everything" 2026-11-03 10:04) is still queued on NATTYNOUR; no branch yet.
4. DONE in #3543 (2026-11-04): `plugin-index.mjs` reads Claude Desktop's own account-plugin store, so the false
   agentic-council / receipts-check / desktop-commander MISSING is gone on both machines (MECHANICS line 2026-11-05:
   `plugins ok (7 required)`). Still truly per-machine: the three marketplace plugins and `nourcity-harness` (#3545),
   installed on NicksMax at user scope 2026-11-05 07:47 on Nour's go.

## Receipts (NicksMax, 2026-11-03, this session)

- `git sparse-checkout add .claude` (09:43): `.claude/` materialized, tracked tree clean.
- `node scripts/agent-os/bootstrap-machine.mjs` (09:50): 13 installed, 2 MISSING; `~/.claude/settings.json` gained the
  SessionStart always-on hook and the two UserPromptSubmit hooks; backup in `~/.claude/bootstrap-backup/`.
- `git pull --ff-only origin main` (09:51, Nour's go): 570633c25 -> 9e456b645, no camera-bridge change, no edge
  restart; bootstrap re-run added the prompt-sharpen hook.
- Not done on NicksMax: no graph build (policy), no tailnet client (blocked on step 2).
