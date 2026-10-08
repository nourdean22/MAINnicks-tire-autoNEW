# Reels Engine v2 — Creative standard and content families

## Lock the standard, not the formula

The mission asked to "codify the Reel formula"; the audit is right that a locked formula ages
badly. What is locked is the **standard**; what stays free is the **structure**.

| Locked (every Reel) | Enforced today by | Flexible (per Reel) |
|---|---|---|
| Brand: Nick's Tire & Auto, Cleveland; no invented warranties/wait-times/reviews; "Payment Programs" never "financing" | `lint:brand-voice`, `brandTruth.test.ts` | story structure, scene count |
| Technical accuracy: every mechanical statement defensible; packets' prohibited claims never made | `shared/mechanicalTruth.ts` at the publish door; `reelClaimAudit` | hook type, educational depth |
| Visual quality: no generated text/logos in plates; no melted tools; identity stable across beats | `RENDERED_DEFECT_CODES` (vision critic), pixel pre-flags, flash scan | camera treatment, creative territory |
| Originality: not a recycled clip; distinct from recent Reels | `reelOriginality`, repetition signals, hook-fatigue steer | duration (within the lane's band) |
| Output specs: 1080×1920@30, H.264/AAC, captions burned, muted-first clarity | assembly + preflight | audio bed / foley mix |
| Customer relevance: a Cleveland driver's actual question | topic miner, angle bank (feasibility-graded) | — |
| One CTA, appropriate to the evidence shown | `ctaType`, campaign keyword | which CTA |
| Claim provenance: a real asset is `real_shop`; a synthetic shot never documents real work | registry `rightsStatus`; per-shot `source` (gap) | — |

## Four initial families (producible with what exists), four deferred

The eight families in the mission are kept as the long-run map; the audit's four are the entry
set because each can be produced from real stills + deterministic cards + the $0 lane.

| Family | Structure | Opening (frame one) | Real asset required | Synthetic allowance | Repo hook |
|---|---|---|---|---|---|
| **A. Evidence diagnosis** | symptom → visible evidence → what it can mean → what inspection determines → next action | the symptom or the evidence, never a logo or a generic moving car | defect macro or measurement shot | abstract transition only | `vibration`, `uneven_wear`, `pothole_damage` packets keep uncertainty honest |
| **B. Matched transformation** | worn/damaged state → one or two process details → matched finished state → result + limitation | the before shot | before + after from the same camera position (§capture rule) | atmospheric transition only | originality: a matched pair is unmistakably ours |
| **C. Measurement proof** | customer question → tool touches component → readable number → interpretation → decision boundary | the tool on the component | gauge / tester / scan screen in frame | none for the number | `tread_depth` packet: 2/32" is replace-now, not a margin |
| **D. Cleveland utility** | local condition → mechanical consequence → quick inspection → shop action | the road / weather condition | real local road or weather still | map or impact visualisation, labelled | `clevelandAngle` on the brief exists |
| E. Myth Court *(deferred)* | misconception → strongest counter-evidence → resolution | the myth as text over evidence | evidence shot | — | enters after A–D hold two weeks of accepted output |
| F. Useful absurdity *(deferred)* | surprising visual, accurate mechanism | the surprise | — | the surprise itself (AI, labelled) | `shared/absurdityConcepts.ts` exists; judge codes price plastic/generic looks |
| G. Customer questions *(deferred)* | privacy-safe question → concise answer | the question card | — | — | needs the consent/privacy treatment first |
| H. Direct-response service *(deferred)* | driver concern → how Nick's helps → make visiting easy | the concern | shop exterior / bay arrival | — | brand-voice gate; one CTA |

## Visual identity — Cleveland Mechanical Noir as the core universe, not the only one

Keep: matte black, graphite metal, controlled gold highlights, realistic shop lighting, macro rubber
and metal textures, real Cleveland road conditions, strong framing, restrained presentation. The
repo already judges palette **per motion lens** (`LENS_PALETTES` in `facelessReelStudio.ts`, the
critic's `PALETTE_DRIFT` is graded against the lens the generator was handed), so a bright daylight
world is not drift and documentary footage is allowed to look like documentary footage.

Format contracts (all in `02-PRODUCTION-DOCTRINE.md` §4): native 9:16; Meta safe zones; readable
overlays (readability gate); consistent logo and contact information on the end card only; captions
burned deterministically; no AI-distorted tools or components (critic codes); no watermark; no
fabricated shop scene presented as real evidence (per-shot `source`).

## Hook intelligence — reuse, then the one real gap

What exists: the beat-1 **hook grammar** classifier and saturation steer (`shared/reelHookGrammar.ts`,
PR #2923), the measured hook scoreboard the generator consumes, the Concept Tournament rubric and
the independent judge, hook_style experiment arms (`baseline` vs `direct`), Pattern Lab. What the
mission's ten-criterion rubric adds that none of those measure: **does frame one carry curiosity
sound-off, and is the emotional/visual promise consistent with the payoff?** That is a preflight
question on the brief (beat-1 `onScreenText` + `visual` vs the last beat's payoff), not a new
model — it belongs in the editorial contract checker (§8 of the doctrine), not in another scorer.
No fear, no fake urgency: the packets' prohibited claims and the brand-voice lint already refuse the
worst of it; the rubric's "action relevance" is the single CTA rule.
