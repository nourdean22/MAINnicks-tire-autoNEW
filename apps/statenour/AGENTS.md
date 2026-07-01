# AGENTS.md Â· statenour-os

> **âš¡ Current truth in one screen:** [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) â€” app location, production deploy path, what's retired, source-of-truth hierarchy. Read it if you only read one thing. Guard: `pnpm check:stale-docs`. Agent runbooks: [`docs/runbooks/index.md`](docs/runbooks/index.md).
>
> **Purpose:** any AI agent (Claude, Codex, Antigravity, Gemini, Cursor, etc.) opening this repo reads this file FIRST. Wave-by-wave ship history is canonical in [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) â€” when a wave lands, add the full entry THERE and update only the stamp below (do NOT grow this header; see the `statenour-wave-reconcile` skill).
> **Last refreshed:** 2026-06-29 Â· post the **Chat Transcripts, System Prompt, and Bulk Tool Upgrades wave â€” PR #437 and PR #438 merged**: â‘  registered calibration schema change in ledger; â‘¡ implemented graceful fallback in `runAutoDecompose` to a single response stream on any sub-agent executor error; â‘¢ updated `identity.ts` system prompt rules to prevent agent passivity and inbox ID begging by mandating a `getMissions` tool pre-fetch; â‘£ enriched bulk task/routine creation tools with loop/routine configuration inputs (`loopKind`, `recurringDays`, etc.); â‘¤ resolved accessibility, ARIA, and relative import warnings. Full detail: RECONCILIATION top entry.

## 1 Â· Where we are right now

**Project:** statenour-os (NOUR OS Â· personal mastery system for Nour Dean). Lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at `apps/statenour/` â€” `main` auto-deploys to Railway, served at `bdnick.info` (custom domain). The old Vercel deploy and the standalone `statenour-os` repo are retired. Companion business-ring app `nickstire` lives in the same monorepo at `apps/nickstire/` (Railway â†’ nickstire.org).

**Stack:** Next.js 16 Â· React 19 Â· Prisma 7 Â· Neon Postgres (with raw-SQL pgvector + tsvector extras) Â· Tailwind 4 Â· AI SDK v6 Â· Vitest.

**Versioning:** the `v10.0.X` scheme is retired â€” commits use `fix Â· statenour Â· â€¦` / `docs Â· statenour Â· â€¦`.

**Tests:** 260 vitest files / 3515 tests (2026-06-15). ALL pass â€” but the suite EXITS 1 on ~12 pre-existing unhandled-rejection errors + an intermittent `tests/ai/agents/router.test.ts` mock-order flake, so read the vitest summary line NOT `$?`. Build `@statenour/lenses` first (`turbo build --filter=@statenour/lenses` from the repo root) or ~5 strategic-frameworks files fail on import.

## 2 Â· How we work

### Branching (operator rule 2026-06-11 â€” supersedes any older "push main" notes)

- **NEVER push `main`.** Named branches (`statenour/<task>` Â· `docs/<task>` Â· `chore/<task>`) + PR; the operator merges. Prefer a fresh `.worktrees/<name>` worktree off origin/main (concurrent sessions share this repo).
- Stage only your files by explicit path Â· never `git add -A` Â· never `--no-verify` Â· scope to the assigned task only.
- `apps/statenour/scripts/pre-push-check.sh` is a stale Vercel-era artifact â€” NOT the active hook; ignore it. The real hook is the repo-root `.husky/pre-push` (`turbo build` for affected apps).

### House rules

1. **Auto mode** â€” execute autonomously, prefer action over planning. Never destructive without explicit confirmation.
2. **Small ships** â€” 1â€“4 files + 1 test file per commit; a wave is 4â€“6 slices.
3. **The push must build clean.** Full local gate: `pnpm verify:hard` (typecheck Â· lint Â· test Â· raw-SQL audit Â· cron manifest Â· prompt-size Â· `prisma validate`).
4. Operator-private GET routes need `auth: "owner"`; mutating routes need an explicit auth wrapper.
5. **Pgvector lives in Prisma as `Unsupported(...)`** â€” Prisma sees the columns and won't drop them on `db push`; querying is raw SQL (`lib/db/pgvector.ts`); the HNSW index is raw-SQL only; `check:raw-sql` blocks `--accept-data-loss` patterns.
6. **Inbox missions â‰  user projects** â€” `lib/services/mission-helpers.ts isInboxMission()` is the single predicate (Plan view, Track tile, mission cap all depend on it).

When the operator invokes `/karpathy-guidelines`, `/kaizen`, `/superpowers-lab`, `/using-superpowers`, `/antigravity-workflows`, or `/prompt-library` â€” treat them as MANDATORY framing for the work.

### Commit format

`<type> Â· statenour Â· <one-line summary>` subject + context / implementation / verify paragraphs + `Co-Authored-By: <model name> <noreply@anthropic.com>`.

## 3 Â· Canonical sources of truth

| What you need | Where it lives |
|---|---|
| **Current truth (deploy/provider/retired)** | [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) â€” read first; `pnpm check:stale-docs` guards it |
| Agent operating runbooks | [`docs/runbooks/index.md`](docs/runbooks/index.md) â€” how to work safely here |
| Current state Â· ship history | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) â€” refresh after every wave |
| Architecture Â· 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Nick agent Â· C4 system context | [`docs/NICK-AGENT-CONTEXT.md`](docs/NICK-AGENT-CONTEXT.md) |
| Repo map Â· cross-ring layout | [`docs/REPO-MAP.md`](docs/REPO-MAP.md) |
| Data model Â· table-by-table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Security posture Â· auth gates | [`docs/SECURITY.md`](docs/SECURITY.md) |
| AI agent contract | [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) â€” verified via `pnpm check:crons`; jobs run through the Inngest mega fan-out |
| AutomationPolicy registry | DB Â· `automation_policies` Â· seed via `pnpm tsx scripts/seed-policies.ts` |
| Schema-drift guard | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) (EXPECTATIONS list) |
| Reasoning tool whitelist | [`lib/ai/reasoning/reasoning-tools.ts`](lib/ai/reasoning/reasoning-tools.ts) â€” 16 read-only tools gated by `NICK_DEEP_REASONING` flag |
| Tool catalog (114 tools) | [`lib/ai/tools/catalog.ts`](lib/ai/tools/catalog.ts) â€” category, cost, risk, required env |
| Firecrawl web scraper | [`lib/integrations/firecrawl.ts`](lib/integrations/firecrawl.ts) â€” `FIRECRAWL_API_KEY` env; `scrapeWebPage` tool in `system.ts` |
| Supply-chain security | `scripts/security-scan.ps1` â€” `pnpm audit --json` wrapper; report at `reports/security-audit.json` |
| Codebase MCP server | `scripts/start-codebase-mcp.ps1` + `docs/codebase-memory-mcp.md` â€” filesystem MCP over `apps/`, `packages/`, `docs/` |

## 4 Â· The fabrication-defense stack (don't break this)

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Never claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) | Verifier-marked turns replaced so the model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Task counts pre-injected as system facts |
| **L5** operator chip | [`components/chat/action-claim-warning.tsx`](components/chat/action-claim-warning.tsx) | Red inline chip shows the diagnostic |

Detection regex: [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) â€” add new verbs as they appear; re-run its test file after changes.

## 5 Â· Active backlog (priority order Â· updated 2026-06-11)

1. P9 confirm-cards Â· judge-eval calibration verdict (needs nâ‰¥30) â€” low priority.

## 6 Â· How to resume in a fresh session

```bash
cd C:\Users\nourd\NOURCITY                       # repo root
git fetch origin && git worktree add .worktrees/<name> -b statenour/<task> origin/main
cd .worktrees/<name> && pnpm install --frozen-lockfile && cd apps/statenour
git log --oneline -10 && head -30 docs/RECONCILIATION.md   # current state
pnpm test                                        # read the summary line, not $?
pnpm verify:hard                                 # full local gate before any push
```

Operator standing rules: `C:\Users\nourd\.claude\CLAUDE.md` (operator on phone Â· default to action Â· direct + concise Â· never destructive without confirmation Â· Cleveland ET for everything).

## 7 Â· Common gotchas / lessons learned

- **Never `--accept-data-loss`** in scripts or CI â€” pgvector + tsvector extras get nuked; recovery scripts exist but don't go there.
- **`prisma migrate status` is the source of truth**, not "I ran release:db" â€” verify against prod before declaring schema work done.
- **`position: relative` containing-block trap** â€” adding it to a parent silently re-anchors `position: fixed` descendants (the state-aura 2545px regression).
- **Next.js dev-server module cache is sticky** â€” when swapping a module's behavior, make the old module internally delegate to the new one (defense-in-depth).
- **Side-effect gating is LIVE in the autonomous-engine** â€” rules with `approval: "ask"` defer + stash `payload.deferredItem`; changing the rule contract means updating `approval-queue.ts` too.
- **aiChat/tracedAiChat NEVER throw on total provider failure** â€” they return a SENTINEL; check `result.provider === "emergency" | "none"` before trusting `content`.
- **Image-gen routes through `generateImageWithFallback`** in `lib/ai/gemini-image.ts` (Replicate FLUX â†’ direct Gemini â†’ OpenRouter), invoked from `lib/ai/chat/handlers/image.ts`. Venice flux-2-pro is RETIRED (no `openai-image.ts`/`venice-image.ts` in tree).
- **GitHub CLI (gh) 401 Bad Credentials inside Agent Sandbox** â€” The agent environment automatically injects a dummy `GITHUB_TOKEN` which overrides the local keyring config. Run `$env:GITHUB_TOKEN=$null` in the terminal session to clear it and successfully fall back to the user's correct local token configuration.
- **Firecrawl `scrapeWebPage` has SSRF defense** â€” `assertPublicUrl()` blocks private/internal URLs before the request reaches Firecrawl. Content is fenced via `fenceContent()` to prevent prompt injection from scraped pages.
- **Deep reasoning tool-gather uses `generateText`, NOT `aiChat`** â€” `aiChat` doesn't support tools. The reasoning engine's `runToolGather()` step uses `generateText` from the AI SDK with the read-only whitelist.

---

## 8 Â· CI/CD Success Metrics

These are the targets to hold. If any go red, stop and diagnose before pushing more work.

| Signal | Target | How to check |
|--------|--------|--------------|
| Full verify gate | 0 errors | `pnpm verify:hard` |
| TypeScript errors | 0 | `pnpm typecheck` |
| ESLint blocking | 0 | `pnpm lint` |
| Test pass rate | 100% (read summary, not `$?`) | `pnpm test` |
| Pre-push build | âœ… turbo cache hit | `.husky/pre-push` |
| Task DB â†’ UI visible | < 15s | `/missions` refetchInterval (PR #455) |
| Prisma migration state | Matches prod | `pnpm prisma migrate status` |

---

## 9 Â· Code Ownership Model

There is no `CODEOWNERS` file. Ownership is enforced by:

| Layer | Mechanism |
|-------|-----------|
| App-level rules | This file (`apps/statenour/AGENTS.md`) â€” read first |
| Cross-cutting rules | Root [`AGENTS.md`](../../AGENTS.md) + [`CIITTY v2.1`](../../.agents/frameworks/ciitty/SKILL.md) |
| PR gate | Operator merges all PRs â€” no direct main push |
| DB constraints | `check:raw-sql` blocks `--accept-data-loss`, pgvector via raw SQL only |
| Schema drift | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) EXPECTATIONS list |

**Governance checks (automated):**
- `pnpm check:stale-docs` â€” guards `docs/CURRENT-TRUTH.md` freshness
- `pnpm check:crons` â€” validates cron manifest against `config/crons.ts`
- `pnpm check:raw-sql` â€” blocks dangerous Prisma flags
- `pnpm check:prompt-size` â€” keeps system prompt under token limit

**PR final report format** (required on every PR):
```
Branch: statenour/<task> Â· SHA: <short>
Changed files: <list>
Checks run: typecheck âœ… Â· lint âœ… Â· test âœ… Â· build âœ…
Intentional exclusions: <none or explain>
```

---

## 10 Â· Agent Framework Reference

This app is governed by **CIITTY v2.1** â€” the monorepo-wide agent operating framework.

ðŸ“„ [`/.agents/frameworks/ciitty/SKILL.md`](../../.agents/frameworks/ciitty/SKILL.md)

Key rules from CIITTY that always apply here:
- **Blind Spot Check** before any significant change (cross-app impact? lockfile sync? Railway gate?)
- **Forgotten Factor Protocol** before closing any task (what cron/env var/webhook depends on what I just changed?)
- **Fault-tolerant DB patterns** â€” never crash the API on a missing table; wrap in try/catch with graceful fallback
- **Cache invalidation** â€” after mutations, invalidate `dashboard_brief`, `ultron_command_center_state_v1` keys
- **iOS PWA** â€” never `window.confirm/alert/prompt`; two-tap DOM pattern only

For clarity-gate usage, full spec lives in: [`~/.gemini/config/skills/clarity-gate/`](~/.gemini/config/skills/clarity-gate/)

