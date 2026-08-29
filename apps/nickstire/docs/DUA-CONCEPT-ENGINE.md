# Delightfully Useful Absurdity (DUA) — concept model + hard gates

**Shipped 2026-08-29.** `shared/dua.ts` · `shared/duaFranchiseKits.ts` · `shared/absurdityConcepts.ts`

> **The one rule, which is also the hard gate:**
> **Be absurd about the presentation. Never be absurd about the truth.**

The absurd frame is packaging. The mechanical fact underneath must be real, sourced,
and unchanged by the joke. A reel already shipped with three false claims about Ohio
E-Check law burned into audio and pixels, where no copy edit could reach them. Comedy
makes that failure *more* likely, not less, because a funny frame invites invented
specifics.

## What already existed (read this before proposing a rebuild)

Most of the vocabulary was here. **None of the enforcement was.**

| Piece | Where | State before this |
|---|---|---|
| Absurdity as a 0-10 score | `ReelConceptScores.absurdity` | Live, averaged into a 60-pt total — a 10/10 irrelevant joke and a 7/10 relevant one were interchangeable |
| `usefulAbsurdity` on concept + brief | `facelessReelStudio.ts` | Live, never checked against anything |
| "Absurdity is a TEACHING DEVICE … if it doesn't teach the fact, cut it" | `igCarouselStudioPrompt.ts:181` | **Prose in a prompt.** Nothing checked it |
| 12 franchises (Pothole Court, Tire Autopsy, E-Check Escape Room …) | `shared/contentFranchises.ts` | Live and wired into `reelBriefGen` |
| 6 faceless characters + prohibitions | `shared/brandBible.ts` | Live |
| `blockingConditions` / `requiredEvidence` / `disclosure` per franchise | `shared/contentFranchises.ts` | **Declared, never read.** `brand-universe.test.ts:96-97` asserted only `.length > 0` — presence, not behaviour |
| 100 absurd concept seeds | `server/services/absurdityConcepts.ts` | **609-line orphan, zero consumers since #346** |

So this is not a new creative engine bolted on. It is the missing enforcement layer for
contracts the codebase had already written down, plus the model that makes them checkable.

## The load-bearing finding: relevance is a GATE, not a score

Strong humour **damages** memory for the underlying claim when the joke is only loosely
related to the message, and the damage disappears when relevance is high. An irrelevant
joke is therefore not neutral-but-fun — it is worse than no joke, because it costs the fact.

So the test is not "is this funny" or even "is this on-topic". It is:

> **Could this frame be swapped for another topic's frame and still work?**

`probeFrameSwap()` runs that literally. It scores the frame against its own fact, then
against a corpus of 100 other topics' facts, and blocks when some unrelated fact fits at
least as well.

**Terms are weighted by rarity, and that is the whole reason it works.** The first draft
compared raw coverage ratios and reported PORTABLE on **6 of 6 genuinely relevant authored
concepts** — a 100% false-positive rate. Two causes:

1. Ratio-of-terms is biased by fact **length**. A frame carrying 3 terms of a 20-term fact
   scores 0.15; the same frame accidentally carrying 2 terms of a 5-term foreign clause
   scores 0.40 and "wins".
2. **Generic connective terms are what make a frame look portable**, and they counted the
   same as diagnostic ones. Measured over the seed corpus: `point` appears in 15/100 facts,
   `check` in 7/100, while `sidewall` and `hygroscopic` appear once or twice.

Inverse document frequency is not a refinement here — it *is* the signal. After weighting:
6/6 authored concepts pass, and a deliberately generic courtroom frame ("a defendant stands
trial, the judge bangs a gavel") scores **0.00** against a tread fact and is correctly portable.

Near-duplicate facts are excluded before comparing (weight ratio > **0.4**). Two facts about
tread depth *should* both fit a tread-depth frame; that is the frame working. Measured: at
0.5 a real sidewall-PSI concept was still beaten by another sidewall-PSI fact. Both 0.5 and
0.95 are now caught by the mutation canaries.

## Hard fails — block, never warn

| Code | Fires when |
|---|---|
| `RELEVANCE_BELOW_THRESHOLD` | the frame carries the fact's mechanism in fewer than 2 of 3 structural surfaces |
| `FRAME_PORTABLE` | an unrelated fact fits the frame at least as well as its own |
| `FABRICATED_EVIDENCE` | the joke asserts a measurement the fact never carried, or claims a test returned a result |
| `CUSTOMER_HUMILIATED` | `subject: "customer"`, or the joke lands on the driver |
| `SAFETY_TRIVIALISED` | a real safety mechanism is resolved by doing nothing |
| `FACT_ABSENT` / `FACT_UNVERIFIED` | no mechanical fact, or no proof source |
| `ABSURDITY_LEVEL_UNCAPPED` | level 5 without explicit `levelOptIn` |
| `LAYER_BOUNDARY_VIOLATION` | a generated asset outside Layer C |
| `GENERATED_WITHOUT_DISCLOSURE` | generated material with no declared disclosure mode |
| `UNKNOWN_ROLE` / `FRANCHISE_BLOCKING_CONDITION` | unregistered role; a franchise's own declared condition matched |

Advisories (`warn`): `ABSURDITY_BELOW_BAND`, `NO_EVIDENCE_LAYER`, `AI_DISCLOSURE_REQUIRED`.

## The dial

`0` documentary → `5` fever dream. **Working band is 2-4**; `5` requires `levelOptIn: true`.
Moderate incongruity outperforms extreme — past the middle, the frame stops being a surprising
way to see a real thing and starts being confusing, and confusion is paid for in credibility,
which is this shop's most valuable asset.

## Three visual layers

| Layer | Purpose | Allowed origins |
|---|---|---|
| **A — Evidence** | what actually happened, in this shop, on this vehicle. The claim rests here. | `real_footage` **only** |
| **B — Explanation** | diagrams, arrows, callouts, data viz | `real_footage`, `authored_graphic` |
| **C — Absurdity** | the generated visual metaphor, clearly editorial | all three, incl. `generated` |

Permission is **monotone down the stack**, so a future origin cannot reach Layer A by
accident. `generated` is C-exclusive: if generated pixels can only appear in the layer whose
entire job is to be obviously editorial, no generated pixel can be mistaken for a record of
something that happened.

> ### Layering does NOT discharge the AI-disclosure duty
>
> The research brief framed the three layers as *solving the AI-disclosure problem*. **It does
> not, and this repo already contradicts it:** `episodeContract.ts:124` has
> `requiresAiDisclosure()` and blocks with `DISCLOSURE_MISSING` at line 261, and all twelve
> franchises carry their own `disclosure` mode. Confining generation to Layer C is a **truth
> control** — it keeps generated pixels out of the evidence. The platform's labelling
> obligation is a separate axis that Layer C does not touch. Treating layering as a labelling
> exemption would be platform-integrity evasion, so the gate encodes the opposite:
> **any generated asset without a `disclosureMode` blocks.**

## Franchise kits

`shared/duaFranchiseKits.ts` gives each of the twelve existing franchises an audio palette,
a recurring vocabulary, and a participation ask. Keyed by `FranchiseId` and exhaustive by
type, so a new franchise cannot ship without a kit and a kit cannot outlive its franchise.

- **Every palette carries `mutedFirstEquivalent`** — what carries the same beat with the sound
  off. Instagram plays muted by default and the quality score already awards 10 points for
  muted-first clarity; an audio identity that ignores it fights its own gate.
- **"The Metal Has Spoken" is overlay-only.** `BRAND_CAST.the_metal` fixes one spoken line per
  episode ("The metal doesn't lie") and says repetition destroys the signature. A second spoken
  catchphrase would break that silently, so it lives in `OVERLAY_ONLY_VOCABULARY` as a verdict card.
- **"NASA Alignment" has no franchise** and is recorded in `UNHOUSED_SHOW_CONCEPTS`, not smuggled
  in as a thirteenth entry. Adding a franchise changes the publishing rotation and needs its own
  `requiredEvidence` — an operator decision, not a data edit.

Recurring cast are **roles bound to `BRAND_CAST`**, not new characters — `brandBible.ts` warns
about exactly the competing-authority defect a second registry would create.

## Wiring — and why severity splits

`runReelPreflight()` calls `runReelDuaChecks()`. Two paths:

- **`brief.dua` authored** → the full gate, every hard fail **blocks**.
- **no authored concept** → the content detectors still **block** (they read text that will
  actually ship); relevance and the swap probe **warn**, because reconstructing
  `violation`/`payoff` from a `ReelBrief` is lossy, and blocking live generation on this
  module's own approximation is not the same as blocking on an author's declaration.

**Block on what is stated; warn on what is inferred.** Authoring the concept is what buys the
strong guarantee.

`detectInventedMeasurements` is deliberately **authored-path only**. Running it over a whole
reel blocked `sample-pressure-door-sticker` on a correct, sourced **"44 PSI"** — a reel is not
a closed fact/joke pair, and its numbers legitimately arrive from several sourced places. That
regression is locked as a test.

## Verification

- `pnpm run verify` — **exit 0 · 498 files · 6,246 passed · 48 skipped · 138.90s**
- `shared/dua.test.ts` + `shared/duaFranchiseKits.test.ts` — 146 tests, every gate a canary pair
- **Mutation pass: 20/20 gates caught.** Each gate was broken in the real module and the suite
  asserted to fail; the near-duplicate threshold survived the first pass and now has its own lock.
- **False-positive probes:** 116 committed reel packs scanned → 0 findings; 10 legitimate
  diagnostic sentences pass; 4 fabricated verdicts block. All locked as tests.

`show` / `shows` / `showed` are deliberately absent from the fabricated-verdict verbs: "an OBD
scan shows a stored code" is correct diagnostic English, while "the scan confirms the caliper
seized" is a verdict the scan never returned.

## Known limits — do not read a pass as more than it is

- **Relevance is lexical.** It detects the *signature* of decoration (the fact's mechanism words
  are absent from the joke's words). It cannot tell whether a metaphor is apt, and a frame that
  teaches through a synonym chain the fact never names will read as decorative.
- **Franchise conditions are English sentences.** Only recurring shapes (cost, unsafe-to-drive,
  street address, remaining-life) have detectors. `DuaGateReport.unenforcedConditions` carries
  what could not be checked, on the report itself, so no caller can render a clean franchise
  verdict without also holding its limits. A `pass` means "nothing detectable fired", never
  "this episode satisfies its show's contract".
- **Nothing here inspects pixels.** This is a design-time gate over words, run before spend.
  `renderedQa.ts` remains the vision critic.
