# Reel production pack — "AC blowing warm, not cold" (2026-08-18)

Scheduled-task run · 2026-08-18 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

**⚠️ Operator flag, read before anything else in this pack:** as of this run
there are **25 open, unmerged draft PRs** in this repo titled "reel production
pack" (`#1607`–`#1644`, most stamped "scheduled faceless-video run"), spanning
2026-08-16 through today. The scheduled task producing these packs is firing
roughly hourly and nothing is merging or closing them — the queue is growing
faster than any human could review it, and several already sit adjacent in
topic (e.g. `#1614` wheel-bearing-hum and `#1637` serpentine-belt-squeal are
both "unusual sound" diagnoses; `#1610` was closed as an exact battery-topic
duplicate of the same-day `#1607`). This pack was placed on a genuinely unused
topic (checked against both the merged packs in `ls
apps/nickstire/docs/reel-packs/` and all 25 open PR titles below), so it does
not add to the duplication problem — but the pile-up itself is the more
actionable finding here. **Recommend the operator either pause this scheduled
task, raise its interval, or triage/merge the backlog** before more packs
accumulate. See §1 for the full list checked.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + credentials; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (free local-ffmpeg lane), not Higgsfield/Seedance. Last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires explicit live operator instruction, which this run does not have. |

**Repetition check — file + PR level, not the live ledger.** `getRecentReelSignals()`
(reads production `reel_jobs`) was **not** queried — that would be a live prod
DB read. Instead checked both required surfaces per the operator skill:

- `ls apps/nickstire/docs/reel-packs/` (merged): penny-test, tire-expiration,
  tread-fingerprint, battery-summer-heat, squealing-vs-grinding-brakes.
- `gh`-equivalent PR search (`is:pr "reel pack"`, open + closed): 25 open
  drafts covering — coolant color, spare-tire mileage, balance-vs-alignment,
  check-engine-light, wheel-bearing-hum, all-season-vs-winter tires,
  cold-weather TPMS light, tread-depth rain-vs-snow, summer-heat tire
  pressure, repair-authorization questions, strut bounce-test, exhaust-smoke
  color, cabin-vs-engine air filter, brake-fluid moisture, road-salt brake-line
  corrosion, wiper-blade check, why-car-pulls, transmission-fluid color test,
  CV-joint clicking, tire sidewall bulge, oil-change intervals, tire rotation,
  serpentine-belt squeal, "noises that mean stop driving now," pothole damage,
  road-trip pre-check, plug-vs-patch tire repair — plus 2 closed (one exact
  battery-topic duplicate, one meta "where packs go" doc fix).

**AC not blowing cold** appears in none of the above. This is a file/PR-system
check, not a substitute for the real ledger — a rejected `reel_jobs` brief that
never produced a pack file wouldn't show up here — so treat "not found" as
directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

No fixed slate document was consulted this run (unlike the brake-noise pack's
`REEL-SLATE-2026-07-31.md` reference) — the 31 already-covered topics above
consumed most of that slate's obvious entries. Scored ad hoc against
seasonality (mid-August, still peak AC-demand weather in Cleveland) and gap
coverage:

| Topic | Hook strength | Evergreen / seasonal? | Already covered? | Selected? |
|---|---|---|---|---|
| AC blowing warm, not cold | Strong — immediate, visceral (August heat), diagnostic hook | Seasonal-current (peaks through September) | No | ✅ **Selected** |
| Battery terminal corrosion | Moderate — visual hook, but adjacent to existing battery-summer-heat pack | Evergreen | Adjacent (not identical, but close) | Parked — too close to an existing pack |
| Dashboard warning-light color meaning (red vs. amber) | Moderate — broad/general, less specific hook | Evergreen | No | Parked — weaker single-sound/single-symptom hook than AC |

AC selected for combining a currently-relevant seasonal hook with zero overlap
against the 31 already-produced topics, and a clean three-cause diagnostic
structure that maps onto the standard 5-beat shape without inventing one.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Weak/warm airflow usually means low refrigerant, a failing compressor, or a clogged cabin filter" | General automotive HVAC knowledge (three canonical failure modes) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` not queried live this run (would be a prod DB read). No `EvidenceRecord` citation attached. Phrasing uses "usually" (approved soft-language pattern, `facelessReelStudio.ts`) rather than an absolute. |
| "If refrigerant is low, there's a leak somewhere" | Standard mechanical fact (AC is a sealed system; it doesn't consume refrigerant in normal operation) — not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "A struggling compressor can seize completely" | Standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided**, sidesteps the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — no `"reel"` channel. This script doesn't lean
on that store, so the gap doesn't block this pack, but would block any future
script quoting an AC-recharge price verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Your AC blowing warm in August isn't 'give it a minute.' It's a system telling you something." |
| 2 · SETUP | 0:03–0:09 | "Weak or warm airflow usually means one of three things — low refrigerant, a failing compressor, or a clogged cabin filter." |
| 3 · VALUE | 0:09–0:16 | "Refrigerant doesn't just run low on its own — if it's low, there's a leak somewhere in the system." |
| 4 · VALUE | 0:16–0:22 | "Ignore it and a struggling compressor can seize completely — that's the expensive fix." |
| 5 · CTA | 0:22–0:28 | "Warm air out of your vents? Send this to whoever's sweating in traffic right now. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

Note: beats 2 and 4 below describe a gloved hand for realism/relatability —
per the standing negative prompt, if the actual generator can't reliably keep
a hand anatomically clean, drop the hand and reframe on the component alone
(compressor pulley, belt) rather than risk a malformed-hand artifact.

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):

- Beat 1: "car dashboard AC vent close up" / "hand adjusting car AC dial"
- Beat 2: "car engine bay AC compressor" / "serpentine belt pulley closeup"
- Beat 3: "AC service port gauge macro" / "car refrigerant gauge closeup"
- Beat 4: "AC compressor clutch engine bay slow motion"
- Beat 5: "auto repair garage bay wide shot" / "car service bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone —
burn in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   engine-bay/room-tone SFX (optional, see §6) → voiceover track → burned-in
   caption track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slight warm/heat-haze grade on beats 1 and 5 (relatable summer
   discomfort → CTA warmth); neutral, slightly cooler/clinical grade on beats
   2–4 (diagnostic/mechanical mood).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is a slow camera move, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  ~25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed posting cadence documented in
  prior packs (7:00 AM or 2:00 PM ET) — do not post ad hoc, and check whether
  today's feed-post cap (2/day) is already consumed by the backlog above
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — consistent with the corrected objective used
  in the most recent prior pack (brake-noise, 2026-08-16), whose SAVE-CTA
  reels measured `saved = 0.00`

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). Operator-tunable
estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
the 25-PR backlog noted above, whichever of these packs is chosen first for
real enqueue should be picked deliberately by the operator, not by pipeline
order — this pack does not assume it goes first.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, consistent
with every prior pack). This pack sidesteps it deliberately rather than
asserting a track is cleared: **no music bed is assigned.** The reel is
voiceover + captions + optional single royalty-free ambient/SFX layer (engine
bay tone, one compressor-clutch click), which also scores well on the
pipeline's muted-first requirement since captions alone carry full meaning.
If the operator wants a music bed, that requires a specific track with asset
ID, source, license scope, territory, and expiry tracked by hand — this pack
does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (61/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Your AC blowing warm in August isn't "give it a minute." It's a system
> telling you something.
>
> Weak or warm airflow usually means one of three things — low refrigerant, a
> failing compressor, or a clogged cabin filter.
>
> Refrigerant doesn't just run low on its own. If it's low, there's a leak.
> Ignore a struggling compressor and it can seize completely — that's the
> expensive fix.
>
> Send this to whoever's sweating in traffic right now.
>
> #carac #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your AC blowing warm isn't 'just give it a second' — it's telling you
> something's actually wrong."
> Caption: Low refrigerant, a failing compressor, or a clogged cabin filter —
> three different problems, three different fixes. Don't guess which one.
> CTA: Warm air out of your vents? Call (216) 862-0005 or stop by 17625
> Euclid Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "AC blowing warm — do you know if it's refrigerant, the compressor,
> or just a dirty filter?"
> Caption: One's a top-off. One's a real repair before it seizes completely.
> Guessing costs you either way.
> CTA: Not sure which one you've got? Bring it by — we'll tell you straight,
> free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (61/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, primarily
on **sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the refrigerant/compressor claims, and that store wasn't queried live
this run) and **loop** (the CTA frame doesn't loop cleanly back into the hook
frame). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the pack
is complete and usable; an operator (or a live-authorized session) can hand it
to the real pipeline via `/api/admin/reel-canary {action:"start", topic:"AC
blowing warm not cold"}`, let the server re-score and re-render for real, and
only then move toward publish.

**Separately — the queue-health finding in the flag above is the part of this
run most worth the operator's attention:** 25 open draft PRs, unmerged since
2026-08-16, is a scheduling/review problem this pack cannot fix by itself.
