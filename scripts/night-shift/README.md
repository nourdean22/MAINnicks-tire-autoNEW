# Night Shift

One unattended Claude Code run per night. It reads the evidence ledger, picks ONE goal contract, proposes ONE scoped change as ONE pull request with proof receipts, and stops. It never merges; a human merge is the only way anything ships.

| File | Role |
|---|---|
| `PROMPT.md` | The whole job, including the authority the run does **not** have (evaluator separation, no merges, no flag flips, one primary variable) |
| `run.ps1` | Fresh worktree → `claude -p` headless → ledger event → teardown. Safe to run by hand |
| `register-task.ps1` | Registers the 02:30 daily Windows task. **Operator runs this; no agent registers a standing task** |

Guards that hold regardless of what the prompt says:

- `config/agent-os/evaluator-paths.json` + `.github/workflows/evaluator-separation.yml` — a `night-shift/*` or `darwin/*` PR that edits a goal contract, an episode, the experiment kernel, the approval gate, a lint gate or CI is red.
- Root `AGENTS.md` protected operations + the Claude-only PreToolUse hook (push-to-main, force-push, destructive DB, `.env` writes).
- Web experiments only go live via a feature flag the operator flips; the resolver only ever **proposes** over Telegram and writes the verdict to the ledger.

First run, by hand, with the ledger door set:

```powershell
$env:STATENOUR_SYNC_URL = "https://bdnick.info"; $env:EVIDENCE_LEDGER_KEY = "<scoped key>"
powershell -File scripts\night-shift\run.ps1 -MaxTurns 60
```

**Which key.** `EVIDENCE_LEDGER_KEY` is a statenour env var accepted by `/api/sync/evidence`
and by nothing else (`lib/auth-guard.ts` `requireEvidenceAuth`). It exists so the unattended
agent holds one narrow credential. `STATENOUR_SYNC_KEY` also opens the evidence door — but it
is the whole cross-app bridge, so `run.ps1` deliberately scrubs it from the child process; do not
"fix" that. Until the operator sets `EVIDENCE_LEDGER_KEY` on Railway (statenour-web) and
locally, the run still works and simply skips reading and posting evidence.

**Identity — the credential-level boundary (2026-09-15).** The PreToolUse rules stop a *spelling*
of "merge"; only an identity that cannot land a change on `main` stops the *ability*. `run.ps1`
therefore refuses to start unless `NIGHT_SHIFT_GH_TOKEN` is set and
`scripts/night-shift/identity-preflight.mjs` (run as the operator) accepts the identity behind it: a
login that is **not** the operator's, with **read or triage** permission on the repo — the run then
pushes to that identity's **fork** and opens a cross-repo PR it cannot merge — or with **write** only
behind an ACTIVE repository ruleset restricting updates to `main` that does not bypass it. On the
GitHub **Free** plan a private repo has neither rulesets nor branch protection (the API answers 403),
so read/triage + fork is the only structural boundary available today; `ruleset-night-shift-boundary.json`
is the ruleset to apply if the repo moves to Pro (`gh api -X POST repos/<owner>/<repo>/rulesets --input
scripts/night-shift/ruleset-night-shift-boundary.json`; it restricts updates, force-pushes and deletion
of `main` to repository admins — RepositoryRole id 5 — and to the GitHub Actions app — Integration id
15368 — so the weekly prerender push keeps working; verify that bypass on first activation). Operator steps, once: create a machine account; add it
as a collaborator with **read**; under Settings → Actions enable workflows on pull requests from forks;
on that account mint a **classic** token with only the `repo` scope (a fine-grained token cannot reach a
repo owned by another personal account, so it could never open the cross-repo PR; `repo` on a read
collaborator can fork, push to the fork and open the PR, and still cannot merge) and store it as the user
env var `NIGHT_SHIFT_GH_TOKEN` — never the operator's own token. Enable 2FA on the account: GitHub
requires it of every contributor within weeks of the first push.
A refusal is recorded as `darwin.run_refused` in the ledger. The child process receives the token only
as `GH_TOKEN`, and git pushes go through `gh auth git-credential` so they carry the same identity.
Canaried in `scripts/agent-os/nightShiftIdentity.test.mjs` (`pnpm agent:verify`).

**Auth.** The run needs `CLAUDE_CODE_OAUTH_TOKEN` (user env var). Mint it once, interactively,
with `claude setup-token` — a one-year subscription token built for scripts and scheduled tasks.
An ordinary `/login` credential is what the first run (2026-09-15) died on: "OAuth session expired
and could not be refreshed" — it cannot renew itself headless. `run.ps1` logs only whether the
token is set, never its value.

**Permissions and trust.** `run.ps1` passes `--dangerously-skip-permissions`: nobody answers a
prompt at 02:30, and without it every Bash/Edit call is denied. The guard is the agent-os
`PreToolUse` hook, which the Claude Code docs say fires before any permission-mode check and
still blocks under that flag; settings-file hooks are used even in a folder that was never
trusted (only `permissions.allow` / `additionalDirectories` are ignored there, which is the
"this workspace has not been trusted" line in the log). Evaluator separation CI and the
push-to-main rule cover the rest.

`-RepoRoot` (default `C:\Users\nourd\NOURCITY`) is where the worktree, the env copies, the
`node_modules` junctions AND `PROMPT.md` come from. If the primary checkout is parked on a
branch without `scripts/night-shift/`, or its `pnpm-lock.yaml` differs from `origin/main`
(then `worktree-setup.ps1` links no `node_modules`), point `-RepoRoot` at a checkout that is
on `main` or a clean descendant of it. The run log lands in `scripts/night-shift/logs/`
(gitignored) under that root.

Then read the PR like a hostile reviewer. Kill criteria (from the Reality Loop report): three consecutive proposals rejected for something a deterministic gate should have caught → stop the task, fix the gate, add its canary, only then re-register.
