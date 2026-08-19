# Reel production pack — "What a bad wheel bearing sounds like" (2026-08-16)

Scheduled-task run · 2026-08-16 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BEARING-HUM**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #8

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
function reads the live `reel_jobs` table on production TiDB, and a real query
would be a production read from an unattended session. Instead, checked both
required file-based proxies before writing anything:

1. `ls apps/nickstire/docs/reel-packs/` — five prior packs exist: **penny test**
   (slate #1), **tire expiration date** (slate #6), **tread fingerprint**
   (wear-pattern diagnosis, not on the slate), **battery / summer heat** (slate
   #12), and **squealing vs. grinding brakes** (slate #2). This run's topic,
   slate item **#8 "what a bad wheel bearing sounds like,"** is not among them.
2. Open-PR search (`gh`-equivalent via the GitHub MCP tools) for
   `is:open reel pack in:title` and a general open-PR listing — **zero** open
   reel-pack PRs exist right now (only #1612 and #1613, both reel-*pipeline
   code* PRs, not content packs), so there is no in-flight draft pack this run
   could collide with.

This is a file-system + PR check, not a substitute for the real ledger — an
actual `reel_jobs` row (e.g. a rejected brief that never got a pack written)
would not show up in either check, so treat "not found" as directional, not a
guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining non-winter-seasonal, non-already-packed
items (today is 2026-08-16 — mid-August, so winter/cold-weather items #3, #11
were deprioritized as seasonally premature even though open):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 8 | What a bad wheel bearing sounds like | Strong — visceral audio hook, binary diagnostic test the viewer can try themselves | Yes | ✅ **Selected** |
| 7 | Solid vs. flashing check engine light | Strong — urgency hook, but overlaps closely with the "noises that mean stop driving" cluster already touched by the brakes pack | Yes | Parked |
| 13 | Why the car pulls to one side | Moderate — alignment hook, softer urgency than a noise-based diagnostic | Yes | Parked |
| 19 | Noises that mean stop driving now | Moderate — broader/vaguer than a single specific diagnostic; risks feeling repetitive after the brakes pack's noise-diagnosis format | Yes | Parked |

Wheel bearing was selected for a hook nearly as strong as the brakes pack's
(a sound + a self-test the viewer can run right now — "turn the wheel and
listen") while being mechanically and topically distinct from every already-
packed concept: not tread/wear (penny test, tread fingerprint), not tire age
(expiration), not electrical (battery), and not brakes.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Wheel bearing noise gets louder turning one way, quieter the other — tire noise stays the same through the turn" | General automotive mechanical knowledge (load-shifting onto a failing bearing during a turn is a standard diagnostic heuristic; also the exact framing already used in `REEL-SLATE-2026-07-31.md` item #8) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached to this claim. |
| "Ignore it, and a bearing does not get better. It can seize, and the wheel can lock up." | General automotive mechanical/safety knowledge (bearing seizure as a documented failure mode) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "can," not "will," which is the approved soft-language pattern (`facelessReelStudio.ts:571`) for an unverified-in-store claim rather than an absolute guarantee. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) — confirmed no `factKey` for bearing service exists, and none is needed since the script makes no price/warranty claim | **N/A — deliberately avoided.** Sidesteps the channel gap noted below entirely. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this particular pack, but
it would block any future reel script that wants to quote a price or warranty
line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (26s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "A humming that changes when you steer is not your tires." |
| 2 · SETUP | 0:03–0:09 | "Wheel bearing noise gets louder turning one way, quieter the other. You are loading the bad side." |
| 3 · VALUE | 0:09–0:15 | "Tire noise does not do that. It stays the same through the turn." |
| 4 · VALUE | 0:15–0:21 | "Ignore it, and a bearing does not get better. It can seize, and the wheel can lock up." |
| 5 · CTA | 0:21–0:26 | "Send this to someone whose car hums on the highway. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score breakdown): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified live
this run):
- Beat 1: "car wheel hub bearing macro" / "wheel hub assembly close up"
- Beat 2: "car steering wheel turning overhead shot" / "alignment rack wheels turning"
- Beat 3: "tire tread rolling on pavement macro"
- Beat 4: "worn wheel bearing workbench" / "auto parts comparison shop"
- Beat 5: "auto repair garage bay interior car on lift"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 26s budget.

### Captions

[`captions.srt`](./captions.srt) — 11 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6 — e.g. a subtle rising hum under beats 2–3) →
   voiceover track → burned-in caption track → end-card CTA text (beat 5 only,
   shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slight desaturation + cooler white balance on beats 1–2
   (garage/mechanical mood), neutral daylight on beat 3, warm shift on beat 5
   (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 26s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 26s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the slate's corrected objective; a
  "save this" CTA measured `saved = 0.00` across the account's first 8 reels,
  even though this topic's original slate entry (#8) was written with a SAVE
  CTA — corrected here to SEND for consistency with the brakes pack

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.60 (5 clips × ~5.2s avg) |
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
cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`) or by the
squealing-vs-grinding-brakes pack from earlier today, this pack should wait
for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — same gap noted in the 2026-08-15 tread-fingerprint pack and the
2026-08-16 brakes pack). This pack sidesteps it deliberately rather than
asserting a track is cleared: **no music bed is assigned.** The reel is
voiceover + captions + optional single royalty-free ambient/SFX layer (a
subtle rising hum under beats 2–3, sourced and rights-cleared manually at
render time), which also scores well on the pipeline's muted-first requirement
since the captions alone carry full meaning. If the operator wants a music
bed, that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (57/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> A humming that changes when you steer is not your tires.
>
> Wheel bearing noise gets louder turning one way, quieter the other — you're
> loading the bad side. Tire noise doesn't do that; it stays the same through
> the turn.
>
> Ignore it, and a bearing doesn't get better. It can seize, and the wheel can
> lock up.
>
> Send this to someone whose car hums on the highway.
>
> #wheelbearing #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That hum gets louder when you turn one way? That's not your tires
> talking."
> Caption: Wheel bearing noise changes with the turn. Tire noise doesn't. One
> quick test tells you which one you've got.
> CTA: Hear a hum on the highway? Call (216) 862-0005 or stop by 17625 Euclid
> Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Turn the wheel — does the hum get louder or quieter? Your answer
> matters."
> Caption: Louder one way, quieter the other = bearing. Same both ways = tire.
> A failing bearing doesn't fix itself, and it doesn't fail gently.
> CTA: Not sure which one you've got? Bring it by — we'll tell you straight,
> free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (57/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on multiple
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the bearing-noise-vs-tire-noise claim,
and that store wasn't queried live this run to check), and **winning-concept
tournament** (scored 0, not estimated, since `conceptTournament.ts` was not
run this session). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no
`igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session) can hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"what a bad wheel bearing sounds like"}`, let the
server re-score and re-render for real, and only then move toward publish.
