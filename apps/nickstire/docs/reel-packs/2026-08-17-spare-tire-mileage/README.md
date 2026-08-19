# Reel production pack — "How far you can drive on a spare" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **SPARE**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #5

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short of
any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and short of
any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead, checked
the file-based record: `ls apps/nickstire/docs/reel-packs/` shows five prior
merged packs (penny test — slate #1, tire expiration date — slate #6, tread
fingerprint — not on the slate, battery/summer heat — slate #12 angle, squealing
vs grinding brakes — slate #2) plus three **open, unmerged draft PRs** found via
`gh pr search "reel pack in:title" --state open` — #1616 alignment vs balance
(slate #4), #1615 check-engine-light (slate #7), #1614 wheel-bearing-hum (slate
#8). Checking PRs was necessary, not optional: on 2026-08-16 a prior run
duplicated a topic that was sitting in an unmerged draft and therefore invisible
to `ls` alone. Combined, eight topics are spoken for. This run's topic, slate
item **#5 "how far you can drive on a spare,"** is not among any of them. This
is a file/PR-system check, not a substitute for the real ledger — an actual
`reel_jobs` row (e.g. a rejected brief that never got a pack written) would not
show up here, so treat "not on disk, not in an open PR" as directional, not a
guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining topics, filtering out: winter-seasonal
items premature for mid-August (#3 cold-weather tire light, #11 all-season vs
winter tires), items already merged or in an open draft PR (#1, #2, #4, #6, #7,
#8, and the battery/tread topics from outside the slate), and items that
overlap thematically with an in-flight PR (#13 "why the car pulls to one
side" overlaps #4 alignment-vs-balance, currently PR #1616; #16 "tread depth
rain vs snow" overlaps the merged penny-test pack; #19 "noises that mean stop
driving" overlaps both the merged brakes pack and the in-flight wheel-bearing
PR):

| # | Topic | Hook strength | Evergreen? | Keyword fit | Selected? |
|---|---|---|---|---|---|
| 5 | Spare tire mileage | Strong — practical, "you might need this Tuesday" urgency | Yes | **SPARE** — exact match in the approved `CAMPAIGN_KEYWORDS` bank | ✅ **Selected** |
| 9 | Oil change intervals | Moderate — myth-correction hook | Yes | No exact match (`NOISE`/`TIRES`/etc. don't fit) | Parked |
| 14 | Cabin filter vs engine air filter | Moderate — timely for August AC season | Yes | No exact match | Parked |
| 15 | Struts | Moderate — strong DIY-demo visual (push-and-rebound test) | Yes | No exact match | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency | Yes | `TIRES` — loose fit | Parked |
| 18 | Coolant color | Strong — "mystery puddle" curiosity gap | Yes | No exact match (checked first, rejected — see below) | Rejected |
| 20 | Questions before authorizing repair | Moderate — trust/authority hook | Yes | No exact match | Parked |

**Why spare tire over coolant color:** coolant color was the first choice
scored (strongest hook of the remaining set) but was rejected after checking
`facelessReelStudio.ts`'s `CAMPAIGN_KEYWORDS` — none of the 17 approved
single-word keywords (`POTHOLE, TREAD, PRESSURE, BRAKES, SALT, BATTERY,
WIPERS, ALIGNMENT, ECHECK, TIRES, SPARE, VIBRATION, PULLING, TPMS, NOISE, DOT,
RAIN, CLUNK`) fits "coolant" without forcing a mismatch that
`validateCampaignKeyword()` would reject outright at real enqueue time. Spare
tire has an exact keyword match (`SPARE`) and a strong, road-relevant hook, so
it was selected instead rather than inventing an off-list keyword for coolant.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Most compact spares are rated around 50 miles and under 50 mph" | General OEM spare-tire convention (nearly universal placard language on the spare/trunk lid) — not shop-specific | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached to this claim. Phrasing is hedged with "around" (approximate, not absolute) rather than presenting the 50/50 figure as a guaranteed spec for every vehicle. |
| "Compact spares have less tread and no wear indicator" | Standard, near-universal design fact about temporary/compact spares vs. full tires — not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) — confirmed shop phone/address used in the CTA block matches the seeded record verbatim: `(216) 862-0005`, `17625 Euclid Ave, Cleveland, OH 44112` | **N/A — deliberately avoided** for the narration itself (no price/warranty claim needs the facts store); the CTA block's contact details are the one place this pack touches `businessFacts.ts`, and they were verified against the seed record rather than typed from memory. |

**Gap, stated plainly (repeated from prior packs, still open):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store for the
narration claims, so the gap doesn't block this particular pack, but it would
block any future reel script that wants to quote a price or warranty line
verbatim and have it channel-scoped correctly.

---

## 4 · Full production pack

### Script — word-for-word, timed (20s total, 5 beats — within the app's real
15–22s target band per `REEL_OUTPUT_RULES` in `facelessReelStudio.ts`, tighter
than the generic 15–60s the scheduling prompt allows)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "A compact spare is not a tire. It's a ride to the shop." |
| 2 · SETUP | 0:03–0:07 | "Most are rated around 50 miles and under 50 mph." |
| 3 · VALUE | 0:07–0:12 | "Less tread, less grip, and no wear indicator to warn you." |
| 4 · VALUE | 0:12–0:16 | "Driving on one all week is how a flat becomes a tow." |
| 5 · CTA | 0:16–0:20 | "Send this to someone riding on a spare right now. Nick's Tire and Auto — link in bio." |

CTA is deliberately written as a **SEND**, not the literal "📌 Save this now"
text in the slate document for item #5 — the slate's own top-of-file
correction states the account's real save rate is `0.00` across all 8 posted
reels and that the objective should be SEND (or no CTA), but only items #1 and
#2's per-topic caption text was actually rewritten to match; items #3–20,
including #5, still carry the old save-oriented wording. This pack follows the
stated corrected objective rather than the stale literal caption text.

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):

- Beat 1: "compact spare tire trunk well" / "space saver spare tire close up"
- Beat 2: "spare tire sidewall speed rating label" / "temporary tire placard"
- Beat 3: "shallow tire tread macro" / "narrow tire tread groove close up"
- Beat 4: "car driving highway rear tire" / "tow truck flatbed hook"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 20s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone — burn in
via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/road-noise SFX (optional, see §6) → voiceover track → burned-in
   caption track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/documentary grade on beats 1–3 (informational, garage/
   trunk setting), slight desaturation and a touch of motion-blur on beat 4
   (highway urgency), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 20s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move or
   dolly, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

**Loop plan:** beat 5 closes on a centered, static framing of the shop bay
door — deliberately composed to echo beat 1's centered framing of the spare
tire in the trunk well (same center-weighted composition, cool-to-warm color
arc bookending on a warm note at both the very start of beat 1's push-in and
the end of beat 5), so a replay reads as a soft continuation rather than a
hard restart. Untested — no render exists to confirm the loop reads cleanly.

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 20s (within both the scheduling prompt's 15–60s range and the
  app's own tighter 15–22s target band)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the slate's corrected objective; a
  "save this" CTA measured `saved = 0.00` across the account's first 8 reels

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.00 (5 clips × ~4s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in the
latest `autonomy_policy_versions` row, which was not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily autonomous
cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`), this pack should
wait for the next open slot rather than force a same-day post. Three other
packs are also sitting in open draft PRs right now (#1614, #1615, #1616) —
whoever schedules these into the real pipeline should sequence them against
each other, not just against this pack alone, given the 2/day feed cap.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — same gap noted in every prior pack in this directory). This pack
sidesteps it deliberately rather than asserting a track is cleared: **no music
bed is assigned.** The reel is voiceover + captions + optional single
royalty-free ambient/SFX layer (light road/trunk ambience), which also scores
well on the pipeline's muted-first requirement since the captions alone carry
full meaning. If the operator wants a music bed, that requires a specific
track with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (60/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> A compact spare is not a tire. It's a ride to the shop.
>
> Most are rated around 50 miles and under 50 mph. Less tread, less grip, and
> no wear indicator to warn you.
>
> Driving on one all week is how a flat becomes a tow.
>
> Send this to someone riding on a spare right now.
>
> #flattire #roadside #cartips #clevelandohio #euclidohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "If your spare's been on for more than a few days, this is for you."
> Caption: Compact spares are rated around 50 miles, under 50 mph, with less
> tread and no wear indicator. That's a ride to the shop — not a replacement
> tire.
> CTA: Riding on a spare right now? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we'll get you back on a real tire.

**Ad-ready variant B (question-forward):**

> Hook: "Do you actually know how far your spare is rated for?"
> Caption: Most compact spares max out around 50 miles and 50 mph. Push past
> that and you're trading a flat for a tow.
> CTA: Get it looked at before that spare becomes the emergency. Nick's Tire
> and Auto, Euclid Ave.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the 50-mile/50-mph or tread-depth
claims, and that store wasn't queried live this run to check) and the
**winning-concept gate** (no real `scoreReelConcept()` tournament was run
against alternative concepts this session, so that 5-point gate is withheld
rather than assumed). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call,
no `igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session) can hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"how far you can drive on a spare"}`, let the server
re-score and re-render for real, and only then move toward publish.
