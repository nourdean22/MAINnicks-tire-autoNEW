# NOUR OS — Session Buffer

**Updated: 2026-08-11** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
NICK VNEXT program: wave 1 (Claude 5 frontier lane) SHIPPED as #1513 — compat
middleware, refusal-as-first-class, effort router + Claim/Evidence ledger in shadow.
Gate table: `docs/GATE-2026-08-11-nick-vnext.md` (the 18th mega-plan, ~70% incumbent).
Remaining program (durable runs · JIT tools · memory graduation · context manifest ·
eval gates) = 7-to-30-day items; EACH needs its own gate first — memory controller is
ALREADY WIRED (08-10 #1486 gate) and receipts/provenance ~90% incumbent (08-10 gate).

## Last material decision
Mythos 5 is strictly attestation-gated (`ANTHROPIC_MYTHOS_ENABLED=1` = operator
attests approved-org access) — never assumed, and untrusted input ALWAYS routes
fable (classifier ON). No production default flip: `ANTHROPIC_MODEL` stays
`claude-sonnet-5`; the flip is one Railway env edit, now safe because the compat
middleware engages on any fable/mythos/opus-5 id. A refusal does NOT mark the
provider failed (prompt-specific, not an outage).

## Known failed approaches
- **Auto fast-forwarding the primary checkout from the scheduled sync — rejected as
  unsafe.** The primary sits on branch `session-end` with a dirty tree that may hold
  a sibling session's work. Fetch is safe; auto-merge is not.
- **"git globs `[id]` like PowerShell does" — false.** `git ls-files | xargs wc -l`
  remains the one trustworthy measure (see 2026-08-10 buffer for the full trap).
- **Trusting a pasted plan's own "VERIFIED" table — report A asserted "Prisma 7,
  verified via code read" against a catalog pinning `^6.3.1` (installed 6.19.3).**
  Re-derive even claims stamped verified by their author.

## Active blocker
**Operator actions:** ① the primary checkout (`C:\Users\nourd\NOURCITY`) remains on
`session-end`, behind `origin/main`, dirty — the daily graph rebuild indexes stale
truth; no script should resolve this. ② The 50-task fable/mythos/opus bake-off needs
Anthropic spend authorization + golden tasks pulled from real usage (prod reads) —
Ollama Cloud is still the one funded LLM lane (2026-07-22).

## Next action
Operator: either flip the canary (`ANTHROPIC_MODEL=claude-fable-5` on Railway — now
safe) or authorize the bake-off. Agent-side next wave: wire `routeCapability()`
behind an off-by-default flag into the chat route's provider pick, and surface
`turnMetaSchema` (model/effort/fallback/refusal) in the Context & Evidence panel.

---

## Durable facts (each corroborated by root `AGENTS.md`, not by this file)
- **Prod**: https://bdnick.info · Railway project `natural-appreciation` · service `statenour-web`
- **Dev**: `pnpm stn dev` → port 3001
- **Stack**: Next.js 16 App Router · React 19 · Prisma 6.19 → Neon · AI SDK v6
- **Branching**: named branches only, PR + squash-merge. **NEVER commit or push to `main`.**

> Deleted 2026-08-10 — three stale inventories (live surfaces · cron list · "retired
> this pass"), all dated 2026-04-18 and unverifiable without a prod probe. Cron truth
> lives in `config/crons.ts`; surface truth in `app/`; ship history in
> `docs/RECONCILIATION.md`.
