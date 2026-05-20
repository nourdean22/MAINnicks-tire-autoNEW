# NOUR OS — Core Memories

> **v10.0.529.106 Wave 75 correction**: prod URL is now
> `bdnick.info` (the operator's domain) · NOT `statenour-os.vercel.app`.
> The deployment branch is `codex/ollama-local` · NOT main. CLI tool
> path is current. PowerShell rule stays.

## User Preferences
- **No PowerShell** — always use .bat files or bash. PS has execution policy issues.
- **Browser**: Chrome (used `start chrome` in launcher)
- **Desktop**: `C:\Users\nourd\OneDrive\Desktop\` (OneDrive-synced)

## Architecture Decisions
- Next.js App Router on Vercel
- CLI tool at `cli/nour.ts` (run via `npx tsx`)
- Deployed at https://bdnick.info (was statenour-os.vercel.app · migrated)
- Branch: `codex/ollama-local` (was main · Wave 49 deployment branch update)
- Tailscale network for cross-device access (100.118.151.61)

## Key Files
- `start.bat` — NOUR OS launcher menu (batch file, not PS)
- `vercel.json` — cron config (morning brief, drift check, weekly review)
- `.vercel/project.json` — Vercel project linking
- `cli/nour.ts` — CLI entry point

## Session Log
- **2026-03-25**: Created `start.bat` launcher with 7 menu options + desktop shortcut. Dev server runs on port 3001. Confirmed Vercel deployment is live.
