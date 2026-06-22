# Antigravity Repair Plan — statenour (NOUR OS)

> Source: external "Statenour Deep Research Report" (2026-06-20), **verified against live code** at `C:\Users\nourd\NOURCITY` (origin `nourdean22/MAINnicks-tire-autoNEW`, main `68478783`).
> Author of this plan: Claude (Opus 4.8) — verification pass only, **no code edited**.
> Executor: **Antigravity**, operating under `.antigravityrules` + `AGENTS.md` + `apps/statenour/AGENTS.md`.
> Status: **DRAFT for execution** · uncommitted docs file · safe to edit/commit on a named branch.

---

## 0. Execution contract (read before touching anything)

Antigravity MUST obey these repo constraints. They override any generic instinct in the report.

- **Never push `main`.** Work on `statenour/<task>` branches; open PRs; the **operator merges**. Use `scripts/worktree-setup.ps1 -branchName statenour/<task> -targetDir .worktrees/<name>` (junctions node_modules — no `pnpm install` needed unless the lockfile changes, then `pnpm install --frozen-lockfile --filter "statenour-web..."` WITH the `...`).
- **Commit attribution:** `Co-Authored-By: Antigravity <noreply@anthropic.com>`.
- **Schema is hand-applied.** Any `prisma/schema.prisma` change → follow the `statenour-migration` skill. **Never `--accept-data-loss`.** One wrong flag silently drops pgvector. Back up + write a reversal before touching the DB.
- **Verify gate (statenour), from `apps/statenour/`:** `pnpm typecheck` · `pnpm lint` · `pnpm test` · full `pnpm verify:hard`. Piping vitest to `tail` masks the exit code — read the summary line. Follow the `statenour-verify` skill.
- **Windows shell:** PowerShell — no `&&` chaining (use `;` or separate calls). Bash cwd resets to `C:\` per call (prefix `cd /c/Users/nourd/NOURCITY/... &&`).
- **iOS PWA:** `window.confirm/alert/prompt` are silently suppressed — use the in-DOM two-tap pattern (`nickstire-ios-pwa-primitives` applies to statenour too).
- **End of wave:** run `statenour-wave-reconcile` (refresh `docs/RECONCILIATION.md` + `AGENTS.md`).
- **Per `.antigravityrules`:** log every major decision to `docs/operations/11-DECISION-LOG.md` using the template there. Each WP below ships a ready-to-paste stub.
- **Concurrency:** sibling sessions are live. Two worktrees already exist — `.worktrees/de-venice-residue` (PR #242) and `.worktrees/statenour-ui`. **Do not edit files those branches own.** `git log origin/<branch>..HEAD` before and after pushing.

---

## Bottom Line

The report is **directionally correct and worth executing**, but it was written against a stale snapshot. Before any code moves: **merge the in-flight de-Venice PR #242**, then execute the work below in Wisdom-Hierarchy order — *finish truth-drift cleanup → harden config/security → make statenour measurable → (operator-gated) simplify IA*. **Do not** act on the report's two false/over-stated claims (Dependabot, "weak CI"). This is a **harden-and-simplify pass, not a replatform.**

## What's Actually Going On

The root problem is not bad code — it is **truth living in too many places**. AI-provider reality, deploy assumptions, and env docs drifted apart faster than they were curated. That is the debt that slows a fast solo product more than ordinary bugs. The fix is to **collapse each truth to one source and generate the rest**, then gate future drift with a CI test. Everything else (CSP, perf, IA) is secondary to killing the drift engine.

---

## 1. Report accuracy ledger (so Antigravity doesn't act on false claims)

| # | Report claim | Verdict | Evidence in live code |
|---|---|---|---|
| 1 | `next.config.ts` is overloaded (redirects + CSP + headers + build flags in one file) | **TRUE** | `next.config.ts` — ~130-line redirect matrix (L147–280), CSP (L105–127), headers, image, build all in one file |
| 2 | `typescript.ignoreBuildErrors: true` | **TRUE (mitigated)** | `next.config.ts:57–59`. Documented `googleapis`/`gkehub` binary-type crash; compensated by pre-push `tsc`, CI `check`, local typecheck. Report under-weights the compensation. |
| 3 | CSP allows `unsafe-inline` + `unsafe-eval` | **TRUE** | `next.config.ts:108` `script-src 'self' 'unsafe-inline' 'unsafe-eval'` |
| 4 | 101 Prisma models, category sprawl | **TRUE (exact)** | `prisma/schema.prisma` — exactly 101 `^model` decls |
| 5 | Venice drift: retired in code, still "critical" in env/deploy docs | **TRUE but IN FLIGHT** | `DEPLOY.md:88`, `.env.example:45–52,170–171` still present Venice. **BUT** PR #242 (`de-venice-residue`) already de-Veniced `provider.ts`, chat + health control planes, knowledge-sync, env.ts, tools-health (+7 new tests). The docs are the *residual*. |
| 6 | Vercel-era assumptions while stack is Railway | **TRUE** | `next.config.ts:15,22,31`; `.env.example:27,34,126,188` reference Vercel; `output:"standalone"` (L32) targets Railway |
| 7 | Lighthouse CI targets nickstire, not statenour | **TRUE** | `.github/workflows/lighthouse-ci.yml` collects only `nickstire.org/*` URLs |
| 8 | No CodeQL / code scanning | **TRUE** | No `codeql` workflow in `.github/workflows/` |
| 9 | `staticPageGenerationTimeout: 300` | **TRUE** | `next.config.ts:39` |
| 10 | **"No Dependabot configuration visible"** | **FALSE** | `.github/dependabot.yml` exists — npm weekly + github-actions monthly, grouped, major bumps hand-reviewed. **Do not "add Dependabot."** |
| 11 | Implied weak/absent CI | **FALSE / over-stated** | `.github/workflows/test.yml` — Turbo `--affected` check+lint+test+build, Node 20 (matches Railway), `pnpm audit --prod --audit-level=high`. CI is solid. |
| 12 | Provider truth should be one machine-readable registry | **GOOD IDEA** | Adopt — but build on the *cleaned* `provider.ts` from #242, not the snapshot the report saw. |

**Net:** ~10 of 12 substantive claims hold. One is outright false (Dependabot). The headline (Venice) is real but ~95% already fixed in an open PR the report couldn't see. The strategic ordering (truth → harden → measure → simplify) is sound.

---

## 2. Sequencing (Wisdom-Hierarchy order)

```
Phase 0  WP-0  Merge PR #242, then finish residual de-Venice + drift guard   [reliability/maintainability]
Phase 1  WP-1  AI provider single-source-of-truth registry                   [reliability]
         WP-2  Decompose next.config.ts + fix Vercel→Railway comments        [maintainability]
         WP-3  Split .env.example into core/optional/local/deprecated        [security/clarity]
Phase 2  WP-4  CodeQL workflow + confirm secret-scanning (settings)          [security]
         WP-5  CSP: drop dead origins, pursue nonce script-src               [security]
         WP-6  statenour field web-vitals + perf coverage                    [measurability]
Phase 3  WP-7  Prisma model governance (NON-destructive first)               [maintainability]  ← operator-gated
         WP-8  IA "Critical Few" + product analytics                         [execution clarity] ← operator-gated, needs buy-in
```

Phases 0–1 are the leverage. Phase 3 is judgment-heavy — **do not autonomously redesign the app or consolidate models**; bring options to the operator.

---

## 3. Work packages

Each WP: **Goal · Files · Changes · Verify · Rollback · Decision-log stub · Wisdom rank**. One PR per WP unless noted.

### WP-0 — Finish de-Venice + lock it with a drift guard `[branch: statenour/de-venice-residual]`
**Wisdom rank: Operational reliability + Maintainability.** Kills the report's #1 issue at the source.

- **Precondition (operator):** merge PR #242 (`statenour/de-venice-residue`) first. WP-0 mops up what #242 left.
- **Files (residual, NOT touched by #242):**
  - `apps/statenour/DEPLOY.md:88` — remove `VENICE_API_KEY · Venice AI default provider`.
  - `apps/statenour/.env.example:45–47,51–52,170–171` — fix provider-chain comment, drop `AI_PROVIDER="venice"` example + `VENICE_MODEL`/`VENICE_FAST_MODEL`, update the image-cost comment.
  - `apps/statenour/next.config.ts:122` — remove `https://api.venice.ai` from `connect-src` **only after** confirming no live code calls Venice (grep `venice.ai`).
  - Confirm/remove dead Venice surfaces: `app/api/ai/venice-status/route.ts`, `components/chat/use-venice-health.ts`, `scripts/probe-venice-*.{ts,mjs}`. If a component is unrendered, delete; if still wired, rewire to the generic provider-health path.
- **Decision needed first:** Is Venice *fully retired* or still a dormant fallback? Read the post-#242 `provider.ts`. If retired → remove all surfaces. If dormant → keep the env key but stop calling it "default" anywhere. **Resolve this before editing — it changes the whole WP.**
- **Drift guard:** extend the existing `tests/meta/stale-docs-gate.test.ts` (added by #242) with an allowlist test that fails if `venice`/`VENICE` appears outside `{ historical docs/, CHANGELOG, this allowlist }`. This is the durable fix — it prevents the report's #5 from ever recurring.
- **Verify:** `pnpm typecheck && pnpm test && pnpm lint`; grep `-ri venice apps/statenour --glob '!docs/archive/**'` returns only allowlisted hits.
- **Rollback:** docs/test-only + dead-code deletion → `git revert` the PR. Zero runtime risk if Venice confirmed dead.

### WP-1 — AI provider single-source-of-truth registry `[branch: statenour/provider-registry]`
**Wisdom rank: Operational reliability.** Build on the post-#242 `provider.ts`.

- **Goal:** one machine-readable registry → generate env docs, system health labels, task-routing order, and a CI contract test. No more provider truth in comments/env guesses.
- **Files:** new `apps/statenour/config/ai-providers.ts` (the report's `ProviderConfig` shape is a good start — adapt to the real task kinds in `lib/ai/`). Refactor `lib/ai/provider.ts` + `lib/ai/provider-health.ts` + `lib/settings/ai-config.ts` to read from it. New `tests/ai/provider-registry.test.ts` asserting (a) only supported runtime providers exist, (b) no retired-provider strings, (c) every `envKey` referenced exists in `lib/env.ts`.
- **Caution:** `provider.ts` was just rewritten by #242 — rebase on merged main, read it fresh, keep the same fallback/circuit-breaker behavior. This is a refactor behind a passing test, not a rewrite.
- **Verify:** `pnpm verify:hard`; confirm `/system/provider-health` still renders the same providers.
- **Rollback:** registry is additive; revert the refactor commit, keep the registry file dormant.

### WP-2 — Decompose `next.config.ts` `[branch: statenour/next-config-split]`
**Wisdom rank: Long-term maintainability.** High-blast-radius file → reduce blast radius + make redirects testable.

- **Files:** extract `config/route-aliases.ts` (the redirect matrix) and `config/security-headers.ts` (header/CSP builder). Thin `next.config.ts` imports them.
- **Must-keep guards (regression tests in `tests/config/route-aliases.test.ts`):**
  - No duplicate redirect `source`s.
  - **`/system/tools` and `/system/proactive-preview` are NOT redirected to `/system`** — they were explicitly un-shadowed (see `next.config.ts:196–217`). A test must protect that or the next cleanup re-buries them.
- **Also fix the Vercel→Railway comment drift** (L15,22,31): the runtime is Railway/standalone; comments still say "Vercel production deploys use default `.next`." Correct them.
- **`ignoreBuildErrors`:** keep for now (the gkehub barrel crash is real). Add a one-line TODO + a tracking note in the decision log to revisit when `googleapis` ships the fix, or to switch to per-API subpath imports (`googleapis/build/src/apis/<api>`) to drop the barrel and re-enable the gate. **Do not silently flip it off** — the build will break.
- **Verify:** `pnpm build:local` (Windows uses `.next-prod`, `output` is win32-gated to `undefined`, so local build ≠ Railway runtime — also confirm CI green on the PR); redirect tests pass.
- **Rollback:** pure refactor; revert the PR restores the monolith.

### WP-3 — Split `.env.example` `[branch: statenour/env-catalog-split]`
**Wisdom rank: Data/auth/security safety + clarity.**

- **Goal:** section `.env.example` into `# CORE (required)`, `# OPTIONAL INTEGRATIONS`, `# LOCAL-ONLY`, `# DEPRECATED` (or split files). Removes secret sprawl + onboarding mistakes.
- **Files:** `apps/statenour/.env.example`; if `lib/env.ts` validation references keys, keep them in sync.
- **Fold in:** the Venice removals from WP-0 and the Vercel-comment fixes (L27,34,126,188).
- **Verify:** `pnpm env-check` (or the repo's env validator) passes; no live `.env` key dropped.
- **Rollback:** docs-only; revert.

### WP-4 — CodeQL + secret scanning `[branch: chore/codeql]`
**Wisdom rank: Security.**

- **Add** `.github/workflows/codeql.yml` (languages: `javascript-typescript`, on push/PR to main + weekly schedule). **Do NOT add Dependabot — it already exists** (`.github/dependabot.yml`).
- **Operator action (repo settings, not a file):** enable GitHub secret scanning + push protection. Note in decision log; Antigravity can't toggle settings.
- **Verify:** CodeQL workflow runs green on the PR (expect findings to triage, not block initially).
- **Rollback:** delete the workflow file.

### WP-5 — CSP hardening `[branch: statenour/csp-tighten]`
**Wisdom rank: Security (defense-in-depth).** Higher risk — stage it.

- **Step 1 (safe):** shrink `connect-src` to actual runtime origins; remove `api.venice.ai` (after WP-0). Keep Ollama/OpenAI/Anthropic/VAPI/`wss:`.
- **Step 2 (investigate, separate commit):** nonce-based `script-src` via middleware to drop `'unsafe-inline'`/`'unsafe-eval'`. Next.js inline-style needs `style-src 'unsafe-inline'` — keep + document. R3F/Three may need `'wasm-unsafe-eval'` rather than full `unsafe-eval` — test the 3D scene after.
- **Verify:** load `/`, `/chat`, `/brain` (3D), `/system/*` in a real browser; **zero CSP violations in console**. This is the make-or-break check — a too-tight CSP white-screens the app.
- **Rollback:** CSP is one string in `config/security-headers.ts` (post-WP-2); revert restores the permissive policy instantly. **Ship Step 1 and Step 2 as separate PRs** so a CSP regression rolls back without losing the connect-src cleanup.

### WP-6 — statenour measurability `[branch: statenour/perf-telemetry]`
**Wisdom rank: Reliability/measurability.**

- **Reality the report missed:** statenour is **auth-walled + robots-blocked + single-operator**. Lab Lighthouse against prod needs a session → unreliable. So **field web-vitals (real operator device) is the primary signal**, lab Lighthouse secondary.
- **Primary:** add `web-vitals/attribution` client beacon → new `app/api/analytics/web-vitals/route.ts` (owner-auth, store p75 LCP/INP/CLS per route). Surface on `/system` or `/system/health`.
- **Secondary (optional):** a statenour Lighthouse job only if an authenticated LHCI run is feasible; otherwise skip rather than ship a perpetually-failing job.
- **Verify:** trigger a navigation, confirm a beacon row lands; dashboard renders p75s.
- **Rollback:** additive route + component; revert.

### WP-7 — Prisma model governance (NON-destructive first) `[branch: statenour/schema-governance]` — **operator-gated**
**Wisdom rank: Maintainability. DATABASE-ARCHITECT lens: access patterns first, backups before destructive moves.**

- **Do NOT delete/merge models yet.** Start with a **model-ownership + naming-rules doc** (`docs/architecture/DATA-MODEL-GOVERNANCE.md`): group the 101 models by domain, name an owner surface, mark retirement candidates, define a naming convention + a retirement process.
- **The `BrainMemory.category` sprawl** (acknowledged in `docs/DATA-MODEL.md`): propose an enum/normalization **as a reversible migration** via `statenour-migration` (back up first; never `--accept-data-loss`).
- **Check** `prisma migrate status` for the registered-but-unapplied migration the report flagged; reconcile per the migration skill.
- **Verify:** `prisma validate`; if a migration runs, verify pgvector row counts before/after.
- **Rollback:** doc-only phase has none; any migration ships with a written reversal.

### WP-8 — IA "Critical Few" + product analytics `[branch: statenour/ia-analytics]` — **operator-gated, needs buy-in**
**Wisdom rank: Execution clarity — but biggest judgment call. Do not execute autonomously.**

- Coordinates with the **in-flight IA reorg (PR #213, Phases 0–2 landed; P3–P5 deferred)** — read `apps/statenour/docs/audits/IA-REORG-{DESIGN,CONTEXT}.md` first; **do not collide** with that work or the `.worktrees/statenour-ui` branch.
- Event taxonomy (`lib/analytics/events.ts`) + a thin provider (PostHog *or* a local table — operator chooses; PostHog adds a vendor/SDK to an auth-walled private OS, weigh that). KPIs: capture→triage→action→complete, chat-assist rate, time-to-first-action.
- **Bring 2–3 options to the operator before building.** This is product direction, not a repair.

---

## 4. Explicitly OUT OF SCOPE (do not do)

- ❌ Add Dependabot — it exists.
- ❌ Replatform off Railway / move to Vercel / Kubernetes — keep Railway + standalone Docker.
- ❌ Split statenour into its own repo — keep the monorepo.
- ❌ Flip `ignoreBuildErrors` off without fixing the googleapis barrel first — breaks the build.
- ❌ Delete/merge Prisma models or run destructive migrations without operator sign-off + backup.
- ❌ Autonomously redesign the home screen / IA — gated on operator + coordinate with PR #213.
- ❌ Touch files owned by `.worktrees/de-venice-residue` or `.worktrees/statenour-ui`.

## 5. Decision-log stub (paste into `docs/operations/11-DECISION-LOG.md` per WP)

```markdown
## Decision: [WP-N title]
- Date: 2026-06-__
- Context: Statenour deep-research report (verified) — [drift / config / security / perf] remediation
- Assumptions: [Known]/[Likely]/[Unknown]/[Risky] ...
- Options considered: ...
- Chosen move: [what shipped]
- Why this is wise: collapses [truth X] to one source + CI guard / reduces blast radius / measurable
- Risks: ...
- Reversal plan: revert PR #__ ([docs-only | refactor-behind-tests | additive])
- Review date: 2026-07-__
- Result: [after review]
```

## 6. Quick verify reference (statenour, from `apps/statenour/`)

```
pnpm typecheck        # tsc --noEmit (the real type gate; next-build gate is bypassed)
pnpm lint
pnpm test             # read the summary line — piping to tail masks exit code
pnpm verify:hard      # full gate before any PR
pnpm build:local      # Windows: .next-prod; output is win32-gated → local ≠ Railway runtime
```

**First concrete action:** operator merges PR #242, then Antigravity starts **WP-0** on `statenour/de-venice-residual`.
