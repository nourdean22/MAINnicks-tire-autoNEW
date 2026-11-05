# nourcity-harness

A Claude Code mod for the NOURCITY monorepo: one pane and one status line that show the state of the
harness (machine, PRs, main, worktrees) without running anything that changes it.

## Design (five lines)

1. **What it shows:** free RAM, the heavy lease, the Chrome slot, open PRs with their check state, main's last commit, worktree counts. A part it cannot read shows "couldn't read", never a zero.
2. **Where it gets the data:** only the repo's own scripts: `heavy.mjs status`, `board.mjs refresh`, board.json, `repo-status.mjs --sweep` (no `--execute`). Nothing is copied here, so a fix to a script reaches the pane with no mod change.
3. **Cost:** the status line refreshes every 5 minutes per session and skips a tick while the last refresh is still running, so many open sessions do not stack up node processes. Only the Refresh button (and `/harness`) calls `gh`.
4. **Buttons:** Refresh (`r`) re-reads everything and refreshes the board from GitHub. Count worktrees (`w`) runs the read-only sweep preview (about 25 s). It never removes a worktree.
5. **Home:** this folder, `.claude/mods/nourcity-harness/`, listed by the root `.claude-plugin/marketplace.json` (marketplace `nourcity`). It is required on every PC through `config/agent-os/required-plugins.json`, so the `[health] machine` line names a PC that lacks it.

## Install (once per PC, user scope)

Shell, any PC:

```
claude plugin install nourcity-harness --marketplace nourdean22/MAINnicks-tire-autoNEW --scope user
```

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
