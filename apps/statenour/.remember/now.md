# NOUR OS — Session Buffer

## Project Quick Ref
- **Project**: statenour-os (NOUR OS — personal mastery system)
- **Location**: `C:\Users\nourd\NOURCITY\apps\statenour`
- **Framework**: Next.js 16 (App Router, React 19, Prisma 6.19 + Neon)
- **Dev server port**: 3001 (default 3000 was in use)
- **Local URL**: http://localhost:3001/
- **Network URL (Tailscale)**: http://100.118.151.61:3001/
- **Production URL**: https://bdnick.info
- **Platform**: Railway · project `natural-appreciation` · service `statenour-web`
- **Service URL (backup)**: https://statenour-web-production.up.railway.app
- **Active branch**: `main` (monorepo `MAINnicks-tire-autoNEW`)

## Live surfaces (Apr 18 after cleanup)
- `/`         — HQ (Ultron) with TodoDesk + BottomPulseTicker
- `/chat`     — Nick (AI conversation)
- `/tasks`    — Unified INBOX/READY/DOING/DONE queue
- `/journal`  — Reflect composer + BrainDump feed
- `/mastery`  — Growth / habits / goals rollup
- `/system/health` — Live observability dashboard
- `/settings` — Config
- Shop admin: external link to `nickstire.org/admin`

## Launcher
- **Desktop shortcut**: `C:\Users\nourd\OneDrive\Desktop\NOUR OS.bat`
- **Project launcher**: `C:\Users\nourd\NOUR-OS\apps\statenour-os\start.bat`
- Uses `.bat` (cmd.exe) — not PowerShell (execution-policy issues on this machine)

## Crons (mega fan-out)
Current scheduled (via mega cron fan-out + standalone):
- `/api/cron/mega?slot=morning` — 9am UTC (fans out brain-cycle, device-sync,
  learn, stale-tasks, device-health, notification-sender, journal-checkin,
  embed-backfill)
- `/api/cron/mega?slot=evening` — 2am UTC (reflect, predict, think,
  consolidate, drift-check, daily-report, data-cleanup, intelligence,
  brain-intelligence, embed-backfill; weekly runs on Sunday)
- `/api/cron/brain-intelligence` — 2am UTC
- `/api/cron/embed-backfill` — every 30min
- `/api/cron/notification-sender` — every 15min
- `/api/cron/operating-rhythm` — 12/16/21 UTC
- `/api/cron/drift-check` — 8pm UTC
- `/api/cron/backlog-triage` — 7am UTC
- `/api/cron/watcher` — every 3h (audits other crons)
- `/api/cron/auto-linker` — 4am UTC (MemoryEdge builder)
- `/api/cron/weekly-review` — 2am UTC Sunday
- `/api/cron/knowledge-sync` — every 6h
- `/api/cron/ingest-{gmail,calendar,drive}` — varying cadence

## Retired this pass (Apr 18)
- OpenLoop → Task INBOX (80+ sites rewired, 68 legacy rows orphaned)
- DailyScore → dropped from schema, runtime shim in `lib/prisma.ts`
- MorningBrief → TodoDesk + BottomPulseTicker
- Ghost crons: review-fetch, follow-up-reminders (no matching route)
- Dead pages removed: /command, /strategy, /brief, /brain, /cameras,
  /causation, /commitments, /decisions, /drift, /habits,
  /system/{audit,deploys,memory-decay}, /mobile, /missions, /personal
- 40+ dead API routes removed: /brain/*, /system/*, /internal/*,
  /knowledge/*, /operator/*, /notifications/*, /integrations/*, plus
  business fossils (/analytics, /reports, /bridge/owner-snapshot)
- 11 dead lib/services, 16 dead scripts, 14 AI tools

## Notes
- Railway deploys from `main` (monorepo `MAINnicks-tire-autoNEW`)
- Single push to `main` is the deploy — Railway auto-builds via Docker
- PowerShell is unreliable — always use .bat or bash
- Working Prisma pattern for local scripts:
  `pnpm exec tsx --env-file=.env.local <script>`
- Date: 2026-04-18
