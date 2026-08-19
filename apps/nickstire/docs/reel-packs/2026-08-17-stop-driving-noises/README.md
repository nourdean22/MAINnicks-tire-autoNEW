# Reel production pack — "Noises that mean stop driving now" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **STOP-NOISE**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #19

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

**Operational note (not part of the pack itself):** at the time this pack was
written, `gh pr list --state open --search "reel pack in:title"` showed **6 open,
unmerged** reel-pack PRs (#1614–#1619, one per hour from roughly 21:45 to 03:32),
none merged, alongside 5 already-merged packs on disk. This run avoided
duplicating any of those 11 topics (see §1), but the operator should be aware a
backlog is accumulating faster than it's being reviewed — worth batch-reviewing
or pausing the schedule rather than letting a 12th, 13th, ... pile up unread.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short of
any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and short of
any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Re-checked this run — line still reads the same. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| ChatGPT | Not applicable | No standalone ChatGPT tool is connected to this session; script/creative direction below is authored directly by this session in the app's real `ReelBrief` shape, same job. |
| Meta Graph API posting / CapCut | Not called / not integrated | Protected customer-facing action per root `AGENTS.md` (posting); no CapCut connector exists in this environment. Manual steps only, see §4. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead, checked
the file-based record: `ls apps/nickstire/docs/reel-packs/` shows five merged
packs (penny test #1, tire expiration #6, tread fingerprint — not on the slate,
battery/summer-heat — slate #12 angle, squealing-vs-grinding-brakes #2), and
`gh pr list` shows six further open, unmerged packs (cabin-vs-engine-air-filter
#14, coolant color #18, spare-tire mileage #5, balance-vs-alignment #4,
check-engine-light #7, wheel-bearing-hum #8). That's 11 of the slate's 20 topics
already claimed. This run's topic, slate item **#19 "noises that mean stop
driving now,"** is not among them. This is a file-system + PR-list check, not a
substitute for the real ledger — a rejected brief that never got a pack written
would not show up here, so treat "not on disk / not in an open PR" as
directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining unclaimed items (today is 2026-08-17 —
mid-August, so winter/cold-weather items #3 "cold weather and the tire light"
and #11 "all-season vs winter tires" were deprioritized as seasonally premature
even though open):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 19 | Noises that mean stop driving now | Strong — three distinct, visceral sound cues + explicit urgency framing ("cannot wait") | Yes | ✅ **Selected** |
| 9 | Oil change intervals | Moderate — myth-correction hook ("3,000 mile sticker") | Yes | Parked |
| 10 | Pothole damage you cannot see | Moderate — "hidden damage" curiosity hook, topical for Cleveland roads | Yes | Parked |
| 13 | Why the car pulls to one side | Moderate — diagnostic-branch hook, less visceral than a noise | Yes | Parked |
| 15 | What "you need struts" actually means | Moderate — jargon-decoding hook, narrower audience (only relevant post-quote) | Yes | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency | Yes | Parked |
| 20 | Questions before authorizing repair | Moderate — trust/authority hook, CTA doesn't drive to shop specifically | Yes | Parked |

Selected #19 for the strongest first-two-second hook (a direct claim — "these
cannot wait" — that creates an open loop the viewer has to stay for) combined
with three concrete, self-checkable diagnostic cues that map cleanly onto the
slate's beat structure without inventing content beyond the approved caption.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Grinding when braking" is a stop-driving-now signal | General automotive mechanical knowledge (metal-on-metal caliper/rotor contact); consistent with the 2026-08-16 squealing-vs-grinding pack's same claim | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. |
| "Knocking that speeds up with the engine" points to an internal engine fault | Standard mechanical fact (RPM-correlated knock indicates detonation/rod-bearing wear, not a road noise) | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "A rhythmic clunk that tracks with wheel speed" (not engine speed) points to a suspension/driveline part | Standard mechanical fact (wheel-speed-correlated noise implicates CV joint, wheel bearing, or suspension linkage, not the engine) | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only (confirmed by reading the file this run) — there
is no `"reel"` channel. This script doesn't lean on that store, so the gap
doesn't block this pack, but it would block any future reel script that wants
to quote a price or warranty line verbatim.

All three diagnostic claims use "usually"-free but hedged, mechanically-general
phrasing (no absolute "always," no diagnosis-without-a-look language) — none
promise a specific repair outcome or price, consistent with the approved
soft-language patterns in `facelessReelStudio.ts`.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Most car noises can wait. These three cannot." |
| 2 · SETUP | 0:03–0:08 | "Grinding when you brake. Knocking that speeds up with the engine." |
| 3 · VALUE | 0:08–0:14 | "A rhythmic clunk that tracks with your wheel speed — not your engine speed." |
| 4 · VALUE | 0:14–0:21 | "Every one of these gets dramatically more expensive with every mile you keep driving." |
| 5 · CTA | 0:21–0:28 | "Send this to someone who just said their car's making a weird noise. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified live
this run):
- Beat 1: "driver pov steering wheel dashboard warning lights dusk"
- Beat 2: "brake rotor grinding macro" / "brake caliper closeup metal"
- Beat 3: "car suspension strut closeup workshop" / "cv joint boot closeup"
- Beat 4: "engine bay mechanic inspection damaged part workbench"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 11 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path; no CapCut connector
is available in this session, so these are hand-off instructions, not an
automated action)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   road/garage room-tone or SFX (optional, see §6) → voiceover track → burned-in
   caption track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–3 (tension/mystery
   mood matching the "these cannot wait" hook), warm shift on beat 5 (CTA,
   inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the slate's corrected objective; the
  slate's own draft caption for this item used "Save this one," but the
  corrected objective (measured `saved = 0.00` across the account's first 8
  reels) argues for a SEND rewrite, applied below

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read this run, not a
live balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
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
cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`), or by whichever of
the six open sibling PRs gets merged and enqueued first, this pack should wait
for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — same gap noted in every prior pack in this directory). This pack
sidesteps it deliberately rather than asserting a track is cleared: **no music
bed is assigned.** The reel is voiceover + captions + optional single
royalty-free ambient/SFX layer (one metallic "clunk" sting under beat 3), which
also scores well on the pipeline's muted-first requirement since the captions
alone carry full meaning. If the operator wants a music bed, that requires a
specific track with asset ID, source, license scope, territory, and expiry
tracked by hand — this pack does not supply one.

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

**Primary caption (SEND-rewritten from the slate's corrected objective):**

> Most car noises can wait. These three cannot.
>
> Grinding when you brake. Knocking that speeds up with the engine. A
> rhythmic clunk that tracks with your wheel speed, not your engine speed.
>
> Each one gets dramatically more expensive with every mile you keep driving.
>
> Send this to whoever just said "my car's been making a weird noise."
>
> #cartips #autorepair #carsafety #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "If your car is making one of these three sounds, stop driving it
> today — not next week."
> Caption: Grinding, engine-speed knocking, or a clunk that tracks your
> wheels — each one turns into a much bigger bill the longer you drive on it.
> CTA: Hear one of these? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Can you tell the difference between a noise that can wait and one
> that can't?"
> Caption: Grinding brakes, engine-speed knocking, and a wheel-speed clunk
> are the three that mean stop driving, not "get to it eventually."
> CTA: Not sure which one you've got? Bring it by — we'll tell you straight,
> free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs any of the three diagnostic claims, and
that store wasn't queried live this run to check). Not
`PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`, nothing was
generated, rendered, or posted. Not `BLOCKED` outright — the pack is complete
and usable; an operator (or a live-authorized session) can hand it to the real
pipeline via `/api/admin/reel-canary {action:"start", topic:"noises that mean
stop driving now"}`, let the server re-score and re-render for real, and only
then move toward publish. Separately, flagged above: **six sibling reel-pack
PRs are open and unmerged** — worth a batch review before more accumulate.
