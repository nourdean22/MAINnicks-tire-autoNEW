# Reel production pack — "Coolant color" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **COOLANT-COLOR**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #18

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

**Capabilities — checked this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. `env \| grep -i HIGGSFIELD` returned nothing — no credential is even present in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` (last verified 2026-08-11) states prod is pinned to **`template_stock`**, the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not present in this session's env | `env \| grep -i REEL_` returned nothing. |
| `ADMIN_API_KEY` / `DATABASE_URL` | Not present in this session's env | Confirms this session has no path to call `/api/admin/reel-canary` even if the hard rule allowed it — checked, not assumed. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing, and unreachable per the env check above regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| Adobe MCP video/image tools (connected to this session) | Not used to render | Real tools, but they operate on assets supplied by the caller (images/video files) — they are not a Higgsfield/Seedance clip generator and cannot substitute for the app's own motion-generation route without inventing source footage. Using them here would produce an asset the real pipeline's render-integrity gate (`reelAssembly.ts` #800/#801) never validated — see "Producing a pack when the motion route is unavailable" in the operator skill. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, unreachable from
this session per the env check above. Instead, checked the file-based record of
prior pack runs AND in-flight (unmerged) PRs, per the operator skill's explicit
warning that checking only `ls` misses drafts still open:

- `ls apps/nickstire/docs/reel-packs/` — five merged packs: penny test (slate
  #1), squealing vs. grinding brakes (#2), tires expiration date (#6), tread
  fingerprint (not on the slate — wear-pattern diagnosis), battery
  summer-heat (adjacent to slate #12).
- `gh`-equivalent PR search (`is:open "reel pack" OR "reel-packs" in:title,body`)
  — four open, unmerged packs as of this run: **balance vs. alignment** (#1616,
  slate #4), **spare-tire mileage** (#1617, slate #5), **check-engine-light**
  (#1615, slate #7), **wheel-bearing-hum** (#1614, slate #8).

That is 9 of the slate's 20 topics already covered or in flight. This run's
topic, slate item **#18 "coolant color,"** is not among them — checked against
both the merged directory and the open-PR list, not just one.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining topics, with cold/seasonal items (#3 cold
weather tire light, #11 all-season vs. winter tires) deprioritized as
seasonally premature — today is 2026-08-17, mid-August — same reasoning the
2026-08-16 brake pack applied to the same two items:

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 18 | Coolant color | Strong — visual mystery ("what's that puddle?") every driver has faced | Yes | ✅ **Selected** |
| 20 | Questions before authorizing repair | Moderate — trust/authority hook, talk-heavy, weaker visual variety | Yes | Parked |
| 15 | What "you need struts" means | Moderate — needs a demonstrable driveway test shot, harder to visualize cleanly in 5 macro beats | Yes | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency, no live-diagnosis hook | Yes | Parked |
| 9 | Oil change intervals | Moderate — myth-correction hook, but text-heavy (sticker vs. manual) rather than visual | Yes | Parked |

Coolant color was selected for the strongest first-two-second visual hook (a
colored puddle is instantly recognizable and slightly alarming) combined with
a clean binary contrast (coolant vs. harmless AC condensation) that maps
directly onto the slate's 5-beat script shape without inventing structure —
the same pattern that worked for the brake pack's squeal-vs-grind contrast.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Green, orange, or pink [liquid] is coolant" | General automotive mechanical knowledge (coolant dye colors are a standard OEM/aftermarket convention) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; confirmed unreachable per §1's env check). No `EvidenceRecord` citation is attached to this claim. |
| "Clear and odorless [liquid near AC vents] is usually just AC condensation" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "usually" and "worth checking" (approved soft-language patterns, `facelessReelStudio.ts` — *can point to · may indicate · worth checking · one clue · do not guess · stop by and we'll take a look*) rather than an absolute, which is the correct hedge for an unverified-in-store claim. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact (no price/warranty claim), which sidesteps the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this particular pack, but
it would block any future reel script that wants to quote a price or warranty
line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "That puddle under your car? The color tells you everything." |
| 2 · SETUP | 0:03–0:08 | "Green, orange, or pink — that's coolant, not something to ignore." |
| 3 · VALUE | 0:08–0:14 | "Clear and odorless near the AC vents? That's just condensation — totally normal." |
| 4 · VALUE | 0:14–0:20 | "Coolant on the ground for a few weeks isn't a 'watch it' problem. It's worth checking before it costs you an engine." |
| 5 · CTA | 0:20–0:27 | "Send this to whoever's got a mystery puddle in their driveway. Nick's Tire and Auto — link in bio." |

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
- Beat 1: "colored liquid puddle asphalt macro" / "car fluid leak driveway"
- Beat 2: "coolant drip underside car macro" / "green antifreeze drop"
- Beat 3: "water drip condenser closeup" / "AC condensation drip car"
- Beat 4: "coolant reservoir low level" / "engine bay steam closeup"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 27s budget.

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
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–2 (mystery/concern
   mood around the puddle), neutral-clean grade on beat 3 (the "it's fine"
   contrast beat), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move or
   liquid-drip motion, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
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
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in the
latest `autonomy_policy_versions` row, which was not read this run (live DB,
confirmed unreachable per §1). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN` — not
probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily autonomous
cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`), this pack should
wait for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same gap
noted in the 2026-08-15 tread-fingerprint and 2026-08-16 brake packs). This
pack sidesteps it deliberately rather than asserting a track is cleared: **no
music bed is assigned.** The reel is voiceover + captions + optional single
royalty-free ambient/SFX layer (a single quiet drip sound under beat 2), which
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (63/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> That puddle under your car? The color tells you everything.
>
> Green, orange, or pink — that's coolant, not something to ignore.
> Clear and odorless near the AC vents? That's just condensation — totally
> normal.
>
> Coolant on the ground for a few weeks isn't a "watch it" problem. It's
> worth checking before it costs you an engine.
>
> Send this to whoever's got a mystery puddle in their driveway.
>
> #cartips #autorepair #carmaintenance #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "There's a puddle under your car. Here's what the color is telling
> you."
> Caption: Green, orange, pink = coolant, don't ignore it. Clear and
> odorless near the vents = just condensation, totally normal. Know the
> difference before a small leak becomes an overheated engine.
> CTA: Got a mystery puddle? Call (216) 862-0005 or stop by 17625 Euclid
> Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Green, clear, or pink — do you actually know what's leaking under
> your car?"
> Caption: One is completely normal AC condensation. The other is coolant,
> and it means your engine is losing what keeps it from overheating.
> CTA: Not sure which one you've got? Bring it by — we'll tell you
> straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (63/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the coolant-vs-condensation claims, and
that store wasn't queried live this run to check — confirmed unreachable per
§1's env check, not just skipped). Not `PUBLISHED WITH READ-BACK` — no
`reel-canary` call, no `igPostId`, nothing was generated, rendered, or
posted. Not `BLOCKED` outright — the pack is complete and usable; an operator
(or a live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"coolant color"}`, let the
server re-score and re-render for real, and only then move toward publish.
