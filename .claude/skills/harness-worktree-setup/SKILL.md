---
name: harness-worktree-setup
description: Make a Claude-harness worktree (.claude/worktrees/*) actually runnable - junction node_modules, then obey the one-checkout rule. Use as the FIRST action whenever cwd is under .claude/worktrees/, or when tsc/eslint report "not recognized" and node_modules looks missing.
---

# Harness Worktree Setup

`AGENTS.md` tells you to start from `scripts/worktree-setup.ps1`, which
creates the `node_modules` junctions for you. **Worktrees the Claude
harness creates under `.claude/worktrees/*` never went through that
script**, so they arrive with no junctions at all. Nothing runs until
you add them.

Symptom: `'tsc' is not recognized`, `eslint` missing, or a `git commit`
that dies in the lefthook pre-commit hook. Never fix this with
`--no-verify`.

## 1 · Junction every node_modules (run first, once)

```powershell
$main = 'C:\Users\nourd\NOURCITY'; $wt = '<this-worktree-path>'
$dirs = Get-ChildItem -Path $main -Recurse -Depth 2 -Directory -Filter node_modules -ErrorAction SilentlyContinue |
  Where-Object { ($_.FullName -split 'node_modules').Count -eq 2 -and $_.FullName -notmatch '\\\.claude\\|\\\.git\\|\\\.worktrees\\' }
foreach ($d in $dirs) {
  $rel = $d.FullName.Substring($main.Length + 1); $target = Join-Path $wt $rel
  if (-not (Test-Path $target)) {
    $parent = Split-Path $target -Parent
    if (Test-Path $parent) { cmd /c mklink /j "$target" "$($d.FullName)" | Out-Null; "LINKED $rel" }
  } else { "EXISTS $rel" }
}
```

Expect ~15 links (root · `apps/*` · `packages/*` · `deploy`). Verify with
`pnpm typecheck` in the app you're touching — not by listing the folder.

## 2 · The one-checkout rule (the expensive one)

A harness worktree's `apps/**` source is a **separate physical copy** from
`C:\Users\nourd\NOURCITY\apps\**`. Only `node_modules` is shared.

> Pick ONE checkout per branch — the one the worktree's git lives in — and
> run **every** command there: tests, greps, seds, node scripts, typecheck.

Cost of ignoring it: PR #794 merged with five broken tests. Edits landed
in the worktree while `cd`-into-the-main-checkout test runs went green
against a copy that had the fix. A second incident burned ~20 minutes
bisecting a fix that was never in the file being executed.

**If a result surprises you** — passes isolated but fails in suite, or a
fresh export reads as undefined — `md5sum` the file in both checkouts
*before* theorizing about flakes.

Repro and probe scripts go in **this** worktree's `scripts/`. Pull env
explicitly (`$env:DATABASE_URL` from the main checkout's `.env.local`)
rather than `cd`-ing toward wherever the `.env` lives.

## 3 · Traps

| Trap | Why |
|---|---|
| `git push` at the default 2-minute tool timeout | The lefthook pre-push `build:affected` gate alone can take 2-5 min when an app is affected (103s witnessed on PR #1355; the push died at exit 143 and left ambiguous remote state). Always give push commands an explicit >=5-minute timeout |
| `pnpm install --filter <app>` in the **primary** checkout | Prunes the shared junctioned `node_modules` every worktree points at. Use `--filter "<app>..."` **with** the `...` suffix, or phantom import failures follow |
| `git worktree remove` on its own | Junctions point OUT of the tree; a recursive delete runs over links into the primary. Use `scripts/worktree-teardown.ps1 -targetDir <path>` |
| Bash `cd` persisting | It resets to `C:\` between calls — prefix each command, and re-anchor by pattern after your own edits shift line numbers |
| Pre-push `IO error: provided value is too long when setting link name` | Windows symlink noise, non-fatal; the build still passes |

## When NOT to use

Worktrees created by `scripts/worktree-setup.ps1` — those already have
junctions and env files. This is only for the harness-created ones under
`.claude/worktrees/`. Teardown is the companion script, not this skill.
