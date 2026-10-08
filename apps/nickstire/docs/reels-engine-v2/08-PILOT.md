# Reels Engine v2 — The 8-Reel pilot (production acceptance, not creative laws)

The pilot is angles **A001–A008** of `angle-bank.json`, in that order: the three proof packs plus
five committed packs whose brief already clears preflight. Each row names the real evidence the
Reel cannot ship without (clip numbers are the six-shot set in `05-CAPTURE-CHECKLIST.md`), what a
synthetic shot may do, and the route the shot router gives the evidence beats. Cost is $0 for
every row until a paid lane is authorised; the $0 lane renders an animatic for review and cannot
publish (stock guard, `02-PRODUCTION-DOCTRINE.md` §1).

| # | Angle (pack) | Family | Required real asset | Synthetic allowance | Route | CTA keyword | Truth packet |
|---|---|---|---|---|---|---|---|
| A001 | One edge worn smooth (`2026-10-08-proof-01-uneven-wear`) | A | clip 2 tread macro with the worn edge; clip 3 gauge in both grooves; clip 4 rack screen or hand on the tie rod | none on evidence beats; the four-cause card is deterministic | real + deterministic | TREAD | `uneven_wear` |
| A002 | Highway shake (`2026-10-08-proof-02-highway-shake`) | A | clip 1/2 wheel on the balancer; clip 3 balancer display; clip 4 hands rocking the wheel; clip 2 flat-spot or bulge macro | none; the three-cause card is deterministic | real + deterministic | SHAKE | `vibration` |
| A003 | Patch or replace (`2026-10-08-proof-03-patch-or-replace`) | A | clip 2 nail macro; clip 3 quarter-inch gauge; clip 4 buffed liner + plug-patch; clip 2 shoulder puncture on a scrap tire | none; the repair-zone card is deterministic | real + deterministic | NAIL | `puncture_repair` |
| A004 | Inner pad gone, outer thick (`2026-09-25-inner-outer-brake-pad-wear`) | A | clip 5 both pads side by side on the bench; clip 4 the slide pin; clip 2 rotor scoring macro | none | real | per pack | `brake_wear` |
| A005 | One Cleveland pothole (`2026-08-17-pothole-damage`) | D | a real pothole still (Euclid Ave); clip 2 sidewall bulge; clip 3 bent inner lip on the balancer; the alignment printout | an impact visualisation, labelled, on one beat at most | real + deterministic | per pack | `pothole_damage` |
| A006 | Clicks but will not start (`2026-08-19-wont-start-battery-starter-alternator`) | C | clip 3 tester number on the battery; voltage while cranking; alternator output at idle | none for any number | real + deterministic | per pack | `no_start` |
| A007 | E-Check says not ready (`2026-08-20-echeck-readiness-monitors`) | D | clip 3 scan tool readiness screen; the E-Check station from the curb | the drive-cycle card is deterministic | real + deterministic | per pack | `echeck_readiness` |
| A008 | Worn tire and new tire in the rain (`2026-08-17-tread-depth-rain-vs-snow`) | C | clip 3 gauge in a 2/32 groove and a 10/32 groove under one light; both tires side by side | none for the numbers; the depth card is deterministic | real + deterministic | per pack | `tread_depth` |

Hooks, scripts, beats, captions and audio for A001–A003 are in each pack's `brief.json`,
`README.md` and `captions.srt`; for A004–A008 they are the committed briefs the daily lane already
builds from (`buildBriefFromApprovedProductionPack`). Nothing is restated here so the pack stays the
single source.

## What each Reel needs before it is a Reel (the gates, in the order they fire)

1. `runReelPreflight` — beat count and length band, muted-first text, readability, editorial
   contract (frame-one subject, one idea per card, one CTA last, end card ≤ 2 s), shot-route
   contradictions, grounding, voiceover fit, leaked ask, claim safety, DUA. All pure, $0.
2. Real evidence on the evidence beats: the six-shot set captured and graded `usable` in the
   real-shop pool (`mediaAssets.rightsStatus = real_shop`). **This is the pilot's bottleneck and the
   only part the shop floor owns.** No capture, no Reel — and since 2026-10-08 the generator
   refuses a beat the brief declares REAL (shared/shotRouter.ts), at enqueue and at generation.
3. Assembly (ffmpeg, captions burned, VO + music bed) → rendered QA (vision critic; now re-run when
   it fails to evaluate) → mechanical-truth check at the publish door → exact-asset approval.
4. Publish: the drain, one Reel per day, approval-gated. The proof packs enter the daily rotation
   only on operator instruction (`09-90-DAY-MODEL.md` handoff).

## What the pilot measures (and what it must not)

The pilot measures **production acceptance** — the first six rows of `07-PRODUCTION-METRICS.md`:
brief-to-first-cut time, first-cut acceptance, revisions per accepted Reel, real-footage usability,
cost per accepted Reel, muted intelligibility (the one-tap "followed it muted" note on the approval).
Eight Reels decide whether the machine works. They decide no creative law: with one Reel a day across
two arms the first decision look is ~24 posting days away (`06-EXPERIMENTS.md`), and a pilot that
"won" on three Reels would be the optional-stopping error PR #2923 removed from the resolver.

Trial reels (share-screen toggle, non-followers first, ~24–72 h) are the cold-audience read for a
pilot Reel before it goes to the grid — a platform read, recorded by hand on the approval note.

## Pilot exit criteria

- 8 of 8 assembled with real evidence on every evidence beat (0 synthetic evidence shots).
- First-cut acceptance ≥ 5 of 8; a rejected first cut names a QA class (mechanical / visual / audio /
  trust) and the shot that caused it.
- Cost per accepted Reel recorded with `isEstimate` flagged where the ledger estimates.
- Every exit number is written to `07-PRODUCTION-METRICS.md` as measured; UNKNOWN stays UNKNOWN.
