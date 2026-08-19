# Reel production pack — "What 'you need struts' actually means" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**STRUT-BOUNCE** · source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #15

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the
operator skill's hard rule is explicit that a stored scheduled prompt does not
authorize `reel-canary` generation or publish calls, and that
repetition-ledger/quality-score reads against the live database are
themselves a production read, not a free action. This session made none of
those calls. See §1 and §7.

**Backlog note (read this before scheduling another run):** at the time this
pack was written, **11 open draft PRs** for prior scheduled reel-pack runs
were sitting unmerged in this repo (`#1612`–`#1624`, oldest opened
2026-08-16 21:45 ET, roughly one every hour since), on top of five packs
already merged to `main`. The schedule is producing packs faster than they
are being reviewed. This run avoided re-covering any topic already packed or
already sitting in one of those open PRs (see §2), but that check gets harder
and less reliable every additional hour the backlog grows — recommend the
operator either merge/close the backlog or slow the schedule interval before
the next firing.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. `ls .env*` in `apps/nickstire/` shows only `.env.example` — no live credentials present in this checkout either. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead,
checked the file-based record and the open-PR backlog, per the operator
skill's explicit two-source rule (the merged directory alone is blind to
unmerged draft PRs — confirmed live by this repo's own 2026-08-16
incident, #1611):

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs: penny test (#1),
  tire expiration date (#6), tread fingerprint (off-slate wear-pattern
  concept), battery/summer-heat (#12), squealing vs. grinding brakes (#2).
- `gh`-equivalent PR list (`list_pull_requests`, open, this repo) — 11 open
  draft PRs (#1612–#1624) covering: summer-heat tire pressure, oil-change
  intervals (#9), why the car pulls (#13), repair-authorization questions
  (#20), noises that mean stop driving now (#19), cabin vs. engine air
  filter (#14), coolant color (#18), spare-tire mileage (#5), balance vs.
  alignment (#4), check-engine-light (#7), wheel-bearing hum (#8).

Combined, 16 of the slate's 20 items are already packed or in flight. Slate
item **#15, "what 'you need struts' actually means,"** is not among them.
This is a file-system + PR-list check, not a substitute for the real ledger —
an actual `reel_jobs` row (e.g. a rejected brief that never got a pack
written) would not show up here, so treat "not found" as directional, not a
guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining items not already packed or in an open
PR (today is 2026-08-17 — mid-August, so the seasonal winter-tire item #11
was deprioritized as premature, matching the reasoning used for #3/#11/#12 in
prior packs):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 15 | What "you need struts" actually means | Strong — names a phrase everyone has heard quoted at a counter and never explained, plus a free at-home test | Yes | ✅ **Selected** |
| 10 | Pothole damage you cannot see | Strong — Cleveland-specific, but overlaps thematically with #13 (why the car pulls), already in an open PR | Yes | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency, no strong visual demo | Yes | Parked |
| 16 | Tread depth for rain vs. snow | Moderate — close in concept to the merged "tread fingerprint" pack; risk of reader-perceived repetition even though not a literal duplicate | Yes | Parked |

Struts was selected over pothole damage specifically to avoid thematic
overlap with the already-open "why car pulls" PR (#1622) — both pothole and
pulling scripts would lean on the same "new pulling/shaking" symptom
language. The struts topic instead offers a self-contained, testable-at-home
demo (the bounce test) that maps cleanly onto the slate's 5-beat script shape
without inventing structure, and gives viewers something to *do*
(save-and-try) rather than just watch.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Struts control how your car settles after a bump. Worn ones keep bouncing." | General automotive mechanical knowledge (struts/shocks damping suspension oscillation is a standard, textbook mechanical fact) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached to this claim. |
| "That bounce can point to longer stopping distance and chewed-up tread" | Same — standard mechanical fact (reduced tire-to-road contact under uncontrolled oscillation), not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "can point to" — the approved soft-language pattern (`facelessReelStudio.ts:570`) — rather than an absolute claim, which is the correct hedge for a claim not backed by a stored `EvidenceRecord`. |
| "Push down hard on one corner. It should rebound once, then settle." | General automotive knowledge (the bounce/push test is a standard consumer-facing suspension check, also stated verbatim in the slate source doc itself, §15) | **UNKNOWN against this repo's evidence store**, same reasoning — sourced from the slate doc, not from `evidenceResolver.ts`. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact (no price/warranty claim), which sidesteps the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this particular pack,
but it would block any future reel script that wants to quote a price or
warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "'Time for struts.' You hear it a lot. It's explained almost never." |
| 2 · SETUP | 0:03–0:09 | "Struts control how your car settles after a bump. Worn ones keep bouncing." |
| 3 · VALUE | 0:09–0:15 | "That bounce can point to longer stopping distance and chewed-up tread — even when the ride feels normal." |
| 4 · VALUE/DEMO | 0:15–0:21 | "The test: push down hard on one corner. It should rebound once, then settle. More bounce than that is worth checking." |
| 5 · CTA | 0:21–0:27 | "Try it in your driveway. Not sure what you felt? Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated quality subscores): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat (matches the repo's real M10 preflight constraint — no in-frame
text, no people):

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

Beat 4 (the bounce-test demo) is written to avoid needing a hand in frame:
the visual is a static low-angle shot of a car's front corner rolling over a
speed bump, suspension compressing and rebounding once, filmed from outside
the vehicle — not a hand pushing on the bumper.

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "mechanic garage clipboard estimate closeup" / "auto shop invoice pen closeup"
- Beat 2: "car strut shock absorber closeup" / "suspension coil spring garage"
- Beat 3: "tire tread cupping wear macro" / "worn tire uneven wear closeup"
- Beat 4: "car suspension bounce speed bump slow motion" / "car driving over bump suspension travel"
- Beat 5: "auto repair garage bay exterior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe zone,
ALL-CAPS optional per house style — burn in via ffmpeg `subtitles` filter,
never as a generated in-frame element (Seedance/Higgsfield can't spell
reliably, and M10 preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slight desaturation + cooler white balance on beats 1–3
   (garage/mechanical mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, video-stream duration
   within 0.75s of 27s (checked separately — container duration can lie via
   the audio track), ≥80% of expected 30fps frame count, ≥3 distinct MD5s
   among 5 sampled frames (motion proof — beat 4's speed-bump clip is
   deliberately real suspension travel, not a still or a repeated loop).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc, and check whether the
  day's feed-post cap (2/day, `RESERVATION_FEED_CAP`) is already consumed by
  the backlog of packs above before assuming an open slot exists
- **Caption/hashtags:** see §8 below
- **CTA type:** SAVE (matches the slate source line "📌 Save this and try it
  in your driveway" — this is the one slate item written around an
  interactive save/try action rather than a SEND-style share; the slate's
  own measurement plan (bottom of `REEL-SLATE-2026-07-31.md`) is explicitly
  testing whether SAVE performs better than the account's historical
  `saved = 0.00`, so this pack should not be silently converted to SEND)

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
the 11-pack backlog noted at the top of this file, if even a fraction of
those packs get pushed through the real pipeline on the same day, the feed
cap and spacing window will bind hard — this pack should wait for a
confirmed open slot, not force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — same gap noted in every prior pack in this directory). This pack
sidesteps it deliberately rather than asserting a track is cleared: **no
music bed is assigned.** The reel is voiceover + captions + optional single
royalty-free ambient/SFX layer (garage room tone, one soft suspension-creak
sound on the beat-4 bump), which also scores well on the pipeline's
muted-first requirement since the captions alone carry full meaning. If the
operator wants a music bed, that requires a specific track with asset ID,
source, license scope, territory, and expiry tracked by hand — this pack
does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (53/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's SAVE-oriented objective for this item):**

> "Time for struts." You hear it a lot. It's explained almost never.
>
> Struts control how your car settles after a bump. Worn ones keep bouncing
> — which can point to longer stopping distance and chewed-up tread, even
> when the ride still feels fine.
>
> The test: push down hard on one corner. It should rebound once, then
> settle. More bounce than that is worth checking.
>
> Save this and try it in your driveway.
>
> #suspension #cartips #autorepair #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Push down on your bumper right now. What your car does next
> actually means something."
> Caption: One bounce and it settles — normal. Keeps bouncing — worth
> checking your struts before it costs you tires and stopping distance.
> CTA: Felt more than one bounce? Bring it by — we'll tell you straight,
> free look.

**Ad-ready variant B (question-forward):**

> Hook: "Do you actually know what 'you need struts' means, or do you just
> pay for it?"
> Caption: It's not a scare line — it's a real test you can run in your own
> driveway in 10 seconds. Here's what to look for.
> CTA: Not sure what you felt? Call (216) 862-0005 or stop by 17625 Euclid
> Ave — no pressure, no guessing.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (53/75, see
`brief.json`) sits well below the pipeline's real 70/75 auto-pass floor,
driven mainly by two dimensions this session structurally cannot verify from
a repo checkout — **sourced fact** (0/10; no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the struts/bounce claims, and that
store wasn't queried live this run) and **loop** (1/5; the CTA end frame,
garage exterior, doesn't loop cleanly back into the hook frame, a strut
close-up). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no
`igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"what you need struts means"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Before that happens, the operator should also address the 11-PR backlog
noted at the top of this file** — either by merging/closing the packs
already sitting open, or by widening the scheduled interval so packs stop
accumulating faster than they can be reviewed.
