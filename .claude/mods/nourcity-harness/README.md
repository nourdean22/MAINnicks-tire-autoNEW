# nourcity-harness

A Claude Code mod for the NOURCITY monorepo: one pane and one status line that show the state of the
harness (machine, PRs, main, worktrees) without running anything that changes it.

## Design (five lines)

1. **What it shows:** free RAM, the heavy lease, the Chrome slot, open PRs with their check state, main's last commit, worktree counts, and local AI Playground/chat/media/speech states. A part it cannot read shows `UNKNOWN`, never a false healthy state.
2. **Where it gets the data:** repo scripts plus `tools/sovereign-dev/ai-playground.mjs health --json`. The Playground bridge emits sanitized service states and the configured MCP server count; that count does not claim each server is connected. The pane discards model IDs and secrets.
3. **Cost:** status refreshes every 5 minutes per session and skips a tick while the last refresh is still running. Timer ticks never start apps or alter AI settings. Only Refresh and `/harness` update the GitHub board.
4. **Buttons:** Refresh (`r`) re-reads everything. Count worktrees (`w`) runs the read-only sweep preview. Start Playground (`p`) opens the local app and checks the model endpoint. Open Playground for media (`m`) opens the app so its supported setup controls can be used; it does not edit settings, install models, or accept terms.
5. **Home:** this folder, `.claude/mods/nourcity-harness/`, listed by the root `.claude-plugin/marketplace.json` (marketplace `nourcity`). It is required on every PC through `config/agent-os/required-plugins.json`, so the `[health] machine` line names a PC that lacks it.

Benchmarked against: Claude Code's own plugin-marketplace pattern (plugin-authoring reference, build 2.1.309, `.claude-plugin/marketplace.json` + `claude plugin install <mod> --marketplace <owner>/<repo>`) · adopted: a repo-root marketplace with a relative source, so the repo that holds the harness scripts also ships the pane that reads them · rejected: a separate mod repository because Nour said "for my project" and updates should ride the same PRs as the scripts. No better-fitting pattern found: the relative `source` path is the documented way to keep a plugin in a monorepo subfolder.

## The same picture in both apps

The pane is local. `scripts/agent-os/harness-snapshot.mjs` sends the same facts to bdnick every 5 minutes, from any PC that has
`%LOCALAPPDATA%\nourcity\harness-snapshot.json` and the task from `scripts/register-harness-snapshot-task.ps1`. Nick reads them
with `getHarnessStatus`; the Harness card is on bdnick `/system` and nickstire Settings > Status. Push only: neither site can
reach a PC. A PC silent for 15 minutes reads UNKNOWN. `--print` shows the exact body and sends nothing.

## Install (once per PC, user scope)

Shell, any PC:

```
claude plugin marketplace add nourdean22/MAINnicks-tire-autoNEW
claude plugin install nourcity-harness@nourcity --scope user
```

(Two steps work on every mod-capable CLI, 2.1.287 and later. The one-step form `claude plugin install nourcity-harness --marketplace nourdean22/MAINnicks-tire-autoNEW` needs 2.1.292 or later.)

Desktop app: the + next to the prompt, Plugins, Add marketplace (`nourdean22/MAINnicks-tire-autoNEW`), then Add plugin `nourcity-harness`.

MECHANICS (shop PC): run the same shell line there, then open a new session in the checkout and type `/harness`.

A hooks-only plugin is active right after install in every later session. Outside a NOURCITY checkout
(no `scripts/agent-os/board.mjs`) the pane says so and does nothing.

## Update

Change `hooks/register.tsx` (or the repo script it reads), bump `version` in `.claude-plugin/plugin.json`
and open a PR. After the merge, on each PC:

```
claude plugin marketplace update nourcity
claude plugin update nourcity-harness
```

Ask for a change by naming the pane part (a new row, a different button, a different tick).

## Check before a PR

From the repo root, with the engine's generated types kept outside the repo:

```
claude plugin validate .claude/mods/nourcity-harness
claude plugin test .claude/mods/nourcity-harness
```

`tsc -p` needs a tsconfig that extends the generated `.claude-plugin/types/tsconfig.json` and includes
`hooks`, `types` and `tests`; keep that file outside the repo. The repo is public: no secrets and
nothing personal in this folder.
