# Proof Reel 01 — Uneven tire wear (Evidence diagnosis)

**Purpose:** prove macro evidence, deterministic overlays and accurate education, entirely from
real footage plus graphics. No generated vehicle parts. Runtime 20 s of beats + the 3 s end card (declared ask `visit`: STOP BY NICK'S).

**Status (2026-10-08):** brief, captions and shot list are production input; the animatic
(timing/readability) was rendered and reviewed; **no real footage exists yet** — every REAL shot
below has a capture owner in `docs/reels-engine-v2/05-CAPTURE-CHECKLIST.md`. Nothing publishes
from this pack until the real clips are in the pool and the operator approves the exact asset.

Source: `shared/mechanicalTruth.ts` uneven_wear packet (NHTSA/USTMA-grounded allowed statement);
tread-depth figures in beat 2 are an example reading to be replaced by the measured one.

## Shot list and routes

| Beat | Seconds | Route | Shot | Acquisition | QA criteria |
|---|---|---|---|---|---|
| 1 | 0–4 | REAL | macro of the worn inner edge under a raking light | capture clip 2 (tread macro), phone + LED, 9:16 | subject fills the centre 60%; the worn edge is unmistakable sound-off |
| 2 | 4–8 | REAL | tread gauge in the worn groove, then the healthy groove | capture clip 3; hold 0.5 s on each reading | both readings legible on a phone; the numbers on screen are the measured ones |
| 3 | 8–12 | DETERMINISTIC | top-down tire card, inner edge shaded, four cause labels | diagram card renderer (gap — until it exists, the caption carries the four causes) | four labels, no verdict; nothing in the outer 6% |
| 4 | 12–16 | REAL | alignment rack screen or a gloved hand on a tie rod end | capture clip 4 on the next alignment job | no plate/VIN/paperwork; the screen is readable or the hand is on the part |
| 5 | 16–20 | REAL | the beat-1 macro again, then the bay door / exterior | reuse clip 2; capture clip 1 for the exterior | the loop lands on the hook frame; logo only on the end card |

Zero-spend route: real clips → `templateStockStudio` camera moves on the stills if only stills exist
→ assembly captions → VO through `reelVoice` (Google Neural2-J, already configured) → music bed
ducked under VO. Estimated generation cost: **$0** (no AI shot in this Reel).

## Editorial contract check

Frame one = evidence (no logo) ✓ · one idea per card ✓ (longest caption 6 words) · single CTA
("get it checked"; the end card and the caption ask the same: stop by) ✓ · end card ≤ 2 s: the lane's end-card freeze is 3 s — review ✓/✗ with the
operator · readability gate: 0 blocking, 0 warnings · narration 41 words ≈ 21.0 s synthesized vs
23 s audible ✓ · mechanical-truth packets: 0 violations · claim audit: none.

## What the animatic proved and did not

Proved: the five captions read muted at phone size; the beat captions sit ~1% inside Meta's 35%
bottom reserve (doctrine §4 — one constant to move). Not proved: the macro itself. That is the
point of the capture checklist.

## Revision loop

Caption defect → regenerate the caption layer only. Evidence defect → recapture that one clip.
Pacing → change the beat boundaries in `brief.json` (the readability and narration gates re-run).

**Primary caption:**
> One edge of this tire wore smooth. That is the tire telling on something: alignment, pressure, a worn part or skipped rotations. An inspection says which. Stop by Nick's Tire & Auto, Euclid Ave, Cleveland.
> #ClevelandAuto #TireWear #WheelAlignment #NicksTireAndAuto #EuclidAve
