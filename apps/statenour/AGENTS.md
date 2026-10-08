# AGENTS.md · statenour-os

> **Read first:** [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — deploy path, providers, what is
> retired, in one screen. Guarded by `pnpm check:stale-docs`.
> **Ship history:** [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md), newest wave on top — the only
> place a wave entry belongs. **Runbooks:** [`docs/runbooks/index.md`](docs/runbooks/index.md).
> **Cross-cutting rules** (branching, protected operations, enforcement map, Windows): root
> [`AGENTS.md`](../../AGENTS.md), already in context. This file adds only what is true of *this app*.

**Last refreshed:** 2026-10-08 · dead bridge queries resolved (customer_stats built, getTopServices retired) · see RECONCILIATION.
**Header cap: one line.** Skill: `statenour-wave-reconcile`.

<!--
  HEADER DISCIPLINE (2026-08-21 audit). The stamp above replaced a single 6,650-byte line carrying
  nine waves of ship history — 27% of this file's bytes, ~1,662 tokens, loaded into every statenour
  session, all already canonical in RECONCILIATION.md (which held #1755, #1747 and "manual-fire"
  three times each). The line above it said "do NOT grow this header"; the adapter said history goes
  "never in AGENTS.md headers". The rule was violated by the line directly beneath it. If you are
  about to append "Prior (Nth wave) · ...", you are re-growing it. One date, one PR pair, one
  pointer. HTML comments are stripped before context, so this note costs 0 tokens.
-->

## 1 · Where we are

statenour-os (NOUR OS) at `apps/statenour/`. `main` auto-deploys to Railway → **bdnick.info**. The
old Vercel deploy and the standalone `statenour-os` repo are retired. Sibling app `nickstire`
(Railway → nickstire.org) shares this monorepo.

**Stack:** Next.js 16 · React 19 · Prisma 6.19 · Neon Postgres (pgvector + tsvector via raw SQL) ·
Tailwind 4 · AI SDK v6 · Vitest. Commits: `<type> · statenour · <summary>`; `v10.0.X` is retired.

**Tests:** the suite is GREEN and exits 0. A non-zero exit is a REAL failure — the "exits 1 on
pre-existing unhandled rejections" era is over; never explain a red away as folklore. Counts belong
in RECONCILIATION, not here (a pinned count is a cache with no invalidation). Four standing rules:

1. Build lenses first — `turbo build --filter=@statenour/lenses` — or ~5 strategic-frameworks files
   fail on import rather than on their own merits.
2. Never export real API keys or a prod `DATABASE_URL` into the test shell: provider-chain tests
   reorder and the empty-DB smoke sees real data. Both produce phantom failures.
3. Read the vitest **summary line**, not the exit status.
4. Run the test files your change touched, explicitly. `tsconfig.json` and
   `tsconfig.typecheck.json` **both exclude `tests/` and `scripts/`** — a green typecheck says
   nothing about `tests/`; `scripts/` is ratchet-gated by `pnpm check:scripts` (in `verify:hard`).

## 2 · How we work

**Branching:** prefix `statenour/<task>`; everything else is in root `AGENTS.md` → Branching. The
only live push hook is root `lefthook.yml` (`pre-push` → `pnpm run build:affected`). No pre-push
script inside this app is active — do not resurrect one.

1. **Auto mode** — execute autonomously, prefer action over planning. Never destructive without
   explicit confirmation (root `AGENTS.md` → Protected operations defines what counts).
2. **Small ships by default** — 1–4 files plus a test per commit; a wave is 4–6 slices.
   **Operator exception (settled 2026-09-09):** when the operator asks for a batched wave —
   "one big merge", "minimal PRs, the checks take forever" — ship ONE PR with staged commits
   inside it and say so in the PR body. Their stated preference wins; do not fragment it back.
3. **The push must build clean.** Full gate: `pnpm verify:hard` — **17 checks, composition at
   `package.json:12`. Read it there;** any prose list goes stale the next time one is added.
4. **Auth is gated, not advisory.** Operator-private GET routes need `auth: "owner"`; mutating
   routes need an explicit auth wrapper. `pnpm check:get-auth`
   (`scripts/check-sensitive-get-auth.ts`) scans **each handler's body, not the file** — see its
   own header at `:18-20`; a file-level grep passes when a guarded PATCH sits beside an unauthed
   GET in the same route file. Plus `pnpm check:mutations:strict`
   (`scripts/audit-mutation-receipts.ts --strict`). Both run inside `verify:hard`.
5. **Pgvector lives in Prisma as `Unsupported(...)`** so `db push` won't drop the columns. Querying
   is raw SQL (`lib/db/pgvector.ts`); the HNSW index is raw-SQL only. `pnpm check:raw-sql` audits
   camelCase column references inside `$queryRaw` strings — **it does not scan for destructive
   flags, and no automated gate does.**
6. **Inbox missions are NOT user projects** — `lib/services/mission-helpers.ts` `isInboxMission()`
   is the single predicate. Readers include `lib/services/{missions,tasks,task-rescue}.ts`,
   `lib/db/conversation-mission-linker.ts`, `lib/ai/chat/truth-grounding.ts`,
   `app/api/cron/inbox-janitor/route.ts` and `config/crons.ts` — change the predicate and you
   change all of them. Get the current list with
   `git ls-files | xargs grep -l isInboxMission`; a number pasted here would be a cache with no
   invalidation.

### Frontend conventions

- **`GlassCard`** (`components/ui/glass-card.tsx`) is the only card. The shadcn `components/ui/card.tsx` was
  deleted in UI v2 PR 4 (2026-10-02); GlassCard's `.neural-glass` rule sits in `@layer components`, so className utilities win.
- **Style through the theme bridge** (`bg-elevated`, `bg-raised`, `text-fg-secondary`,
  `border-glass`, `text-gold`) declared in `app/styles/tokens.css` `@theme inline`. Raw
  `bg-[var(--token)]` is legacy read-path only. **A token that does not exist emits zero CSS and fails
  silently** — verify the rendered value, not the class name.
- **`app/globals.css` is an import manifest only.** Real CSS lives in
  `app/styles/{tokens,base,effects}.css`; import order is cascade order. Append within the right
  layer, never reorder.
- **Bottom chrome:** clear the fixed tab-bar with `pb-[var(--bottom-chrome-h)]` (published by
  `components/layout/bottom-tab-bar.tsx`). Never hand-tune per-page bottom padding.
- **Folders:** domain UI in `components/<domain>/`, primitives in `components/ui/`, shared logic in
  `lib/`. `src/` is retired; `features/` is frozen to the existing slices.
- **iOS PWA:** `window.confirm/alert/prompt` are silently suppressed — two-tap in-DOM confirms only,
  48×48px minimum targets. Since 2026-08-27 the `adoption-gates.yml` CI gate AST-blocks
  `window.confirm/alert/prompt` here (canaried; red is advisory until branch protection).
  Skill: `nickstire-ios-pwa-primitives` — it governs this app too.

## 3 · Canonical sources

Open the row that matches your task. These are pointers, not context.

| What you need | Where |
|---|---|
| Deploy path, providers, what's retired | [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) |
| Ship history, wave by wave · active backlog | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) |
| How to work safely here | [`docs/runbooks/index.md`](docs/runbooks/index.md) |
| Architecture · 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Data model, table by table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Auth gates + security posture | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) — gated by `pnpm check:crons` |
| Live cron catalog + kill switches | `/system/crons` (tRPC `systemAutomation.cronDeck` · `setCronEnabled` toggles · `runManifestCron` fires). The kill switch gates route crons in `cronHandler` AND Inngest-native crons in `CronLifecycleMiddleware.wrapFunctionHandler` (2026-10-02). |
| Schema-drift expectations | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) |
| Tool catalog (count = `TOOL_CATALOG.length`, never prose) | [`lib/ai/tools/catalog.ts`](lib/ai/tools/catalog.ts) |
| Reasoning whitelist (read-only, `NICK_DEEP_REASONING`) | [`lib/ai/reasoning/reasoning-tools.ts`](lib/ai/reasoning/reasoning-tools.ts) |

Integration detail (Firecrawl, last30days, MoneyPrinterTurbo, the codebase MCP server) lives with
each integration under `lib/` and `docs/` — read it when you touch that integration, not before.

## 4 · The fabrication-defense stack — do not break this

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Never claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) | Verifier-marked turns replaced so the model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Task counts pre-injected as system facts |
| **L5** operator surface | [`components/chat/message-diagnostics.tsx`](components/chat/message-diagnostics.tsx) + [`lib/services/claim-warnings.ts`](lib/services/claim-warnings.ts) | Surfaces the diagnostic in the transcript |
| **L6** evidence gate | [`lib/ai/reply-gate.ts`](lib/ai/reply-gate.ts) `runEvidenceGate` + [`chat/named-source-claims.ts`](lib/ai/chat/named-source-claims.ts) + [`chat/gate-enforcement.ts`](lib/ai/chat/gate-enforcement.ts) | A NAMED resource with no tool receipt this turn is a blocking claim — L1-L2 cover past-tense ACTION verbs only, so an invented channel name tripped nothing. **Runs in SHADOW** (`evidence_gate_shadow`, persisted at `tokenUsage.evidenceGate`): it CANNOT block on the streaming path, since `onFinish` runs after the last token flushes. Enforcement goes live on the buffered path once the shadow false-positive rate is known — **never read a shadow verdict as an enforced one.** Design: [`docs/NICK-TRUST-ARCHITECTURE-V2-2026-09-10.md`](docs/NICK-TRUST-ARCHITECTURE-V2-2026-09-10.md) |

Detection regex: [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) — add
new verbs as they appear, then re-run its test file.

<!--
  2026-08-21 AUDIT: the L5 row pointed at components/chat/action-claim-warning.tsx, which PR #689's
  own dead-component sweep DELETED, while still describing it as live. Now re-pointed at the live surface.
  NOTE: an early draft of this comment called it "the ONLY dangling reference across all 9
  files". An adversarial review refuted that — the cron-registry row two rows up in §3 pointed
  at `/api/cron/list` and `/system/cron-deck`, neither of which exists. Do not restate the boast.
-->

## 5 · Common gotchas — each cost a real incident

- **Never pass a destructive data-loss flag to Prisma.** pgvector and tsvector extras get nuked.
  No automated gate scans for it; the ban is policy plus the Claude-only PreToolUse hook — a Codex
  or Cursor session has **no** block at all here.
- **`prisma migrate status` is the source of truth**, not "I ran release:db" — verify against prod
  before declaring schema work done.
- **`position: relative` containing-block trap** — adding it to a parent silently re-anchors
  `position: fixed` descendants (the state-aura 2545px regression). Dual: a `fixed` child ignores ancestor padding (#2355).
- **The Next.js dev-server module cache is sticky** — when swapping a module's behaviour, have the
  old module internally delegate to the new one.
- **`aiChat` / `tracedAiChat` NEVER throw on total provider failure** — they return a SENTINEL.
  Check `result.provider === "emergency" | "none"` before trusting `content`.
- **Deep-reasoning tool-gather uses `generateText`, NOT `aiChat`** — `aiChat` has no tool support.
- **Image-gen routes through `generateImageWithFallback`** in `lib/ai/gemini-image.ts` (Replicate
  FLUX → Gemini → OpenRouter), from `lib/ai/chat/handlers/image.ts`. Venice flux-2-pro is RETIRED —
  there is no `openai-image.ts` / `venice-image.ts` in the tree.
- **Side-effect gating is LIVE in the autonomous engine** — rules with `approval: "ask"` defer and
  stash `payload.deferredItem`; changing the rule contract means updating `approval-queue.ts` too.
- **Firecrawl `scrapeWebPage` has SSRF defense** — `assertPublicUrl()` blocks private URLs; scraped
  content is wrapped by `fenceContent()` against prompt injection.
- **`gh` returns 401 in the agent sandbox** — a dummy `GITHUB_TOKEN` overrides the local keyring.
  Clear it (`$env:GITHUB_TOKEN=$null`) before any `gh` call.
- **`scripts/pre-push-check.sh` is a stale Vercel-era artifact** — not active, not in the tree.

## 6 · Governance

| Layer | Mechanism |
|---|---|
| App rules | This file |
| Review routing | [`.github/CODEOWNERS`](../../.github/CODEOWNERS) — real owner since 2026-07-21; advisory until branch protection is enabled (a repo setting) |
| Cross-cutting rules | Root [`AGENTS.md`](../../AGENTS.md) |
| Schema drift | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) EXPECTATIONS |
| Tool-call policy | `config/agent-os/policy.json` — **Claude Code only** |

**PR report:** branch · SHA · changed files · checks run with receipts · intentional exclusions.

**Framework:** CIITTY v2.1 — [`.agents/frameworks/ciitty/SKILL.md`](../../.agents/frameworks/ciitty/SKILL.md).
Blind Spot Check before a change · Forgotten Factor before closing · fault-tolerant DB patterns
(never crash the API on a missing table) · invalidate `dashboard_brief` and
`ultron_command_center_state_v1` after mutations.

<!--
  2026-08-21 AUDIT — what was CUT and where it went, so no fact is lost:
  · L6 wave-history paragraph (6,650 B / ~1,662 tok) -> RECONCILIATION.md, which already held it 3x.
  · "Active backlog" (8 items, stamped 2026-07-28) -> apps/statenour/docs/RECONCILIATION.md,
    section "Open backlog — moved out of AGENTS.md on 2026-08-21". VERIFIED present there
    (grep "Scheduled-cycle proof" / "Memory write governance" / "Recall-eval corpus" -> 1 each).
    An earlier edit claimed this relocation BEFORE performing it, and a later one said "RESTORED
    below as §6" when §6 is Governance. Both pointers were wrong; this one was checked.
    An always-loaded policy file is the wrong home for a backlog: it goes stale silently and bills
    tokens every session.
  · "CI/CD Success Metrics" table -> every row was an OUTCOME of `pnpm verify:hard`, which house
    rule 3 already names. Outcomes are not falsifiable rules; the gate is the rule.
  · The 16-check verify:hard enumeration -> replaced by a package.json:12 file reference. A pasted
    list of checks is a cache with no invalidation.
  · Duplicated CODEOWNERS + CIITTY prose (near-verbatim with apps/nickstire/AGENTS.md) -> collapsed.
  · Mojibake repaired on 4 lines (L33 "≠", L137/L170 "✅", L180 "📄") — UTF-8 written through a
    cp1252 reader. Re-check after any scripted bulk edit; nothing in CI catches this.
-->
