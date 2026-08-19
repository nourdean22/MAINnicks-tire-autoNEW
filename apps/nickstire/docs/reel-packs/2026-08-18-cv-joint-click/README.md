# Reel production pack — "That clicking sound when you turn" (CV joint) (2026-08-18)

> **Sprawl flag — read this before treating this pack as routine.** A search of
> open PRs (`gh`/GitHub search, `is:pr "reel pack" in:title`) turned up **35
> reel-pack pull requests**, of which **~29 are still open and unreviewed**,
> firing at roughly one per hour since at least 2026-08-14. Between them they
> already cover essentially every item on `REEL-SLATE-2026-07-31.md` (19 of 20
> topics) plus at least 9 off-slate topics. This is very likely a scheduled
> task that has been running unattended far longer than intended, producing
> content nobody is merging or acting on. **This pack does not fix that** — it
> is one more scheduled firing completing its assigned task per
> `.claude/skills/nickstire-reel-operator/SKILL.md`. Flagging it here, in the
> PR body, and via a proactive notification so a human sees it, because the
> skill's own file (`nickstire-reel-operator/SKILL.md`, "Where the pack goes")
> already documents one prior instance of exactly this failure mode
> (2026-08-14/15, eight packs in eight directories) and this is now a second,
> larger instance of the same root cause: an unattended cadence with no human
> in the loop to merge, reject, or pause it.

Scheduled-task run · 2026-08-18 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · topic **CV-CLICK**
(off-slate — the one remaining un-packed slate item, #11 "all-season vs
winter tires," was deliberately skipped as seasonally premature in mid-August,
same call made for it in the 2026-08-16 brakes pack)

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

**Capabilities — checked this run:**

| Capability | Status this run | Why |
|---|---|---|
| Env vars (`ADMIN_API_KEY`, `HIGGSFIELD_*`, `REEL_*`, `DATABASE_URL`) | Checked — **none set** in this session's shell | Confirms this is a Claude Code repo session with no path to the running app, its DB, or its admin routes. Grounds for the pack-only route below, not an assumption. |
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | No server process, no credential in this session. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (last verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead,
checked two file/PR-based proxies (this is directional, not a substitute for
the real ledger — a rejected brief that never got a pack written would not
show up here):

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs: penny test, tire
  expiration, tread fingerprint, battery/summer-heat, squealing-vs-grinding
  brakes.
- `gh`-equivalent PR search `is:pr "reel pack" in:title` — **35 total**, 29
  open, covering coolant color, spare-tire mileage, alignment vs balance,
  check-engine light, wheel-bearing hum, repair-authorization questions
  (TRUSTCHECK), cold-weather tire light (COLDSNAP), cabin vs engine air
  filter, pothole damage, tire rotation, "noises that mean stop driving now,"
  sidewall bulge, serpentine-belt squeal, wiper-blade check, exhaust-smoke
  color, strut bounce-test, oil-change intervals, why-the-car-pulls,
  road-trip pre-check, transmission-fluid color test, summer-heat tire
  pressure, road-salt brake-line corrosion, tread-depth rain-vs-snow, and
  plug-vs-patch tire repair.

**CV-joint clicking-noise-when-turning is not among any of the above** — it
is a distinct diagnostic topic from wheel-bearing hum (which is
speed-correlated and constant, not turn-triggered), so it clears the
repetition check on both proxies.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already packed? | Selected? |
|---|---|---|---|---|
| CV joint clicking when turning | Strong — specific, diagnosable-by-sound, distinct from every packed topic | Yes | No | ✅ **Selected** |
| All-season vs winter tires (slate #11) | Moderate — seasonal | Yes, but not *now* | No (only remaining slate gap) | Parked — mid-August is too early for a winter-tire hook, same call as the 2026-08-16 brakes pack made for slate items #3/#11/#12 |
| Any slate item #1–#10, #12–#20 | — | — | **Yes**, all already have an open or merged pack | Excluded outright — would be the 3rd+ instance of the exact duplication failure this skill's own file already documents once |

CV-joint clicking was selected specifically because it survives the
repetition check cleanly while every slate item except #11 does not, and #11
is seasonally wrong for today's date.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "It's usually the CV joint" (clicking noise when turning) | General automotive mechanical knowledge (CV — constant-velocity — joints are the standard diagnosis for turn-triggered clicking) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "usually" (approved soft-language pattern, `facelessReelStudio.ts`) rather than an absolute. |
| "The rubber boot cracked, grease leaked out, now it's grinding metal on metal" | Same — standard mechanical fact (torn CV boot → lost lubrication → joint wear), not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (repeated from every prior pack, still unresolved):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
no `"reel"` channel exists. This script doesn't lean on that store, so the gap
doesn't block this pack, but it would block any future script quoting a price
or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "That clicking sound when you turn the wheel? That's not nothing." |
| 2 · SETUP | 0:03–0:08 | "It's usually the CV joint — the part that lets your axle turn and flex at the same time." |
| 3 · VALUE | 0:08–0:15 | "The rubber boot around it cracked. Grease leaked out. Now it's grinding metal on metal every turn." |
| 4 · VALUE | 0:15–0:21 | "Ignore it long enough and the joint fails completely — that wheel stops taking power." |
| 5 · CTA | 0:21–0:27 | "Hear a click turning corners? Send this to whoever's car makes that sound. Nick's Tire and Auto — link in bio." |

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

- Beat 1: "car turning parking lot low angle wheel"
- Beat 2: "CV axle boot closeup" / "drive axle macro"
- Beat 3: "torn rubber boot grease" / "cv joint disassembled macro"
- Beat 4: "mechanic axle removal workbench"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone — burn
in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

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
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc. Given the current
  backlog (§ sprawl flag above), this pack should queue behind the ~29 other
  unreviewed packs, not jump ahead of them.
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — matches the account's corrected
  SEND-oriented objective used in every pack since the brakes pack

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
the latest `autonomy_policy_versions` row, not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
~29 packs already queued unreviewed, the feed cap and topic-repeat windows
will bind hard the moment anyone starts merging and enqueuing this backlog —
that is itself a reason to triage the backlog before generating more.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, repeated
from every prior pack, still unresolved). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient/SFX layer (garage room tone, one light mechanical clink), which also
scores well on the pipeline's muted-first requirement since the captions
alone carry full meaning. If the operator wants a music bed, that requires a
specific track with asset ID, source, license scope, territory, and expiry
tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (61/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> That clicking sound when you turn the wheel? That's not nothing.
>
> It's usually the CV joint — the part that lets your axle turn and flex at
> the same time. The rubber boot around it cracked, grease leaked out, and
> now it's grinding metal on metal every turn.
>
> Ignore it long enough and the joint fails completely.
>
> Send this to whoever's car makes that sound.
>
> #cvjoint #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That click when you turn? It's not your imagination — it's your CV
> joint running dry."
> Caption: A torn boot means the joint lost its grease. Left alone, it grinds
> itself apart and the wheel stops taking power.
> CTA: Hear it? Call (216) 862-0005 or stop by 17625 Euclid Ave — free look,
> no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Does your car click when you turn into a parking lot? Here's what
> that actually means."
> Caption: It's almost always a CV joint with a torn boot — grease gone,
> metal grinding metal, one turn at a time.
> CTA: Not sure if that's what you're hearing? Bring it by — we'll tell you
> straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (61/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, mainly on
**loop** (the CTA frame doesn't loop cleanly back into the hook frame) and
**sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the CV-joint/boot claims, and that store wasn't queried live this run).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the pack
is complete and usable.

**Operator action recommended beyond this single pack:** the ~29-open-PR
backlog documented in the sprawl flag above needs a human triage pass
(merge the best, close true duplicates, e.g. #1610/#1585/#1564/#1607/#1587
are already-closed duplicates of merged packs — the same fate likely awaits
several of the 29 still open) before this scheduled task fires again and adds
a 6th, 7th, 8th... concept nobody has looked at yet.
