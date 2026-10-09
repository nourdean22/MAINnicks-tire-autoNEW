# Capture checklist — six clips per usable job

The production bottleneck is not ideas; it is obtaining usable shots. This is the shop-floor
contract that feeds the `real_shop` asset pool (`mediaAssets.rightsStatus`) the Reel lane already
reads through `realAssetFirst.ts`. Print it; clip it near the inspection station.

## Kit (simpler than the first report asked for)

- One recent phone with locked focus and exposure (tap-and-hold, AE/AF lock).
- Clamp, tripod or magnetic mount — the camera must not move between a *before* and an *after*.
- Small diffused LED inspection light; rake it across tread, rotors and threads.
- Macro attachment only if the phone cannot focus inside ~8 cm.
- Neutral cleaning cloth and a small dark background card.
- A printed evidence card (business-card size, matte black, gold type, laminated): a case
  number, a 1/32-inch and millimetre scale strip along one edge, and a blank line for one word
  in grease pencil (INSPECT · MEASURE · REPAIRABLE AREA · REPLACE). Set it beside the defect in
  clips 2 and 3. It is the scale reference a viewer needs to read a macro, and it carries no
  customer data: never the plate, the name or the invoice number.
- This page.

## Six clips for every usable job (5–8 s each, with handles before and after the action)

| # | Clip | What makes it usable | Family it unlocks |
|---|---|---|---|
| 1 | Vehicle or component context | neutral angle, no plate, no interior paperwork | all |
| 2 | Defect macro | light raking across the defect; the defect fills the centre 60% | Evidence diagnosis |
| 3 | Measurement or diagnostic evidence | gauge / tester / scan screen readable; hold 2 s on the number | Measurement proof |
| 4 | Technician action | hands and tool on the real component; no face | Evidence diagnosis, Transformation |
| 5 | Removed or corrected component | on the bench or the lift, same light | Transformation |
| 6 | Matched final state | **same mount position, lens, distance, exposure and object orientation as clip 2** | Matched transformation |

Vertical (9:16) first; a second landscape take only when the subject needs it. Keep the subject
inside the central 60% of height — Instagram's UI covers the top ~14% and bottom ~35%.

## Shots the proof Reels and the soap test still need (none exist in the repo; the pool is the only source)

| Reel | Clip | Owner |
|---|---|---|
| 01 uneven wear | tread macro with one edge worn smooth (clip 2); tread gauge in the worn and the healthy groove (clip 3); alignment rack screen or hand on a tie rod (clip 4); same macro again for the loop | technician on the next alignment or tire job |
| 02 highway shake | wheel spinning on the balancer (clip 1/2); balancer display with correction weights (clip 3); hands rocking a wheel at 12–6 and 9–3 on the lift (clip 4); sidewall bulge or flat-spot macro (clip 2) | technician on the next balance job |
| 03 patch or replace | nail in the tread macro (clip 2); quarter-inch gauge beside the puncture (clip 3); inner liner buffed and the plug-patch seated (clip 4); a shoulder/sidewall puncture macro (clip 2) | technician on the next repair — the sidewall example can be a scrap tire |
| A027 soap test (the ninth pilot Reel, `08-PILOT.md`) | soap film over the bead seat, valve stem and tread, bubbles growing at one spot (clip 2); the leak marked with the evidence card beside it (clip 3); the plug-patch or new valve core going in (clip 4/5); the same spot sprayed again, no bubbles (clip 6) | whoever checks the next tire that comes in low — one spray bottle |

## Before an asset enters the creative library

Exclude or remove: plates, VINs, faces, paperwork, screens with customer data, voices. A clip
that cannot be cleaned is not usable; mark it `privacy_blocked` rather than hoping.

## Grades (write one per clip when it is added to the pool)

`usable` · `salvageable` (needs a crop or a re-light) · `missing_context` (what is this?) ·
`privacy_blocked` · `unusable`. The pool today has no grade field; until it does, the grade goes in
the asset's note (the enrichment lane reads notes).

## Natural sound

Capture 5 s of each when it happens: impact tool, ratchet, tire machine, lift, bay door, rain on
the lot, road noise from the curb. Sound carries energy, never a factual claim.
