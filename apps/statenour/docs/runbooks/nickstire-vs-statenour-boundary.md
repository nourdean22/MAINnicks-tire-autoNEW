# Runbook · Nickstire vs Statenour boundary

- **Status:** active · **Domain:** monorepo · **Risk:** medium · **Last verified:** 2026-06-09
- **When to use:** working in the monorepo so you don't cross app boundaries or push the wrong gate.
- **Source of truth:** the monorepo `CLAUDE.md`, [`../REPO-MAP.md`](../REPO-MAP.md), [`../../config/repos.ts`](../../config/repos.ts).

## The two apps

| App | Deploys to | Surface |
|---|---|---|
| `apps/statenour` | `main` → Railway → **bdnick.info** | personal OS, Nick Prime, brain, mastery |
| `apps/nickstire` | `main` → Railway → **nickstire.org** | tire shop storefront + admin + booking |

Both ship from `main` on Railway. The standalone statenour-os repo is retired —
statenour is an app **inside** this monorepo, not its own repo.

## Rules

1. **Scope to one app.** Keep a change inside `apps/statenour` or `apps/nickstire`; don't edit the other app's tree in a statenour wave.
2. **Stage by explicit path.** `git add apps/statenour/<path>` — never `git add -A` on shared `main`.
3. **iOS-PWA primitives.** Both apps run as standalone iOS PWAs — `window.confirm/alert/prompt` are silently suppressed on the operator's phone; use an in-DOM confirm.

## Gotchas

- The pre-push hook builds **both** affected apps via turbo — the other session's broken working tree can bounce your push. Surface it with a self-contained prompt; **never `--no-verify`**, never force-push shared history.

## Commands

```
git add apps/statenour/<path>
git log origin/main..HEAD     # see what rides along from the sibling session
```

## Verification

- Only your app's files are staged; pre-push turbo build green.

## Rollback

- Unstage foreign files; rebase on `origin/main`.
