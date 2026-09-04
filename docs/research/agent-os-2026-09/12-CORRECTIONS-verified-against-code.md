# Corrections — research claims disproven by reading the code (2026-09-03)

The research tracks in this directory were written from primary sources about the *ecosystem*.
When those claims were checked against **this codebase and this live database**, several were wrong.
This file is the correction record. **Where this file disagrees with tracks 01–11, this file wins.**

The pattern is worth naming: every error below is the same shape — *"the ecosystem commonly lacks X,
therefore this codebase lacks X."* That is an inference about the world presented as a fact about the
repo. The repo was consistently **better** than the research assumed.

---

## C-1. SSRF: "you have none" — WRONG
**Track 03 claimed:** *"egress allowlist for any URL-fetching tool — this is your SSRF control and
you have none."*

**Reality — verified by reading `lib/utils/url-safety.ts`, `lib/ai/tools/*.ts`, `lib/integrations/*`:**
| Control | Status |
|---|---|
| `assertPublicUrl()` | **exists** — blocks private/link-local/metadata ranges |
| `fetchPublicUrl()` | **exists** — re-asserts the gate at **EVERY redirect hop**, max 5, with loop detection |
| Redirect-bypass gap | **already found and fixed** by a 2026-09-02 deep-research audit (C-6). Its own docstring explains the attack: *"a public URL that answers 302 → http://169.254.169.254/ walks straight through the gate it just passed."* |
| Firecrawl sink | gated (`lib/integrations/firecrawl.ts:89`) |
| `ingestDocumentFromUrl` | gated, walks the redirect chain by hand |
| Telegram link handler | gated via `fetchPublicUrl` |
| `fetchVideoTranscript` | **positive host allowlist** (`youtube.com`/`youtu.be`, https-only) + `execFile` (no shell) — *stronger* than a blocklist |
| `browser_navigate` | targets a **remote cloud browser session**, not this network |
| Remaining `fetch()` in tools | all `${base}/api/...` — same-origin internal, no model-supplied host |

**Verdict: the SSRF posture is good, and the per-hop re-assertion is better than most production
systems.** No action needed. My audit heuristic missed it because the gates live in the *delegates*,
not the tool bodies.

---

## C-2. Cost controls: "none" — PARTIALLY WRONG
**Track 09 (E2) claimed** a cost kill switch was entirely absent.

**Reality:**
| Control | Status |
|---|---|
| Per-run step ceilings | **EXISTS** — `stepCountIs(3)` in the reasoning engine, `MAX_STEPS_CAP` in `browse-and-do.ts`, `stepCountIs` in `stream-with-fallback.ts` |
| Cost measurement | **EXISTS** — `estimateCostUsd()`, `costUsd` on `AiResponse` (`provider.ts:1354`) |
| `kill_switch` flag | **EXISTS** — `lib/services/runner-state.ts:47`, but scoped to the **autonomous runner**, not LLM spend |
| **Spend enforcement** | **GENUINELY MISSING** — cost is measured, nothing halts on breach |

**UPDATE 2026-09-03, later the same session — the corrected claim was ALSO wrong.**
Spend enforcement exists, two layers deep. I found it only after going to build it:

| Layer | Where |
|---|---|
| Daily budget resolution | `lib/services/cost-slo.ts:51` `resolveDailyAiBudgetCents()` |
| Today's burn | `computeTodayBurn()`, over `AiGeneration.costCents` (already indexed on `(feature, createdAt)` and `(model, createdAt)`) |
| Over-budget check | `isOverBudget()` |
| Burn-rate forecast + trip | `computeBurnRateForecast()`, trips at forecast > budget x 1.2 |
| **Pre-flight enforcement** | **`lib/ai/chat/gate.ts:147` — `checkAiBudget(0)`; `if (!budget.allowed)` BLOCKS the turn** |
| **Downstream hard cap** | **`lib/ai/budget.ts` — `assertWithinBudget()`, `BudgetExceededError`, 60s cached status** |
| Monitoring | cron `app/api/cron/cost-slo-check` + `components/ultron/observability/cost-slo-tile.tsx` + `tests/services/cost-slo.test.ts` |

The gate even handles its own failure correctly — a budget-read error is **logged rather than
silently swallowed**, with a comment explaining that a swallowed read must never disable enforcement.

**Final verdict on C-2: there is no cost-control gap. The original finding was wrong, and my first
correction of it was also wrong.** Both errors came from grepping for the words I expected
(`maxBudgetUsd`, `spendCap`, `killSwitch`) instead of for the *concept*. The real implementation
calls it `checkAiBudget` / `assertWithinBudget` / `cost-slo`. **Vocabulary mismatch is not absence.**

---

## C-3. `VectorEmbedding` HNSW index: "audit it, likely missing" — WRONG
**Track 06 flagged** the classic silent-sequential-scan risk (Prisma does not manage indexes on
`Unsupported` columns).

**Reality — read from live prod `pg_indexes`:** both HNSW indexes exist, with partial predicates:
```
vector_embeddings_embedding_vec_hnsw       USING hnsw (embedding_vec vector_cosine_ops)      WHERE embedding_vec IS NOT NULL
vector_embeddings_embedding_vec_1536_hnsw  USING hnsw (embedding_vec_1536 vector_cosine_ops) WHERE embedding_vec_1536 IS NOT NULL
```
**No action needed.**

---

## C-4. `pg_search` / Neon's 2026-09-21 removal — DOES NOT APPLY
**Track 06 flagged** this as *"the single most urgent item"* (18 days out at the time).

**Reality:** `app/api/people/search/route.ts` computes BM25 with **core Postgres** —
`ts_rank_cd(to_tsvector(...), plainto_tsquery(...))`. The variable is *named* `bm25_score`, which is
what the grep matched. **The `pg_search` extension is not used anywhere.** Neon's removal is a no-op
for this repo. **No action needed.**

*(Real but minor improvement still available: that route blends BM25 and cosine with a fixed
`0.4/0.6` weighting. RRF — `Σ 1/(k + rank)`, k=60 — fuses on **rank position** and so avoids
normalizing BM25's unbounded range against cosine's. ~15 lines. Not urgent.)*

---

## C-5. Inngest determinism: "audit 101 step.run sites" — CLEAN
**Track 07 called this** *"the highest-value hour available on this stack."*

**Reality:** the naive probe (`Date.now()` outside `step.run`) produces **false positives**. In
`approval-sweeper.ts`, `now`/`ageFloor`/`staleTime` are computed outside a step but consumed **only
inside** it — Inngest memoizes by step ID, so on replay the closure never re-executes and the
recomputed values are never used. Harmless.

The pattern that actually breaks is **fresh nondeterminism gating which steps run**, because that
changes the step *sequence* across replay. Probed for exactly that across all
`lib/inngest/functions/*.ts`: **0 hazards.**

Two edge cases checked by hand and both correct:
- `task-due-reminder.ts` — `sleepUntil(due)` where `due` comes from the **event payload**, which
  Inngest replays identically.
- `social-publish.ts` — `sleep-poll-${attempts}` where `attempts` is a deterministic loop counter
  gated on a memoized step result.

**Verdict: the codebase is already disciplined here. No action needed.**

---

## C-6. Native dialogs in the iOS PWA — CLEAN
Zero live `window.confirm/alert/prompt` **calls**. Every grep hit is a comment explaining why the
in-DOM two-tap pattern is used instead. The CI AST gate (`adoption-gates.yml`, since 2026-08-27)
covers both PWAs' client trees.

---

## C-7. License traps — CLEAN
- **tldraw** (proprietary, license-key enforcement in code, watermark on free tier): **not present**
- **npm `xlsx`** (frozen 2022-03-24, prototype-pollution/ReDoS): **not present**
- `exceljs@4.4.0` **is** present and ~3 years stale (last release 2023-10-19) — real but low severity
- Root `AGENTS.md` **already exists** — the "one file unlocks 8 coding agents" item was already done

---

## C-8. ⚠️ Ollama Cloud — the one place the research found something REAL and NEW
This is the exception: research that was correct and that the codebase had not accounted for.

**Verified from `docs.ollama.com` (2026-09-03):**
1. **Structured outputs are NOT supported on Ollama Cloud**, and the constraint is dropped
   **silently** — no 400, no warning. Verbatim from the docs: *"Ollama's Cloud currently does not
   support structured outputs."* Maintainer said "coming soon" on 2025-12-10; still open, last
   activity 2026-07-19.
   → **Does NOT bite this repo.** Grepped `generateObject`, `streamObject`, `Output.object`,
   `experimental_output` across `lib/` and `app/`: **zero call sites.**
2. **`tool_choice` is NOT in Ollama's OpenAI-compat supported-field list**, and is absent from the
   native `/api/chat` OpenAPI schema entirely.
   → **This one matters.** `build-stream-config.ts` runs a whole toolChoice ladder (step-0 action
   force, `runPython` pin, `arsenalWebSearch` pin, last-step clamp to `"none"`), sent
   **unconditionally with no provider guard**, and Ollama is prod primary.

**But the repo carries a counter-receipt**, `build-stream-config.ts:273`:
> *"deepseek-v4-pro honors strict tool_choice via Ollama's OpenAI-compat endpoint (probed live)."*

That was true on 2026-07-15. **`deepseek-v4-pro` has since been retired upstream** (recorded DEAD in
`ai-providers.ts`), and the current pin has never been re-probed. So the honest position is
**unknown, not broken** — a stale receipt, which is the same drift the comment two lines above it
warns about.

**Action taken:** rather than assume either way, `markForcedTool()` now records
`forcedToolName` / `forcedToolHonored` / `provider` / `modelId` per turn. A run of
`forcedToolHonored=false` is the smoking gun; an empty run is the all-clear.

**Also confirmed real and unaddressed:** Ollama Cloud retires models roughly monthly (17 retired in
one 2026-07-15 batch). A hardcoded model id **will** break on a vendor schedule. The repo already
learned this twice — the code comments record both incidents.

---

## C-9. Disaster recovery — CONFIRMED, and FIXED
The one severe finding that held up under verification.

**Measured from the live Neon project:** `history_retention_seconds: 21600` = **exactly 6 hours**,
and `get_snapshot_schedule` returned **`{"schedule": []}`** — no backups configured at all.

**Fixed the same session**, using Neon's native scheduled snapshots rather than a `pg_dump` pipeline:
daily @ 08:00 UTC (30-day retention) + weekly (35-day), plus an immediate baseline snapshot
`snap-silent-mouse-am71c9mi`. Verified by read-back — `set_snapshot_schedule` returns `null` on
success, which is exactly the silent-success shape that makes read-back mandatory.

**Still open:** a *restore drill*. A backup that has never been restored has an unknown success rate.

---

## C-10. The pattern, stated plainly
Four of the ten items here were "this repo is missing X" and **all four were wrong**: SSRF, cost
controls (twice), the HNSW index, `pg_search` urgency. Two more (`tldraw`/`xlsx`, Inngest hazards)
were "this repo probably has a problem" and also wrong.

The research was accurate about the *ecosystem* and wrong about the *repo* in the same direction
every time: **it underestimated what was already built.** A codebase with 103 models, 696 test files
and 20+ verify gates has usually already solved the obvious thing — and it has solved it under a
name you did not grep for.

## Method note for the next session
The research tracks are still valuable — the ecosystem facts, licenses, benchmarks and dates in them
were checked against primary sources and held up. **What did not hold up was every inference from
"the ecosystem" to "this repo."**

Rule for next time: an ecosystem finding is a **hypothesis about the codebase**, never a finding.
Grep first, read the delegate second, check prod third — then write the claim.
