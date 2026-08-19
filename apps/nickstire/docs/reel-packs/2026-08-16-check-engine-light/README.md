# Reel production pack — "Solid vs. flashing check engine light" (2026-08-16)

Scheduled-task run · 2026-08-16 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CEL-FLASH**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #7

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

**Capabilities — checked where a check was safe and read-only, stated as
unavailable otherwise:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | This checkout's `apps/nickstire/.env` file does contain `DATABASE_URL` and `ADMIN_API_KEY` values, but per the skill's hard rule and `prod-db-guard`, their mere presence is not live operator authorization — they were deliberately not used to query prod this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| Claim-safety pattern banks (`FORBIDDEN_CLAIM_PATTERNS` etc.) | **Actually run**, standalone, against this pack's narration | Pure regex, no DB/network — see §4 and `brief.json.claimSafetyVerification`. This is real verification, not a self-estimate, for this one narrow check. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead, checked
two file-based records, per the operator skill's collision-avoidance rule (the
merged-packs directory alone missed three same-day duplicates on 2026-08-16):

1. `ls apps/nickstire/docs/reel-packs/` — five prior **merged** packs: penny
   test (slate #1), squealing vs. grinding brakes (slate #2), tire expiration
   date (slate #6), tread fingerprint (off-slate, wear-pattern diagnosis), and
   summer-heat battery warnings (touches slate #12's territory).
2. `gh`-equivalent PR search (`mcp__github__search_pull_requests`, `is:open
   reel pack in:title`) — **one open draft, PR #1614**, "wheel-bearing-hum reel
   production pack" (slate #8), opened 2026-08-16T22:38:27Z, same day as this
   run.

This run's topic, slate item **#7 "solid vs. flashing check engine light,"**
is not among any of those six. This is a file-system + PR-search check, not a
substitute for the real ledger — a rejected `reel_jobs` brief that never
produced a pack would not show up here, so treat "not found" as directional,
not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining topics not already merged, not on today's
open PR, and not seasonally premature (today is 2026-08-16 — mid-August, so
winter/cold items #3 and #11 were deprioritized):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 7 | Solid vs. flashing check engine light | Strong — a light every driver has seen and half-ignored, binary contrast maps cleanly to the 5-beat script | Yes | ✅ **Selected** |
| 19 | Noises that mean stop driving now | Moderate — strong urgency, but overlaps the sound-based hook already used by slate #2 (merged) and slate #8 (open PR #1614); risks feeling like a third variation on the same "sound = danger" hook this week | Yes | Parked |
| 9 | Oil change intervals | Moderate — myth-correction hook ("3,000-mile sticker"), lower urgency than a warning-light hook | Yes | Parked |
| 14 | Cabin filter vs. engine air filter | Weak — informational, no urgency, harder first-frame visual (two similar-looking filters) | Yes | Parked |

Check-engine-light was selected for a hook nobody dismisses (an actual
dashboard warning most drivers have seen and second-guessed), a clean binary
contrast (solid vs. flashing) that needs no invented structure, and zero
overlap with this week's two already-covered sound-based warning topics
(brakes, wheel bearing).

**Caption tension, flagged rather than resolved silently:** the slate's own
header states the corrected CTA objective is "a SEND, or none at all" (saves
measured `0.00` across the account's first 8 reels), but item #7's caption
text below the header still uses "📌 Save this" verbatim — the corrected
objective was written into the slate's intro but not back-applied to every
item's copy. This pack keeps the original, already brand-voice-linted "Save
this" wording rather than inventing an unreviewed SEND rewrite. An operator
should decide before this posts: keep as-is (consistent with the rest of the
un-edited slate) or swap to a SEND variant (not yet run through
`scripts/lint-brand-voice.ts`).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Solid means get it looked at soon" | General automotive convention (a steady MIL indicates a non-critical fault code) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. |
| "Flashing means stop driving. It usually points to a misfire that can destroy the catalytic converter" | Standard automotive mechanical knowledge (an active misfire dumps unburned fuel into the exhaust stream, which can overheat and damage the catalytic converter) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "usually points to" — an approved soft-diagnostic pattern (`SOFT_DIAGNOSTIC_ALLOWED`, `facelessReelStudio.ts:569`) rather than an absolute "this means" or "you definitely need," which is the correct hedge for an unverified-in-store claim, and is why it clears `OVERDIAGNOSIS_PATTERNS` in the check below. |
| "The difference is thousands of dollars" | Not a specific price — comparative framing, no quoted dollar figure | Verified clean against `PRICE_CLAIM_PATTERN` (`/\$\s?\d+/`) — no literal `$`-digit sequence, so it does not block on the "no prices in-reel" rule. See §4 and `brief.json.claimSafetyVerification` for the actual regex run. |
| No warranty, wait-time, guarantee, or stock claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this particular pack, but
it would block any future reel script wanting to quote a price or warranty
line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Solid and flashing mean completely different things." |
| 2 · SETUP | 0:03–0:07 | "Solid means get it looked at soon." |
| 3 · VALUE | 0:07–0:16 | "Flashing means stop driving. It usually points to a misfire that can destroy the catalytic converter —" |
| 4 · VALUE | 0:16–0:21 | "one of the most expensive parts on the car." |
| 5 · CTA | 0:21–0:27 | "Save this. The difference is thousands of dollars. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, claim-safety verification result): [`brief.json`](./brief.json).

**Claim-safety check — actually run, not just estimated.** The four real
pattern banks (`FORBIDDEN_CLAIM_PATTERNS`, `OVERDIAGNOSIS_PATTERNS`,
`FEARMONGER_PATTERNS`, `PRICE_CLAIM_PATTERN`) were copied verbatim from
`client/src/lib/facelessReelStudio.ts` into a standalone Node script (pure
regex, no imports, no DB, no network) and executed against the full narration
text above. **Result: zero findings across all four banks.** This is a real
execution of the shipped regex source against this exact script, not a
human read-through — see `brief.json.claimSafetyVerification` for the method
note and result. It is still not the same as invoking
`runSafetyChecks()`/`detectFabricatedStats()` on a live `ReelBrief` object
through the actual module, which was not done this run.

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):
- Beat 1: "car dashboard check engine light macro" / "instrument cluster warning light"
- Beat 2: "check engine light close up steady"
- Beat 3: "dashboard warning light flashing" / "check engine light blinking macro"
- Beat 4: "engine bay exhaust manifold" / "catalytic converter close up"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 12 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone —
burn in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slight desaturation + cooler cabin lighting on beats 1–2 (calm,
   "solid" state), shift warmer/more saturated red-amber on beat 3 ("flashing"
   urgency), neutral engine-bay tone on beat 4, warm inviting shift on beat 5
   (CTA).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move or a
   blink-state change, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc. Check whether today's
  two slots are already claimed by `dailyReelPost.ts` (if
  `REEL_AUTOPOST_ENABLED=true`) or by PR #1614's topic before scheduling this
  one.
- **Caption/hashtags:** see §8 below
- **CTA type:** see the "Caption tension" note in §2 — kept as SAVE (slate's
  original, brand-voice-linted wording) pending an operator call on whether to
  swap to SEND per the slate's stated corrected objective.

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.70 (5 clips × ~5.4s avg) |
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
cron, or by PR #1614's wheel-bearing-hum pack landing first, this pack should
wait for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same as
every prior pack in this directory). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.** The
reel is voiceover + captions + one optional royalty-free ambient/SFX layer
(cabin/engine-bay room tone, one subtle rapid-blink tick under beat 3), which
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
| Claim-safety pattern banks (forbidden/overdiagnosis/fearmonger/price) | `facelessReelStudio.ts` detectors | **PASS** | Actually executed (regex copied verbatim, run standalone) against the full narration — zero findings. See §4 and `brief.json.claimSafetyVerification`. |
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (60/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (verbatim from the slate, item #7):**

> Solid and flashing mean completely different things.
>
> Solid means get it looked at soon.
> Flashing means stop driving. It usually points to a misfire that can
> destroy the catalytic converter — one of the most expensive parts on the
> car.
>
> 📌 Save this. The difference is thousands of dollars.
>
> #checkenginelight #cartips #autorepair #clevelandohio

**Ad-ready variant A (hook-forward, shorter, SEND CTA):**

> Hook: "Is that check engine light steady or flashing? The answer changes
> everything you do next."
> Caption: Solid = get it scanned soon. Flashing = pull over. A flashing
> light usually means an active misfire, and that can take out your
> catalytic converter — one of the priciest parts under the hood.
> CTA: Light's on right now? Call (216) 862-0005 or stop by 17625 Euclid
> Ave — free look, no pressure.

**Ad-ready variant B (question-forward, SEND CTA):**

> Hook: "Do you actually know the difference between a solid and a
> flashing check engine light?"
> Caption: One means "get it looked at soon." The other means "stop
> driving now" — and can mean thousands in avoidable damage if you keep
> going.
> CTA: Not sure which one you've got? Bring it by — we'll tell you
> straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the misfire/catalytic-converter claim,
and that store wasn't queried live this run to check). The claim-safety
pattern banks were actually run and returned clean (§4, §7), which is a real
gate result, not a self-estimate — but that is one gate among several the
real `calculateReelQualityScore()`/`evaluateReelPublishGate()` still need to
clear for real. Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no
`igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session) can hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"solid vs flashing check engine light"}`, let the
server re-score and re-render for real, resolve the SAVE-vs-SEND CTA tension
noted in §2, and only then move toward publish.
