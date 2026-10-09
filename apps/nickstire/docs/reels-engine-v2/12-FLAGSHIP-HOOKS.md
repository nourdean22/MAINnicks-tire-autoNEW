# Reels Engine v2 - Flagship hooks (2026-10-09)

Nine opening treatments, three per flagship, each changing the opening visual or mechanism, not the first
sentence over the same footage. One body per flagship is shared by its three hooks, so a hook test buys one
body and three 4 s openings. Hook tests happen before D1; Day 1 = first day two approved Reels exist (D1..D31, America/New_York).

## Rules every hook obeys

- Frame one carries the subject, never a logo or plate; one idea per card (`shared/editorialContract.ts`).
  Hand-cut flagships use a 2 s end card by choice. A lane render gets the 3 s freeze
  (`REEL_OUTPUT_RULES.saveFreezeSeconds`, `client/src/lib/facelessReelStudio.ts`; unconditional,
  `server/services/reelAssembly.ts`); editorialContract's 2 s rule is a preflight warning on a storyboard beat
  whose visual names an end card, not a precedence rule over the READMEs' 3 s.
- Readability (`client/src/lib/facelessReelStudio.ts`, `validateOnScreenReadability`): a beat blocks above
  4 words/s and warns above 3 words/s after a 0.3 s allowance, so a card read in 2 s warns above 5 words
  and blocks above 8. Every card below is 5 words or fewer. "2/32" and "1/4" count as one word each.
- Truth packets (`shared/mechanicalTruth.ts`), each prohibited claim given by id or by its reason, never as
  the affirmative sentence (the file's own rule for `buildTruthPacketFragment`): `puncture_repair` (USTMA;
  `plug_alone_is_proper_repair`: a plug alone is not a complete repair; `sidewall_is_repairable`: sidewall
  and shoulder are not repairable; `every_puncture_repairable`: size and position decide); `tread_depth`
  (NHTSA; `safe_until_bald`; `two_32_is_plenty`: 2/32 is the replace point, not a margin;
  `wrong_legal_minimum`); `vibration` (`sources: []`; `vibration_single_certain_cause`: no one cause stated
  as certain). No card or spoken line below matches any of them (`mechanicalTruthViolations`: 0 over the 9
  cards and 9 spoken lines).
- No ask in a hook. The one ask lives on the end card; the `shared/reelAsk.ts` patterns ("stop by",
  "send this to", "comment WORD", "call us") never appear in a hook card or spoken line.
- Memory devices (`docs/reels-engine-v2/10-FLAGSHIP-PRODUCTION.md`): the safety-yellow magnetic proof
  pointer (visual); "Don't guess. Prove it." spoken by the technician (verbal); the original two-second shop
  sound at the reveal (audio); the technician pointing at the proof (behavioral). The body carries all four
  at its reveal for every hook; the device named per hook is the one inside 0-4 s; the verbal line is never in a hook.
- Sound at 0-2 s is literal foley from the capture-day audio row (ratchet, impact, air release, balancer
  start, shop door, room tone; `10-FLAGSHIP-PRODUCTION.md`) plus the tire machine and lift from
  `05-CAPTURE-CHECKLIST.md`. No music under a hook.
- Evidence class is one of the mission's six (`Nicks_Creative_Quality_Coder_Mission_2026-10-09.md`): VERIFIED
  SHOP EVIDENCE, VERIFIED EXTERNAL FACT, REPRESENTATIVE DEMONSTRATION, SYNTHETIC ILLUSTRATION, STRONG INFERENCE, UNKNOWN.
- Credits: every hook is cut from capture clips, so all nine cost 0. The only credit line in this file is
  Reel A's body hero shot (12 credits, Seedance 1.5 Pro, one 4 s 1080p clip, labelled "illustration";
  `10-FLAGSHIP-PRODUCTION.md` spend envelope), and the 0-credit match cut is tested before it is bought.
- Clip ids are the capture-day table in `10-FLAGSHIP-PRODUCTION.md` (P1-P8, B1-B6, T1-T6). A hook that
  needs an extra take of a listed clip says so; none needs a clip the table does not have.
- A hook is 4 s, the pack brief's beat 1: 0-2 s is the motion described, 2-4 s hands off to the body's first
  subject. Cuts are made by hand with the ffmpeg in `@remotion/compositor-win32-x64-msvc`
  (`10-FLAGSHIP-PRODUCTION.md`, Production route): three openings concatenated onto one body file.

## Flagship C - Patch or replace (A003, `docs/reel-packs/2026-10-08-proof-03-patch-or-replace`)

Default: C2, because the pack brief and `10-FLAGSHIP-PRODUCTION.md` both fix frame one as the nail with the
question, and the mission's C treatment is a prediction before the interior reveal; C1 and C3 test against it.

### C1 - Evidence reveal: the inside first
- Frame one: the inner liner of the dismounted tire under raking light, the nail tip breaking through from
  inside, centred, no text. 0-2 s: the light sweeps once across the liner; at 1.4 s the yellow pointer lands
  beside the exit point. 2-4 s: cut to the same nail from outside (P1) so beat 2's gauge lands on it.
- Card at 0.6 s: "This is the inside." Spoken: "This is the side of the nail you never see." Sound: room
  tone, tire machine idling.
- Promise: what the inside decides that the outside cannot; paid by beat 4 (liner, plug-patch) and beat 6
  (the decision). Device: visual, the pointer at the exit point.
- Evidence: VERIFIED SHOP EVIDENCE when P4 is the job tire; REPRESENTATIVE DEMONSTRATION on a scrap tire,
  and then the first card reads "Demo. This is the inside." Clips: P4, P1. Credits: 0.
- Risk (truth): the liner exists only after dismount, so the loop no longer lands on the nail the brief's
  `loopIdea` names; beat 6's bay-door exit hides the seam, and the review sheet scores it anyway.

### C2 - Specific question: the vote (default)
- Frame one: the nail head in the tread (P1), raking light, the evidence card beside it, grease-pencil line
  blank; no text for 0.3 s. 0-2 s: a gloved finger taps the nail head twice at 0.8 s; the quarter-inch
  reference (P2) slides in at 1.5 s and stops beside the hole. 2-4 s: hold; the reference stays for beat 2.
- Card at 0.3 s: "Patch it, or replace it?" Spoken: "Patch it or replace it? Decide before we do." Sound:
  room tone, one ratchet click at 0.8 s.
- Promise: the rule that decides, and whether the viewer guessed right; paid by beat 2 (the measurement)
  and beat 6 (the decision). Device: behavioral, the finger on the nail.
- Evidence: VERIFIED SHOP EVIDENCE (a real puncture on a real job tire); the vote itself claims nothing.
  Clips: P1, P2. Credits: 0.
- Risk (truth): the body ends wherever the real injury goes, repair or replace; the nail is never swapped
  for a different tire so the vote lands the way the script would like.

### C3 - Useful contradiction: holds air, still comes off
- Frame one: soap film over the nail in the tread, no bubble rising (the P8 setup, one extra take before
  dismount on the job tire), centred, no text. 0-2 s: the bottle mists the nail again at 0.5 s, still no
  bubble; at 1.6 s cut to the bead breaking on the tire machine (P3). 2-4 s: the tire leaves the wheel.
- Card at 0.4 s: "Holds air. Still comes off." Spoken: "It holds air. It still comes off the wheel."
  Sound: tire machine, then the air release at the bead break (1.6 s).
- Promise: why a tire that holds air is opened anyway; paid by beat 3 (plug plus inside patch) and beat 4
  (inspected inside first). Device: audio, the air release at the bead break is this hook's reveal.
- Evidence: VERIFIED SHOP EVIDENCE; the no-bubble take and the dismount are the same job tire, same
  session. Clips: P8 (extra take before dismount), P3. Credits: 0.
- Risk (mechanical): a slow leak can show no bubble in two seconds; the card says "holds air", never "no
  leak", and the inside is read in beat 4, not here.

### Body edit reuse - C
- Body = pack brief beats 2-6 (4-24 s), unchanged, plus one 2 s end card (the hand-cut choice; a lane render
  would get the 3 s freeze) carrying the declared ask `visit`; the three hooks replace beat 1 (0-4 s) only.
- Beat 2: the quarter-inch reference beside the puncture (P2), the mark readable. Beat 3: the deterministic
  cross-section card, PLUG and INSIDE PATCH labelled, nothing else.
- Beat 4: inner liner under the light, buffing, the plug-patch seating (P4, P5, P6); hands only.
- Beat 5: a shoulder or sidewall injury on a scrap tire with the zone outline (P7).
- Beat 6: the nail with the outline, then the bay door; the loop lands on the nail for C2 and C3.
- Voiceover identical from 4 s. Reveal devices live in beat 4: pointer on the liner, the technician's finger,
  the 2 s shop sound, and "Don't guess. Prove it." spoken once.
- Credits: 0 (real or deterministic throughout). Block before any cut: beat 4 needs the shop's approval to
  film a real repair (pack README); until then C is held, not faked with a scrap-tire repair.

## Flagship B - Why only at 65? (A002, `docs/reel-packs/2026-10-08-proof-02-highway-shake`)

Default: B2, because it is the driver's own words (angle-bank A002: "Why does my steering wheel shake only
above 55?", `docs/reels-engine-v2/angle-bank.json`) and the frame `10-FLAGSHIP-PRODUCTION.md` fixes; B1 and
B3 test against it.

### B1 - Evidence reveal: the number first
- Frame one: the balancer readout (B2), wheel stopped behind it, both correction values legible, centred,
  no text. 0-2 s: hold; the pointer touches the larger value at 1.2 s; at 1.8 s rack focus to the wheel
  behind as it spins up (B1). 2-4 s: full speed, readout still in frame, so beat 2 cuts back to the display.
- Card at 0.5 s: "One number. Not the answer." Spoken: "This is the first number we check. Not the
  last." Sound: room tone, then balancer start at 1.8 s.
- Promise: what the number can and cannot say; paid by beat 2 (the weight) and beat 6 ("Speed says where
  to start. Not the answer."). Device: visual, the pointer on the readout.
- Evidence: VERIFIED SHOP EVIDENCE (a real reading from a real balance job); the car's symptom is never
  stated. Clips: B2, B1. Credits: 0.
- Risk (rights): the display mirrors whatever stands in front of it; shoot the readout off-axis so no face
  or plate is in the glass (pack README, beat 2 QA).

### B2 - Specific question: why only at 65 (default)
- Frame one: the wheel at full speed on the balancer (B1), rim inside the central 60%, readout at the edge
  of frame, no text for 0.3 s. 0-2 s: static camera, the tread blur holds; at 1.6 s the cycle ends, the
  wheel starts to slow and a gloved hand points at the readout. 2-4 s: it slows into beat 2's display.
- Card at 0.3 s: "Why only at 65?" Spoken: "Smooth at 40. Shakes at 65. Why?" Sound: balancer start under
  frame one, room tone.
- Promise: a reason speed matters; paid by beat 2 (the balancer number) and beat 3 (three places to look),
  closed by beat 6. Device: behavioral, the hand pointing at the readout at 1.6 s.
- Evidence: VERIFIED SHOP EVIDENCE (real wheel, real balancer). Clips: B1, B2. Credits: 0.
- Risk (mechanical): 65 and 40 are a contrast, not thresholds; the `vibration` packet allows no
  speed-to-cause claim, so neither the hook nor the body says the speed names balance.

### B3 - Useful contradiction: zero is not done
- Frame one: the re-spin readout showing zero (B6), wheel stopped, the pointer already on the zero,
  centred, no text. 0-2 s: hold 0.8 s; cut to gloved hands rocking a wheel at twelve and six on the lift
  (B4), the rock visible. 2-4 s: the hands move to nine and three; cut to beat 2's display.
- Card at 0.4 s: "Zero here. Not done yet." Spoken: "A zero on the balancer does not end the check."
  Sound: room tone, then the lift at the cut.
- Promise: what gets checked after the balancer reads zero; paid by beats 3, 4 and 5 (the roughly 3 s of B4
  here, 0.8-4 s, is paid in full at beat 4). Device: visual, the pointer on the zero.
- Evidence: VERIFIED SHOP EVIDENCE for the zero and the rock; the multi-cause statement is the `vibration`
  packet's allowed claim, STRONG INFERENCE until it carries a source or a sign-off. Clips: B6, B4. Credits: 0.
- Risk (truth): this is not "we balanced it and it still shook", which the mission says needs the actual
  case; the card says the check continues, never that a shake remained. Prior art with the same truth:
  `docs/reel-packs/2026-09-25-balancer-zero-still-vibrates/brief.json`.

### Body edit reuse - B
- Body = pack brief beats 2-6 (4-24 s), unchanged, plus one 2 s end card (the hand-cut choice; a lane render
  would get the 3 s freeze) carrying the declared ask `visit`; the three hooks replace beat 1 (0-4 s) only.
- Beat 2: the display and a weight tapped on (B2, B3); 2 s on the numbers.
- Beat 3: the deterministic three-column card, no verdict. `10-FLAGSHIP-PRODUCTION.md` lists four suspects
  (it adds the bent wheel); the brief's "tire or wheel damage" column covers it, and no hook names a suspect.
- Beat 4: hands rocking the wheel at twelve-six, then nine-three (B4). Beat 5: bulge or flat spot (B5).
- Beat 6: the wheel spinning down (the B1 take), exterior for the last second. Loop: B2 restores the brief's
  `loopIdea` (spinning down into spinning up); B1 and B3 open on a readout, so their loop lands one cut later.
- Voiceover identical from 4 s. Reveal devices live in beat 2: pointer on the readout, the technician's
  finger, the 2 s impact pulse under the weight tap, and "Don't guess. Prove it." spoken once.
- Credits: 0. Block before publish: the `vibration` packet has no source (`shared/mechanicalTruth.ts`,
  `sources: []`) and needs a cited source or the technician's sign-off (`10-FLAGSHIP-PRODUCTION.md`).

## Flagship A - working title "Worn beside new" (A008, `docs/reel-packs/2026-08-17-tread-depth-rain-vs-snow`)

Renamed 2026-10-09: the earlier working title was the phrase the mission says to avoid
(`Nicks_Creative_Quality_Coder_Mission_2026-10-09.md`), and a working title propagates to file names and
review sheets; `10-FLAGSHIP-PRODUCTION.md`'s Reel A heading should follow. The title stays in the plan only:
no card, spoken line or caption repeats it, says "safe" or claims a margin.
Default: A2, because `10-FLAGSHIP-PRODUCTION.md` fixes frame one as the split macro under one raking light
with "LOOK THE SAME?" and the mission's A treatment opens on a visual discrepancy; A1 and A3 test against it.

### A1 - Evidence reveal: two readings
- Frame one: the gauge seated in the worn groove, its reading centred and sharp (T2), no text. 0-2 s: hold
  the number 1.2 s; the pointer tip touches the mark the gauge reads at 0.8 s; at 1.2 s the gauge lifts and
  drops into the new tire's groove (T3). 2-4 s: the second number holds; a deterministic split shows both
  readings side by side; cut to T1 for the body.
- Card at 1.4 s: "Same gauge. Two grooves." Spoken: "Same gauge, two grooves. Read the numbers." Sound:
  room tone, one ratchet click at the cut.
- Promise: what the gap between the numbers does on a wet road; paid by the body's water beat (T6,
  channeling) and the decision rule card (replace at 2/32, NHTSA). Device: visual, the pointer on the mark.
- Evidence: VERIFIED SHOP EVIDENCE for both readings (filmed, never typed; the split shows the measured value,
  not the 10/32 the plan expects); REPRESENTATIVE DEMONSTRATION for the scrap-beside-stock pairing. Clips: T2, T3. Credits: 0.
- Risk (mechanical): a probe not on the groove floor reads high; the captured clip holds each number 2 s
  (`05-CAPTURE-CHECKLIST.md`, clip 3), the hook shows the worn reading 1.2 s, and body beat 3 shows both for
  2 s; T2 is re-shot if the probe tilts.

### A2 - Specific question: which one is worn (default)
- Frame one: worn tread beside new tread (T1) under flat light so both read as black rubber, centred, no
  text. 0-2 s: at 0.8 s the raking LED switches on from the side and the difference appears, worn blocks
  flat, new grooves throwing shadow; at 1.6 s a gloved finger lands on the worn edge (T5). 2-4 s: hold; T1
  runs on as the body's first beat. T1 is shot with the light switched on inside the clip, same mount.
- Card at 0.3 s: "Which one is worn?" Spoken: "Which one is worn? Wait for the light." Sound: room tone,
  the shop door closing far off at 0.2 s.
- Promise: the answer, and how to see it on your own tire; paid by the gauge beat (T2, T3) and the wear
  bar (T4). Device: behavioral, the finger on the worn edge.
- Evidence: VERIFIED SHOP EVIDENCE (two real tires under one light); REPRESENTATIVE DEMONSTRATION as a pair,
  so no "this car" line anywhere. Clips: T1 (light switched on in-clip), T5. Credits: 0.
- Risk (truth): under flat light the two tires must genuinely look alike or the question is a trick; if
  the worn tire reads as worn even flat-lit, run A1 instead.

### A3 - Useful contradiction: not bald, already at 2/32
- Condition: A3 runs only if T2 reads 2/32 on camera; otherwise it is dropped and A1 or A2 runs. No reading
  exists today (`media_assets` holds 0 `real_shop` rows, `10-FLAGSHIP-PRODUCTION.md`), so the 2/32 below is
  the condition, not a measurement.
- Frame one: wear-bar macro (T4), the raised bar flush with the tread blocks around it, the evidence card's
  1/32 scale strip beside it, centred, no text. 0-2 s: the pointer tip touches the bar at 0.6 s; at 1.3 s
  cut to the gauge seated in the same groove reading 2/32 (T2). 2-4 s: hold the reading; cut to T1.
- Card at 0.4 s: "Not bald. Already at 2/32." Spoken: "Not bald. The bar is flush. That reads 2/32."
  Sound: room tone, one ratchet click at 1.3 s.
- Promise: why visible tread can already be at the replace point; paid by the decision rule (replace at
  2/32, NHTSA) and the water beat (less groove, less channeling). Device: visual, the pointer on the bar.
- Evidence: VERIFIED SHOP EVIDENCE for the bar and the reading; VERIFIED EXTERNAL FACT for the 2/32 replace
  point (`tread_depth` packet, NHTSA). Clips: T4, T2. Credits: 0.
- Risk (mechanical): a bar that is close but not flush makes "2/32" a false reading; T4 and T2 are the same
  groove in the same session and the gauge decides, not the eye.

### Body edit reuse - A
- The pack brief predates the capture plan: its beats 1-5 are synthetic rain-world shots and its cards carry
  3/32 and 4/32, numbers the `tread_depth` packet does not list. The body keeps a brief beat only where it
  maps onto a real clip and follows the structure in `10-FLAGSHIP-PRODUCTION.md`.
- Brief beat 4 (two sections side by side) -> body beat 2: T1 under raking light.
- New body beat 3: the gauge in the worn groove and the new groove (T2, T3), 2 s on each number.
- Brief beat 2 (water across the tread) -> body beat 4: T6 recast as channeling; the card says where the
  water goes, never a grip result (mission: no performance test from water poured on parked tread).
- Brief beat 3 (snow) -> dropped: no snow to capture in October, and 4/32 is outside the packet.
- New body beat 5: the wear bar flush (T4). Body beat 6: the hero transformation, worn to new, camera and
  wheel locked; test the 0-credit match cut first (clamp mount unmoved, `05-CAPTURE-CHECKLIST.md` clip 6),
  and only if it fails buy the 12-credit Seedance shot, labelled "illustration", inside the 30-credit cap.
- Brief beat 5 (payoff) -> body beat 7: the decision rule card, replace at 2/32 (NHTSA), then the end card.
- Voiceover identical from 4 s; every number spoken is one the gauge showed on camera. Reveal devices live
  in body beat 3: pointer on the 2/32 mark, the finger, the shop sound, "Don't guess. Prove it." Credits: 0, or 12.
