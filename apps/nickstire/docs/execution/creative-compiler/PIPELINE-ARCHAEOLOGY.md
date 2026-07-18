# Creative Compiler 2.0 — Milestone 2: Pipeline Archaeology

Field-provenance map of the upstream draft path, campaign ask → provider request.
Produced by a 3-agent adversarial trace (wf_7cdc50b3-4c7) against `main` after #859.
**All four directive issues (3.1–3.4) CONFIRMED.**

## The chain and where structure is lost

```
campaign ask
  → concept tournament (pitch → judge → resolveWinner)   conceptTournament.ts
  → Creative Genome                                        genomeGen.ts / creativeGenome.ts
  → Reel Director (genomeConstraintBlock)                  reelDirector.ts
  → Reel brief generator (+ critic/rewriter)              reelBriefGen.ts
  → Higgsfield prompt pack (beat.visual → Subject:)        facelessReelStudio.ts
  → provider CLI args                                      higgsfieldStudio.ts
```

## Confirmed issues

| # | Issue | Evidence | Owner milestone |
|---|---|---|---|
| **3.1** | Structured intent compressed into a ≤1000-char prose `sourceDetail` | `genomeConstraintBlock` (reelDirector.ts:62-80) `.slice(0,1000)` packs 7 fields and DROPS `objective`, `audienceMoment`, `driverTension`, `mechanicTruth`, `creativeTerritory` entirely; `genomeToReelSeed` truncates to a 300-char topic | **M3 (done)** + M5 |
| **3.2** | Tournament winner re-ideated downstream | reelBriefGen re-runs the internal 7-concept ideate/score/pick (reelBriefGen.ts:382-386) even when a genome is supplied | M4 |
| **3.3** | Critic rewrites the whole object | the critic re-emits the entire brief (reelBriefGen.ts:439); nothing hard-preserves winningConceptId / mechanicTruth / evidence ids / metaphor | M9 |
| **3.4** | Provider-risk mixed with creative intent | raw `beat.visual` prose becomes Seedance `Subject:` unchecked (facelessReelStudio.ts:855); no provider-safe scene-spec separation | M5 + M6 |

## Winner → genome: zero structured preservation (the deepest loss)

`conceptTournament.ts:362-364` flattens the winning concept to a prose `campaignAsk` string before `generateCampaignGenome`. As a result:

- `whyItWorks` — **dropped** (never in the chaining prose).
- director lens/role attribution — **dropped** at `anonymizeConcepts` (needed for unbiased judging, never restored).
- `winnerId` / per-dimension `scores` / `judgeReasoning` — computed + returned (line 377) but **not passed** to `generateCampaignGenome`.
- `title` / `hook` / `coreIdea` / `visualIdea` — **stringified** into prose only; no field map, so the genome LLM may reinterpret or ignore them.

**Zero winner fields are deterministically preserved into the genome.** The deterministic map the code *could* use (`visualIdea→visualMetaphor`, `coreIdea→mechanicTruth/audienceMoment`, `hook→driverTension`, `whyItWorks→emotionalTurn`, lens→`nickSignature`/`creativeTerritory`) is discarded at conceptTournament.ts:331-344. → **M4** owns this.

**M4 (done):** `generateCampaignGenome` now takes a `winnerSeed` and **FORCES** the winner's three identity fields (`visualMetaphor`←visualIdea, `mechanicTruth`←coreIdea, `emotionalTurn`←whyItWorks) into the genome after generation — the LLM fills only genuine gaps. `whyItWorks` (previously dropped entirely) is now in the seed AND the prose. The forced values are pre-sliced to genome limits and re-run through claim safety. Proven: a drifted LLM genome is overridden to the winner on all three fields (genomeGen.test.ts). Still open for later milestones: lens/role attribution restoration, judge scores/reasoning into the genome, and gating reelBriefGen's downstream re-ideation (3.2, M4-continued/M9).

## Smaller drops worth fixing in-flight

- `styleKit` / `safeZoneGuidance` computed in the prompt pack but **never sent to the CLI** (higgsfieldStudio.ts).
- Enum coercions silently swap off-vocab values to the first enum member with no warning: `coerceEnum → Object.keys[0]`, `coerceKeyword → CAMPAIGN_KEYWORDS[0]`.
- The genome safety-retry (genomeGen.ts:110) regenerates the whole object instead of patching flagged fields.

## Milestone 3 (this PR) — what it fixes

`creativeThesis.ts`: a versioned, protected `CreativeThesis` contract locked from the genome (`lockCreativeThesis`), carrying `mechanicTruth`, `premise` (audienceMoment), `customerTension` (driverTension), `visualMetaphor`, `desiredAction`, etc. as **typed data, untruncated** — the exact fields 3.1 dropped. `mustPreserve` = {conceptId, mechanicTruth, visualMetaphor, desiredAction}; `mustNeverIntroduce` = the 690001 defect classes. Threaded into `generateReelBriefAI` as a structured `thesis` field; its readable representation (`serializeThesisForPrompt`) leads the system prompt. `thesisPreservationViolations` is ready for M9's critic guard. Doctrine honored: fields the v1 genome lacks (openingPromise, finalMeaning, memorableFrame, soundMotif) stay **empty, not invented**.

Still lossy and slated for removal once downstream stops reading it: `genomeConstraintBlock` remains as the evidence-provenance channel (additive, not authoritative).

## Milestone 5 — what it fixes (3.4, the compile-boundary guard)

`compileProviderScene(visual, motion)` separates a beat's **creative intent** from the **provider scene**. `buildHiggsfieldReelPromptPack` now compiles each beat and uses the compiled scene as the Seedance `Subject:` — and the in-frame-text + faceless validators run **inside the pack builder**, at the compile boundary. This closes the concrete gap the archaeology named: `dailyReelPost` (the autonomous cron path) builds the pack **without ever calling `runSafetyChecks`**, so a risky beat could reach the provider unguarded. Now every path is guarded. A flagged beat gets a deterministic corrective clause on its Subject, and each beat carries `sceneStatus` + `sceneFindings` for M10's preflight to consume. The full intent→scene **transformation** (zero-lettering rewrites, Section 11) is Milestone 6; M5 is the seam + the universal guard.

## Milestone 6 — zero generated lettering (the 690001 regression corpus)

`transformToProviderSafeScene(visual)` deterministically **neutralizes** the renderable-text tokens a beat carries — brand/logo words → "unbranded surface", quoted labels (`'MAX PRESS 44 PSI'`) → removed, measured readings (`11.8V`, `44 PSI`) → removed, bare alphanumeric codes (`FTD913`) → removed — so the generator has nothing to mis-spell. It's applied at three points inside the pack builder: the Subject, the "previous shot ended on" continuity reference, and the continuity block's `heroAnchor`. Removal (not paraphrase) keeps prose grammatical; the removed meaning is carried by the deterministic caption overlay. A subtle correctness catch: the quote-label regex anchors the opening quote to start-or-space, so a **possessive apostrophe** ("sidewall's") is never mistaken for a label delimiter. Proven against the 690001 corpus (FTD913, 'MAX PRESS 44 PSI', Nick's logo, 11.8V) plus a wordless-passthrough test. Remaining (Section 11, deeper): LLM-grade scene *rewrites* (e.g. "tester displays WEAK BATTERY" → "unbranded tester, screen angled away, a red status light activates") — M6 removes the token and steers with the directive; the full rewrite is a later refinement.

## Milestone 7 — pre-generation Visual Bible (defect-audit the anchor)

`referenceFrameScreen.ts`: before a hero frame becomes the image-conditioning **anchor** (every beat is generated from it, so a defect propagates to the whole reel — audit #11), `screenReferenceFrame(imageUrl)` runs a vision QA over the **actual pixels** (mirroring `observeVisualBible`) for the 690001 classes — generated text, fake/mis-spelled logo, human/hands — plus automotive plausibility and conditioning suitability. `referenceFrameVerdict` is the pure gate: any hard defect or unsuitable frame → reject; a null screen (unavailable) is conservative (reject when the frame *will* be an anchor). Wired into `attachAutonomousVisualWorld`, screening **only when `REEL_IMAGE_CONDITIONING` is on** (a paid vision call is spent only when the frame is actually used as an anchor); a rejected/unavailable screen falls back to text-only. Operator-facing surfacing of the verdict in Studio is M12.

## Milestone 8 — conditioning-aware compiler (no contradictory continuity)

Section 14's contradiction: the compiler told every beat to "continue directly from the previous clip's ending position" even when the hero frame is the shared `--start-image` anchor for all beats — two different continuity strategies at once. `resolveConditioningMode(brief)` now derives the mode (env-free) from whether a hero frame is attached: **hero_image** (share one identity anchor) vs **text_only** (independent clips). In hero_image mode the opening-frame instruction keeps the *shared identity* and composes each beat fresh — it no longer says "continue from the previous clip's final frame" (phrased around identity, so it's true whether or not `--start-image` is literally sent). In text_only mode the aspirational previous-shot continuity stands. Each beat prompt now carries `conditioningMode` for observability.
