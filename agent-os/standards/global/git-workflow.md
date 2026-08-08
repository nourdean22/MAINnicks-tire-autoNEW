# Git & Branch Discipline

## Branch rule

- **NEVER push or commit directly to `main`.** No exceptions, no `--force`.
- Branch names are `<scope>/<task>` where scope is the app or category:
  `nickstire/<task>` · `statenour/<task>` · `docs/<task>` · `chore/<task>`
- Autonomous merge is allowed. Push the branch, then:

```bash
Remove-Item Env:\GITHUB_TOKEN -ErrorAction SilentlyContinue
gh pr create --head <branch> --title "<message>" --body "<body>"
gh pr merge <pr-number> --squash --delete-branch
```

- Sync local `main` with `git fetch origin main` + `git merge --ff-only`.
  **Never `reset --hard`** — a sibling session's work may be in your tree.

## Staging

- Stage **only your files, by explicit path**.
- Never `git add -A` · never `--no-verify` · never force-push shared history.
- Scope the change to the assigned task only — no unrelated docs, generated
  reports, or sibling-session files.

## Commits

- One logical change per commit. Imperative subject; body explains *why*.
- Never commit secrets, `.env`, build output, or `node_modules`.
- AI commits MUST include attribution:

```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

## Hooks

- Git hooks are **enforcement, not advice**. Never disable one to unblock
  yourself — fix the cause.

## Final report format

Every completed task reports: branch · SHA · changed files · checks run ·
PR link · intentional exclusions.
