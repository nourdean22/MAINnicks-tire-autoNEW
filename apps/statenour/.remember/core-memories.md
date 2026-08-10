# NOUR OS — Core Memories

> **Corrected 2026-08-10.** Prod URL `bdnick.info` (not `statenour-os.vercel.app`)
> still holds. Two claims in this file had gone false against root `AGENTS.md` and
> are fixed below: the deploy branch is **`main`** (AGENTS.md:14, "one deploy
> branch"), not `codex/ollama-local`; and the blanket "no PowerShell" rule is
> retired — PowerShell is this repo's CLI shell. CLI tool path re-verified: tracked.

## User Preferences
- **PowerShell is the CLI shell** (root `AGENTS.md` > Environment) — but never chain
  with `&&`; use `;` or separate calls. The original rule survives only in the narrow
  case it was true for: `start.bat` stays cmd.exe because of an execution-policy
  issue on this machine. It was over-generalised into "no PowerShell" and stayed that
  way for months.
- **Browser**: Chrome (used `start chrome` in launcher)
- **Desktop**: `C:\Users\nourd\OneDrive\Desktop\` (OneDrive-synced)

## Architecture Decisions
- Next.js App Router on Railway
- CLI tool at `cli/nour.ts` (run via `npx tsx`)
- Deployed at https://bdnick.info (Railway · migrated off Vercel)
- **Deploy branch: `main`.** Named branches + squash-merged PRs only; never commit
  or push `main` directly (root `AGENTS.md` > Branching).
- Tailscale network for cross-device access (100.118.151.61)

## Key Files
- `start.bat` — NOUR OS launcher menu (batch file, not PS)
- `config/crons.ts` — cron manifest · fan-out via `/api/cron/mega`
- `cli/nour.ts` — CLI entry point

## Session Log
- **2026-03-25**: Created `start.bat` launcher with 7 menu options + desktop shortcut. Dev server runs on port 3001. Confirmed Vercel deployment is live.
