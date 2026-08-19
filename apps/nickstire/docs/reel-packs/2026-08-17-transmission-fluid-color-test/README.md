# Reel production pack — "The transmission fluid color test" (2026-08-17)

> **Scheduling note — read this first.** At the time this pack was written, a
> GitHub PR search (`is:pr "reel pack" in:title`) returned **17 open, unmerged
> draft PRs** from this same scheduled task, fired roughly once an hour since
> 2026-08-16 18:32 UTC, plus 10 more already merged/closed. Nearly every common
> mechanic-truth topic (brakes, battery, tires, belts, fluids, lights, noises)
> is now either packed or mid-flight as an unreviewed draft. This pack picks a
> topic none of those 27 titles cover, but the volume itself is worth an
> operator decision this session cannot make on its own: whether the schedule
> interval is intended to run this frequently, and whether the 17 open drafts
> should be triaged (merged, closed, or consolidated) before more accumulate.
> See the closing chat summary for the full list.

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · no slate item — topic
selected fresh against the PR/directory survey above, not from
`REEL-SLATE-2026-07-31.md`.

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt does
not authorize `reel-canary` generation or publish calls, and that
repetition-ledger/quality-score reads against the live database are
themselves a production read, not a free action. This session made none of
those calls. See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + credentials; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed today. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead,
checked both required file-based proxies per the skill's own duplication
lesson:

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs on disk: penny test,
  tire expiration, tread fingerprint, battery-summer-heat,
  squealing-vs-grinding-brakes.
- `gh`-equivalent (`mcp__github__search_pull_requests`, `is:pr "reel pack" in:title`)
  — 27 total PRs (17 open, 10 closed/merged), covering: coolant color,
  spare-tire mileage, balance vs. alignment, check-engine light, wheel-bearing
  hum, repair-authorization questions, cabin/engine air filter, pothole
  damage, tire rotation, "noises that mean stop driving now," wiper blades,
  exhaust smoke color, strut bounce-test, oil-change intervals, why cars
  pull, summer tire pressure, sidewall bulge, plus the merged-pack topics
  above.

**Transmission fluid (color/smell check) appears in none of the 32 surveyed
directory entries + PR titles.** This is a file-system + PR-title check, not
a substitute for the real ledger — a rejected brief that never produced a
pack or PR would not show up here, so treat "not found" as directional, not a
guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against topics not already covered on disk or in an open/closed PR
title (the 32-item exclusion list above):

| Topic | Hook strength | Evergreen? | Overlap risk | Selected? |
|---|---|---|---|---|
| Transmission fluid color/smell test | Strong — visual "look and know" DIY test, same proven format as the penny test | Yes | None found | ✅ **Selected** |
| Power-steering fluid low symptoms | Moderate — less visceral, harder to shoot without hands | Yes | Low, but weaker hook | Parked |
| Serpentine belt cracking | Moderate — good macro visual, but close to "noises that mean stop driving now" (open PR #1620) in feel | Yes | Medium | Parked |
| Battery terminal corrosion | Weak-to-moderate | Yes | High — "battery" already covered twice (heat myth, merged + closed duplicate #1607/#1610); risks tripping a 7-day repeat-topic guardrail on the keyword alone | Rejected |

Transmission fluid was selected because it reuses the account's
highest-performing proven format (a 10-second DIY visual test, same shape as
the penny test) on a genuinely unused topic, and because every ingredient
needed to shoot it — a dipstick, a cloth, fluid color — is hands-free
shootable per the standing negative prompt (no hands in frame).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Bright red and clear usually means it's doing its job" | General automotive mechanical knowledge (ATF color as a degradation indicator is standard, non-shop-specific knowledge) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "usually" and "can point to" (approved soft-language patterns, `facelessReelStudio.ts`) rather than an absolute, which is the correct hedge for an unverified-in-store claim. |
| "Brown, black, or a burnt smell can point to fluid breaking down" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (repeated from prior packs, still true):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Pull your transmission dipstick. This ten-second look is worth checking." |
| 2 · SETUP | 0:03–0:08 | "Bright red and clear usually means it's doing its job." |
| 3 · VALUE | 0:08–0:14 | "Brown, black, or a burnt smell can point to fluid breaking down." |
| 4 · VALUE | 0:14–0:20 | "That's one clue — don't guess. It could mean a transmission already wearing itself out." |
| 5 · CTA | 0:20–0:27 | "Send this to someone who hasn't checked theirs in years. Stop by and we'll take a look — Nick's Tire and Auto, link in bio." |

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

- Beat 1: "transmission dipstick macro" / "car dipstick closeup"
- Beat 2: "red transmission fluid drop macro"
- Beat 3: "fluid color comparison macro" / "motor oil color swatch"
- Beat 4: "transmission pan underside garage" / "auto repair undercarriage"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral, slightly warm garage tone on beats 1–2 (clean, trust
   the visual), cooler/harsher shift on beats 3–4 (the "problem" reveal),
   warm shift back on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, video-stream duration
   within 0.75s (checked separately — container duration can lie via the
   audio track if the video track ends early), ≥80% of expected 30fps frame
   count, ≥3 distinct MD5s among 5 sampled frames (motion proof — no
   static/looped single image; every beat here is a slow camera move, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed posting cadence per
  `REEL-SLATE-2026-07-31.md` — do not post ad hoc, and check whether the
  daily autonomous cron or one of the 17 open-draft packs already claims
  today's feed-cap slot before scheduling this one (see §5 guardrail order)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the slate's corrected objective; a
  "save this" CTA measured `saved = 0.00` across the account's first 8 reels

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
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run (live
DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is
likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
17 open draft packs already produced roughly hourly, **today's feed cap is
very likely already exhausted several times over if even a fraction of those
drafts were ever advanced to real jobs** — an operator should confirm current
`content_reservations` state before treating this pack as postable today.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, repeated
from prior packs). This pack sidesteps it deliberately rather than asserting
a track is cleared: **no music bed is assigned.** The reel is voiceover +
captions + optional single royalty-free ambient/SFX layer (garage room tone,
one soft metallic clink on the dipstick beat), which also scores well on the
pipeline's muted-first requirement since the captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by hand —
this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (62/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> Pull your transmission dipstick. This ten-second look is worth checking.
>
> Bright red and clear usually means it's doing its job. Brown, black, or a
> burnt smell can point to fluid breaking down.
>
> That's one clue — don't guess. It could mean a transmission already
> wearing itself out.
>
> Send this to someone who hasn't checked theirs in years.
>
> #cartips #transmission #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your transmission dipstick will tell you the truth in ten seconds."
> Caption: Red and clear — good. Brown, black, or burnt-smelling — one clue
> that fluid is breaking down. Don't guess.
> CTA: Not sure what you're looking at? Call (216) 862-0005 or stop by 17625
> Euclid Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know what color your transmission fluid should be right
> now?"
> Caption: One color means it's doing its job. Another is one clue something's
> already wearing out. Two very different repair bills down the road.
> CTA: Bring it by — we'll take a look and tell you straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (62/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, same two
dimensions as prior packs — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the fluid-color/smell claims, and that
store wasn't queried live this run to check). Not `PUBLISHED WITH READ-BACK`
— no `reel-canary` call, no `igPostId`, nothing was generated, rendered, or
posted. Not `BLOCKED` outright — the pack is complete and usable; an operator
(or a live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"transmission fluid color
test"}`, let the server re-score and re-render for real, and only then move
toward publish.

**Separately, and more urgently than this specific pack: the 17-open-draft-PR
backlog found in §1 is an operator decision this session flags but does not
act on** — closing, merging, or consolidating those PRs, or slowing the
schedule interval, needs a human call, not another automated pack.
