# CURRENT-TRUTH.md — Statenour

> **The one-screen answer to "where am I and what's real?"** If any other doc
> contradicts this file as a *present-tense instruction*, this file and live
> code win. Last verified **2026-08-16**. When in doubt, **verify in code, git,
> the DB, or logs** — not in prose.

## Since 2026-07-20 (verified 2026-07-28 — headline deltas)

- **Inngest fleet repaired + drift-proofed**: ~16 scheduled functions were unregistered (briefing_log had NEVER filled); re-synced, then boot-time self-sync (now verifying `res.ok` + response shape), a heartbeat self-row, and a worker-scheduled out-of-band liveness check were added. Definitive per-capability proof = the artifacts themselves (briefing_log row, drain counts), not invocation.
- **Post-turn outbox**: frozen payload before deferred work; drain replays orphans — now including rows stranded at `processing` (stale-claim reclaim), honoring `nextAttemptAt`, with loud enqueue/finish failures.
- **Loud-failure phase 2**: 29 defect-hiding silent catches converted (write-losses, content parses, watchdog heartbeats).
- **Suite truth**: 390 files / 4,419 passed / exit 0 — the "passes but exits 1" era is over; a non-zero exit is real.
- **verify:hard** gained auth-scan (check:get-auth) and a dependency gate that can actually fail (CRITICALs).
- **Home** simplified around four questions; canonical chat consolidation landed. Follow-up dismissals are DURABLE — `agendaDismissFollowUp` writes to `agenda_items` (`lib/trpc/routers/operator.ts`) and `components/home/follow-ups-list.tsx` reads it; the localStorage era is over. (This line previously said the opposite, two lines above the evening-waves entry that records the fix.)

- **Evening waves (same day):** durable Home agenda (FOLLOW_UP in agenda_items; localStorage dismissals dead) · memory commit gateway observing in SHADOW (review ~08-04) · alerts have resolve/mute lifecycle · chat command console (control sheet, authority strip, Context & Evidence, typed tool cards) · `getFleetTruth`/`getTopDecisions`/`fetchVideoTranscript` chat tools · execute-before-prose split (attempt-tense + receipt-backed completion messages) · intelligence_outcomes ledger live on Neon with two producers · /system/fleet + /system/chat-states pages · PR #1152 engine-lock wrapper merged.

## Since 2026-08-16 — knowledge/intelligence: three severed joints, not missing capability

- **★★★ `/knowledge` is RETIRED and now redirects to `/brain`.** Its loader
  resolved `process.cwd()/../..` to a NOUR-OS vault layout that stopped existing
  at the monorepo import, so it rendered ZERO files in prod and locally, always,
  with no test coverage. Deleted with `lib/mastery/knowledge.ts`, the 3 tRPC
  procedures, `lib/ai/knowledge-compiler.ts` and `scripts/refresh-digest.ts`.
  `KnowledgeRefreshPanel` is UNRELATED and survived — it moved to `/system/crons`
  and is still the only manual trigger for the ingest fan-out + prompt-cache flush.
- **★★★ The outcome ledger had zero deciders.** `recordDecision`/`recordOutcome`
  had NO callers anywhere, so `decision` was NULL on every IntelligenceOutcome row
  and `outcomesNeedingReview()` always returned empty — that is why the recall-eval
  corpus never grew, and why `scripts/data-census.ts` records "corrections: 0/200".
  Not low volume: a missing writer. `recordDecisionByContent()` joins on the
  indexed `contentHash`; wired on nudge dismissal and the new Discover verdicts.
- **★★★ Gateway Phase-2 is LIVE BY DEFAULT** — kill-switch
  `NICK_MEMORY_GATEWAY_PHASE2=0`. ★ It was flipped on by explicit operator
  instruction ("we can take the risk"), NOT by the 7-day shadow review that
  graduated Phase-1 — accepted risk, not measured safety. If writes look
  wrong, throw the kill-switch FIRST, then run
  `scripts/probe-gateway-agrees.ts`. Honors `update` (content, no bump) and
  `review_required` ONLY for `reasonCode: "weaker_evidence"`. `unknown_category`
  still falls through on purpose — it is the larger slice of the 349/wk, and
  parking it would freeze whole categories of automation writes.
- **★★ Recall renders PROVENANCE, not a confidence percentage.**
  `[category · you stated · seen 4x]` replaced `[category] (NN%)`. ★ An
  unrecognized source renders **"unclassified", never "unverified"** — the
  first cut said "unverified" and the ladder matches operator sources by EXACT
  equality, so `source: "operator"` and the operator's own `pin:chat` rows
  would have been announced to the model as untrusted. That percentage
  was never certainty: confidence is `0.5 + 0.1 × (sightings − 1)`, i.e. the
  sighting count restated. Labels come from the commit gateway's evidence ladder —
  one vocabulary, not a fourth taxonomy.
- **★★★ Confidence is a FREQUENCY COUNT and recall sorted by it** — so surprise,
  being low-frequency, structurally lost every ranking contest. `NICK_NOVELTY_RECALL`
  (**LIVE by default**, kill-switch `=0`; also operator-authorized without an
  eval win) adds a 0.95–1.18 novelty term AFTER
  the reranker, because rerank overwrites `hybrid` for the top 25 and discards
  every post-fusion multiplier — `importanceMultiplier` still has that hole.
- **`research_claim_candidate` is NOW actually quarantined from chat recall.**
  Two comments claimed it for months; `RECALL_EXCLUDE_CATEGORIES` never contained
  it, and candidates mint at confidence 0.3 against recall's `gte: 0.3` floor —
  passing exactly, not narrowly. Pinned by `tests/brain/recall-quarantine.test.ts`.
- **"source_supported" means cosine ≥ 0.75 against OUR OWN MEMORY, not source
  verification.** The stored enum is unchanged (indexed column, 2 exact-literal
  query filters; a rename needs a prod backfill + ALTER DEFAULT and fails SILENTLY
  if code ships first). `describeGroundingStatus()` tells the truth at the only
  boundary where the value reaches a human or a model. Real thresholds are
  **0.75 / 0.55** — `docs/research-lab.md` said 0.80, and a false-green test
  re-implemented that wrong number inline instead of importing the module.
- **New surfaces:** `/brain` → **Discover** (the four nightly creative categories,
  ordered by recency, each labelled INFERRED/SPECULATIVE, with
  investigate / already-knew / noise verdicts that write the ledger) and ONE Home
  contradiction slot that renders `null` on measured zero and deep-links to the
  EXISTING resolution panel. The ticker's contradiction item now carries
  `?resolve=<key>` — the receiving panel had always read it; only the sender was missing.

## Since 2026-08-16 — chat quality: it was a token budget, not the model

- **`maxOutputTokens` was truncating every substantive answer.** Standard mode
  allowed **2000**; the pinned THINKING model (`minimax-m3`) needs **3000-3600**
  completion tokens to finish one. Measured, 12 calls
  (`scripts/probe-empty-responses.ts`): the 8 that completed used 3013-3611; 4 hit
  `finish_reason="length"`, one returning a 500-char fragment and one returning
  **content=0 with completion_tokens=4000** — a full budget generated, none
  delivered. Now **6000 standard / 10000 deep** (#1590).
- **`provider.garbage ... chars=0` means BUDGET EXHAUSTION, not a dead upstream.**
  `completion_tokens=4000` on an empty response proves the model generated a full
  budget. Check `finish_reason` + `completion_tokens` before concluding anything
  about an empty response.
- **The client stall abort is the ONLY deadline in the system** — `maxDuration` is
  inert on Railway, the server has none — and its clock starts at SUBMIT. It is
  now **180s** (was 90s), because it is coupled to the token ceiling above: at
  13.2 ms/token measured, 6000 tokens = 79s mean / 97s worst and 10000 = 132s /
  161s, both past 90s before the ~40k system prompt and tool round-trips (#1591).
  The extreme deep tail can still reach 180s.
- **Chat had no failover.** Prod: `provider.all_failed tried=["ollama"]` with FIVE
  provider keys configured and idle — `TASK_ROUTING_PREFERENCES` keeps openrouter
  2nd "so a cooldown never dead-ends a turn", and the cost firewall filters the
  very list the failover loop iterates. Last-resort rescue tail added, **OFF by
  default**, `NICK_FAILOVER_RESCUE=1` (#1589; operator enabled it 2026-08-15).
- **The chat permission picker was FAKE and is gone.** `draft` and `execute` were
  the same code path — `"execute"` never appears server-side as a permission
  value; only `=== "read"` branches. "Draft only — nothing runs" was false.
  Server-side read-mode enforcement (`stripMutatingTools`) is untouched and still
  covered by `tests/security/agentic-redteam.test.ts`.
- **Web search runs on Tavily alone.** `searxng-perplexica` returns ZERO healthy
  responses (116 CAPTCHA across duckduckgo/wikipedia/startpage/brave/google-cse);
  `perplexica` returns ZERO completed searches (`400 invalid_request_error` —
  **not** a retired model id; `gpt-oss:120b` is alive). The primary cap is now 6s
  with a 3-miss/10-min breaker (was a hardcoded 30s tax on every search).
- **Model pins: `minimax-m3` is correct.** With the de-confounded bake-off it is
  the only model in the catalog that **reframes**. `deepseek-v4-pro` is DEAD
  (retired upstream mid-session), `kimi-k3` is HTTP 402 (outside the flat plan),
  `deepseek-v3.1:671b` is long gone (410) — **do not recommend it**.
- **REFUTED, do not re-propose:** wrong model pinned · tool overload (the pruner
  caps exposure at 24, `NICK_TOOL_BUDGET`) · prompt/context bloat
  (`PROMPT-AB-2026-08-12`+`12b` — incumbent 4 / compact 3, below the
  pre-registered ≥3 lead → abandoned as noise) · stale pin · persona stance
  (`PERSONA-AB-2026-08-16-clean`: A=3.50 / B=3.08, lead −0.42, inside ±0.75 on
  both runs → abandoned per its frozen pre-registration).

## Since 2026-08-14 — Nick media workspace + VideoDB (BDN-301..321)

- **★★★ The VideoDB client had NEVER worked.** Four bugs, all found by live probe (BDN-321): paths are SINGULAR (`/collection`, `/video`, `/index` — the plural forms 404); every response is enveloped `{data, success}` and the client read the top level; upload is a THREE-STEP PRESIGNED flow (`GET upload_url` → `POST` bytes → `POST /upload {url}`), not a multipart POST (which 500s); and **VideoDB signals refusal INSIDE HTTP 200** (`{"success":false,"error_code":"low_credit"}` — `res.ok` is true). Corroboration: the collection holds ZERO videos, so audio-drop-to-chat has been dead since v10.0.349. `assertVideoDbSuccess()` now checks `success===false` in one place before unwrap.
- **★★★ BLOCKED, NOT ON CODE: the VideoDB account balance is $0.00.** Video attach and transcripts cannot work until credit exists. The "50 free uploads" the client's error hint advertises are not available on this account. Probes: `scripts/probe-videodb-transcript.ts` (read-only) · `scripts/probe-videodb-upload.ts` (writes — operator-authorized only).
- **`getTranscript` was discarding every timing the API returns** (BDN-318). It read `json.transcript ?? json.text` — `transcript` is not even a key this endpoint returns — and threw away `word_timestamps`. Now returns `{ text, segments, segmentsUnavailable }`, sentence-segmented. This is what made clickable transcripts / chapters look like a backend limitation; it was ours.
- **Media workspace shipped (8 items)**: universal file-part renderer with URL-scheme gating · persistent dock (native `<video>`, no player dependency) · clickable timestamp seek with a token-based `requestSeek` · media-as-evidence adapter over the incumbent `claims.ts` · composer accepts audio + PDFs with one shared intake gate for picker/paste/drop (video routes to the upload lane, never base64) · desktop focus panel + transcript pane · explicit save-a-moment to BrainMemory (never automatic) · UI-token integrity guard.
- **Persona work (BDN-301/302)**: `CONFIDENCE_CUES` split into `ESTIMATIVE_LIKELIHOOD` (ODNI seven-point scale) + `ANALYTIC_CONFIDENCE`; the old rule stays exported but is NO LONGER INJECTED. Per-lane persona census over stored `reply_judgment` rows. Verbalized-Sampling SPAR variant behind `NICK_SPAR_VS` (default off).
- **BDN-307 prompt trim REFUTED by measurement**, not deferred: Layer 1 is 13,274 chars / ~3,319 tokens against a 40,000-char guard. `scripts/measure-static-layer.ts` measures it offline (the live `measure-prompt-size.ts` is gated as a prod lane).
- **BDN-310 memory supersession: APPLIED to prod Neon 2026-08-14** via `prisma migrate deploy`. `brain_memories` now carries `valid_from` / `valid_until` / `last_verified_at` / `superseded_by_id`, the self-FK (`ON DELETE SET NULL`), and three indexes. Verified after apply: 4/4 columns, FK and all 3 indexes present · **25,381 rows unchanged** · **pgvector still installed** · `migrate status` = "Database schema is up to date!". ★ The first draft of that migration targeted `"BrainMemory"` — the Prisma model carries `@@map("brain_memories")`, so every statement would have FAILED against prod. A read-only preflight (`scripts/probe-bdn310-preflight.ts`) caught it before any DDL ran. No code reads the new columns yet; the schema is ahead of the app on purpose.
- **Unwired instruments (self-audit, honest status):** `summarizePersonaByLane` and `summarizeEstimativeCompliance` have no in-app caller; `scripts/report-nick-instruments.ts` is the read-only runner. `toEvidenceRef` / `canSupportAlone` / `reopenTargetFromKey` have NO caller outside tests — media does not actually mint evidence yet, despite the PR wording. `taskClass` has no producer anywhere, so the census refuses to call an all-unknown comparison comparable.

## Where this runs

- **App location:** `apps/statenour/` inside the monorepo **`nourdean22/MAINnicks-tire-autoNEW`**.
- **Production deploy:** branch **`main`** → **Railway** (service `statenour-web`) → **https://bdnick.info**. Pushing `main` auto-deploys via per-service watch paths.
- **Companion app:** `apps/nickstire/` (Railway → nickstire.org) — a separate ring; see `docs/REPO-MAP.md`.

## Retired — do NOT treat as current (these are the landmines)

- **Vercel** — **retired** for Statenour production. There is no `vercel.json` crons block; scheduled jobs run via the Inngest mega fan-out.
- `codex/ollama-local` and `statenour-master` branches — **retired**. Never push there; never claim either is the production branch.
- Standalone `nourdean22/statenour-os` repo — **retired** for production. Statenour now lives only in the monorepo above. (As of 2026-07-25 the repo still exists on GitHub and is NOT yet archived there; `config/repos.ts` marks it `stale` pending the actual archive flag.)
- Local path `C:\Users\nourd\NOUR-OS` — **retired**. Canonical checkout is `C:\Users\nourd\NOURCITY`.
- `scripts/pre-push-check.sh` — **retired** Vercel-era artifact (references the retired branches). It is NOT the active hook; the active hook is the repo-root `lefthook.yml` `pre-push` (turbo build --affected); Husky is not used.

## Source-of-truth hierarchy (highest first)

1. `apps/statenour/AGENTS.md` — where we are, how we work, active backlog.
2. `apps/statenour/docs/RECONCILIATION.md` — verified ship-by-ship log (top entry = latest).
3. `apps/statenour/docs/RUNBOOK.md` — operational procedures.
4. `apps/statenour/docs/REPO-MAP.md` — cross-ring repo layout.
5. `apps/statenour/docs/AGENT-CONTRACT.md` — AI agent contract.
6. `apps/statenour/config/repos.ts` — typed repo manifest (mirrors REPO-MAP).
7. `apps/statenour/config/crons.ts` — typed cron manifest (single source; `pnpm check:crons`).
8. **Live code, tests, scripts, git history** — beats any doc on a factual conflict.
9. Archived docs (`docs/archive/**`) — **historical context only, never active instructions.**

## Truth lives in code, not prose (don't hardcode these in docs)

- **Provider / model:** read `lib/ai/provider.ts` (the `AI_PROVIDER` env selects `ollama`|`gemini`|`openai`|`anthropic`; model ids are env-driven) and `lib/ai/domain-routing.ts`. Do **not** assert a model name (e.g. a specific Venice/GLM/Ollama model) as "current" in prose — it drifts; point to the file.
- **Crons:** `config/crons.ts` is the manifest; `pnpm check:crons` verifies it against the filesystem and the Inngest fan-out (`lib/inngest/jobs.ts`).
- **Repos:** `config/repos.ts` + `docs/REPO-MAP.md`.
- **Tailwind colour utilities:** this app is **Tailwind v4** (no `tailwind.config`; `postcss.config.mjs` + `@import "tailwindcss"`). A colour utility exists **only** if its token is registered in the `@theme inline` bridge in `app/styles/tokens.css`. A bare `--primary:` custom property in `:root` does **not** create `bg-primary` — the class silently emits **zero CSS**, with no error, no warning and no visual clue. This shipped: the full shadcn palette was authored in `:root` but never bridged, so `bg-primary` / `border-border` / `text-muted-foreground` were dead app-wide, and the weekly-recurrence weekday picker rendered its selected state identically to unselected — the operator reported the buttons as broken when the click handler was fine (#972/#973, 2026-07-20). All 18 used tokens are now bridged and pinned by `__tests__/theme-token-utilities.test.ts`. **Before styling with a new colour token, check the bridge — do not assume a `:root` variable is enough.**
- **Migrations:** column-first, hand-applied. See `docs/DB-MIGRATION-POLICY.md`, the schema sentinel (`lib/db/schema-sentinel.ts`), and the migration `scripts/`. A migration is "applied to prod" only when run via the guarded `apply-pending-migration` endpoint **and** verified (`prisma migrate status`) — never claim applied otherwise. Never `--accept-data-loss` (drops pgvector/tsvector).

## Active vs historical docs

- **Active:** `AGENTS.md`, `CURRENT-TRUTH.md` (this file), `docs/RECONCILIATION.md`, `docs/RUNBOOK.md`, `docs/REPO-MAP.md`, `docs/AGENT-CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/runbooks/**`. There is **no** separate "active plan" doc — `RECONCILIATION.md` (ship log) + `AGENTS.md` (backlog) are the live sources; a plan doc that stops being reconciled is historical (see below).
- **Historical (do not paste into agents as current):** `docs/archive/**`, `docs/project/V10-PLAN.md` (v10 control-layer plan, last reconciled 2026-05-08 — HISTORICAL per audit #22), `docs/project/MASTER-CONTEXT.md` (v7-alpha, quarantined), `docs/project/UPGRADE-PLAN.md` (v8.x, quarantined), `docs/UPGRADE-PLAN-V6.md`, dated snapshots (`cohort-*`, `state-of-autonicks-*`, `session-handoff-*`), `adr/*`, `audits/*`.

## Stale-doc guard

`pnpm check:stale-docs` scans active (non-archive) docs + agent-facing files for retired deploy/provider terms used as current instructions. Critical terms (Vercel-as-prod, the retired branches, the standalone repo URL, the retired local path) hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn. A line is exempt if it contains a safe-context word: `historical`, `retired`, `archived`, `do-not-execute`, `obsolete`, `not current`. **Never paste an archived doc into an agent as current context** — quote `CURRENT-TRUTH.md` or live code instead.

## See also

- `docs/runbooks/index.md` — agent operating runbooks (how to work safely here). Guard: `pnpm check:runbooks`.
- `lib/evals/` + `pnpm eval:memory` — the truth scoreboard that checks Nick remembers this file.
- `lib/ai/receipts/action-receipt.ts` — the action-honesty receipt contract (`canClaimDone`).
- `lib/knowledge/action-converter.ts` — knowledge→action suggestions (suggestion-only).
