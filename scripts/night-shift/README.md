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
$env:STATENOUR_SYNC_URL = "https://bdnick.info"; $env:STATENOUR_SYNC_KEY = "<key>"
powershell -File scripts\night-shift\run.ps1 -MaxTurns 60
```

Then read the PR like a hostile reviewer. Kill criteria (from the Reality Loop report): three consecutive proposals rejected for something a deterministic gate should have caught → stop the task, fix the gate, add its canary, only then re-register.
