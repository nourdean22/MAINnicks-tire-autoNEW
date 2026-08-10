# AGENTS.md · statenour-os

> **⚡ Current truth in one screen:** [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — app location, production deploy path, what's retired, source-of-truth hierarchy. Read it if you only read one thing. Guard: `pnpm check:stale-docs`. Agent runbooks: [`docs/runbooks/index.md`](docs/runbooks/index.md).
>
> **Purpose:** any AI agent (Claude, Codex, Antigravity, Gemini, Cursor, etc.) opening this repo reads this file FIRST. Wave-by-wave ship history is canonical in [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — when a wave lands, add the full entry THERE and update only the stamp below (do NOT grow this header; see the `statenour-wave-reconcile` skill).
> **Last refreshed:** 2026-08-10 · agent-bridge observability + risk truth — the 17th mega-plan gated (~90% incumbent; 6 UPSTREAMS rows + failure mode 11; NHTSA row 49 corrected). Refused bridge calls left no trace in any of three sinks and are now audited, prod-verified (#1487); effective `riskClass` wired at the three sites that bypassed the resolver, so `runDeviceCommand` no longer audits as "low" (#1488). Full roll-up: RECONCILIATION top entry. Prior: 2026-08-09 · consolidation-campaign wave — the 8th mega-plan gated (11 claims falsified; 4 UPSTREAMS rows added + failure mode #8), and the vapi lane VAPI never called deleted: 4 routes + 2 helpers + the `/api/vapi` route-policy entry, 1,020 lines out (#1460). Full roll-up: RECONCILIATION top entry. Prior: 2026-08-08 · chat-cockpit gate wave — mega-plan gated (~85% incumbent/refuted; 2 UPSTREAMS rows added), SSE `X-Accel-Buffering` parity on the chat stream, chat-feed `role="log"`/`aria-busy` semantics. Full roll-up: RECONCILIATION top entry. Prior: 2026-07-29 · fourteenth arc — truth-guard artifact/browser claim classes, daily-brief degrade guarantee (briefing_logs always gains its row), WP-21 eval-dataset exporter. Full roll-up: RECONCILIATION top entry (sibling arcs #1195/#1200 backfill-pending there).

## 1 · Where we are right now

**Project:** statenour-os (NOUR OS · personal mastery system for Nour Dean). Lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at `apps/statenour/` — `main` auto-deploys to Railway, served at `bdnick.info` (custom domain). The old Vercel deploy and the standalone `statenour-os` repo are retired. Companion business-ring app `nickstire` lives in the same monorepo at `apps/nickstire/` (Railway → nickstire.org).

**Stack:** Next.js 16 · React 19 · Prisma 6.19 · Neon Postgres (with raw-SQL pgvector + tsvector extras) · Tailwind 4 · AI SDK v6 · Vitest.

**Versioning:** the `v10.0.X` scheme is retired — commits use `fix · statenour · …` / `docs · statenour · …`.

**Tests:** the suite is GREEN and exits 0 (measured 2026-07-28 late: 394 files, 4,441 passed | 1 skipped, exit 0). The old "EXITS 1 on ~12 pre-existing unhandled rejections" era is OVER — a non-zero exit now means a REAL failure; do not explain it away as folklore. Two standing caveats: (1) never export real API keys / prod `DATABASE_URL` into the test shell — provider-chain tests reorder with live keys present and the empty-DB smoke sees real data (phantom failures); (2) still read the vitest **summary line** and run the files YOUR change touched explicitly — `tsconfig` excludes `tests/`, so `tsc` never catches a broken test import. Build `@statenour/lenses` first (`turbo build --filter=@statenour/lenses` from the repo root) or ~5 strategic-frameworks files fail on import.

## 2 · How we work

### Branching (operator rule 2026-06-11 — supersedes any older "push main" notes)

- **NEVER push `main`.** Named branches (`statenour/<task>` · `docs/<task>` · `chore/<task>`) + PR; create and squash-merge the PR yourself per root `AGENTS.md` → Branching (autonomous merging allowed). Prefer a fresh `.worktrees/<name>` worktree off origin/main (concurrent sessions share this repo).
- Stage only your files by explicit path · never `git add -A` · never `--no-verify` · scope to the assigned task only.
- `apps/statenour/scripts/pre-push-check.sh` is a stale Vercel-era artifact — NOT the active hook; ignore it. The real hook is the repo-root `lefthook.yml` (`pre-push` -> `turbo build --affected`; Husky is not used).

### House rules

1. **Auto mode** — execute autonomously, prefer action over planning. Never destructive without explicit confirmation.
2. **Small ships** — 1–4 files + 1 test file per commit; a wave is 4–6 slices.
3. **The push must build clean.** Full local gate: `pnpm verify:hard` (typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`).
4. Operator-private GET routes need `auth: "owner"`; mutating routes need an explicit auth wrapper.
5. **Pgvector lives in Prisma as `Unsupported(...)`** — Prisma sees the columns and won't drop them on `db push`; querying is raw SQL (`lib/db/pgvector.ts`); the HNSW index is raw-SQL only. (`check:raw-sql` audits camelCase column references in `$queryRaw` strings — it does NOT scan for `--accept-data-loss`; no automated gate does. The flag ban in §7 is policy, enforced by review.)
6. **Inbox missions â‰  user projects** — `lib/services/mission-helpers.ts isInboxMission()` is the single predicate (Plan view, Track tile, mission cap all depend on it).

When the operator invokes `/karpathy-guidelines`, `/kaizen`, `/superpowers-lab`, `/using-superpowers`, `/antigravity-workflows`, or `/prompt-library` — treat them as MANDATORY framing for the work.

### Frontend conventions (2026-07-07 consistency wave)

- **Card primitive** — `GlassCard` (`components/ui/glass-card.tsx`) is canonical. `components/ui/card.tsx` is @deprecated legacy (kept only for the structured CardHeader/Content API in `components/stats/*`); never import it in new code.
- **Token write-path** — new styling uses the Tailwind theme-bridge utilities (`bg-elevated`, `bg-raised`, `text-fg-secondary`, `border-glass`, `text-gold`, …) declared in `app/styles/tokens.css` `@theme inline`. Raw `bg-[var(--…)]` arbitrary values are legacy read-path only.
- **Stylesheet layers** — `app/globals.css` is an import manifest only; real CSS lives in `app/styles/{tokens,base,effects}.css`. Import order = cascade order; append within the right layer, never reorder.
- **Bottom chrome** — page content clears the fixed tab-bar/ticker with `pb-[var(--bottom-chrome-h)]` (owned by `bottom-tab-bar.tsx` + `tokens.css`). Never hand-tune per-page bottom padding.
- **Folder convention** — domain UI in `components/<domain>/`, shared primitives in `components/ui/`, server/shared logic in `lib/` (inngest moved `src/inngest` → `lib/inngest`, 2026-07-07; `src/` is retired). `features/` is frozen to the existing `chat-v2` + `missions` slices — don't add new top-level conventions.

### Commit format

`<type> · statenour · <one-line summary>` subject + context / implementation / verify paragraphs + `Co-Authored-By: <model name> <noreply@anthropic.com>`.

## 3 · Canonical sources of truth

| What you need | Where it lives |
|---|---|
| **Current truth (deploy/provider/retired)** | [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — read first; `pnpm check:stale-docs` guards it |
| Agent operating runbooks | [`docs/runbooks/index.md`](docs/runbooks/index.md) — how to work safely here |
| Current state · ship history | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — refresh after every wave |
| Architecture · 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Nick agent · C4 system context | [`docs/NICK-AGENT-CONTEXT.md`](docs/NICK-AGENT-CONTEXT.md) |
| Repo map · cross-ring layout | [`docs/REPO-MAP.md`](docs/REPO-MAP.md) |
| Data model · table-by-table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Security posture · auth gates | [`docs/SECURITY.md`](docs/SECURITY.md) |
| AI agent contract | [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) — verified via `pnpm check:crons`; jobs run through the Inngest mega fan-out |
| AutomationPolicy registry | DB · `automation_policies` · seed via `pnpm tsx scripts/seed-policies.ts` |
| Schema-drift guard | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) (EXPECTATIONS list) |
| Reasoning tool whitelist | [`lib/ai/reasoning/reasoning-tools.ts`](lib/ai/reasoning/reasoning-tools.ts) — 16 read-only tools gated by `NICK_DEEP_REASONING` flag |
| Tool catalog (count = `TOOL_CATALOG.length`, never prose) | [`lib/ai/tools/catalog.ts`](lib/ai/tools/catalog.ts) — category, cost, risk, required env |
| Firecrawl web scraper | [`lib/integrations/firecrawl.ts`](lib/integrations/firecrawl.ts) — `FIRECRAWL_API_KEY` env; `scrapeWebPage` tool in `system.ts`. SSRF defense via `assertPublicUrl()`, output wrapped in `fenceContent()` |
| last30days research engine | `lib/ai/last30days` — `last30days` tool in `system.ts`; deep search across Reddit/HN/Polymarket/GitHub/YouTube. Needs `python3` (installed in the Dockerfile) + output tracing in `next.config.ts`; whitelisted in `reasoning-tools.ts` |
| MoneyPrinterTurbo video generator | `lib/ai/moneyprinter` — `moneyprinter` tool in `system.ts` (sideEffecting, in-flight-guarded). Dockerfile installs `ffmpeg`, `imagemagick`, `py3-pip`; credentials mapped into `config.toml` at runtime |
| Supply-chain security | `scripts/security-scan.ps1` — `pnpm audit --json` wrapper; report at `reports/security-audit.json` |
| Codebase MCP server | `scripts/start-codebase-mcp.ps1` + `docs/codebase-memory-mcp.md` — filesystem MCP over `apps/`, `packages/`, `docs/` |

## 4 · The fabrication-defense stack (don't break this)

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Never claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) | Verifier-marked turns replaced so the model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Task counts pre-injected as system facts |
| **L5** operator chip | [`components/chat/action-claim-warning.tsx`](components/chat/action-claim-warning.tsx) | Red inline chip shows the diagnostic |

Detection regex: [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) — add new verbs as they appear; re-run its test file after changes.

## 5 · Active backlog (priority order · updated 2026-07-28 late — evening waves shipped 5 of the 9 items listed this morning)

1. **Scheduled-cycle proof** — first real briefing_log row (10:15 UTC) + heartbeat + worker artifact-liveness; first outcome-ledger rows from the brief + decision surfacings.
2. **Memory write governance** — gateway SHADOW receipts accumulate to ~2026-08-04; review `agrees` rates, then route high-value writers + change promotion semantics (repetition ≠ corroboration).
3. **Triage adoption** — the incumbent one-item flow (InboxTasksTriage + task.triage) is verified complete; adoption is operator behavior, not code. (Spine-5's parallel contract was deleted 2026-07-28 — see contracts registry note.)
4. **Realtime completion-message push** — S3's receipt-backed follow-up appears on next load; pushing into an open stream is its own transport change.
5. **Recall-eval corpus growth** — feed real corrections from outcomesNeedingReview into lib/brain/recall-eval fixtures; only then retune RRF/persona weights.
6. **Chat-state visual regression** — Playwright screenshots of /system/chat-states in the e2e lane.
7. **Approval/decision card runtime receipts** — first live renders post-#1176 deploy; extend the typed-card registry only on verified shapes.
8. P9 confirm-cards · judge-eval calibration verdict (needs n≥30) — low priority.

## 6 · How to resume in a fresh session

```powershell
cd C:\Users\nourd\NOURCITY                       # repo root
git fetch origin
powershell scripts/worktree-setup.ps1 -branchName statenour/<task> -targetDir .worktrees/<name>
# ^ copies env files + JUNCTIONS node_modules. Do NOT run `pnpm install` in a junctioned
#   worktree: it offers to WIPE the shared node_modules (default Y) that every worktree points at.
cd .worktrees/<name>/apps/statenour
git log --oneline -10 ; Get-Content docs/RECONCILIATION.md -TotalCount 30   # current state
pnpm test                                        # read the summary line, not $?
pnpm verify:hard                                 # full local gate before any push
```

Operator standing rules: `C:\Users\nourd\.claude\CLAUDE.md` (operator on phone · default to action · direct + concise · never destructive without confirmation · Cleveland ET for everything).

## 7 · Common gotchas / lessons learned

- **Never `--accept-data-loss`** in scripts or CI — pgvector + tsvector extras get nuked; recovery scripts exist but don't go there.
- **`prisma migrate status` is the source of truth**, not "I ran release:db" — verify against prod before declaring schema work done.
- **`position: relative` containing-block trap** — adding it to a parent silently re-anchors `position: fixed` descendants (the state-aura 2545px regression).
- **Next.js dev-server module cache is sticky** — when swapping a module's behavior, make the old module internally delegate to the new one (defense-in-depth).
- **Side-effect gating is LIVE in the autonomous-engine** — rules with `approval: "ask"` defer + stash `payload.deferredItem`; changing the rule contract means updating `approval-queue.ts` too.
- **aiChat/tracedAiChat NEVER throw on total provider failure** — they return a SENTINEL; check `result.provider === "emergency" | "none"` before trusting `content`.
- **Image-gen routes through `generateImageWithFallback`** in `lib/ai/gemini-image.ts` (Replicate FLUX → direct Gemini → OpenRouter), invoked from `lib/ai/chat/handlers/image.ts`. Venice flux-2-pro is RETIRED (no `openai-image.ts`/`venice-image.ts` in tree).
- **GitHub CLI (gh) 401 Bad Credentials inside Agent Sandbox** — The agent environment automatically injects a dummy `GITHUB_TOKEN` which overrides the local keyring config. Run `$env:GITHUB_TOKEN=$null` in the terminal session to clear it and successfully fall back to the user's correct local token configuration.
- **Firecrawl `scrapeWebPage` has SSRF defense** — `assertPublicUrl()` blocks private/internal URLs before the request reaches Firecrawl. Content is fenced via `fenceContent()` to prevent prompt injection from scraped pages.
- **Deep reasoning tool-gather uses `generateText`, NOT `aiChat`** — `aiChat` doesn't support tools. The reasoning engine's `runToolGather()` step uses `generateText` from the AI SDK with the read-only whitelist.

---

## 8 · CI/CD Success Metrics

These are the targets to hold. If any go red, stop and diagnose before pushing more work.

| Signal | Target | How to check |
|--------|--------|--------------|
| Full verify gate | 0 errors | `pnpm verify:hard` |
| TypeScript errors | 0 | `pnpm typecheck` |
| ESLint blocking | 0 | `pnpm lint` |
| Test pass rate | 100% (read summary, not `$?`) | `pnpm test` |
| Pre-push build | âœ… turbo cache hit | `lefthook.yml` (pre-push) |
| Task DB → UI visible | < 15s | `/missions` refetchInterval (PR #455) |
| Prisma migration state | Matches prod | `pnpm prisma migrate status` |

---

## 9 · Code Ownership Model

`.github/CODEOWNERS` exists (real owner `@nourdean22` since 2026-07-21) and ROUTES review
requests — `/apps/statenour/prisma/`, `/lib/ai/`, `/lib/automation/`, `middleware.ts`, `auth.ts`
and the security paths are listed there. It only becomes REQUIRED once branch protection on
`main` enables "Require review from Code Owners" (repo setting, not settable from code).
Ownership is otherwise enforced by:

| Layer | Mechanism |
|-------|-----------|
| App-level rules | This file (`apps/statenour/AGENTS.md`) — read first |
| Review routing | [`.github/CODEOWNERS`](../../.github/CODEOWNERS) |
| Cross-cutting rules | Root [`AGENTS.md`](../../AGENTS.md) + [`CIITTY v2.1`](../../.agents/frameworks/ciitty/SKILL.md) |
| PR gate | Named branch + PR — agents create and squash-merge their own PRs (root `AGENTS.md` → Branching); NEVER a direct push to `main` |
| DB constraints | `check:raw-sql` audits raw-SQL column casing; the `--accept-data-loss` ban is policy (no automated gate); pgvector via raw SQL only |
| Schema drift | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) EXPECTATIONS list |

**Governance checks (automated):**
- `pnpm check:stale-docs` — guards `docs/CURRENT-TRUTH.md` freshness
- `pnpm check:crons` — validates cron manifest against `config/crons.ts`
- `pnpm check:raw-sql` — audits camelCase column references in raw SQL. It does NOT scan for `--accept-data-loss`; no automated gate does, and the flag ban is policy enforced by review (see §5 and the DB-constraints row above, which already say so — this line used to contradict both)
- `pnpm check:prompt-size` — keeps system prompt under token limit

**PR final report format** (required on every PR):
```
Branch: statenour/<task> · SHA: <short>
Changed files: <list>
Checks run: typecheck âœ… · lint âœ… · test âœ… · build âœ…
Intentional exclusions: <none or explain>
```

---

## 10 · Agent Framework Reference

This app is governed by **CIITTY v2.1** — the monorepo-wide agent operating framework.

ðŸ“„ [`/.agents/frameworks/ciitty/SKILL.md`](../../.agents/frameworks/ciitty/SKILL.md)

Key rules from CIITTY that always apply here:
- **Blind Spot Check** before any significant change (cross-app impact? lockfile sync? Railway gate?)
- **Forgotten Factor Protocol** before closing any task (what cron/env var/webhook depends on what I just changed?)
- **Fault-tolerant DB patterns** — never crash the API on a missing table; wrap in try/catch with graceful fallback
- **Cache invalidation** — after mutations, invalidate `dashboard_brief`, `ultron_command_center_state_v1` keys
- **iOS PWA** — never `window.confirm/alert/prompt`; two-tap DOM pattern only

Clarity Gate (pre-ingestion epistemic verification) is invoked as a skill — see root `AGENTS.md` → Operating frameworks.

