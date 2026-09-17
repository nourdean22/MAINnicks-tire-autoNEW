# Session ledger — statenour

## Session C (overnight capability hardening) — branch `statenour/overnight-capability-hardening`

**MISSION:** make StateNour materially more useful/reliable/measurable. Choose the highest-leverage
move continuously; fix foundations before layering intelligence.

**BASELINE (measured, not assumed):** origin/main `a4d0f14b8` was **RED** — 843 files, 4 failed
tests in 2 files, `exit=1`. Now **844 files / 8,467 tests, exit 0**.

**COMPLETED + PROVEN**
- `f1ac75990` — suite red→green. Two causes, both "a test that cannot fail for its stated reason":
  (a) obsidian probe used an absolute Windows path as an `import()` specifier — Node reads `C:` as a
  URL scheme; `.split("\\").join("/")` fixed separators, not the scheme. `pathToFileURL` is correct
  on both platforms. The failing arm was the file's own POSITIVE CONTROL, so it could not
  discriminate shimmed from unshimmed. (b) `brain-engines-smoke` mocks only `@/lib/prisma` and calls
  its subjects "100% DB-dominated"; `findTeachingMoments` reaches the **nickstire bridge over HTTP**
  (`recentShopJobs`/`recentShopLeads` → `queryNick`), so its verdict depended on network
  reachability — green in CI, red where the bridge answers. Mutation-verified non-vacuous.
- `57f6ddbc1` — `compareActionDoneShadow` now has a production call site. It shipped with tests and
  ZERO callers, so `legacyStrictGap` had never been observed. Extracted to
  `lib/ai/receipts/action-done-shadow-recorder.ts` (injectable → testable; its only caller is a
  ~700-line untested function). Writes `action.done.shadow` to `system_metrics` with the
  disagreement CLASSES. 7 tests, mutation-verified.

- `<browser slice>` — **browser capability was UNREACHABLE from chat and is now reachable.**
  MEASURED from the census (first read since #2359 unblinded it): in **467 turns the browser was
  used ZERO times**. Both BROWSERBASE creds PRESENT, 6 tools built; `browser_navigate/act/observe/
  extract` all in `neverSurfaced`, `browseAndDo` surfaced 9/467 (1.9%) and chosen 0. An episode
  against the real `pruneTools` surfaced NO browser tool for six unambiguous prompts in either
  mode ("go to monro.com…", a literal URL, "log into…"). Cause, both in `chat-mode.ts:285`:
  (a) the trigger wanted "scrape"/"automate the browser"/"browser act" — not how anyone speaks;
  (b) `/browser_/` **cannot match `browseAndDo`**, the entry point meta.ts:298 says to PREFER, so
  even on a hit it offered the surgical tools and skipped the recommended one. Fixed with a
  natural-intent trigger + a high-level/low-level split (4 surgical tools now cost slots only when
  named). All 6 prompts now surface `browseAndDo, browser_do`.
- ★★ **The census's other headline: 8.4 of every turn's 24 tool slots go to a tool NEVER ONCE
  CHOSEN** — 3,911 wasted slot-impressions / 101 tools / 467 turns. Worst: `getMasteryScores` (57%
  of turns), `getHabitRevenueCorrelation` (50%), `findCustomer` (49%), `getCommitments` (49%),
  `createCommitment` (48%). NOT acted on — pruning needs a per-tool judgement, and "zero calls" has
  five different diagnoses. This is the best-evidenced backlog item in the app.
- ★ `createMissionPlan`: 150 surfaces, 4 calls, **25% success** — a real quality defect invisible to
  the `highFailure` bucket, which needs ≥10 calls. `getRepoMap`: 1 call, 0% ok.

- `<rewrite-queue slice>` — **the description-rewrite cron was drafting against an EMPTY queue.**
  It filters `totalCalls >= 10 && success < 60%` (the `highFailure` bucket) — measured at **0**. So
  it ran nightly and produced nothing, while the bucket the census itself calls "the actionable
  prune list" held 101 tools costing 8.4 slots/turn. A never-called tool has no telemetry row, so
  `getToolStats` structurally could not see it. Added a second evidence kind
  (`surfaced_never_chosen`) with its OWN prompt — there are no errors to learn from, so it asks for
  discriminative clarity and explicitly allows "this tool is redundant" as a valid answer.
  Failures draft first; never-chosen fills the remainder, so the original queue cannot be starved.
  Still DRAFT-ONLY (human carries it into code). Dry-run against prod: would draft
  `getMasteryScores` (266/467 = 57%), `getHabitRevenueCorrelation` (50%), `findCustomer` (49%).
  ★ `getMasteryScores`'s description is **33 chars** ("Get current mastery domain scores") — no
  hint of when to use it, shown in 57% of turns, never chosen. Hypothesis well-supported.
  ⚠ PROVEN: selection (10 tests + prod dry run). NOT EXERCISED: the LLM draft + upsert, which
  would spend tokens and write prod rows — not authorised here.

- `<gate-calibration slice>` — **the evidence-gate promotion decision is now computable.**
  AGENTS.md §4 L6 defers enforcement "once the shadow false-positive rate is known". Verdicts have
  been persisted at `tokenUsage.evidenceGate` since 2026-09-10 and **nothing read them** — no
  `build*`, no digest procedure, no panel. Added
  `lib/observability/evidence-gate-calibration.ts` + `system.evidenceGateCalibration`.
  ⚠⚠ **I got this measurement WRONG first and the module encodes the fix.** A naive pass over ALL
  verdicts gave 36.9% would-block with a sample full of itinerary/advice FPs — but
  `isResourceTitle()` (5 rules targeting exactly those) shipped in `8ee86eb3b` at **2026-09-16
  08:56**, and most of that sample predates it. The number measured the FIX'S ABSENCE.
  Live readout now: before-fix 91 turns / 37.4% / named_claim 21 · after-fix 12 turns /
  **rate WITHHELD** / named_claim 1, fact_check 3. Three rules: cohort at the last precision
  change · state NO rate below n=40 · split by driver (named vs fact-check vs **length**, which is
  not an evidence signal at all). 15 tests.
  ★ Residual post-fix FP: `"TEE and Manny"` — two people's names in conversation still trip the
  named-claim rule. ★ The dominant blocker CHANGED: fact-check, not named claims.
  **DO NOT PROMOTE YET — n=12.** Re-read the readout once ~40 turns accumulate.

- `<reachability guard>` — ★★ **the browser was one instance of a CLASS.** A sweep of 8
  capabilities against the real selector found **3 with no plain-language path at all**:
  `searchSkills`, `solveMath`, `getCameraIntelligence` — none credential-gated in the catalog, so
  all unreachable BY ACCIDENT. Deliberately NOT blanket-fixed: surfacing a capability that returns
  nothing is worse than leaving it dark (`solveMath` is plausibly redundant — the never-chosen
  rewrite queue will now draft exactly that verdict; `getCameraIntelligence` is pre-G3 with no live
  data; `searchSkills` is the best candidate IF the skills store has content — CHECK FIRST).
  Added a MUST_BE_REACHABLE table to `tests/ai/chat-mode-browser-reachability.test.ts`: a narrowed
  keyword family now fails at commit time instead of showing up in the census a month later.
- Removed the DEAD `canClaimDone` from `chat/action-result-verifier.ts` — zero callers anywhere,
  while its docstring said "Wired directly into the live chat-finalize loop". The live one is a
  DIFFERENT function of the same name in `receipts/action-receipt.ts`. Anyone hardening the honesty
  gate would have found the corpse first and shipped nothing.

- `<telemetry evidence>` — ★★★ **stored tool errors kept the INPUT and threw away the REASON.**
  `recordToolInvocation` did `errorMessage.slice(0, 200)` — a HEAD truncation. AI SDK validation
  errors are shaped `…Value: {big json}. Error message: <REASON>`, so the reason is at the TAIL and
  was always cut. Measured: all three `createMissionPlan` failures were EXACTLY 200 chars, each cut
  mid-payload — a tool known to fail 75% of the time and not one row said why.
  ⚠ It COMPOUNDS: `tool-description-rewrite.ts` feeds `lastErrors` to an LLM as failure evidence on
  the premise that one pass over recent failures fixes the description. Evidence with no reason
  cannot. The rewriter was reading input fragments and guessing. Fixed with head+tail
  (`condenseToolError`, 140+300, states how much was elided). 6 tests, mutation-verified.

- `<budget-cliff slice>` — ★★★ **the pruner truncated by ALPHABET, and that is the mechanism behind
  the 8.4-wasted-slots headline above.** Tier 4 ordered candidates with `Array.from(m).sort()`;
  `addIfSpace` stops at TOOL_BUDGET, so that order IS the selection policy past slot 24. Tier 5
  (semantic rank) is gated on `selectedNames.size < TOOL_BUDGET`, so it is skipped on exactly the
  turns that truncate. Measured over 192 turns / 5,227 gate decisions:
  **72.9% of turns hit the cliff · 70.3% skipped the semantic tier · tier-4 ALLOWED averaged
  first-letter index 5.28 ("f") vs BUDGETED_OUT 11.78 ("l") · 65.3% of tier-4 ALLOWED impressions
  went to NEVER-CHOSEN tools.** A 6.5-letter gap across 5,227 decisions is not relevance correlating
  with spelling. `searchWebVerified` cut 52x, `githubRecentCommits` 53x — and **5 of 13 recorded
  searchTools recoveries were for a web-search tool the keyword family HAD matched and truncation
  had dropped**, costing a whole extra generation step each time.
  Fixed with `orderKeywordCandidates` (pure, exported, 11 tests, mutation kills 5 of 11).
  ⚠ SCOPE DISCIPLINE: **ordering only — membership is asserted unchanged**, so no tool becomes
  reachable that a keyword family had not already matched; this cannot widen authority. Cold cache
  falls back to alphabetical rather than ranking on partial data.
  ★ Also populated `ToolGateDecision.rank`/`score`, which existed since the table shipped with **no
  producer** — the diagnosis above had to be reconstructed from first letters because of it.
  **NOT YET MEASURED IN PROD:** re-read the alphabetical skew after ~100 post-deploy turns; if the
  fix works the two means converge. That is the promotion evidence, and it does not exist yet.

- `<enum-legend slice>` — ★★ **a 2026-09-03 fix landed on 1 of SIX call sites, and only a mechanical
  sweep found the other five.** Prod `tool_telemetry`: `createTask` failed 7x because `effort` and
  `context` are CODE enums with no `.describe()` — the model answered `{"effort":"30 min"}`,
  `{"context":"Newsletter creation"}`, and twice put a whole task description / journal reflection
  in `context`. Fixed in `tasks.ts` on 2026-09-03 — **inline, in that one block**. `missions.ts`
  kept two byte-identical bare copies, so `createMissionPlan` was STILL failing two months later at
  4 calls / 1 ok (25%), stored failure `{"context":"Shop Operat…` — identical shape.
  ⚠ I started to re-fix `createTask` before reading its source and finding it ALREADY FIXED; its 7
  failures are historical (their own payloads carry July 2026 dueDates). Second near-miss of this
  kind this session — measuring a fix's ABSENCE and calling it a defect.
  Wrote `tests/ai/tool-enum-legends.test.ts`, which walks every AI-facing `inputSchema` via zod
  introspection. It immediately found THREE more I had not: `updateTask.loopKind`,
  `logSituation.context`, `scheduleFollowUp.effort`. Legends now live in ONE module
  (`lib/ai/tools/task-field-legends.ts`) — six copies of a string is *why* one fix reached one site.
  ★ `logSituation.context` is a DIFFERENT `context` (situation KIND, not location) — same field
  name, different vocabulary, one model. Now says so explicitly.
  ⚠⚠ **The sweep's shape-rule does NOT catch `context`** — its values (DESK/PHONE/SHOP/…) are plain
  English, so nothing looks cryptic. The defect was the misleading field NAME, not the vocabulary.
  Proven by mutation: dropping `contextField`'s describe leaves the opaque-code test GREEN and only
  the by-name rule red. Both rules are load-bearing; deleting either halves the file.
  ★ Rewrote `tool-example-validity.test.ts`'s createTask regression from a SOURCE-TEXT assertion to
  a built-schema one. It had coupled a claim about the schema to a fact about file layout and went
  red on a refactor that *extended* the property it names.
  Receipts: 212 files / 2,689 tests exit 0 · tsc exit 0 · contract-drift snapshot flagged exactly
  the 6 intended tools and nothing else.

- `<repair-lane slice>` — **a pruned-out tool is now recoverable; a hallucinated one still is not.**
  `buildRepairToolCall` shipped with ZERO direct tests and a docstring promising it only ever maps
  "to a tool that actually exists in the live set" — which was also its ceiling: steps 1 and 2 both
  require `target in toolSet`, so the pruner-dropped case (the larger half of the 6 measured
  "Model tried to call unavailable tool" failures) could never be rescued. Step 3 routes it through
  `invokeTool`, which IS on every turn. ★ The boundary cuts both ways and is tested both ways:
  `getRepoMap` (real, pruned) is rescued; **`getGoals` is NOT IN THE CATALOG AT ALL** — a
  hallucination, and repairing it would invent a capability.
  ★ Authority is deliberately NOT re-decided in the repair: `invokeTool` already enforces
  read-safety + circuit-breaker + operator `disabledTools`, and a second copy of that gate could
  drift from the one the approval flow depends on. A write tool routed there is refused BY NAME —
  strictly better than today's dead end, which teaches the model to say "I don't have that
  capability" when the tool exists and was merely unloaded (an L1-L6 fabrication, from the harness).
  11 tests, mutation kills 4 of 11 while the 7 boundary/preservation tests stay green.

- `<review-P1s slice>` — ★★★ **Codex review found TWO REAL P1s in my own shadow wiring, and both were
  the exact defect classes I spent this session hunting. Verified against source before acting.**
  (a) **The instrument could not report its own failure.** I injected `lib/services/metrics.ts`'s
  `recordMetric`, whose body ends `.catch(() => {})`. So the await could NEVER reject,
  `recordActionDoneShadow` always returned `"recorded"`, and the "NOT a silent catch" branch I wrote
  was DEAD CODE in prod. My test passed only because the injected mock rejected where the real
  dependency cannot — **a test agreeing with its own double.** Fix: `recordMetricStrict` returning a
  `MetricWriteReceipt`; `recordMetric` now delegates to it (ONE insert definition). ★ The deps type
  demands the receipt, so `Promise<void>` is **unassignable** — a fail-soft writer can never be
  wired to an instrument again without a COMPILE ERROR. A type where a comment would have been.
  (b) **The denominator excluded the exact case it was built to measure.** My call sat inside
  `if (actions.length > 0)`, so a completion claim with NO action block — the phantom
  ("Done — both profiles created", nothing attempted) — never recorded, while the module docstring
  claimed "a row for EVERY turn whose prose claimed completion". Fix: a zero-action arm passing
  `compareActionDoneShadow([], cleanedText)`. ⚠ SEPARATE call site, not a hoist: `withErrorCapture`
  is **not awaited**, so `results` does not exist yet — one hoisted call would race it.
  ⚠ The recorder tests could not have caught (b) — they test the recorder, which was always willing.
  Added an explicit WIRING guard (2 call expressions on COMMENT-STRIPPED source, per the repo's own
  remedy) and labelled it as a wiring guard, not a behaviour guard. Mutation: removing the
  zero-action arm reddens it; swallowing in `recordMetricStrict` reddens the propagation test.
  ★ `completion-authority` CI was failing SOLELY on these two unresolved threads — one root cause,
  three symptoms.

- `<instrument-failures slice>` — ★★★ **I applied my own enum-legend lesson to my own P1 fix and
  found THREE more siblings.** The review P1 was one instrument wired to the swallowing
  `recordMetric`; sweeping the class found `tool.surfaced` (THE census instrument — its comment read
  *"Fire-and-forget: recordMetric already swallows its own failures"*, the defect stated as a
  feature, double-swallowed with a `.catch(() => {})` on top), `operation.integrity_shadow`, and —
  found by the new wiring guard, not by reading — `recordToolInvocation`, the writer behind
  `tool_telemetry` (census invoked/high-failure buckets AND the `lastErrors` the rewrite cron reads).
  ⚠ These are HOT PATH and non-blocking by design, so "await strict everywhere" would trade a silent
  instrument for latency. Fix = keep fire-and-forget, change only the FAILURE CHANNEL:
  `logError(instrumentScope(name))` → persisted `errorLog` → `buildInstrumentFailures()` reader on
  `system.digest`, deliberately next to the census whose zeros it disambiguates.
  ★★ `getSelectionTelemetryHealth()` had ZERO callers and its own docstring claimed "the panel reads
  that". Worse than unread: the counters are **lambda-instance scoped**, so a tRPC query answers from
  a different instance and reads its own zeros — they *cannot* answer a cross-instance question, so
  no panel could ever have been wired correctly. errorLog persists; that is why the reader uses it.
  ⚠ HONESTY BOUND, stated in the payload: this detects instruments that FAILED, never ones that
  NEVER RAN. A deleted call site logs nothing and looks healthy — only a wiring test sees that.
  ⚠⚠ **A defect I introduced and a test caught:** first cut reached `instrumentScope` via
  `Promise.all([import(metrics), import(instrument-failures)])` — and `instrument-failures` imports
  prisma, so the chat hot path was loading the DB client for a STRING HELPER. Split into a
  prisma-free `instrument-scope.ts`. Symptom was a test whose fire-and-forget writes landed one `it`
  block late.
  ⚠⚠⚠ **`tool-telemetry-operation-state.test.ts` was passing on a LEAKED call**: `mock.calls[0]`
  read the PREVIOUS test's shadow write (both used `convId: "c1"`), so its `legacySdkSuccesses` /
  `operations` assertions had never checked the turn they name. Replaced with a `shadowCallFor(convId)`
  selector — order-independent, and 8x faster (1019ms → 128ms).
  ⚠ Two MORE hand-written partial `vi.mock`s of `@/lib/services/metrics` broke on the new export —
  4th and 5th this session. ★ `importOriginal()` spread is the usual cure but is WRONG here: the real
  metrics module imports prisma, so spreading made the hot-path test RACE. Kept synthetic+fast and
  covered the drift at SOURCE level via the wiring guard instead. **The cure has a cost; name it.**

**DELIBERATELY NOT DONE (scope discipline, not oversight)**
- **Do NOT merge tier 4 and tier 5 into one ranked pool yet.** It is the natural completion of the
  budget-cliff fix — rank keyword + semantic candidates together and take the top 24, which would
  also reach the ~35 `neverSurfaced` tools. But it changes tier PRIORITY semantics, and the tier-4
  ordering fix it builds on is NOT YET PROVEN IN PROD. Verification first.

**CORRECTIONS THIS SESSION (I was wrong, twice, and checked)**
- The recovery lane is NOT unreachable. `pruneTools` never offers `searchTools`/`invokeTool` (no
  CORE_TOOLS entry, no keyword family) — but `prepare-tools.ts:184-194` **re-attaches both
  unconditionally after pruning**. I probed the pruner alone and nearly filed a false finding.
  Prod confirms it works: **13/192 turns fired searchTools, 6 reached invokeTool.**
  Lesson: `pruneTools` is not the surfacing path; `prepareTools` is.
- `.remember/now.md` is BOTH: the `.remember/` **directory** matches a .gitignore rule, AND this
  file is already **tracked** (it is in `12802d7c1`). So `git status` shows it as modified and it
  commits normally, but a plain `git add <path>` is REFUSED and needs `-f`. `git check-ignore` on
  the file returns "not ignored", which is why an earlier note recorded only half of this.

**OPEN / NEXT (evidence in hand, not acted on)**
- `createMissionPlan` 150 surfaces / 4 calls / **25% ok**. Real cause now visible: the model sends
  free text where an enum is required (`context: "Shop Operations"` vs `DESK|PHONE|SHOP|CAR|HOME|
  ANYWHERE`) and one call sent `tasks: []`. The enum fields carry NO `.describe()` while
  `nextPhysicalAction` does. Below the rewrite cron's ≥10-call floor, so nothing else will surface
  it. Candidate fix: describe() the enums + consider `.catch(default)` so one bad enum does not
  lose the whole mission plan.
- ★★ **6 tools failed with "Model tried to call unavailable tool"** — `arsenal.webSearch`,
  `person.update`, `getGoals`, `memory.remember`, `getRepoMap`. Note the DOT NOTATION: the catalog
  is camelCase (`arsenalWebSearch`) but action-blocks use dots (`task.create`), so **two naming
  conventions coexist and the model mixes them**. One entry is a whole call expression plus a stray
  `</arg_value>` XML fragment stored AS the tool name — a tool-call parsing leak worth its own look.

**IMPORTANT DISCOVERIES**
- ★★ **"The full pruneTools() has a require()/path-alias issue in vitest" is STALE.**
  `tests/ai/chat-mode-keyword-families.test.ts` mirrors regexes by hand because of that claim, so
  its tests lock a COPY and cannot fail when the source narrows. `pruneTools` imports and runs
  cleanly in vitest (11 tests, 103ms) — `tests/ai/chat-mode-browser-reachability.test.ts` now
  asserts the REAL selector. Other families could be migrated the same way.
- ★★ **The primary checkout `C:\Users\nourd\NOURCITY` is on `statenour/nextjs-critical-rce-advisory`,
  160 commits BEHIND origin/main.** Reading source there is reading stale code — it cost me one wrong
  conclusion. Work from a worktree at origin/main. (The RCE fix itself IS on main: `next ^16.3.4`.)
- ★★ Two different functions are named `canClaimDone`. `receipts/action-receipt.ts` is WIRED (2 call
  sites). `chat/action-result-verifier.ts` has **zero callers** and its docstring still says "Wired
  directly into the live chat-finalize loop". Not dead — it wraps the shadow comparator — but the
  docstring is false and the name collision is a trap for anyone hardening the honesty gate.
- ★ `recentShopJobs`'s comment claimed "no bridge query exposes recent jobs; returns empty" — false;
  it calls `recent_invoices` and returns live data. That stale comment is why the smoke test's
  prisma-only mock looked sufficient. Corrected.
- ★ **L6 evidence gate also runs in SHADOW** (`evidence_gate_shadow`, `tokenUsage.evidenceGate`);
  AGENTS.md says enforcement waits "once the shadow false-positive rate is known". Unmeasured.
- The tool-surfacing census (#2359) was fixed TODAY after 3 weeks blind; **456 rows of
  `tool.surfaced` data (2026-08-25..09-16) exist and nobody has read them yet.**

**NEXT BEST MOVES** (re-evaluate; do not treat as a fixed list)
1. Read the tool census from prod — 3 weeks of just-unlocked data → real surfaced-never-chosen /
   never-surfaced diagnoses (the mandate's tool-catalog rule).
2. Measure the L6 evidence-gate shadow's false-positive rate; that is the stated gate on promotion.
3. Fix the false "Wired directly into the live chat-finalize loop" docstring + the `canClaimDone`
   name collision.
4. `CURRENT-TRUTH.md` says "Last verified 2026-09-02" — 14 days of waves since.

**RISKS / NOTES**
- Test runs from this worktree can reach the **live nickstire bridge** (observed: real invoice data
  with no `DATABASE_URL` set). Reads only, but it is a real network dependency in "unit" tests.
- Worktree needed `apps/statenour` + `packages/*` node_modules junctions (was nickstire-only).

**Updated:** 2026-09-16 (Session B: counter reconcile #2348 SHIPPED + DEPLOYED-VERIFIED `ef52c8e38`, prod reconcile DONE 10:28Z; Visible Transformation + honest-counter repair W8 open on `claude/statenour-ui-architecture-intmaf` — sixth PR #2349; Session A: execution truth + Dream-to-Proof #2335–#2345 all SHIPPED + DEPLOYED-VERIFIED, last `6f5059b7c`)

## (Session B) Honest-counter repair W8 (2026-09-16; same branch, on top of the Visible Transformation slices)
**Operator:** fact-check the research, repair reality, keep shipping. **Re-measured on prod FIRST** (Neon,
read-only) rather than trusting any number in a comment or an audit: 20 live profiles · 7 ever logged · 13 at
zero · max `interaction_count` 4 · `>= 3` matches 2 · `trustScore` 0.3–0.9.
**Shipped (5 commits):** writer guard — `RESERVED_LEDGER_METADATA_KEYS` + `assertWritableMetadata` in the
`recordInteraction` seam + a zod `superRefine` on `task.logLedger` · trust scale — `unstableAlliances` compared a
0–1 Float to `50` (vacuously true for everyone) while its other half `>= 10` was unreachable; now `< 0.4` AND one
logged contact · reader contamination — all 16 ledger reads classified, 13 filtered through `contactRowsOnly`, 3
allowlisted with a reason, `changes-since.ts` moved `count` → fetch-then-filter · counter consumers — 4 bare
`orderBy: { interactionCount: "desc" }` now lead with `lastInteraction` NULLS LAST, Greene law_16's
`"interactionCount > 20"` trigger replaced with the observable SHAPE (and the schema doc that taught it), the
neglect predicate de-duplicated into `lib/services/people/neglect.ts` at `>= 1` · W7 gate fallout —
`components/ui/{input-group,section-header}.tsx` deleted, anti-slop waiver canary repointed onto its own fixture.
**Traps measured, all worth keeping:**
· **A canary that cannot fail is not a canary.** The ledger scan's first cut tested
  `src.includes("contactRowsOnly")` — the IMPORT line alone satisfies that, and mutation proved it stayed GREEN
  after the call was deleted. Tightened to a real call shape it immediately caught a REAL miss in the same diff.
· **A detector fires on its own documentation.** Both new source scans flagged the comment explaining the bug they
  fix. The score-scale one strips comments AND strings (its subject is code); the threshold one strips comments and
  KEEPS strings (its subject is prose an LLM reads). Mirror images, and each needs the "does not fire on a comment"
  arm or the next fix is un-documentable.
· **A threshold authored against a broken counter survives the fix.** `>= 3` was not dead, it was MIS-SCALED, and
  it dropped the worst cases first. Re-measure every threshold downstream of a data repair, not just the ones that
  went to zero.
· **`git commit` commits the INDEX, not your pathspec.** A `git rm` staged earlier swept 256 lines of deletion into
  an unrelated slice. Caught by reading `git show --stat`; fixed with `reset --soft` while nothing was pushed.
**Environmental, NOT this branch (do not chase):** `obsidian-ingest-server-only` + `generate-pwa-icons-sharp` both
spawn `npx tsx -e`, and in this Linux container a spawned `tsx -e` dynamic import collapses every module namespace
to `default` — reproduced on untouched `lib/db/soft-delete.ts` WITHOUT the shim. `check:env` fails for want of
provider keys (never export real keys into the test shell).
**Next:** W9 nickstire public FCFS vs "SCHEDULE DROP-OFF" — HOLD, a sibling session is doing GSC/SEO work in those
same files (`Home.tsx`, `FocusedServicePage.tsx`, `InternalLinks.tsx`, `SiteFooter.tsx`); coordinate before touching.

## (Session B) Visible Transformation wave (2026-09-16; same branch, sixth PR, after #2348 shipped `ef52c8e38`)
**Operator:** the workbench substrate shipped but the pages "still look 85–95% like before"; new bar: old vs new
side-by-side from six feet away must be unmistakable, and *visual similarity to the pre-workbench screenshots is
now a failure condition*. This reverses spec §2 correction 5 (no rail, no cosmetic pass) — recorded in the spec.
**Shipped:** the bar as a test — `tests/e2e/visible-transformation.spec.ts` renders 5 pages × 2 viewports on the
hermetic stack and fails under 0.35 REGISTERED INK-MASS distance from the committed PRE-wave baselines
(`tests/e2e/visible-transformation.spec.ts-snapshots/`, never regenerate casually) · desktop spine (4.5rem at
≥1280px, `--spine-w`, `<main>` pads) + workset strip + ruled bottom chrome + intent resolver restyle · Home
(display verdict, gold-rule lead, ruled command line, `empty:hidden` rail) · Missions (NEXT MOVE hero across the
page, capture / decide / board as ruled sections, mission cards → ruled list with display titles, WAITING + DONE
rail, nested-button hydration error in the card header fixed) · People (NEEDS ATTENTION verdict from the totals,
the list always visible as hairline rows, gold-ruled Person Workspace; the `browse all` <details> is gone) ·
System (Control Tower: `lib/system/control-tower.ts` — ALL SYSTEMS NOMINAL / N REQUIRE ATTENTION, exceptions
only, vitals as one mono line; unknown is never nominal) · Brain (nine tabs grouped into five lenses with five
layout archetypes in `PageTabs lenses=`; every `?tab=` deep link unchanged).
**Traps measured:** a pixel-share distance is capped by ink — the house palette is 2.5–10% ink, so a 30% bar was
unreachable and a 64px slide scored 82–91% of ink pixels "changed"; the fix is a 48px-cell ink-mass grid,
relative L1, minimised over ±2 cells (shift proxies 11–26%, recomposed pages ≥0.36, same-tree noise 0.000;
canary `tests/repo/visual-distance-metric.test.ts`, red under two mutants) · a capture taken mid-load measures
skeletons — the gate now waits for `[data-skeleton]` / `aria-busy` / `.animate-pulse` to leave (cap 20s) and
gives a cold `next dev` compile 60s · the cloud container restarts kill background Postgres + `next dev`; every
e2e run re-checks both first · `pkill -f <pattern>` matches the shell running it.
**Next:** the secondary pages (Stats glass/purple, Journal, Intelligence, Content, Photo, Pins, Settings, Links,
Learn) · Brain phone hydration mismatch (pre-existing, ignored by the gate on purpose) · `make_interval(days =>
bigint)` raw-query error on plain PG16 · the eight unfiltered ledger readers (#2348 §7).

## (Session B) Counter reconcile wave (2026-09-16; same branch, PR #2348, after #2346 shipped + deployed `e0f0275bd`)
**Operator:** "counter recon". **Measured (Neon, read-only):** 27 profiles, `interaction_count` sum 200 vs 15 contact
rows (23 minus 8 synthetic); 20 with zero rows; worst 69 vs 4 (last 09-12 vs 06-04). **Shipped in #2348:** contact-row
predicate (`contact-rows.ts`: not synthetic, not status_flip) · `deriveCounters` / `computeCounterDeltas` · delete side
recomputes both counters behind the person lock · creation starts 0 / null · six `nulls: "last"` orderings + a
source-scan canary · power-dynamics NULL = unknown · `scripts/reconcile-person-counters.ts` (dry-run default,
`--apply` snapshots to `_bak_person_profiles_counter_recon_<yyyymmdd>`). **Sequence:** merge → deploy-verify →
reconcile prod with the script's SQL (snapshot + per-person locked recompute in one transaction) → residual-drift
SELECT = 0 → receipts into the RECONCILIATION entry. **Traps:** no `DATABASE_URL` in the cloud container (the write
path is Neon MCP; the script is the repo record) · Neon PITR is 6 h (`history_retention_seconds`), so the `_bak_`
table is the rollback · a bare DESC on a nullable column sorts NULLs FIRST in Postgres — the codebase knew
(`autoPriority` uses `nulls: "last"` in 10 places) but never for `lastInteraction`. **Next:** the eight unfiltered
ledger readers (#2348 §7) · cadences on /people · the first Telegram `/log` is the live receipt for the seam.

## (Session B) Relationship ledger wave (2026-09-16; same branch, restarted by merging main `fc631eccc`)
**Finding:** the ledger had no live writer worth the name — 23 rows ever, last 2026-07-10, the 8 "chat" rows a
synthetic 05-29 backfill, 0 outreach/gmail/calendar/telegram rows ever — while `interaction_count` (sum 191) and
`last_interaction` kept moving from chat MENTIONS, `person.update` edits and profile creation. **Shipped:** ONE
writer `lib/services/people/record-interaction.ts` (row + both counters in one transaction, forward-only
timestamp by predicate, embed + XP after commit; `recordInteractionOnce` = per-person advisory lock every writer takes, one row per person per
window) fed by the modal / ⌘K, the picks button, Telegram `/log`, Nick's `person.logInteraction`, and the digest
(model returns `interacted` per person; a mention writes nothing). `person.update` no longer bumps counters.
**Left alone on purpose:** the historical counter drift (a prod write + a behaviour change — operator's call) ·
cameras/devices (operator: "leave the cameras for now"). **Traps measured:** the repo clone is shallow (82
commits from 2026-09-10) — `git log -S` cannot see May; prod metadata (`synthetic: true`) told the story instead ·
`information_schema` needs the `@@map` name (`cron_job_logs`, `chat_conversations`), and cron-log columns keep
Prisma's camelCase (`"jobName"`, `"createdAt"`) · a `vi.waitFor` is the only honest way to assert a
fire-and-forget hook fired.
**Next:** decide the counter reconcile (`interaction_count := ledger count`, `last_interaction := max(ledger)`) —
one dry-run-first script, operator-run · the `/people` line's "went overdue" stays silent until a cadence is set.

## Execution truth + Dream-to-Proof, waves 2-3 + follow-ups (Session A, 2026-09-15/16)
**Objective:** close both "StateNour reset" audits in-session. **Done:** truthful Telegram + durable
`ActionAttempt` (`action_attempts` table APPLIED to prod; reclaim is a compare-and-swap pinned to id +
attemptNo + state + holdUntil; `ledgerState` stamped only after a confirmed settle) · ledger producer
ceilings + lineage + recursive PII · exact-id recall lane · `check:scripts` ratchet (44 errors baselined,
5 dead imports fixed; `sharp` resolves via `next`) · Repo Time Machine (`lib/services/proof-timeline.ts`,
`GET /api/proof/timeline`, `/proof` section, grouped on the commit the site SERVED). **Last decision:** the
hidden holdout lives outside the tree (secret `HOLDOUT_EPISODES_B64`, six episodes, three from real
incidents) and posts `proof.holdout` every run — `unmeasured` when absent. **Blocker (operator):**
`EVIDENCE_LEDGER_KEY` still not created (the proof lane posts through the bridge key); Night Shift needs
the machine GitHub account + classic `repo` token (agents may not create accounts). **Next:** when a
`proof.holdout` ever fails while the visible run passes, that is the overfitting signal — read
`/proof`'s Time Machine before touching an episode. Traps: the StateNour domain-boundary gate rejects
"nickstire.org" / "Nick's Tire" in any StateNour prose outside a link-out; vitest's `NODE_PATH` makes bare
specifiers resolve in-process (resolution tests must spawn a child); a `node` job "runner shutdown signal"
minutes after a main merge is merge ordering, not code (root AGENTS.md merge recipe now checks first).

## (Session B) UI workbench — previous header: **Updated:** 2026-09-15 (UI workbench #2337 shipped + deployed-verified; wave 3 on the same branch name, second PR)

## UI workbench wave 3 (2026-09-15; branch `claude/statenour-ui-architecture-intmaf` restarted by merging main — force-push is policy-blocked)
**Shipped this wave:** `tool` inspector + inspectable `/system/tools` rows · ChangeSet primitive
(`lib/ui/change-cursor.ts`, `hooks/use-change-cursor.ts`, `components/ui/change-set-line.tsx`; Home refactored,
Brain `changesSince` second consumer) · `tests/e2e/selection-grammar.spec.ts` on `/system/ui-lab` fixture rows
(4/4 green in Chromium against a hermetic Postgres + pgvector — both P1s mutated red first) ·
`execution-panel.tsx` on the shared snooze presets. **Refuted:** "type floor still open" (CSS block since 09-08).
**Traps measured:** `next dev` appends a `nextjs-agent-rules` block to `AGENTS.md` and rewrites `next-env.d.ts`
— revert before committing · the repo pins @playwright/test 1.63 but the container ships Chromium 1194: run
Playwright with a scratch config under `.next/` pointing `launchOptions.executablePath` at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` · the grammar's document listener attaches a commit after
the layout hydrates; wait on `html[data-selection-grammar="1"]`, not on the tab bar.
**Wave 3.6 (same branch, same PR):** React catalog floor `^19.3.0` (lock 19.3.0 for BOTH apps) ·
`@types/react(-dom)` ON the catalog (statenour, nickstire, reel-engine, social-assets) · Base UI `^1.8.0` ·
`<ViewTransition>` on the inspector only (`inspector-host.tsx`; keyframes + reduced-motion pin in `effects.css`;
instrument `tests/e2e/inspector-view-transition.spec.ts` counts `document.startViewTransition`).
**Traps measured:** bumping ONE app's `@types/react` leaves two copies in the tree and every peer on the old one —
four `Key` TS2322 errors in files the diff never touched; the fix is the catalog, never a per-app pin ·
`next build` wipes `.next/`, so a scratch Playwright config under it must be rewritten before each e2e run ·
Next 16.3.4 already vendors the stable `ViewTransition` (no `viewTransition` config flag exists in 16.3.4).
**Wave 4 (2026-09-16, follow-ups; same branch, restarted by merging main — `35f9a904f`):** `agentRules: false`
(next.config.ts; the appended block is gone for good) · `/people` ChangeSet line (`task.peopleChangesSince`,
`components/relationships/people-change-line.tsx`) — SILENT in prod by measurement (0 cadences, ledger last
written 2026-07-10), which is the honest render, not a bug · `device` renderer BLOCKED: no device surface
(`/system/devices` pruned, `G D` dangles) and the bridge heartbeats stopped 2026-09-11 — spec §5 has the
receipts; needs an operator decision on restoring a device list.
**Next:** whatever the operator decides on devices · retire/retarget `G D` + the hub's `/system/devices` link.

## UI workbench slices 1 + 2 (2026-09-15; #2337 merged 19:27Z, live 19:32Z)
**Objective:** gate a pasted 38-section UI plan against live code, correct it, build the substrate as vertical
slices. Spec + verdict: `docs/design/ui-workbench-2026-09-15.md` (read THAT before proposing any inspector,
drawer, selection or "spatial" work). Ship entry: RECONCILIATION top.
**What now exists:** `?inspect=<kind>:<id>` opens ONE inspector for memory / task / person / alert / cron
from any page (`components/inspector/inspector-host.tsx`, mounted in the layout; registry in
`inspector-registry.tsx`); rows with `data-entity` inside a `[data-selection-scope]` get j/k/Space/Enter/x
(Brain Changed, Missions, People, /system/alerts, /system/crons); ⌘K leads with the focused object's actions;
a workset shelf; Reality Mode (⌘K → Modes) renders provenance inline; `/proof` is in NAV; the chat bridge
reads `?inspect=`; the task inspector shows the scorer's per-term breakdown (`task.byId` →
`priorityBreakdown`) and runs the Missions board's complete / snooze through page-lent actions
(`useRegisterInspectorActions`); `/system/ui-lab` is the primitives gallery (frozen clock). Slice-1 hostile
review: 18 findings, all fixed in `ba227588a` — spec §3.8 lists them; read it before touching the hook.
**Next (in order, spec §5):** `tool` inspector (`/system/tools` registry) · ChangeSet with Brain's Changed
view as the second consumer · Base UI 1.8 + React 19.3 dependency PR, then `<ViewTransition>` on row →
inspector only · the §5.1 type floor on `bottom-tab-bar.tsx` / `more-sheet.tsx` with the chat-states
baselines re-cut in the same PR · `execution-panel.tsx` → `lib/missions/snooze-presets.ts` · a Playwright
case for route-change reset + one-Esc-one-layer (DOM code the Node lane cannot see).
**Not this branch's, reproduced on `origin/main` in the container:** `tests/repo/obsidian-ingest-server-only`
("chain moved: persistKnowledgeCandidate missing") and `check:policy-coverage` (`server-only` under plain tsx
at `lib/ai/budget.ts:9`). CI was green on the same code (#2334); if CI is red on these here, it is the
environment, not the diff.
**Sibling session (PR #2335, execution truth):** backend only; the only shared file is `docs/UPSTREAMS.md`
(my rows at the top of the table, theirs at the bottom). Ownership map: spec §4.

## Camera vision wave 0 (2026-09-08; superseded stamp)
**Updated:** 2026-09-08 (camera vision wave 0 on top of the design pass + Brain plan/Wave 0-1)

## Camera vision wave 0 (2026-09-08; PRs #2221 nickstire, #2222 statenour, #2223 docs; edge PR pending)
**Objective:** make the #315 Arrival Intelligence pipeline receive its first real event and hand the operator an
implementation-grade plan: `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` + ADR-0017.
**Finding:** every `[id]` device route resolved the cuid while the bridge sends `platformDeviceId`, so every event
and heartbeat answered 404; prod `device_events` = 2 rows, both the June test device. Fixed in #2222 with a route
test proven red first. The edge (camera-bridge) was pinned to Frigate 0.13.2 with a 0.14+ config; rewrite lands on
`chore/camera-bridge-v2`. The cameras are Anyka `Hw_HsAKQQXG_WIFI_20230421` exposing only TCP 8800/9800; the
SD-card `ceshi.ini` unlock is the documented path (plan section 3.3), PoE cameras for LPR.
**Next:** merge #2221 -> #2222 -> #2223 -> edge PR on green; operator runs the unlock on SHOPSIGN and orders the
PoE overview camera; Phase 1 = Frigate 0.17.2 + visitd on the laptop as a lab with the recorded replay fixture;
`NICK_ARRIVAL_INTELLIGENCE` stays off until gate G3. Still open: `analyzeCameraData` has no scheduler;
`local-agent/v380_agent.py` is a delete after edge heartbeats are live.
**Objective this wave:** independently inspect, stress-test and repair bdnick.info, then hand the
operator a prioritized program. Program doc: `docs/research/2026-09-07-statenour-quality-power-program.md`
(read THAT before re-auditing anything here). Full wave entry: RECONCILIATION top.

## The finding that mattered
**Production had been stuck on `b3bebde` (2026-09-04 12:08Z) for three days.** Both Railway
services showed `Deploy failed`; the build log ended with `COPY apps/statenour/patches … not
found`. #2096 deleted the only file in that directory, git dropped the directory, and both
Dockerfiles failed at the deps stage on every push after 12:34Z. The previous ledger entry said
#2096 "shipped" — it was merged, not deployed. Merged and deployed are different claims.

## Shipped 2026-09-08, evening (details: RECONCILIATION top; the Brain plan is the current roadmap)
- **#2202 `PR head d237929f1`** design pass §5.3/5.4/5.8 · **#2204 `9f879de113bf`** chat badge + starters · **#2213 `this PR, head 8b7d7f113`**
  Brain plan (`docs/research/2026-09-08-statenour-brain-intelligence-upgrade-plan.md`) + Wave 0/1.
- **Next for the Brain (in order):** Wave 2 = `validFrom` at write + supersession flip after a shadow week +
  retrieval arbiter behind `NICK_RECALL_ARBITER` + writer migration batch 1 (journal_brain, conversation_analysis,
  belief-harvester, distillation, the Drive/Calendar/Reviews intake through the quarantine door). Then Wave 3
  (allocator + placement + context receipt + deterministic query planner), Wave 4 (tool funnel 24→16→12).
- **Operator-run:** `railway run --service statenour-web -- pnpm tsx scripts/drain-brain-embeddings.ts` (2,460
  unembedded personal rows) · `pnpm eval:recall -- --write-manifest` where the 28-case corpus lives · decide the
  paused `data-cleanup` cron · AGENTS.md 44 vs 48px · HSTS preload · phone composer check.

## Shipped 2026-09-08, backlog wave (deployed-verified; details: RECONCILIATION top)
- **#2193 `008afcf20`** cost truth: aiChat records every call · one price table · lane caps = deterministic
  stops · thumbs → Langfuse scores · model prices registered in Langfuse (5/5, via `railway run`).
- **#2196 `e2d4ea2d2f14`** nickstire Market admin section (`/admin/market`, `market.*` → marketing.manage) + public
  cached ribbon counts (D14). **#2195 `26b4b382eb2b`** approval windows (env override) + the deferred-automation
  list (press-and-hold Approve) · /market retired → redirect · image-flag prerequisites · HSTS preload-ready.
- **#2198 `bfccff82c636`** as-of recall (`validityWhere`, `searchMemories.asOf`) · sink policy (fence taints the
  turn → external side effects need a human) · intent playbooks (tier 7) · copy voice · phone type floor.
- Outside git: Neon `production` branch protected · Railway `IMAGES_REQUIRE_SIGNATURE=1` set on
  statenour-web and verified on the redeployed container (raw image id without a session -> 401, a
  signed URL passes auth, a bogus signature -> 403; prod holds no `generated_image` audit rows today,
  the orchestrator GC removes them after 90 days, so the probe used a synthetic id) · Langfuse model
  prices registered (5/5) by `scripts/langfuse-register-models.ts` under `railway run`, keys never printed.
- Blocked on the operator: Sentry project split (MCP tool rejects the call; one-liner in RECONCILIATION) ·
  HSTS preload submission. Not started: §5.3/5.4/5.8 design pass (needs screenshots).

## Shipped 2026-09-08 (all deployed-verified via `/api/version` ancestry; details: RECONCILIATION top)
- **#2180 `b531b203f`** deploy-drift observer (GitHub workflow, canaries) · inbound-crm header-only · read-mode
  contract · NICK FAB lane · Sentry app tag. **#2186 `87e5d3bfe`** fixed its SIGPIPE; plain run PASSED, stale canary FAILED.
- **#2181 `e4e88d5d1`** approvals expire (authorization, not obligations; 409 before execution) · devices classified,
  retire marks RETIRED. **#2183 `989345d28`** signed image URLs behind `IMAGES_REQUIRE_SIGNATURE` (unset = today).
- **#2185 `851b597e7`** resume record on park · `tests/e2e/floating-collision.spec.ts` (first run red on real
  collisions → NICK pill docked into the More sheet on phones, 7rem lane) · Brain nav 4→9.
- **#2188 `d3a760d68`** middleware.ts → proxy.ts. **#2189 `66b79cc17`** violet AI accent retired, `--status-ai` deleted.
- Operator decisions open: flip `IMAGES_REQUIRE_SIGNATURE`; approval windows; `/market` MOVE/RETIRE; Sentry split;
  HSTS preload; Neon branch protection. Do not relaunch review workflows here unasked (usage).

## Shipped 2026-09-07
- **#2175 `71e7cf14`** (operator-merged 21:58:41Z; deployed 22:02:50Z; runtime-verified 23:54Z
  via `/api/version` ancestry, worker `/health`, live headers, anonymous 401, `sw.js` v11) —
  dead COPY removed from both Dockerfiles + `tests/repo/dockerfile-copy-sources.test.ts`;
  `/api/brain/pinned` anonymous 500 → 401; `--font-mono`/`--font-sans` bridged (Geist Mono had
  never rendered); `/save` keeps similar-but-different statements instead of discarding them;
  `sw.js` same-origin `/_next/static/` only (v11); journal-brief plain headings; `X-Robots-Tag
  noindex` + sign-in robots meta; lint baseline re-snapshotted; soft-delete allowlist with reason;
  SECURITY.md CSP section rewritten to what production serves.
- **#2177 (open)** — pinned guard preserves the auth-guard's 503 and sanitizes unexpected errors;
  `/save` identity decided BEFORE any embedding call, embedding outage still saves (`embedded:
  false`, embed-backfill indexes later); near-duplicate pairs queued into the EXISTING
  contradiction review (`signal: near_duplicate`); `resolveContradiction` writes `supersededById`
  + `validUntil` on the loser (the columns every recall lane already filters on — the earlier
  "no readers" line was wrong); `.github/workflows/docker-context-gate.yml` builds the real deps
  stage of both Dockerfiles with a canary. Full suite 708 files / 7,482 tests, exit 0.

## Toolchain trap (still true)
The shared `node_modules` predate `@sentry/nextjs` (#2074): in every junctioned worktree
`typecheck` shows TS2307 phantoms, tests importing `next.config` fail to load unless they mock
`@sentry/nextjs/config`, and the pre-push build cannot run. Both PRs were pushed from a hookless
sparse scratch clone (the path `statenour-verify` documents); CI was the gate. The operator
declined a `railway deployment list` call after the merge — verify deploys via `/api/version`
ancestry + worker `/health`.

## Open — operator decisions (details in the program §2/§13)
- Independent deploy observer (not an in-worker cron); classify the 20 "offline" cameras by
  intended lifecycle; expire approval AUTHORIZATION without fabricating a decline.
- Signed URLs for `/api/images/[id]` (consumers: chat markdown, /content publish,
  social-actions, photo-improver); inbound-crm `?secret=` removal; read-mode contract (strict vs
  "no autonomous changes"); NICK FAB overlap on /journal + /missions; `middleware.ts` → `proxy.ts`.
- Neon: PITR 6 h, daily 30 d / weekly 35 d snapshots, `production` branch unprotected, org MFA
  not required → restore drill with outbound effects disabled + branch protection.
- `/market`, "Check Business Dashboard", shop-flavoured chat starters: MOVE or RETIRE (R7).
- nickstire PhotoRibbon → StateNour's Sentry project (chip spawned); Sentry project split.

## Carried forward — the 2026-09-02 observability arc (still true)

**The finding that shaped the whole arc.** Adding Sentry (#2074) silently killed Langfuse.
`Sentry.init()` registers the global OpenTelemetry tracer provider; `@opentelemetry/api`'s
`registerGlobal` refuses a SECOND registration, logs it through a no-op diag logger, and keeps the
FIRST. `instrumentation.ts` imported the Sentry config before `initLangfuseTracing()`, so every AI
SDK span went to Sentry's provider and was dropped — while the boot log said `langfuse_started` and
`/api/version` said `langfuse: true`. Measured, not inferred: `/api/public/traces` returned
`totalItems: 0` all-time against the live project with valid keys.

**Shipped:** #2073 `863ce4c47` (one `langfuseTelemetry()` helper, 22 sites) · #2080 `5e9a510f0`
(provider handover, recording self-check, `app/global-error.tsx`, shared secret mask,
`POST /api/system/observability-probe`) · #2082 `a1d51cf09` (sample the ROOT) · #2083
`e4f1a6bb2` (the receipt). #2079 CLOSED, not merged (real key material in its first commit;
history NOT rewritten).

**Receipts:** Langfuse trace `d3eebaac74d030dc2aea911b83ace1bb` (2026-09-02T17:43:48Z, `a1d51cf`,
environment production, planted `metadata.probeId`, `service.namespace: sentry`) · Sentry issue
`JAVASCRIPT-REACT-Y` with the SAME probe id. Reproduce with the probe route.

**Open / known gaps:** token usage and cost are 0 (provider reported no usage) · only the probe
has exercised the Langfuse path · Langfuse keys are in `main` history from #2073 — operator
declined rotation 2026-09-02, do NOT re-raise.

**Traps:** two SDKs cannot both own OpenTelemetry by accident · Sentry's `tracesSampler` sees
ROOT spans only · `lib/observability/sentry.ts` reaches the BROWSER bundle · Langfuse names
observations `<functionId>:<span>` and `/api/public/v2/observations` is a thin projection.
