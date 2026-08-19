# Reel production pack — "Pothole damage you cannot see" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**POTHOLE-CHECK** · source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #10

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

**Operational note for the operator, not part of the pack itself:** at the time
this pack was written, `gh pr list` showed **15 other open, unmerged draft PRs**
from this same recurring scheduled task (topics: coolant color, spare-tire
mileage, balance vs. alignment, check-engine light, wheel-bearing hum, cabin vs.
engine air filter, tire rotation, "noises that mean stop driving," wiper blades,
exhaust smoke color, strut bounce test, oil-change intervals, why a car pulls,
summer tire pressure, and repair-authorization questions), several fired only
~1 hour apart. None have been reviewed or merged. Worth a look — the packs
themselves check for topic overlap against `ls` + `gh pr list` per the skill,
but a growing backlog of unreviewed drafts is a sign the review side of this
loop isn't keeping pace with the generation side.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short of
any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and short of
any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + rotating CLI session credential; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (last verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead, checked
the file-based record: `ls apps/nickstire/docs/reel-packs/` shows five prior
merged packs (penny test #1, tire expiration #6, tread fingerprint —
off-slate, battery/summer-heat #12-adjacent, squealing-vs-grinding-brakes #2),
and `gh pr search` shows fifteen further open drafts covering slate items
#4, #5, #7, #8, #9, #14, #15, #17, #18, #19, #20, plus one off-slate
("noises that mean stop driving now" duplicates slate #19's own title, and
"repair authorization" duplicates #20 — those two are likely the same
concept restated, not confirmed here). **Slate item #10 (pothole damage) does
not appear in either list.** This is a file-system/PR-list check, not a
substitute for the real ledger — a rejected brief that never got a pack
written would not show up here, so treat "not found" as directional, not a
guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining items not already covered by a merged
pack or an open PR (per §1's check), with winter/cold-weather items
deprioritized as seasonally premature in mid-August:

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 10 | Pothole damage you cannot see | Strong — relatable local pain point, "hidden damage" framing creates curiosity gap | Yes — Cleveland/Euclid roads are a year-round issue, not winter-locked | ✅ **Selected** |
| 16 | Tread depth for rain vs. snow | Moderate — but thematically close to the already-packed "tread fingerprint" concept (2026-08-15), real overlap risk | Yes | Parked — overlap risk with existing pack |
| 3 | Cold weather and the tire light | Weak right now — the hook depends on a temperature drop that hasn't happened yet in mid-August | Seasonal | Parked — seasonally premature |
| 11 | All-season vs. winter tires | Weak right now — slate's own CTA is "save this for when the forecast turns," which isn't now | Seasonal | Parked — seasonally premature |

Pothole damage was selected because it's the strongest evergreen, non-winter,
non-overlapping topic left on the slate: a genuine "you might not know this"
hook (invisible damage after a non-flat-causing impact) that maps cleanly onto
the 5-beat script shape without inventing structure, and it's timely — Euclid
Ave and the surrounding roads take real damage from freight traffic
year-round, not just in freeze-thaw season.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Impact can bend a wheel, knock out alignment, or bruise the sidewall from the inside" | General automotive mechanical knowledge (pothole-impact damage modes are a standard diagnostic category — bent rim, alignment shift, and internal sidewall/belt separation from a hard hit) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "can" (approved soft-language pattern, `facelessReelStudio.ts` §580 list) rather than an absolute — correct hedge for an unverified-in-store claim. |
| "The tell is new pulling, new shaking, or a slow leak that starts days later" | Same — standard mechanical fact (delayed symptom onset after impact damage), not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Avoids the banned "this means your X is bad" pattern (`facelessReelStudio.ts:560`) — framed as symptoms/clues, not a verdict. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the `FactChannel` gap noted below, same approach as the prior brakes pack. |

**Gap, stated plainly (repeated from prior packs, still open):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (29s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "The pothole that did not flatten your tire may still have cost you." |
| 2 · SETUP | 0:03–0:10 | "Impact can bend a wheel, knock out alignment, or bruise the sidewall from the inside — where nothing shows." |
| 3 · VALUE | 0:10–0:17 | "The tell is new pulling, new shaking, or a slow leak that starts days later." |
| 4 · VALUE | 0:17–0:23 | "None of that shows on a walk-around. It shows up on the road." |
| 5 · CTA | 0:23–0:29 | "Hit a bad one lately? Send this to someone who did. Nick's Tire and Auto — link in bio." |

Beats 1–3 reuse the slate's own pre-vetted copy verbatim
(`REEL-SLATE-2026-07-31.md` item #10) rather than paraphrasing it.

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):
- Beat 1: "car tire hitting pothole slow motion" / "pothole impact tire closeup"
- Beat 2: "bent wheel rim macro" / "wheel alignment rack shop"
- Beat 3: "tire sidewall bulge closeup" / "tire sidewall bubble macro"
- Beat 4: "steering wheel POV driving" / "car pulling to one side dashboard view"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 29s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   road/garage SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slightly harsh/high-contrast on beats 1–3 (impact, damage
   reveal — asphalt and metal texture-forward), calmer/warmer on beats 4–5
   (steering-wheel POV, CTA garage bay).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 29s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat is a slow move or reveal, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 29s (within the 15–60s target range and the account's own
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
latest `autonomy_policy_versions` row, which was not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
that 15+ other packs from this same recurring scheduled task already sit as
open PRs (see the operational note at the top of this file), if any of them
were actually enqueued the same day, this pack should wait for the next open
slot rather than force a same-day post — `RESERVATION_FEED_CAP` (2/day) would
already be exhausted many times over.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — noted in every prior pack in this directory). This pack sidesteps
it deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient/SFX layer (a low road-noise bed and one soft "thud" sting under beat
1's impact), which also scores well on the pipeline's muted-first requirement
since the captions alone carry full meaning. If the operator wants a music
bed, that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

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

**Primary caption (matches slate's corrected SEND-oriented objective, and its
own hashtag set):**

> The pothole that did not flatten your tire may still have cost you.
>
> Impact can bend a wheel, knock out alignment, or bruise the sidewall from
> the inside — where nothing shows.
>
> The tell is new pulling, new shaking, or a slow leak that starts days
> later.
>
> None of that shows on a walk-around. It shows up on the road.
>
> Hit a bad one lately? Send this to someone who did.
>
> #potholes #clevelandohio #euclidohio #cartips

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your tire didn't go flat. That doesn't mean the pothole didn't hurt
> it."
> Caption: A hard hit can bend a rim, knock out alignment, or bruise a
> sidewall from the inside — and the symptoms show up days later, not on
> the spot.
> CTA: New pulling or shaking since a bad pothole? Call (216) 862-0005 or
> stop by 17625 Euclid Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "When's the last time you actually checked what a pothole did to
> your car?"
> Caption: Not flattening the tire isn't the same as not doing damage.
> Bent rims, alignment knocked out, sidewalls bruised from the inside — none
> of it shows on a walk-around.
> CTA: If your car's felt off since you hit one, bring it by — we'll tell
> you straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA garage-bay frame doesn't loop
cleanly back into the hook's pothole-impact frame) and **sourced fact** (no
`EvidenceRecord` in `evidenceResolver.ts` currently backs the
impact-damage/delayed-symptom claims, and that store wasn't queried live this
run to check). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no
`igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"pothole damage you cannot see"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Separately, flagging for the operator (not a pack defect):** 15 open,
unmerged draft PRs from this same recurring scheduled task exist right now.
Recommend either reviewing/merging or closing the backlog before more packs
accumulate, and/or slowing the schedule's firing interval — the topic list is
finite (20 slate items) and is close to exhausted for non-winter items.
