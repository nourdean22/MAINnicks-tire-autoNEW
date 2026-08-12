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

**Junctions alone are not enough to run the verify gates.** `worktree-setup.ps1`
does two more things a harness worktree never got:

1. **Copy `apps/<app>/.env*` from the primary checkout.** Without them
   `check:env` fails, and `verify:hard` fails with it — a false red that
   looks like a code problem.
2. **Build `@statenour/lenses` before any statenour test run:**
   `pnpm exec turbo build --filter=@statenour/lenses`. Five
   strategic-frameworks test files fail at import without it. Turbo replays
   it from cache in ~250ms, so there is no reason to skip it.

`pnpm typecheck` passes on junctions alone, so it will NOT warn you about
either of these — a green typecheck is not evidence the gates will run.

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

## 3 · Changing dependencies from a worktree

**Every `pnpm install` variant is policy-blocked here** — including
`--lockfile-only`, and including from a scratchpad clone. The agent-os
hook matches on COMMAND TEXT, not cwd, so no install runs anywhere in a
session anchored to a worktree. (It also fires on a plain `cat >> file`
heredoc whose *document body* merely mentions the command — write those
with the Edit tool instead.)

**Global (`-g`) installs** never touch repo `node_modules` but still match
the rule via command text, and the harness PINS the session shell cwd to
the worktree — `Set-Location` does not persist between calls, so verify
cwd before any `node_modules/.bin` invocation (a bare `pnpm exec vitest`
after a silent reset-to-root fails "not recognized" and looks like a
missing dep). Sanctioned path for a global install: a process runner
with a non-worktree cwd (e.g. the Desktop Commander MCP), never a rule
edit. Witnessed 2026-08-12: the CLI update 2.1.150→2.1.228 ran this way
after two blocked shell attempts.

For **workspace-link-only** changes — adding/removing a `workspace:*`
dep line, adding/removing a package — hand-edit `pnpm-lock.yaml`:

- Remove the `importers:` entry (3 lines: name, `specifier`, `version:
  link:...`) and/or the whole `packages/<name>:` block.
- These are self-contained and serializer-stable — no hash or peer
  graph recomputation is involved.
- **CI's frozen-lockfile `node` job is the validator.** Do not merge
  while it is red. Verified on #1428: hand-edited lockfile, `node`
  passed in 9m08s, merge deployed clean.

For **registry-version** changes (a real dependency bump), do NOT
hand-edit — hand the install to the operator or a primary-checkout
session.

## 4 · Traps

| Trap | Why |
|---|---|
| `git push` at the default 2-minute tool timeout | The lefthook pre-push `build:affected` gate alone can take 2-5 min when an app is affected (103s witnessed on PR #1355; the push died at exit 143 and left ambiguous remote state). Always give push commands an explicit >=5-minute timeout |
| `pnpm install --filter <app>` in the **primary** checkout | Prunes the shared junctioned `node_modules` every worktree points at. Use `--filter "<app>..."` **with** the `...` suffix, or phantom import failures follow |
| `git worktree remove` on its own | Junctions point OUT of the tree; a recursive delete runs over links into the primary. Use `scripts/worktree-teardown.ps1 -targetDir <path>` |
| Bash `cd` persisting | It resets to `C:\` between calls — prefix each command, and re-anchor by pattern after your own edits shift line numbers |
| Pre-push `IO error: provided value is too long when setting link name` | Windows symlink noise, non-fatal; the build still passes |
| `gh pr merge --delete-branch` failing with `fatal: 'main' is already used by worktree at ...` | **The remote merge usually ALREADY SUCCEEDED** — only gh's local branch-switch failed, because a sibling worktree holds `main`. Check `gh pr view <n> --json state` BEFORE retrying; a naive retry misreports a merged PR as failed. Witnessed twice (#1447, #1487). Avoid it entirely: merge WITHOUT `--delete-branch`, then delete the ref via `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>` |
| An `Edit` whose old/new string ENDS on a meaningful space | The harness normalizes the trailing space away. Once produced `##Title` — matching neither markdown header level — and two follow-up Edits differing only by that space were then rejected as "old and new are identical". Anchor through the next token instead, or do whitespace-sensitive rewrites with a shell regex and grep-verify the result |

## When NOT to use

Worktrees created by `scripts/worktree-setup.ps1` — those already have
junctions and env files. This is only for the harness-created ones under
`.claude/worktrees/`. Teardown is the companion script, not this skill.
