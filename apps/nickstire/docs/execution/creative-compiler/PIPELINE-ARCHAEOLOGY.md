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

**Zero winner fields are deterministically preserved into the genome.** The deterministic map the code *could* use (`visualIdea→visualMetaphor`, `coreIdea→mechanicTruth/audienceMoment`, `hook→driverTension`, `whyItWorks→emotionalTurn`, lens→`nickSignature`/`creativeTerritory`) is discarded at conceptTournament.ts:331-344. → **M4** owns this: pass the winner as structured inputs + assert genome lineage.

## Smaller drops worth fixing in-flight

- `styleKit` / `safeZoneGuidance` computed in the prompt pack but **never sent to the CLI** (higgsfieldStudio.ts).
- Enum coercions silently swap off-vocab values to the first enum member with no warning: `coerceEnum → Object.keys[0]`, `coerceKeyword → CAMPAIGN_KEYWORDS[0]`.
- The genome safety-retry (genomeGen.ts:110) regenerates the whole object instead of patching flagged fields.

## Milestone 3 (this PR) — what it fixes

`creativeThesis.ts`: a versioned, protected `CreativeThesis` contract locked from the genome (`lockCreativeThesis`), carrying `mechanicTruth`, `premise` (audienceMoment), `customerTension` (driverTension), `visualMetaphor`, `desiredAction`, etc. as **typed data, untruncated** — the exact fields 3.1 dropped. `mustPreserve` = {conceptId, mechanicTruth, visualMetaphor, desiredAction}; `mustNeverIntroduce` = the 690001 defect classes. Threaded into `generateReelBriefAI` as a structured `thesis` field; its readable representation (`serializeThesisForPrompt`) leads the system prompt. `thesisPreservationViolations` is ready for M9's critic guard. Doctrine honored: fields the v1 genome lacks (openingPromise, finalMeaning, memorableFrame, soundMotif) stay **empty, not invented**.

Still lossy and slated for removal once downstream stops reading it: `genomeConstraintBlock` remains as the evidence-provenance channel (additive, not authoritative).
