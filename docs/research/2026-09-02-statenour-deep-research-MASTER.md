# StateNour / bdnick.info — Deep-Research Program · MASTER REPORT

**Date:** 2026-09-02 · **Program:** front-to-back product, AI, tooling and architecture research, plus the remediation of every defect the program verified.
**Pinned to:** `origin/main @ abdd99395` (= production commit `abdd993`, deployed 13:23Z) for all research; fixes branch from `c13b8fbdb`.
**Method:** 16 read-only research agents over a `git archive` snapshot, plus live unauthenticated probes, plus rendered-UI capture in the operator's signed-in browser. Full agent reports (13,280 lines) are listed in §12.
**Supersedes:** `2026-09-02-statenour-deep-research-INTERIM.md`.

Evidence classes used throughout: **A** verified current code (pinned SHA) · **B** verified rendered UI · **C** verified runtime/live probe · **D** first-party dated doc · **H** inference · **I** unknown / not verified. No numeric confidence anywhere, by house rule.

---

## 1. The answer, in six sentences

StateNour is a genuinely unusual product: an honest, deterministic attention compiler sitting on top of an AI system whose safety architecture is better designed than most production systems and **is not connected to the path the product actually runs on**. The 29-capability registry, the approval gate and the guardian wrapper — the controls two prior audits credited — govern a legacy text-block action parser, while the 181 tools the operator actually talks to are handed straight to the model with no gate call anywhere in their implementations. The memory system has the mirror-image gap: its commit gateway arbitrates re-writes but returns "add" unconditionally for any claim it has not seen before, so a new AI inference becomes canonical, recallable personal fact with no human step. Those two facts explain what the operator sees every morning: a Home screen whose lead recommendation has been "17 approvals are parked waiting on you, oldest 201h" while every historical approval in the system was closed by an auto-purge rather than by him, a judgment queue of AI-authored commitments to accept, and roughly 200 machine-written memories a day. The product's problem is therefore not ranking, not UI, and not model choice — it is **provenance and obligation hygiene**, and it is fixable without a rewrite. Seven defects verified during this program were fixed and are in this branch; the two largest are architectural and are specified here rather than rushed.

---

## 2. Source of truth (Phase 0)

| Fact | Value | Class |
|---|---|---|
| Repository / app | `nourdean22/MAINnicks-tire-autoNEW` · `apps/statenour` (`@statenour/web`) | A |
| Research ref | `origin/main @ abdd99395fb6aad898e2a6fcb043871dc4b321de` | A |
| Production at research time | `/api/version` → `abdd993`, started 13:23:44Z, `configured: database ai telegram langfuse sentry cron = true` | C |
| Deploy | Railway `statenour-web` → https://bdnick.info; `main` auto-deploys | D |
| Scale | 36 live page routes, ~380 API routes, 32 tRPC routers, ~64.8k LOC in app/components/features/lib/hooks, 674 test files | A |
| Data | `schema.prisma` **103 models / 31 enums** (the widely-repeated "~120/27" is wrong), 52 hand-applied migrations | A |
| AI surface | 181 catalog tools · 29-entry capability registry · 77-entry cron manifest over 55 cron routes + 26 Inngest functions | A |
| Landed the same morning | Langfuse tracing on all 22 AI SDK call sites (#2073), Sentry SDK (#2074), docs (#2075) — by a Codex session, not this program | A |

### 2.1 Live unauthenticated posture (C)
All pages 307 to sign-in. `/api/version` public by design. `/api/actions/openapi` public, 19 KB, disclosing the full Custom-GPT command surface — deliberate, since ChatGPT's import flow needs it, and execution still requires a Bearer token. CSP is nonce + `strict-dynamic`; HSTS, DENY framing, nosniff and a restrictive Permissions-Policy all present; `x-powered-by` exposed. Service worker v10 caches only content-hashed assets, never HTML or API responses.

---

## 3. The two findings that reframe everything

### 3.1 The tool gate is not on the live path (A, verified directly by this session)

The prior audit reported "7 external-mutation tools, 0 ungated" and explicitly listed as **not verified** whether all ~181 chat tools dispatch through `checkApprovalGate`. They do not.

```
grep -rn 'withGuardian|evaluateToolAction|checkApprovalGate' lib/ai/tools/   → 0 matches (18 files)
grep -rn 'checkApprovalGate' lib/ app/ (excluding tests)                     → 3 lines, all one call site
                                                                                lib/ai/nick-agent.ts:147
```

`app/api/ai/chat/prepare-tools.ts` hands the pruned `nourTools` object straight to the AI SDK. The capability registry is consulted only by `nick-agent.ts`, a pre-tool-calling text-block action parser that `augment-final-prompt.ts` teaches to the model **only on the Anthropic provider branch** — and the base chat lane is Ollama. So on an ordinary turn, the audited gate is not merely bypassed; it is not present.

Three independent "hold for approval" implementations exist: the registry gate (nick-agent path), a self-implemented `ActionReceipt` + Telegram approve/decline flow (customer SMS only), and nothing at all for the remaining tools. Of 181 catalog tools, an implementation-level read puts **57 at write-or-external**; two have a real gate.

**Consequence.** Every claim of the form "Nick cannot do X without approval" needs re-derivation. The blast-radius argument that made the 2026-09-01 prompt-injection finding merely medium-high rested on this gate.

### 3.2 The memory gateway never gates a first write (A)

`lib/brain/memory-commit-gateway.ts:162-169` returns `{decision:"add"}` unconditionally when no row exists for a `(category, key)` pair. The gateway is a **re-write arbiter**, not an admission control. Any brand-new AI-inferred claim — any source, any evidence class — is written and immediately recallable as canonical fact.

The coverage is also narrower than it appears: ~55 call sites go through `brainMemory.remember()`, while 71 direct `prisma.brainMemory.create()` and 80 direct `.upsert()` sites across ~110 files write around it entirely, with no category validation, no evidence ladder, no shadow receipt. Every `remember()` also writes a second `memory_gateway_shadow` row, which inflates the raw write count the operator sees.

Confidence on those rows is `0.5 + 0.1 × (sightings − 1)` — a frequency proxy, not a calibrated probability — and the code's own comment records that 73% of recent single-sighting rows do not even follow that formula because several writers stamp confidence directly.

---

## 4. The bottleneck (Phase 2), and the evidence for it

Captured 2026-09-02 07:39 EDT in the operator's signed-in browser (class B; my page views themselves wrote page-visit rows and advanced the since-last-visit cursor):

| Surface | What it said | What it means |
|---|---|---|
| Home state line | "System degraded — 17 silent crons · 20 devices offline" | The 20 devices have been offline since 2026-04-14 (`app/api/devices/retire-stale/route.ts:8` records the cause: the local agent died); the operator chose to skip. A permanent amber dot carries no information. |
| Home lead | "DECISIONS ARE BLOCKING THE SYSTEM — 17 approvals parked, oldest 201h" | The decide arm owns the lead whenever the approval queue is non-empty. All 485 historically decided `autonomous_actions` rows were closed by auto-purge; zero by the operator. |
| Judgment queue | 31 items; visible ones are AI-authored COMMITMENTs to ACCEPT | Sole producer is `lib/brain/journal-brain.ts:487`, an LLM-extracted "next action" from journal text. ACCEPT flips status to active and does nothing else — no task, no notification. |
| Change line | "202 memory writes" in ~20 hours | Machine-authored memory dominates the corpus that recall draws from. |
| Bottom ticker | "BRAIN ⚠ patience horizon 20 — you're committing to same-week deadlines" (1 of 12) | Coaching inference rendered in the persistent alert channel that also carries priority alerts. |
| Missions next move | "Fix basement bathroom ceiling · untouched 47d · roi 25 → 33" · "today: 0 chosen · 0 min" | Correct behaviour on a stale board: the deck is honest that nothing is chosen today. |
| Missions readiness | "HEALTH DATA IS 71 DAYS OLD — READINESS UNKNOWN" | Honest, and identical every day for ten weeks. |
| Chat empty state | "Find the biggest revenue leaks — Leads, estimates, callbacks" | Shop operations offered as a primary prompt on the personal OS. |

**The constraint is not the compiler. It is what the compiler is being fed.** `lib/home/operator-brief.ts` is one of the better-written files in the repo: every source guarded, failed reads named as unmeasured rather than zeroed, an attention cap of 7 enforced in the builder and shipped as a receipt, and an explicit refusal to invent a confidence percentage. It faithfully compiles a queue the system produced for itself and the operator never works.

**The next constraint after this one** is retrieval quality over a smaller, human-weighted corpus. Today that is measured only by `docs/RETRIEVAL-BASELINE-2026-08-27.md` (hit@5 went 0% → 50% → 86% in one week), and that baseline is the only number any retrieval proposal should be argued against.

---

## 5. What was fixed in this program (shipped on this branch)

Seven verified defects. Every one has a test that was pointed at the unfixed code and observed to fail — 17 of 20 assertions red in the first canary, exactly 2 of 10 in the second, exactly 4 in the third — with positive controls proving the tests were not passing vacuously.

| ID | Defect | Fix |
|---|---|---|
| C-1 | `GET /api/integrations` paginated the raw model, shipping the Google **refresh token** (stored cleartext in `Integration.config`) to the browser. Owner-gated, but a long-lived credential in an HTTP body reaches devtools, HARs and client-side error reporters — and Sentry went live that morning. | Scoped select; `hasConfig` + `configKeys` (key names, never values) keep the row useful. No consumer existed. |
| C-2 | `assertPublicUrl()` was applied at 2 of 6 callers reaching the Firecrawl scrape; `deep-research`, `intelligence/ingest`, `change-detection` and `competitor-watch` passed model- or row-derived URLs unchecked. | Gate moved into the sink, so a seventh caller inherits it. Typed, non-retryable refusal. |
| C-3 | `logError()` wrote caller-supplied `extra` verbatim into the persisted `ErrorLog.context` across ~107 call sites while the other logging path redacted by key name. | One shared redactor; `redactSensitive` exported rather than duplicated. |
| C-4 | Deleting a chat conversation had **no confirmation of any kind** — one tap destroyed the thread and its history. Rename, two buttons away, already used a dialog. | Same in-DOM primitive (window.confirm is silently swallowed in the installed iOS PWA). Archive stays one-tap: it is reversible. |
| C-5 | `proposeCalendarEvent` writes to the operator's real Google Calendar yet was catalogued `personal_read` + `battle: true`, evading all three read-mode tripwires because "propose" is not a mutating verb prefix. Read-only sessions could create real events. | Reclassified `personal_write` + `sideEffecting`; a ledger test pins the tools whose implementations were read and confirmed to write. |
| C-6 | The Telegram link handler checked the URL once then fetched with `redirect: "follow"` — a public URL answering 302 to cloud metadata walked through the gate it had just passed. `ingestDocumentFromUrl` had been hardened against this exact bypass and the fix never propagated. | Shared `fetchPublicUrl()` re-asserts on every hop, with loop and hop-cap detection. |
| C-7 | The Stripe signature check parsed `t=`, folded it into the signed payload, and never compared it to the clock — a captured request stayed valid forever, under a comment claiming to match the standard protocol. | Stripe's documented 300s tolerance, rejected symmetrically for future and non-numeric values. |

Also deleted: four AI brief routes with zero callers anywhere in the monorepo (`home-brief`, `scoreboard-brief`, `goals-brief`, `chat-openers`), verified against code, docs and the GPT Actions surface, and independently corroborated by two agents.

---

## 6. Two security claims this program REFUTED

Recorded because acting on either would have caused an unnecessary production change, and because the prior audit measured its own mechanical detectors wrong about one time in three.

1. **"Two Critical unauthenticated Next.js RCEs published 2026-08-25, fixed in 16.3.3+."** Both cited GHSA identifiers return HTTP 404 from GitHub's advisory API. Querying the advisory database directly for advisories affecting the `next` npm package returns nine, all published 2026-07-22, **all patched at exactly 16.2.11** — the version installed and deployed. There is no August advisory affecting `next`. A framework upgrade on this basis would have been churn. (Separately: Next 16 does still honour a root `middleware.ts`; it is deprecated in favour of a Node-runtime `proxy.ts`, with an official codemod and no removal version committed. Worth a planned migration, not an incident.)
2. **"js-yaml is pinned at the vulnerable 5.2.0."** The declared pin is 5.2.0, but the repo root carries a pnpm override — `"js-yaml@>=5.0.0 <5.2.2": ">=5.2.2"` — which is precisely the mitigation for GHSA-pm4m-ph32-ghv5. The lockfile and the installed tree both resolve 5.2.2. The repo had already handled this deliberately.

---

## 7. The target architecture

### 7.1 Product thesis
StateNour is the operator's **evidence-and-judgment layer**: it observes what happened, records where each belief came from, keeps what Nour authored separate from what Nick inferred, surfaces only what genuinely needs his judgment, executes reversibly, asks before anything consequential, and stays quiet otherwise. Everything below serves that sentence, and anything that does not is a candidate for deletion.

### 7.2 The five architectural moves, in dependency order

**M1 — One gate on the live path.** Wrap the tool object handed to the AI SDK so every tool call passes `evaluateToolAction` before executing, and make the capability registry cover the catalog rather than a 29-entry subset. Ship it in shadow mode first: log what *would* have been gated for a week, then enforce. This is the single change that makes every existing safety claim true. *Do not* start by writing 152 registry entries by hand — derive the default from the catalog's own `sideEffecting`/category metadata (now trustworthy for the one tool this program found lying) and require an explicit entry only where the default is wrong.

**M2 — Admission control on memory.** Make the commit gateway decide first writes, not just re-writes. Split the corpus by origin: operator-authored evidence (journal, chat statements, pins, corrections) and externally-sourced records with provenance are `memory`; cron and model inferences are `inference` rows carrying `valid_until`, excluded from recall by default and promotable by the operator. The supersession columns applied 2026-08-14 already provide the schema. Route the ~150 direct `create`/`upsert` sites through the gateway or explicitly exempt them in a shrink-only allowlist.

**M3 — Obligation hygiene.** Every machine-generated judgment item gets a TTL, a per-day cap and a visible "proposed by Nick" label distinct from operator-authored items: proposals expire in 72 hours, approvals auto-decline with a receipt after 7 days and never auto-approve. Home's decide arm should fire only on **operator- or externally-originated** decisions — an email needing a reply, a real invoice, a person's promise — never on Nick's own proposals. This is what takes Home off its permanent "17 approvals" lead.

**M4 — Silence as a default.** Split the one alert channel three ways: incidents to System, judgment to Home, inferences to Brain's Discover surface behind an opt-in. Retire dead devices from the health denominator and give each of the 17 silent crons a verdict — run it, kill it, or delete it from the manifest. A permanently amber dot is not a signal.

**M5 — The boundary as a contract, not a multiplier.** Today the scorer dampens BUSINESS tasks ×0.7 and the Chat empty state offers revenue-leak analysis. Replace both with a typed crossing: `JudgmentItem.origin = "shop-escalation"`, produced only by the nickstire bridge, carrying the owner decision, commitment, exception, risk or authorization that justifies crossing. Then delete the shop-operational tools and prompts from StateNour. `findCustomer` — full customer-360 with spend and visit history on a personal-OS chat — is the clearest violation; `/system/camera` ("Operational cameras on shop WiFi") is the clearest surface.

### 7.3 What should be deleted
The 13 parked components (3D island, actions/loops island, `operator/compound-chain`, four Ultron HQ) unless an owner names a re-mount date. `ArsenalLog` (self-documented dead). The nine schema-orphaned shop enums left behind when lead persistence moved to nickstire. The dead `app/manifest.ts`, shadowed by a static `public/manifest.webmanifest` that wins — the live manifest is not the one in code. The unused `hooks/use-offline-queue.ts`, which is fully built and tested with zero production consumers. `cron-healer`'s second, uncapped destructive sweep, which duplicates `data-cleanup` and writes its completion row under the wrong actor.

### 7.4 What should NOT be built
No policy engine, no durable-execution replacement, no CRDT layer, no new vector or graph database, no confidence percentage anywhere, no additional connectors before the existing ones are measured live, no retrieval re-architecture except against the measured 86% hit@5 baseline. Of the memory platforms surveyed, Graphiti and Cognee require a new graph database, Letta and Cognee are Python-cored, and two named injection-defense libraries (LLM Guard, Rebuff) are archived by their own maintainers. The one prompt-injection technique worth adopting is datamarking (arXiv:2403.14720), which is roughly a hundred lines and no dependency.

---

## 8. Roadmap

**P0 — merged in this branch.** C-1 through C-7 above.

**P0 — next, and specified but deliberately not rushed here.** M1 (one gate on the live path, shadow-first) and M2 (memory admission control). Both change what the running product does on every turn; both deserve their own branch, their own canary, and an operator decision about the shadow window.

**P1.** M3 obligation hygiene · M4 alert-channel split and the silent-cron verdicts · the `/system/health` backlog headline that folds a failed read into `?? 0` under a comment explaining why that is wrong · the `data-source-probes` route returning `ok: true` unconditionally with the probe history swallowed by `.catch(() => [])` · the orphaned `pauseAllCrons` global kill switch with no UI caller · the second approval queue (`AutonomousAction`) whose count feeds the PWA badge while no page can resolve it.

**P2.** M5 boundary contract · retire the RPG character-sheet as a ranking input (`buildNextMove` derives Home's "weakest axis" from a 30-stat sheet whose keys include "seduction", "combat" and "faith") · reconcile the two unlinked commitment concepts (`Task.loopKind=PROMISE` and the `Commitment` model) · the five models carrying `deletedAt` that are absent from `SOFT_DELETE_MODELS` · dependency majors (AI SDK 6→7, MCP SDK 1→2, Prisma client/adapter major skew).

**P3.** Polling reduction on the daily surfaces (derived from code: Home ≈4–5 requests/min, Missions ≈8) · `middleware.ts` → `proxy.ts` migration · MCP spec 2026-07-28 alignment (elicitation redesigned, tasks moved to an extension, protocol now stateless).

### First seven days
1. Land this branch and re-probe the three fixed live behaviours.
2. Build M1 in shadow mode; read the log after a week rather than guessing.
3. Give each of the 17 silent crons a verdict, and retire the dead device fleet from the health denominator.
4. Decide the observability egress classification: Langfuse now exports prompt and completion content for every non-private turn, and the AI SDK's `recordInputs`/`recordOutputs` default to on. That is a data-classification decision, and it should be a test, not a habit.

---

## 9. Ledgers

### 9.1 Contradictions found
Home's doctrine says it renders nothing when it has nothing true to say; the live product always has a lead because the decide arm fires on Nick's own proposals. The Missions deck comment says "Home compiles THE brief" while five brief generators still exist server-side, three with no confirmed UI caller. `CURRENT-TRUTH.md` said supersession columns had no readers; `contradiction-cleanup.ts` now stamps them unconditionally. A plan document edited at 08:31 says Sentry has no SDK in the app; the SDK landed at 08:59 the same morning. `NEXT-WAVE-2026-07-29.md` claims surfaces were deleted that two later waves delete again.

### 9.2 Unknown / unmeasured
Every runtime behaviour of an authenticated mutating control — none was exercised, by design. Which provider actually serves a live production turn. Whether any Langfuse trace or Sentry event has yet landed with real content (the integration's own doc records zero traces at deploy time). All performance numbers: no `web-vitals` anywhere and Sentry's trace sample rate is 0, so LCP, INP, CLS and bundle sizes are unmeasured. Row counts for every table. The exact composition of the 202 daily memory writes. Whether the `/api/cron/mega` scheduler is a Railway cron configured outside this repo or the flag-gated Inngest path.

### 9.3 Instrument errors this program caught in itself
Two subagent security claims refuted against authoritative sources (§6). One assertion of mine about guardian retry counts was wrong: `GuardianError.attempts` is the constant `maxRetries + 1`, never a measurement, so it can never falsify a retry claim — the test now asserts the classification instead, and the misleading field is recorded here rather than quietly worked around.

---

## 10. What is genuinely strong and must survive any rework

`lib/home/operator-brief.ts` and its doctrine. The Execution Deck's single-read model and freshness-bounded readiness. The action-language contract that forbids completion tense before a receipt exists, plus its claim detector. `nav-items.ts` as the one IA source for three nav surfaces. `route-policy.ts` and the middleware-subject test that replaced a canary testing the wrong subject. `verify-crons.ts`'s bidirectional manifest gate. The UI mount-graph gate with a shrink-only PARKED list. `lib/observability/otel-export.ts`, whose two independent privacy layers throw rather than silently drop an unrecognised key. The `agent-bridge` Bearer-scope model, which exposes a curated 35 tools to MCP rather than all 181 and audits every call and denial. The honest empty states that say "State unknown, not empty."

---

## 11. The smallest coherent end state

Six destinations, not sixteen. **Home** compiles attention from measured state and operator-originated obligations. **Chat** is the reasoning and command surface, with one gate on its tool path. **Execute** is the deck. **Journal** is evidence, kept separate from what the model inferred from it. **Brain** is the trust system: every belief answers where it came from, when it was true, whether a human said it or a model guessed it, and how to correct it. **System** is the cockpit, where unknown never renders as healthy. People, Stats, Pins, Content, Market, Learn, Links and Photo Improver are projections, tabs or deletions — not destinations. The measure of success is not that Nour uses it more; it is that on a normal day it says almost nothing, and the little it says is worth stopping for.

---

## 12. Appendices — the underlying research

All 16 agent reports, 13,280 lines / 1.5 MB, are committed alongside this one in
[`docs/research/2026-09-02-deep-research/`](./2026-09-02-deep-research/):

| Report | Covers |
|---|---|
| `00-ledger` | Orchestrator evidence ledger and live probes |
| `01a-pages-core` | Home · Chat · Missions · Journal · Stats · global overlays |
| `01b-pages-rest` | Brain · People · Settings · System (17 surfaces) · 12 more pages |
| `02-chat-pipeline` | The full chat turn, hop by hop, with the prompt-block table |
| `03-tools-mcp-actions` | All 181 tools · MCP · GPT Actions · local-agent · Telegram |
| `04-brain-memory` | Capture → recall → correction → deletion, as a trust system |
| `05-jobs-matrix` | 77 manifest crons + 26 Inngest functions, with blast-radius guards |
| `06-connectors` | Every integration: auth, token storage, egress, failure mode |
| `07-security-threat-model` | Assets, actors, boundaries, 14 numbered sections |
| `08-data-model-ontology` | 103 models, 31 enums, overlap clusters, target ontology |
| `09-prompts-models` | Model-call census, prompt inventory, routing, evals |
| `10-pwa-perf-a11y-observability` | iOS PWA, derived polling rates, WCAG 2.2, observability |
| `11-lineage-digest` | Wave timeline and the do-not-re-propose register |
| `12-platform-currency` | Dependency and advisory verification (see §6 for two refutations) |
| `13-oss-frontier` | 18 categories of OSS candidates with adopt/reject verdicts |
| `14-hci-benchmarks` | HCI evidence graded ROBUST/PLAUSIBLE/SPECULATIVE, product mechanisms |
| `15-standards-platform-data` | Standards versions, iOS PWA capability table, lawful data sources |

Read them for evidence; read this file for decisions. Where they disagree with this
report, this report states which one it followed and why.
