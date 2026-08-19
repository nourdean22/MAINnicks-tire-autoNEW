# StateNOUR — System Verdict · 2026-08-19

**Method:** six parallel read-only audits (surface/IA · intelligence architecture ·
execution architecture · truth semantics · performance/reliability · design/mobile),
gated against the 2026-07-28 blueprint and CURRENT-TRUTH so nothing incumbent got
re-proposed. Every claim below carries a file receipt in the underlying audit logs;
the flagship claims were re-verified by hand before anything was built. One
implementation wave shipped the same day (commits listed at the bottom), then the
whole diff went through an adversarial multi-agent review before merge.

---

## State of StateNOUR

The system is **structurally rich and epistemically leaky**. The hard parts exist
and mostly work: a governed memory write-path with a commit gateway, two hybrid
recall lanes over pgvector + FTS, a 72-entry cron manifest with census guards, a
receipts/approval discipline nickstire sessions envy, a fabrication-defense stack,
and a navigation chrome (4 tabs + MORE + ⌘K from one registry) that is maintained
faster than several pages it points at.

What it is NOT yet is one product. The recurring disease — measured, not vibed —
is **information that dies at a seam**: columns with no writer, writers with no
reader, instruments that render failure as health, and the same semantic concept
defined 3-13 different ways across surfaces.

## Core product verdict

StateNOUR should be run as a **truth instrument first, advisor second, archive
last**. The operating loop (observe → decide → act → learn) does not need new
surfaces; it needs the existing seams welded so signal survives the trip. The
product's real currency is trust-per-glance on a phone: every number either
carries its provenance/age or it is noise wearing a UI.

## Strongest parts (protect these)

- **The write-governance stack** — remember() gateway (Phase-1/2), wisdom gate,
  Review queue, quarantine categories. Best-in-class for a personal OS.
- **The cron/fleet truth machinery** post-#1691 — logCronRun failure detection,
  schema sentinel at 26 expectations, artifact probes.
- **Nav chrome discipline** — nav-items.ts feeding tabs/MORE/⌘K; page-context
  bridge so Nick knows the operator's surface (live since 08-12).
- **Chat quality instrumentation** — 8-axis judge, persona golden set, k-sample
  calibration; the only lane with a real measurement flywheel.
- **FreshnessChip + fleet-truth "unknown never counts as healthy"** — the right
  doctrine, previously applied only to machine surfaces.

## Biggest problems (ranked, as found)

1. **`Task.autoPriority` carried two OPPOSITE scales in one column** — the scoring
   engine wrote higher=hotter, the nick-agent/chat-tool lane wrote 5/15/30/60
   lower=hotter, and ~27 readers split down the middle. The 8am MIT picker, the
   daily scheduler, todo desk, mission cards, execution focus and Nick's own task
   list were structurally surfacing least-urgent-first. v10.0.46 had "fixed" the
   MIT picker in the wrong direction on the same confusion. **FIXED this wave.**
2. **Unknown rendered as zero/calm on operator surfaces** — situation card
   emerald-"clear" on a failed fetch; meta-scoreboard flooring failed reads to 0
   ("Open tasks 0 · calm" from a dead DB); revenue mirror with no recency bound;
   Home action matrix and /missions rendering failed reads as a cleared board;
   /system "Clean" hint + freshness chip stamped `new Date()` on failure.
   **FIXED this wave** (the #1691 doctrine, extended from /system/health to the
   surfaces the operator actually reads).
3. **Broken learning loops** — recordOutcome: 0 callers; Task.outcomeRating/
   outcomeLesson write-only; reasoning traces never re-enter memory (no
   embedding, deliberately excluded); journal → getLearnedKnowledge() prompt leg
   severed (0 importers); Discover's "already knew" novelty signal unconsumed
   while NICK_NOVELTY_RECALL ships default-ON. **Partially addressed** (see
   supersession below); the rest is the next wave's spine.
4. **Supersession schema with no writer and no reader** — BDN-310 columns applied
   to prod 08-14; a superseded belief stayed exactly as recallable as a fresh
   one. **FIXED this wave** (contradiction-resolution stamps the loser; both
   recall lanes + fallback filter).
5. **Competing definitions everywhere** — 7 "open task" filters, 13 task rankers,
   13-value free-text Commitment.status with 3 "active" filters, 16 uncoordinated
   staleness thresholds, 3 "done today" clocks (one anchored to hardcoded -05:00).
   **One canonicalized this wave (priority)**; the rest ranked below.
6. **Home's physics** — ~24 client-side reads, zero SSR data, one blocking
   httpBatchLink batch gated on the slowest member (system.hub, ~20 uncached
   queries — **now cached 30s**); /missions re-pulls up to 1500 full task rows
   every 15s; three 5s pollers on unbounded findMany.
7. **Confidence theater** — BrainMemory.confidence is a re-sighting count rendered
   as "conf 92%" in /brain panels; hardcoded 0.9/1.0 confidences displayed as
   measurements; 6 schema confidence fields with no renderer; AI-inferred links
   styled nearly identically to operator-confirmed.

## Fragmentation / what should converge

- **Status-color + staleness vocabulary**: 3,353 raw hue utilities, per-file
  severity palettes, two staleness ladders (FreshnessChip 60s/5m/1h/1d vs /pins
  7d/14d/30d) → one shared tone module + one ladder parameterized by decay class.
- **Card primitives**: GlassCard (117) vs Panel (128) vs 321 hand-rolled vs a
  base.css attribute-selector cascade — pick two (GlassCard + Panel documented
  as THE two tiers), migrate opportunistically.
- **System-status surfaces**: /system vs /system/health vs /system/fleet vs
  /settings cards read the same substrate four ways.
- **"Calibration"** means two unrelated things on /stats vs /system/calibration.
- **Token dialects**: features/chat-v2 uses bridge utilities exclusively (179/0)
  while the rest of the app writes 4,040 `[var(--…)]` arbitraries; 15 phantom
  tokens render NO css at 74 sites (assistant-tab's inputs are unstyled);
  `font-mono` (1,441 uses) never actually renders Geist Mono — the `--font-mono`
  bridge mapping is missing.

## What should disappear (operator sign-off, then a cleanup wave)

- Dead routes/links: brain-graph's `/decisions` href 404s; `/money?tab=*`
  redirects land on 404; G+d/G+q/G+p shortcuts advertise redirect stubs.
- Dead code with zero importers: `getLearnedKnowledge`/`getAiStats`,
  `getPageVisitIntelligence`, `lib/brain/cloud-memory.ts` (whole module),
  `task-priority-inferrer.ts`, `intelligence-matching.ts` (a mock demo in lib/),
  `plan-day` route (180s AI route, no caller, docblock points at a page that
  doesn't exist), ReviewLog (0 writers, 0 readers, docblock names nonexistent
  routes), 7 rendered-by-nothing components, 18 dead CSS tokens.
- The `rebalanceTaskPriorities` retired stub still surfaced verbatim through the
  syncKnowledge chat tool ("N rebalanced" from hardcoded zeros).
- WP-5 standing decisions: warroom / research / missions-simulator reachability.

## Highest-leverage next moves (ranked)

1. **Close the outcome loop end-to-end** — wire recordOutcome from the surfaces
   that already call recordShown; feed Task.outcomeRating/outcomeLesson into
   runAutoLearn; give reasoning traces embeddings (write via remember()) so Nick
   remembers his own conclusions. This is the mega-prompt's "decisions compound"
   ask, and all three writers already exist.
2. **Commitment.status canonical vocabulary** + promise_integrity fixes (expired
   commitments currently vanish from the denominator — neglect can't degrade the
   axis; `in_progress` uncounted as active).
3. **"Open task" + "done today" single definitions** (shared predicates module,
   same treatment as the polarity fix — source-scan pinned).
4. **Home progressive loading** — httpBatchStreamLink, bound task.list payloads,
   visibility-gate the raw setInterval pollers, focus-refetch on PWA foreground.
5. **One status-tone module + phantom-token repair** (15 phantom tokens, worst
   file first; `--font-mono` bridge line).
6. **Person→everything**: Task.personId now persists — surface "open promises"
   on /people and in briefs; Commitment/Decision→Person links remain schema-only.
7. **Mission.lifeGoalId** — decide: wire a writer (validators + link UI) or derive
   mission→goal from its tasks' modal goalId and delete the dead column claim.

## What was implemented this wave (receipts)

| Commit | What | Proof |
|---|---|---|
| 484d0c0bd | autoPriority polarity canonicalized (34 files): one scale (higher=hotter), canonical bands/helpers, 5 writers + ~19 readers aligned, reorder overload fixed + its false "cron honors 7d" comment corrected | new polarity contract test w/ repo-wide source scan (caught 3 sites every manual pass missed); 71 targeted tests green |
| d13b98163 | Unknown-is-not-zero on operator surfaces: meta-scoreboard measured:false cards, revenue-mirror age honesty, pin bounded to today-ET, situation-card error branch, action-matrix BOARD UNREADABLE, /missions unreadable panel, /system honest hint + freshness; system.hub cached 30s | 6 new contract tests; 27 adjacent tests green |
| bbe95e332 | Task.personId reaches the DB (validator was silently stripping it) | 4 new validator tests + regression suites, 51 green |
| 681fe871c | BDN-310 supersession: first writer (contradiction loser stamped supersededById+validUntil) + both recall lanes and fallback filter superseded/expired rows | writer contract + reader source pins, 18 green |
| 6bb49087e | Gateway kill-switches on the flag board; reasoning toolbox count truth (socialTools source + strict-equality test) | 30 tests green incl. catalog-claims |
| a08870a82 | Both tool-contract snapshots regenerated (sanctioned path) after the full suite correctly flagged the intended setTaskPriority description change | snapshot diff = 3 lines, all setTaskPriority |

Full suite at review time: **528 files · 5,635 tests · 5,633 passed, 2 failed —
both failures were the contract pins doing their job on the intended change,
ratified above.** Post-ratification suite result in the PR body.

## Deliberately NOT built

- No new surfaces, no new tables, no new dependencies (UPSTREAMS discipline).
- No automatic prod data migration for legacy inverted rows. A read-only census
  now exists at `scripts/probe-task-priority-overrides.ts`; it prints each live
  override, its current canonical band, and a suggested legacy remap without
  mutating data. Merge/deploy of the polarity flip requires the operator to run
  that probe and choose a reversible, audited migration policy — guessing an
  operator's historical intent is worse than a deliberate hold.
- No IA reshuffle — the surface map + convergence list above is the input to
  that conversation, not a unilateral move.
- Nothing in the /brain lane (sibling session owns it this window); brain-side
  findings (confidence-as-percentage panels, graph 404 href) are routed here
  instead of edited.

## Evidence trail

Six audit reports (surface map · intelligence seams · execution loops · truth
semantics, 31 findings · perf, 5 ranked problems · design scorecard) live in the
session transcript; their flagship claims were hand-verified against source
before implementation, and the shipped diff was re-reviewed by an adversarial
multi-agent pass (finders + refuters + external prior-art research) before merge.
