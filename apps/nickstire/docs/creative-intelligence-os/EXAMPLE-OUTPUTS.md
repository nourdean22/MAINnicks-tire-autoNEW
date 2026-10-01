# Example outputs — what the upgraded system produces

Demonstrations, not the production backlog. Every fact below is from `shared/business.ts` /
`businessFacts.ts` (warranty: parts 1-year / labor 90-day, no mileage; payment programs $10 down;
walk-ins 7 days; used tires from $25 installed, most $40–80) or is explicitly marked as evidence the
system would need before publishing. Customer phrases are illustrative of the shape the miner returns —
anonymised, aggregated, never a named customer.

## Reel concepts (5)

**1. "60 MPH is the clue"** — hook `symptom_question`, shape `clue→cause→consequence→action`, lane evidence+VO, 22 s
Tension (customer language): "it shakes at 60 but it's fine around town." Beat 1: real wheel spinning on the balancer, on-screen *ONLY SHAKES ON THE HIGHWAY?* Beat 2: macro of the bend in the rim lip (real asset required: bent wheel). Beat 3: three cards — balance / alignment / bent wheel — "speed-sensitive is the tell". Beat 4: what the mechanic checks first (balancer readout). End: *THE WHEEL IS A CLUE. NOT A DIAGNOSIS.* CTA `send_to_someone`. Ownable: customer phrase + real asset + Cleveland potholes. Anti-generic: a chain would say "get an alignment".

**2. "The grind that only happens in the morning"** — hook `customer_quote`, shape `belief→contradiction→truth`, lane real-shop UGC, 20 s
On-screen: *Customer said: "it only grinds in the morning."* Macro real rotor with surface rust. VO: "That detail matters. Surface rust after a wet Cleveland night sounds ugly for the first few stops. Grinding that stays? Different conversation." Evidence: real rotor photo. End: *THE SOUND IS A CLUE. IT ISN'T THE DIAGNOSIS.* Send trigger: "send to the person who thinks every brake noise means pads."

**3. "What road salt does below the paint"** — hook `local_moment`, shape `outside→inside→mechanism`, lane AI cinematic (wordless) + real evidence insert, 35 s (duration-lane experiment)
Beat 1 silent: clean car in a January car wash. Beat 2: cutaway of brake line / subframe with brine wicking (AI, no text). Beat 3: real asset — corroded line from a Cleveland car. Beat 4: the one check (visual: flashlight at the rear subframe). Deterministic caption overlays. Ownable: real asset + salt lens. Claims: none numeric.

**4. "Plug or patch — look here first"** — hook `before_you_spend`, shape `wrong→right_side_by_side`, lane deterministic + real photo, 24 s
Two real punctures side by side: tread-centre nail vs shoulder puncture. Text: *FIXABLE / NOT FIXABLE — the location decides, not the size.* VO explains why a shoulder repair is refused. CTA `save_for_later`. Ownable: real photos; mechanic refusal rule (true and safe). No price.

**5. "E-Check said NOT READY"** — hook `nobody_tells_you`, shape `3_clue_countdown`, lane evidence+VO, 30 s
On-screen: *"NOT READY" is not "FAILED."* Clue 1: battery was disconnected. Clue 2: a code was cleared. Clue 3: the drive cycle never finished. Payoff: what a drive cycle is, in one sentence. Evidence: E-Check printout (real asset, redacted). Ownable: GSC query rising + call frequency (signals the assistant would cite). CTA `ask_in_comments`: "which one happened to you?"

## UGC-style faceless Reels (3)

**A. Text reenactment (phone-on-counter)** — 18 s. Phone screen mock rendered deterministically: *"Do I need all four tires?"* Cut to real tire rack. VO, counter voice: "Depends on two things we can measure, not guess: tread difference between axles, and whether it's AWD. Bring it by, the measuring is free." End card: *Walk in. No appointment.* (SSOT). No price.

**B. Mechanic POV** — 22 s. Camera at eye level over the lift, hands in frame (real-shop lane allows). VO: "If the steering wheel is crooked but the car tracks straight, this is the first thing I look at" — tie-rod end wiggle test on camera. On-screen: *CROOKED WHEEL ≠ ALWAYS ALIGNMENT.* CTA `send_to_someone`.

**C. Object POV / useful absurdity** — 20 s. *POV: you're the tire that met the Euclid Ave pothole.* Real bent-wheel asset as the reveal. VO calm: "Here's what actually bent, and why the vibration showed up a week later." Ends on the decision rule: "a wobble that starts after a hit is a wheel check first, not a balance."

## Carousel concepts (3)

**1. "SHAKING AT 60?"** (family `split_diagnosis`, 5 slides) — cover: real spinning wheel photo + promise; S2 BALANCE — usually speed-sensitive; S3 ALIGNMENT — shows as tracking/wear, not one magic speed; S4 BENT WHEEL / TIRE — a physical problem can mimic both; S5 *THE STEERING WHEEL IS A CLUE. NOT A DIAGNOSIS.* + "save this for the next highway shake". Screenshot-safe slide: S3.

**2. "Salt season checklist"** (family `checklist`, 6 slides) — one check per slide with the real-photo reference for each (brake lines, subframe, battery terminal, tread depth, wiper edge, washer fluid rating). Last slide: the two checks you can do in a parking lot. Objective: save.

**3. "Fixable vs not — tire punctures"** (family `myth_reality`, 5 slides) — myth per slide ("size decides", "any plug kit works", "sidewall can be patched") each answered with a real puncture photo. Objective: share ("send to the person with the plug kit").

## Static concepts (3)

1. **Receipt proof** (family `receipt_proof`): the actual alignment printout before/after (redacted), headline *THIS IS WHAT "PULLING LEFT" LOOKS LIKE ON PAPER.* Evidence: real printout.
2. **Cleveland alert** (family `cleveland_alert`): NWS freeze warning tonight → *YOUR TIRE PRESSURE DROPS ~1 PSI PER 10°F* — numeric claim allowed only with a named source (NHTSA/Tire industry reference attached in the evidence pack); otherwise rendered as "pressure drops when temperature drops — check it tomorrow morning."
3. **Question card** (family `question_card`): *"Car won't start but the lights work" — what we check first.* Customer phrase as headline; subline: "usually not the battery alone."

## Facebook-specific (3)

1. **Status, no link:** "Cleveland drivers: which road has cost your suspension the most this year? We see the repair side of pothole season — curious which stretch everyone already braces for." (comment harvest → topic graph edges for pothole content).
2. **Album:** "Five things road salt did underneath this car" — 5 real photos with one-line captions, closing decision rule: "if you hear a new clunk after the thaw, it's a look-underneath, not a wait-and-see."
3. **FB Reel variant** of Reel #2 with a longer caption written for FB ("Here's the full story of this rotor…") and the video actually attached (today a "both" reel can degrade to a text post).

## Article concepts (3)

1. **"Why your steering wheel shakes at highway speed — and why alignment isn't always the answer."** Evidence pack: customer phrase, balance/alignment/bent-wheel decision tree, real bent-wheel photo, Cleveland pothole season, related `/tires`, `/alignment`, `/brakes` (resolved by the registry). No invented costs.
2. **"E-Check says NOT READY: what it means and what to do before you drive back."** Pack: GSC query family, drive-cycle explanation, what NOT to do (clear codes again), related `/emissions`, `/diagnostics`.
3. **"Plug, patch, or replace: how we decide what a punctured tire gets."** Pack: industry repair-location rule (named source), real puncture photos, the used-tire SSOT line when replacement is the answer, related `/tires`.

## Meta-ad concepts (3) — facts from BrandTruth only

1. **Direct-response / local problem:** tension "I don't know if this noise is serious." Hook: *Hear it? Don't guess.* Truth: free quick check + written quote before any work; you don't pay until you say yes. Proof: Google 4.9★ (count from SSOT). Visual: real rotor macro (Reel #2 derivative). CTA: Call / Get directions. Organic twin: Reel #2. Test hypothesis: real-evidence creative beats poster on cost per call.
2. **Payment-program angle (compliant):** *Tires today. $10 down.* Payment programs: Acima · Snap · Koalafi · American First Finance. No approval promise, no "financing" word, no credit claims. Visual: clean catalog family, real tire rack. CTA: Walk in — open 7 days.
3. **Seasonal / Cleveland alert:** *Salt season starts under your car.* Educational hook → free quick check → walk-ins 7 days. Visual: Reel #3 cutaway + real corroded-line insert. CTA: directions. Warranty line if used: "12-month parts / 90-day labor limited warranty on shop-installed repairs" — exactly as compiled, never "12,000-mile".
