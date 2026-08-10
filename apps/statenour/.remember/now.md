# NOUR OS — Session Buffer

**Updated: 2026-08-10** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
Memory-controller campaign: gate the 14th external mega-plan, then wire the two
real gaps it surfaced (graph freshness · this ledger). Audit → `docs/GATE-2026-08-10-memory-controller.md`.

## Last material decision
Phase 0 verdict: the memory controller **already exists and is wired** (native
SessionStart hook + Claude Code Auto Memory). Phases 2 and 3 of the mandate were
declined as duplicate-builds; three of its six delete targets were refuted outright.

## Known failed approaches
- **Auto fast-forwarding the primary checkout from the scheduled sync — rejected as
  unsafe.** The primary sits on branch `session-end`, 26 behind `origin/main`, with a
  dirty tree that may hold a sibling session's work. Fetch is safe; auto-merge is not.
- Mandate's `git ls-files`-free measuring: `git show` / `git cat-file` / PowerShell
  `Get-Content` **all** misread `[id]` paths. Only `git ls-files | xargs wc -l` is honest.

## Active blocker
**Operator action:** the primary checkout (`C:\Users\nourd\NOURCITY`) is on
`session-end`, **26 commits behind `origin/main`**, working tree dirty. The daily
graph rebuild indexes that tree, so every graph is born a day or more stale. No
script should resolve this — a sibling session may own the uncommitted changes.

## Next action
Land the audit + the two fixes as one PR from `claude/memory-controller-single-pass-ff500d`.

---

## Durable facts (each corroborated by root `AGENTS.md`, not by this file)
- **Prod**: https://bdnick.info · Railway project `natural-appreciation` · service `statenour-web`
- **Dev**: `pnpm stn dev` → port 3001
- **Stack**: Next.js 16 App Router · React 19 · Prisma 6.19 → Neon · AI SDK v6
- **Branching**: named branches only, PR + squash-merge. **NEVER commit or push to `main`.**

> Deleted 2026-08-10 — three stale inventories (live surfaces · cron list · "retired
> this pass"), all dated 2026-04-18 and unverifiable without a prod probe. Two of
> their claims had gone actively false: *"Active branch: main / single push to main
> is the deploy"* (inverts the repo's hardest safety rule) and *"Dead pages removed:
> … /decisions …"* (`app/(mastery)/decisions/[id]/page.tsx` is **634 lines and live**,
> plus three sibling routes). Four consecutive external audits have since claimed
> that page is empty or dead. Cron truth lives in `config/crons.ts`; surface truth
> in `app/`; ship history in `docs/RECONCILIATION.md`.
