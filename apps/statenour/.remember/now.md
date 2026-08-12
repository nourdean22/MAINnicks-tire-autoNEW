# NOUR OS — Session Buffer

**Updated: 2026-08-11** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
NICK VNEXT program, Ollama-first: waves 1-4 SHIPPED (wave 1 = #1513; wave 2-4 =
second PR same day) — Claude 5 compat + refusal-first-class, deep canary,
**normal-chat cost firewall** (ollama = only zero-incremental lane; Turbo consent
opens metered), **memory gateway Phase-1 default-ON**, reply-gate
evidenced-uncertainty fix, server-derived claim verification, browseAndDo
update|save|upload guard, Ollama bake-off (`docs/OLLAMA-BAKEOFF-2026-08-11.md`).
Gates: `docs/GATE-2026-08-11-nick-vnext.md` + addendum (plans #18-#20). Next wave:
Context-Manifest instrumentation → compact-prompt A/B (V1/V2 shadow-metrics has NO
live callers — an empty series is not convergence), Eval-40 baseline,
effort→reasoning-tier remap, proactivity governor, Phase-2 memory (349
review_required/wk + temporal supersession).

## Last material decision
$0 incremental spend is a HARD invariant (operator, 3x): the cost firewall fails
COST-CLOSED when Ollama is down instead of degrading onto metered credits
(kill-switch `NICK_COST_FIREWALL=0`; suite pins it off for chain tests). Memory
Phase-1 default-ON justified by the 7-day shadow review — 1,788 receipts, noop 846
(47%) at ZERO legacy agreement (kill-switch `NICK_MEMORY_GATEWAY_PHASE1=0`).
Canary armed but COLD: `ANTHROPIC_MODEL=claude-fable-5` set on Railway, but NO
`ANTHROPIC_API_KEY` exists on any service — and under the firewall, anthropic also
needs the canary attestation. A refusal does NOT mark the provider failed.

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
Operator env decisions: ① `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` (bake-off:
incumbent glm-5.2 measurably lost — high confidence); ② `OLLAMA_MODEL=minimax-m3`
only as canary/after rerun (thin evidence vs prod history); ③ fund an
ANTHROPIC_API_KEY only if Turbo is wanted. Agent next wave: Context-Manifest
log-only instrumentation, then the compact-prompt A/B on the same Ollama model,
then Eval-40 baseline (all gated against incumbents first).

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
