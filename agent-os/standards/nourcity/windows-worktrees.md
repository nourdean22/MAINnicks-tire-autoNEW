# Windows & Worktrees

Environment-specific rules that silently corrupt work if ignored.

## PowerShell shell

- **Do not chain with `&&`** — parser error. Use `;` or separate calls.
- Bash cwd resets to `C:\` between calls — prefix every bash command with
  `cd /c/Users/nourd/NOURCITY/... &&`.
- `Edit` with unicode in `old_string` (arrows, middots, emoji) often fails to
  match — use ASCII-only anchors taken from a fresh Read.
- Pre-push "IO error: provided value is too long when setting link name" and
  symlink warnings are **non-fatal Windows-path noise**; the build still passes.

## Worktrees (concurrent sessions share this repo)

Start from a fresh worktree:

```powershell
powershell scripts/worktree-setup.ps1 -branchName <branch> -targetDir .worktrees/<name>
```

It copies env files and creates NTFS junctions for every `node_modules`,
bypassing `pnpm install` entirely.

- **Never run `pnpm install` inside a junctioned worktree.** It offers to WIPE
  the shared `node_modules` every other worktree points at — and the prompt
  defaults to yes.
- Worktrees the Claude harness creates under `.claude/worktrees/*` skip that
  script and arrive with **no junctions**. Nothing runs there until you add
  them (skill: `harness-worktree-setup`; symptom: `tsc` "not recognized").
- Tear down with:
  ```powershell
  powershell scripts/worktree-teardown.ps1 -targetDir .worktrees/<name>
  ```
  **Never bare `git worktree remove`** — the junctions point OUT of the tree, so
  a recursive delete walks into the primary checkout's `node_modules`.
  `-Force` if untracked files block removal; `-KeepBranch` to keep the branch.

## Shared-surface discipline

- `git log origin/<branch>..HEAD` **before AND after** pushing.
- Disclose rider commits from sibling sessions in the PR body — never rewrite
  them away.
- Never `reset --hard` local `main`; use `git merge --ff-only`.
