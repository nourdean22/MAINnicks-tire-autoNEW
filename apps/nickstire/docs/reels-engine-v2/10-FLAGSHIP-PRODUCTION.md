# Reels Engine v2 — Flagship production package (2026-10-09)

One package for the three flagship Reels, synthesized from this folder (01–09), two operator reports
of 2026-10-09 ("Reconciliation and Flagship Execution Gate", "Creative Theft Manual") and read-only
production reads the same day. Where the reports disagree, the stricter rule wins. Nothing here
spends money or publishes.

## Ground truth it is built on (read 2026-10-09)

| Fact | Evidence | Level |
|---|---|---|
| The real-shop media pool is empty | `media_assets` has 0 rows with `rights_status = 'real_shop'` | FACT |
| No Reel has posted since 2026-10-04 04:08Z, and none was produced on 10-09 | `reel_jobs`, `cron_log` "production held: usable READY buffer 2"; fixed by #2940 (main `8175758a`, deployed 2026-10-09; live proof due at the 2026-10-10 ET 06:00 pulse) | FACT |
| Higgsfield: Ultra plan, 2,863 credits; a 3,000 grant on 2026-10-07 03:26Z | account `balance` + `transactions`; balance = grant minus the 137 spent since | FACT |
| The pipeline's CLI spends draw that same website-credit pool | Seedance 1.5 Pro at 12 credits per 4 s clip at the minutes job 2040001 generated (10:17–10:23Z) and repaired (17:27Z); GPT Image 2.0 at 6.5 | FACT (same ledger, same minutes) |
| Unused credits reset at the next grant, about 2026-11-07 | balance equals the grant minus spend exactly; no carry-over visible | STRONG INFERENCE |
| No Unlimited allowance is usable by automation on this account | model catalog `unlim.available = false` | FACT |
| Reels publish around 00:08 ET | the drain publishes on the first pulse of the ET day; the analytics "best hour 0" is media-type confounded (26 Reels at 0 ET, images at 8/13/20) | FACT; no change made, see Slots |
| Job 2040001 should be retired | 13 blocking findings; frames show the penny jammed in a gouged hole, then lying flat | FACT (frames + verdict) |
| E-Check still applies in Cuyahoga County | Ohio EPA was directed on 2026-09-29 to begin ending it in 7 NE Ohio counties; testing continues until U.S. EPA approves; public comment in October, request by year-end | STRONG (Governor's bulletin + local press) |

## Order of work

1. **Freeze new features** until three finished Reels prove the system. Defect fixes are not features.
2. **Capture day** (below). The pool must be non-empty before any flagship edit starts.
3. **Reel C first** — real footage only, 0 credits, highest trust value.
4. **Reel B second** — real balancer evidence plus a deterministic cause graphic.
5. **Reel A third** — one hero shot through a bounded model benchmark.
6. **Covers and first frames** tested on their own, at phone size, three variants each.
7. Only after human review: the pilot (A001–A008 + A027), then two daily slots, then the 62-slot slate.

## Where it stands (2026-10-09, end of day)

| Item | State | Owner |
|---|---|---|
| READY deadlock and paid-repair economics (#2940) | deployed; live proof at the 2026-10-10 ET 06:00 pulse | code |
| Jobs 2040001 and 1770004 | retire in Instagram > Queue | operator |
| Old-style daily lane spend (about 60 credits per Reel) | keep, or hold with `REEL_AUTOPOST_ENABLED=false` | operator |
| Capture day | not booked | shop |
| Reels C, B, A | blocked on capture day | after capture |
| Pilot | blocked: every pilot Reel needs real evidence and the pool is empty | after capture |
| Two daily slots | on hold: one Reel a day must post reliably first, and the hour data is confounded | judgment call |
| 62-slot slate | on hold per the Creative Theft Manual; a provisional draft from the angle bank costs 0 credits and was offered | operator's call |

## Memory devices (recur; never a template)

- **Visual:** a safety-yellow magnetic proof pointer touches the evidence at the reveal.
- **Verbal:** "Don't guess. Prove it." Spoken by the technician, not burned into every card.
- **Audio:** one original two-second shop sound recorded on capture day (impact pulse or air release), used at the reveal.
- **Behavioral:** the technician physically points at the proof at the payoff.

Brand lands at the reveal, not only on the end card. Mutation rule for anything borrowed from a
reference: change at least three of subject, setting, evidence, protagonist, structure, visual
treatment, payoff, brand device. Steal the mechanism, never the footage, script, music or look.

## Reel C — "Outside fine, inside ruined" (A003, pack `2026-10-08-proof-03-patch-or-replace`)

- **First frame:** the real nail in the tread, pointer on it. On-screen: "PATCH IT?"
- **Structure:** nail, viewer vote, tire off the wheel, inner liner under raking light, the repairability rule, plug-patch seated or the tire rejected, end card under 2 s.
- **Real captures:** puncture job clips P1–P8 below. **Synthetic:** none. Only a deterministic locator ring and a cross-section card for the inside patch.
- **Truth (Tier 1, USTMA):** repairs need the tire demounted for an inside inspection; tread area only; injury 1/4 inch or smaller; a plug and patch together, not a plug alone. Shoulder and sidewall injuries are not repaired.
- **Fallback if no puncture comes in:** A027, the soap-test slow leak (one spray bottle on any low tire).
- **Instagram:** "Nail in the tread. Patch it or replace it? The outside can't answer that. A proper repair starts with the tire off the wheel so the inside gets inspected: tread area only, a quarter inch or smaller, plug and patch together. Comment NAIL if you've got one. #ClevelandOH #TireRepair #PatchOrReplace"
- **Facebook:** "Would you patch this tire? Here's how we decide at Nick's Tire & Auto on Euclid Ave: the tire comes off the wheel, we inspect the inside, and only tread-area punctures a quarter inch or smaller get a plug-patch. Sidewall or shoulder means a new tire."

## Reel B — "Why only at 65?" (A002, pack `2026-10-08-proof-02-highway-shake`)

- **First frame:** a real wheel spinning at full speed on the balancer, readout visible. On-screen: "ONLY AT 65?"
- **Structure:** symptom; four suspects on one card (balance, tire damage or out-of-round, bent wheel, worn steering or suspension); balancer reading; hands checking play; each suspect leaves the card only when evidence rules it out; close on "Speed says where to start. Not the answer."
- **Real captures:** balance job B1–B6. **Synthetic:** the cause card is deterministic. At most one heavy-spot cutaway, labelled "illustration", and only if the card cannot carry it.
- **Truth:** speed narrows the search; it is not a diagnosis. The `vibration` truth packet needs a cited source or the technician's sign-off before publish.

## Reel A — "The last safe millimeter" (A008, pack `2026-08-17-tread-depth-rain-vs-snow`)

A008, not A001: A001 is a wear diagnosis; this brief needs a worn-versus-new reveal.

- **First frame:** split macro, worn tread beside new tread under one raking light, water starting to move. On-screen: "LOOK THE SAME?"
- **Structure:** visual difference; gauge in a 2/32 groove and a 10/32 groove; wear bar flush; one hero transformation shot; decision rule.
- **Real captures:** tread pair T1–T6. **Synthetic:** one labelled hero shot, worn to new, camera and wheel locked. No hydroplaning claim beyond what NHTSA states.
- **Truth (Tier 1, NHTSA):** tread provides wet and icy traction; replace at 2/32 inch.
- **Send trigger:** "Send this to the person who says the tread still looks fine."

## Capture day — 90 minutes, one harvest for all three

Phone vertical, focus and exposure locked, the clamp mount does not move between a before and an
after. Never plates, VINs, faces without consent, paperwork, customer voices or identifying screens.
Five to eight seconds per clip, with handles.

| Group | Clips |
|---|---|
| Puncture job (Reel C) | P1 nail macro with the evidence card · P2 quarter-inch reference held to the injury · P3 tire coming off the wheel · P4 inner liner under raking light · P5 buffing · P6 plug-patch seating · P7 shoulder or sidewall puncture on a scrap tire · P8 final soap leak check |
| Balance job (Reel B) | B1 wheel spinning at full speed, locked mount · B2 readout held 2 s · B3 weight going on · B4 hands rocking the wheel for play · B5 any real bulge or flat spot · B6 re-spin reading zero |
| Tread pair (Reel A) | T1 worn and new tire side by side, same light · T2 gauge in a worn groove, held 2 s · T3 gauge in a new groove, held 2 s · T4 wear-bar macro · T5 finger on the worn edge · T6 water poured across both treads |
| Shop identity | ten atmosphere clips (bay door, lift, wheel roll, impact, compressor, hands, signage) · six neutral hand shots for covers |
| Audio, 5 s each | ratchet · impact · air release · balancer start · shop door · room tone |

Log every clip: job, subject, privacy status, truth class (evidence or atmosphere), audio quality,
rights (`real_shop`, reuse allowed). An unusable clip is marked unusable, never forced into an edit.

## Production route

Since 2026-10-09 the assembly lane carries real footage and drawn cards itself
(`13-SOURCE-AWARE-ROUTE.md`): a beat declared REAL binds the registry clip named by its
`realAssetId` (verified `real_shop` video, exact sha256, probed duration, up to 12 s on screen), a
beat declared DETERMINISTIC is drawn locally from its `cardLines`, and the finished MP4 carries a
per-shot lineage the disclosure gate reads. What it still needs is the footage: register each capture
as a `real_shop` video row and put its id on the beat. Until then the proof packs hold at enqueue
with `needs_real_footage`, by design. A hand cut with the bundled ffmpeg remains a valid fallback
for a one-off, but it carries no lineage and must not claim the lane's provenance.

Each finished Reel ships with a 1080×1920 faststart MP4, a cover, both captions, a source manifest
(real or synthetic per shot, model and prompt version, credits), safe-zone, muted-first and audio
checks, and a scored review sheet.

## Review sheet (score before any paid repair)

| Dimension | Weight | Fails when |
|---|---:|---|
| First-frame comprehension | 15 | the object or problem is unclear without sound |
| Curiosity specificity | 10 | the hook is vague suspense, not a precise question |
| Visible proof | 20 | a claim is asserted, not shown |
| Mechanical truth | 15 | an unsupported diagnosis or a wrong visualization |
| Brand memory | 10 | another shop could repost it unchanged |
| Emotional payoff | 10 | no surprise, relief, satisfaction or use |
| Native execution | 10 | unsafe text, weak audio, unreadable cover |
| Send or save utility | 5 | no person or moment to share it with |
| Local relevance | 5 | Cleveland is cosmetic |

Reject below 80, or on any mechanical-truth failure. A repair targets the failed dimension.

## Spend envelope (Higgsfield credits; staged, never pooled)

| Stage | Cap | Rule |
|---|---:|---|
| Capture, scripts, covers, deterministic cards | 0 | none |
| Reel A hero benchmark | 30 | same 4 s brief and source still; Seedance 1.5 Pro (current) against at most two alternatives the catalog lists for this account; stop a model after two failures on one constraint |
| Reel A first cut, best route | 30 | none |
| One correction after human review | 30 | only against a named defect |
| Reserve | 30 | only for a near-accepted asset |

Total at most 120 of 2,863. The daily autopilot lane spends separately, about 60 credits per Reel
at five clips. Holding it while the flagship runs is the operator's call (`REEL_AUTOPOST_ENABLED`
on Railway, or the daily generation cap in the autonomy panel).

## Slots and posting time

The data cannot pick an hour yet. Reels at 0 ET averaged 567 reach (26 posts, Aug 29 to Oct 4);
Reels at 14 ET averaged 269 (14 posts, Jul 20 to Sep 28). The periods differ, so the gap may be
content, not timing. Test it inside the two-slot phase, Discovery and Trust on separate keys and
separate hours, once two approved Reels a day exist.

## Not built, on purpose

The reference genome (fields on angle-bank entries, not a new database), the twelve-series slate
and the 62-slot plan wait for the three finished Reels. Series vocabulary for that slate: Don't
Guess. Prove It · The Tire Autopsy · Why Only Here? · 60 MPH Only · Cleveland Pothole Autopsy ·
Salt vs. Car · Lake-Effect Ready? · E-Check: True Today · Patch or Replace? · What We Didn't Sell ·
Estimate Evidence · One-Minute Second Opinion.
