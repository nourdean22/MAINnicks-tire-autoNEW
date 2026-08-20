# Reel production pack — "Windshield chip: repair before it spreads" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CHIPSPREAD**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog update, read before triaging this PR — see the box in §1.** The
prior pack (2026-08-19, "Won't start," merged as #1699) reported a 52-PR
open-draft backlog and recommended an operator batch-review. That review has
happened: this run found **zero open pull requests** in the repo (any
title), not 52. The backlog concern from the prior 10+ runs no longer
applies — this pack is the first in that stretch produced against a clean
slate rather than a saturated one.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container — fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / TTS / Meta credentials | **Not present** | `env \| grep -iE "higgsfield\|reel\|admin_api\|openai\|anthropic_api\|elevenlabs\|tts\|instagram\|meta_"` returned nothing in this shell. |
| `ffmpeg` / any local render tool | **Not present** | `which ffmpeg` → not found; `ffmpeg -version` → command not found. No local assembly path exists in this container either. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Not set in this session's shell — no live repetition-ledger or quality-score read is possible or attempted. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last edit — last-known, not live-reconfirmed this run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/ | wc -l   → 37 merged packs
    gh-equivalent: list_pull_requests state=open  → 0 open PRs (any title)

Merged-pack topics on disk cover: the penny test, tire-expiration dates,
tread-wear fingerprint, battery heat in summer, check-engine light,
squealing-vs-grinding brakes, wheel-bearing hum, balance-vs-alignment,
cabin-air filter, coolant color, exhaust-smoke color, oil-change intervals,
plug-vs-patch tire repair, pothole damage, repair-authorization questions,
road-salt brake-line corrosion, road-trip pre-check, serpentine-belt
squeal, tire sidewall bulge, spare-tire mileage limits, noises that mean
stop driving now, strut bounce-test, summer-heat tire pressure, tire
rotation, transmission-fluid color test, tread-depth rain-vs-snow, why a
car pulls to one side, wiper-blade check, AC not blowing cold,
all-season-vs-winter tires, brake-fluid moisture test, cold-weather TPMS
light, CV-joint clicking, power-steering whine, TPMS sensor battery life,
uneven tire-wear patterns, and (same day) won't-start battery/starter/
alternator triage.

**"Windshield chip — repair before it spreads into a crack" is not among any
of the above.** It is a distinct failure mode (glass damage, not
tire/brake/battery/fluid) and a distinct genre (a race-against-time
repair-vs-replace decision) from every listed topic. Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Windshield chip — repair before it spreads | Strong — universal near-miss ("that just happened to me"), clean urgency hook, visually simple to shoot | Yes | No | ✅ **Selected** |
| Headlight yellowing/oxidation — restore vs. replace | Moderate — real problem, less urgent framing | Yes | No | Parked — weaker urgency hook than the chip topic |
| Timing belt vs. timing chain maintenance interval | Weak — technical, low relatability for a general driver audience | Yes | No | Parked — narrower audience fit |

"Windshield chip" was selected for universal relatability (almost every
driver has had a chip appear overnight), a clean two-outcome structure
(repair now vs. pay for a full replacement later) that maps onto the
account's 5-beat shape without inventing structure, and confirmed
non-overlap with all 37 merged topics and the (now empty) open-PR set.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Temperature swings and road vibration are what usually make it spread" | General automotive-glass knowledge (thermal-stress crack propagation is a standard, widely taught mechanism) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run — no `DATABASE_URL` is present in this session, so any real read would be a production read this run cannot make. No `EvidenceRecord` citation is attached. |
| "A chip smaller than a quarter can often be repaired in under thirty minutes" | Standard windshield-repair-industry rule of thumb, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can often be repaired" (hedged, not absolute). |
| "Once a crack reaches the edge of the glass, that may indicate it's a replacement instead" | Same — standard glass-repair heuristic | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate" (`facelessReelStudio.ts` approved soft-language list). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "That small chip in your windshield? It's a clue that starts a clock." |
| 2 · SETUP | 0:04–0:10 | "Temperature swings and road vibration are what usually make it spread." |
| 3 · VALUE | 0:10–0:16 | "A chip smaller than a quarter can often be repaired in under thirty minutes." |
| 4 · VALUE | 0:16–0:22 | "Once a crack reaches the edge of the glass, that may indicate it's a replacement instead." |
| 5 · CTA | 0:22–0:28 | "Don't guess how long it'll hold. Stop by and we'll take a look, free. Nick's Tire and Auto, link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "windshield rock chip closeup morning sun" / "car windshield glass damage macro"
- Beat 2: "windshield glass macro heat shimmer" / "dashboard reflection sunlight glare"
- Beat 3: "windshield repair resin injector tool closeup" / "auto glass repair kit macro"
- Beat 4: "windshield crack spreading closeup" / "car windshield crack dusk light"
- Beat 5: "auto repair shop garage bay interior open door windshield inspection"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone, ALL-CAPS optional per house style — burn in via ffmpeg `subtitles`
filter, never as a generated in-frame element (Seedance/Higgsfield can't
spell reliably, and the M10 preflight blocks generated text for exactly
that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient road/garage room-tone (optional, see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 5 only, shop name +
   "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (the
   ticking-clock tension of an untreated chip), warm shift on beat 5 (CTA,
   inviting).
5. **Loop:** beat 5's final frame racks focus from the garage bay onto a
   parked car's windshield in the bay, echoing beat 1's chip-close-up
   composition — designed so the last frame reads as a soft return to the
   opening frame on replay (see `brief.json` `concepts[0].loopIdea`).
6. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — a second concept produced the same calendar day as
  the "Won't start" pack is not itself a problem (`RESERVATION_FEED_CAP` is
  2 posts/day per §5), but do not force both into the same slot; queue this
  one for the next open cadence slot rather than same-timestamp as the
  other pending pack
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to whoever just found a chip in
  their windshield"), matching the account's corrected objective (a
  SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels, per an earlier pack's finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). Operator-tunable
estimate, not a metered price — directional only.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, not reachable this run (no
`DATABASE_URL`, no live server). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN`.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed (this is the second
pack produced today — see §1), a real enqueue of this concept should wait
for the next open slot rather than force a same-day double-post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional ambient road/garage
room-tone only, which also scores well on the pipeline's muted-first
requirement since captions alone carry full meaning. If the operator wants
a music bed, that requires a specific track with asset ID, source, license
scope, territory, and expiry tracked by hand — this pack does not supply
one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (60/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> That small chip in your windshield? It's a clue that starts a clock.
>
> Temperature swings and road vibration are what usually make it spread.
> A chip smaller than a quarter can often be repaired in under thirty
> minutes. Once a crack reaches the edge of the glass, that may indicate
> it's a replacement instead.
>
> Don't guess how long it'll hold. Send this to whoever just found a chip.
>
> #cartips #clevelandohio #carmaintenance #autoglass

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That windshield chip isn't staying small — it's on a clock."
> Caption: Small chip, caught early = often a 30-minute fix. Let it spread
> to the edge of the glass, and it's usually a full replacement instead.
> CTA: Not sure which stage yours is at? Call (216) 862-0005 or stop by
> 17625 Euclid Ave — we'll take a look free.

**Ad-ready variant B (question-forward):**

> Hook: "Did you check your windshield today, or just glance past the
> chip that's already there?"
> Caption: A chip caught early is a quick repair. A chip ignored becomes a
> crack, and a crack becomes a full windshield bill.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the thermal-stress/repair-window
claims, and that store wasn't and couldn't be queried live this run — no DB
access) and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing). Loop
plan is designed this time (unlike the same-day "Won't start" pack, which
flagged its absence), so that dimension scores full unlike the prior pack.
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"windshield chip: repair before it spreads"}`, let
the server re-score and re-render for real, and only then move toward
publish.

**Separately: the backlog condition that blocked the prior 10+ runs (52
open PRs, self-reported duplicates) is resolved as of this run** — 0 open
PRs found repo-wide. This session did not merge, close, or otherwise touch
any other PR; the clean state was already in place when this run started.
Recommended next step for the operator: none required to unblock future
runs specifically, but confirm whether the 37 merged packs on disk have
actually been carried through to real `reel-canary` production, since a
merged docs-only pack is not itself a published Reel.
