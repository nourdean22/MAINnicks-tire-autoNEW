# Reel production pack — "What your exhaust smoke color is telling you" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · concept slug **EXHAUST-SMOKE**
· not on `REEL-SLATE-2026-07-31.md` — a new concept, checked against the slate and
found absent (see §2).

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present. The operator
skill's hard rule blocks `/api/admin/reel-canary` (start/advance/qa/publish) and
any live production-DB read (repetition ledger, quality re-score) from an
unattended scheduled run. This session made none of those calls — see §1.

**Operational flag, read before anything else:** at the time this pack was
written, `gh`/GitHub search showed **23 open pull requests** titled "reel
production pack," almost all created within the last ~15 hours at roughly
one-per-hour cadence, consistent with this same scheduled task firing
repeatedly. At least two topic collisions exist among them (battery: #1607 +
#1610; brakes: squealing-vs-grinding merged *and* re-opened at #1609). None of
the 23 have been merged, closed, or reconciled. This pack was deliberately
scoped to an uncovered topic to avoid adding a 24th collision, but the
underlying issue — packs accumulating faster than a human or the
`statenour-wave-reconcile`-style process can review them — is a scheduling/
review-cadence problem the operator should look at directly, not something a
single run can fix by producing better content. Flagging here and via a
proactive notification rather than guessing at a fix.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call and short of any live read against
production TiDB.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | No running server process / `HIGGSFIELD_API_KEY` in this session; this is a Claude Code repo session, not the live app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` (last verified in-repo 2026-08-11) states prod is pinned to **`template_stock`** — the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gated behind the cron pulse job; not queried this run. |
| TTS voiceover (`reelVoice.ts`) | Not called | No TTS tool connected to this session; calling the app's real TTS quota from an unattended run would itself be an uninstructed spend action. |
| ChatGPT / LLM scripting | This session (Claude, via Claude Code) wrote the script directly — no separate "ChatGPT" tool exists or was needed | — |
| Higgsfield generation | Not called (see above) | — |
| Meta/Instagram posting | Not called | Protected customer-facing action; requires an explicit live operator instruction every time, which this run does not have. |
| Shell/render (ffmpeg, Adobe video tools) | Available in principle (Bash, Adobe-for-creativity MCP) but not invoked | Rendering here would consume real Adobe credits/compute on an unattended run with no stock footage sourced or license-checked yet, and would not satisfy the render-integrity gate (`reelAssembly.ts` #800/#801) that the app's own pipeline enforces on a finished asset — a shell-rendered file could not skip that gate and still be called finished. |
| CapCut or equivalent editor | Not available in this environment | No editing GUI is connected to this session; assembly instructions below are written for a human (or the app's ffmpeg pipeline) to execute. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, which this mode
does not touch. Checked instead, per the skill's dedup protocol:

1. `ls apps/nickstire/docs/reel-packs/` — 5 merged packs, none about exhaust
   smoke, coolant, or emissions.
2. GitHub open-PR search `"reel pack" in:title` — 23 open PRs (list above);
   none mention exhaust, smoke, or emissions color-diagnosis.

Neither check is a substitute for the real ledger — a rejected `reel_jobs` row
that never produced a pack file or PR title would not show up in either.
Treat "not found" as directional, not a repetition guarantee.

---

## 2 · Candidate scores and selection

Three candidate concepts were scored against the same rubric weights the app's
real `calculateReelQualityScore()` uses (`facelessReelStudio.ts`): first-frame
scroll-stop, muted-first clarity, beat structure, sourced-fact use, faceless
compliance, claim safety, keyword relevance (0–5 scale here, informal — this
is a pre-brief judgment call, not the app's actual 75-point score, which only
runs inside `content.generateReelBrief`/`enqueueReelJob`):

| Concept | Hook strength | Evergreen? | Visual variety (faceless-friendly) | Claim-safety risk | Selected? |
|---|---|---|---|---|---|
| **Exhaust smoke color (blue/white/black)** | Strong — colored smoke is a striking, muted-friendly visual with an obvious "which one is mine" pull | Yes, year-round | High — three distinct smoke colors + shop cutaway, no faces/hands needed | Low — framed as "usually points to," not a diagnosis | ✅ **Selected** |
| Serpentine belt squeal on cold start | Moderate — sound-based hook, but overlaps structurally with the already-merged brake-noise pack | Yes | Moderate — mostly one shot (belt under hood) | Low | Parked — too close to existing brake-noise format |
| TPMS light meaning (on vs. blinking) | Moderate — informational, lower visceral pull than smoke or sound | Yes | Low — mostly a dashboard icon close-up | Low | Parked — thinner visual story |

Exhaust smoke was selected for the strongest first-frame visual (color is
instantly legible even muted) and a clean three-way structure that maps onto
the same beat shape as prior packs without inventing a new format.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Blue-gray smoke usually points to oil getting into the engine and burning off" | General automotive mechanical knowledge (oil bypassing worn valve seals/piston rings and burning in the combustion chamber is a standard diagnostic heuristic) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "usually points to" — an approved soft-language pattern (`facelessReelStudio.ts`: *can point to / may indicate*), the correct hedge for an unverified-in-store claim. |
| "Thick white smoke that doesn't clear after warm-up can point to coolant getting into the engine" | Same — standard mechanical fact, not shop-specific; the "doesn't clear after warm-up" qualifier is included specifically to distinguish it from normal cold-start condensation, avoiding a false-alarm claim | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "Black smoke usually means the engine's running rich" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim is made anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap below entirely. |
| Shop name/address used only in the CTA card, verbatim from `SEED_FACTS` `legal.entity` | `businessFacts.ts` line ~118: "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" | **Verified against repo source file** (not prod DB — this is the git-versioned code fallback, which per the skill's source-of-truth model is always available even when the DB is empty). |

**Gap, stated plainly (same one every non-SSOT-quoting pack hits):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel yet. This script avoids the gap by not quoting
any priced/warrantied fact, same pattern as the brake-noise pack.

---

## 4 · Full production pack

### Format
9:16 vertical, target **30 seconds** (4 spoken beats totaling 27s + a 3s
silent SAVE-freeze CTA card — matches the render-integrity contract in
`reelAssembly.ts` that a finished render is checked against: container and
video-stream duration within 0.75s of beats+freeze, ≥80% of expected 30fps
frame count, ≥3 distinct sampled-frame MD5s as motion proof).

### Word-for-word script, timed

| Beat | Time | VO (word-for-word) | Est. pace |
|---|---|---|---|
| 1 — Hook | 0:00–0:03 (3.0s) | "Exhaust smoke color is a clue." | 6 words / 3.0s ≈ 2.0 wps |
| 2 — Blue | 0:03–0:11 (8.0s) | "Blue-gray smoke usually points to oil getting into the engine and burning off — often worn valve seals or piston rings." | 20 words / 8.0s ≈ 2.5 wps |
| 3 — White | 0:11–0:19 (8.0s) | "Thick white smoke that doesn't clear after warm-up can point to coolant getting into the engine — that one shouldn't wait." | 20 words / 8.0s ≈ 2.5 wps |
| 4 — Black + soft CTA | 0:19–0:27 (8.0s) | "Black smoke usually means the engine's running rich, burning more fuel than it should — worth having someone check, not a guess." | 21 words / 8.0s ≈ 2.6 wps |
| 5 — SAVE freeze (silent) | 0:27–0:30 (3.0s) | *(no VO — held frame, text card only)* | — |

Total runtime: **30.0s**, inside the 15–60s window.

### Per-beat visual prompts (Higgsfield/Seedance-style; standing negative
prompt applies to every beat)

**Standing negative prompt (all beats):**
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Shot | Prompt |
|---|---|---|
| 1 | Close-up, static | "Close-up static shot of a car exhaust tailpipe at idle in a dim shop bay, faint haze in the air, shallow depth of field, realistic automotive documentary lighting, no visible smoke yet" |
| 2 | Close-up, slow motion | "Close-up slow-motion shot of thick blue-gray smoke puffing rhythmically from a car exhaust pipe against dark wet asphalt, cool overcast light, realistic vapor texture, shallow depth of field" |
| 3 | Close-up, static hold | "Close-up shot of thick white smoke billowing continuously from a car exhaust pipe in cold shop-bay air, dense opaque vapor, moody fluorescent garage lighting, realistic texture" |
| 4 | Close-up, handheld drift | "Close-up shot of black sooty smoke puffing from an exhaust pipe during hard acceleration on a city street, gritty high-contrast look, slight handheld drift, realistic exhaust soot texture" |
| 5 (freeze) | Wide, static | "Wide static shot of a tire and auto repair shop bay with the door open, organized tools and a lift in the background, warm inviting late-afternoon light, empty of people, held completely still for a 3-second freeze" |

`REEL_IMAGE_CONDITIONING` note: if the app's real HERO/SUPPORT continuity
pattern is used, beat 1's final frame (tailpipe, no smoke) should be passed as
the `--start-image` anchor for beats 2–4 so the same pipe/asphalt geometry
carries through all three smoke colors — this is the one continuity technique
already built into `higgsfieldStudio.ts`, not a new invention.

### Caption timing

See `captions.srt` in this directory (SRT, matches the VO table above exactly,
line-broken for on-screen legibility — muted-first per the app's 10-point
scoring dimension, captions carry full meaning with no audio).

### Editing / assembly instructions (manual — CapCut, Premiere, or ffmpeg)

1. **Layer order (bottom → top):** background clip (per-beat) → dark
   bottom-third gradient (for caption legibility) → burned-in caption text →
   (beat 5 only) CTA text card.
2. **Sequence:** beat 1 (3.0s) → hard cut → beat 2 (8.0s) → hard cut → beat 3
   (8.0s) → hard cut → beat 4 (8.0s) → hard cut → beat 5 freeze (3.0s, no cut
   transition — hold the last frame of the wide shop shot, do not use a fade).
   No crossfades between beats 1–4; a hard cut on each color change is part of
   the "which one is mine" hook.
3. **Audio:** VO track ducked to -3dB under a low royalty-free ambient/garage
   bed (see §6 — no track is cleared yet, this is a placeholder instruction,
   not a source). VO starts exactly at each beat's timestamp above; beat 5 has
   no VO.
4. **Captions:** burn in from `captions.srt`, bottom-third safe zone, high
   contrast (white text, black outline or semi-opaque bar), sized to remain
   legible at 9:16 mobile scale.
5. **CTA card (beat 5, 0:27–0:30):** text overlay, centered lower-third:
   "Worth checking, not guessing.\nStop by and we'll take a look.\nNick's Tire
   & Auto · 17625 Euclid Ave, Cleveland" — text only, no VO, per the standing
   negative prompt's "no on-screen text" applying to the *generated clip*, not
   this edit-layer overlay.
6. **Export:** 1080×1920 (9:16), 30fps, H.264, target ≤60s (this cut is 30s).
7. **Before calling this "finished":** run it through the same checks
   `reelAssembly.ts` enforces mechanically on a real render — container and
   video-stream duration within 0.75s of 30.0s, frame count ≥80% of 900
   (30fps × 30s), and visibly distinct frames across the smoke-color beats (a
   static/looping file would fail the app's own motion-proof gate and should
   fail a human's judgment the same way).

---

## 5 · Credit-risk and fallback routing (estimates, not a live metered read)

Per `generationLedger.ts` `COST_ESTIMATES_USD` (operator-tunable estimates,
labeled as such in the source, not a metered price):

| Route | Per-unit estimate | This pack (4 generated beats + 1 freeze reuse) |
|---|---|---|
| `template_stock_clip` (free local-ffmpeg lane — **prod's pinned route** per last-known `REEL_VIDEO_PROVIDER`) | $0.00 | **$0.00** |
| `seedance_clip` (paid Higgsfield route) | $0.25/clip (ASSUMPTION per source comment) | ~$1.00 for 4 generated beats (freeze reuses beat-1 geometry, no new generation) |
| `veo_second_720p` | $0.10/sec (Google-published, the one real metered figure in this ledger) | ~$3.00 for 30s if this route were used end-to-end |

Since prod is last-known-pinned to `template_stock` (free lane), the
no-generation-call decision this run has **zero** opportunity cost against
today's `maxGenerationCostPerDayUsd` cap — nothing was reserved or spent.
`getHiggsfieldAccountHealth()` balance: **UNKNOWN** (not called, see §1).
Today's `autonomy_policy_versions` limits: **UNKNOWN** (would require a live
DB read this mode does not perform).

---

## 6 · Audio / music rights — real gap, not filled in

No rights ledger for music exists in this repo (confirmed in
`nickstire-reel-operator` skill). This pack names no specific track. Status:
**BLOCKED** — any music bed must be sourced and its license (asset ID,
source, scope, territory, expiry, organic/ad clearance) recorded manually
before this pack can be called publish-ready; do not assume a royalty-free
library implies clearance without a record. Voiceover is separately gated by
`reelVoice.ts`'s own fail-closed contract (not exercised this run — no TTS
call was made).

---

## 7 · QA matrix

Nothing was rendered this run, so every gate is either `BLOCKED` (never run)
or `UNKNOWN` (no evidence read). None are silently marked `PASS`:

| Gate | Module | Status | Why |
|---|---|---|---|
| Brief-time quality score (min 70/75) | `calculateReelQualityScore()` | `BLOCKED` | Never called — that function runs inside `content.generateReelBrief`, not invoked this run. |
| Server re-score at enqueue | `enqueueReelJob` | `BLOCKED` | No job was enqueued. |
| Render-integrity gate (#800/#801: duration, frame count, motion-proof) | `reelAssembly.ts` | `BLOCKED` | No file was rendered to check. |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No rendered frames exist. |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No repair cycle occurred (nothing rendered to repair). |
| 7-way automation decision | `qualityAutomation.ts` | `BLOCKED` | No job state exists to decide on. |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate` | `BLOCKED` | Not called — correctly, since nothing is close to publish-ready. |
| Evidence entailment | `shared/claimEntailment.ts` | `UNKNOWN` | Claims use approved soft-language hedges (§3) precisely because entailment was never evaluated. |

---

## 8 · IG/FB copy + two ad-ready variants

**Primary caption (organic feed):**
> Your exhaust is telling you something 🚗💨 Blue, white, or black — the color of the smoke is a real clue. Worth checking, not guessing.
> #TireShop #AutoRepair #CarCareTips #ClevelandOhio #EuclidOhio #CarMaintenance #ExhaustSmoke #MechanicTips

**Variant A (hook-forward, curiosity CTA):**
> Hook: "Blue smoke, white smoke, black smoke — do you know which one means trouble?"
> Caption: Three exhaust smoke colors, three different stories. We break down what each one usually points to — and why guessing is the wrong move. Stop by Nick's Tire & Auto and we'll take a real look.
> CTA: "Save this before your next oil change."
> #ExhaustSmoke #CarProblems #TireShopCleveland #AutoRepairTips #KnowYourCar

**Variant B (myth-correction angle, ad-ready):**
> Hook: "White smoke on a cold morning isn't always bad — but if it doesn't clear, that's different."
> Caption: Not all exhaust smoke means the same thing. Here's the quick way to tell a normal cold start from a real warning sign — and what to do next.
> CTA: "Questions about your exhaust? Stop by 17625 Euclid Ave."
> #CarCareTips #ClevelandMechanic #NicksTireAndAuto #ExhaustProblems #AutoDiagnostics

**Platform / dimensions:** Instagram Reels + Facebook Reels, 1080×1920 (9:16),
30s, MP4/H.264, captions burned in (also attach `captions.srt` as a platform
caption file where supported).

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY` (nothing has been rendered or passed the render-
integrity/QA gates in §7) and not `BLOCKED` (the pack itself is complete and
internally consistent — every claim is hedged with approved soft-language,
every capability gap is named rather than assumed). No `jobId`, `igPostId`,
or permalink exists anywhere in this pack, and none is claimed. Rendering
this into a finished MP4 and pushing it through the app's own render-
integrity + QA gates (§4 step 7, §7) requires either the live app pipeline
(`/api/admin/reel-canary`) under an explicit live operator instruction, or a
human editor following §4's assembly instructions directly.

**Separately — the PR pile-up noted at the top of this file is the more
important finding from this run** and is worth the operator's attention
independent of this specific pack's content.
