# Reel production pack — "Balance vs. alignment" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**BALANCE-VS-ALIGN** · source:
[`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #4
"Alignment vs balance"

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that
repetition-ledger/quality-score reads against the live database are
themselves a production read, not a free action. This session made none of
those calls. See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities — checked this run, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| `ADMIN_API_KEY` / any reel-canary route access | Absent | `env \| grep -iE "ADMIN_API_KEY\|HIGGSFIELD\|REEL_GENERATION_ENABLED\|OPENAI\|ANTHROPIC_API\|ELEVEN\|DATABASE_URL"` returned nothing this session — no admin, generation, TTS, or database credential is present |
| `getHiggsfieldAccountHealth()` (creds/balance) | Not callable | No `HIGGSFIELD` credential in this session's env; this is a Claude Code repo session, not the running app process |
| `ffmpeg` binary | Not present | `which ffmpeg` returned nothing — no local render toolchain in this session |
| CapCut / other GUI editor | Not present | Headless repo session, no desktop app access |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | No env access this session; gate lives on the cron pulse job |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS credential connected to this session |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule for a scheduled firing, and no `ADMIN_API_KEY` present regardless |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have |

**Conclusion for step 1 of the task prompt:** none of ChatGPT-equivalent
generation, TTS, Higgsfield, Meta posting, or shell render tooling are
connected in this session. Per the task's own step 3/5, this run produces a
**production-ready pack**, not a claimed finished MP4.

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, and no
`DATABASE_URL` is present in this session to do so even informally. Instead,
checked the two file-based records that actually exist:

- `ls apps/nickstire/docs/reel-packs/` — five merged packs: **penny test**
  (slate #1), **tire expiration date** (slate #6), **tread fingerprint**
  (off-slate wear-pattern concept), **battery / summer heat** (off-slate),
  **squealing vs. grinding brakes** (slate #2).
- `gh pr list --state open --search "reel pack in:title"` — two open,
  unmerged pack PRs not yet visible in the directory listing: **#1615
  check-engine-light** and **#1614 wheel-bearing-hum** (both off-slate,
  neither overlaps this topic).

Today's topic, slate item **#4 "alignment vs balance,"** is not among any of
these seven. This is a file-system + open-PR check, not a substitute for the
real ledger — an actual `reel_jobs` row (e.g. a rejected brief that never got
a pack written) would not show up here, so treat "not found" as directional,
not a guarantee of zero repetition.

**Queue note:** with seven packs now produced (five merged, two still open)
against a fixed 2-posts/day cadence, an operator triage backlog is likely
building. This pack adds an eighth candidate rather than clearing that
backlog — worth flagging, not hiding.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining items not already packed or parked as
seasonal (today is 2026-08-17):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 4 | Alignment vs balance | Strong — corrects a real, common confusion; slate's own hook tests well ("shaking at highway speed") | Yes | ✅ **Selected** |
| 5 | How far you can drive on a spare | Moderate — useful but lower urgency than a symptom the viewer may be feeling right now | Yes | Parked |
| 9 | Oil change intervals | Moderate — myth-correction hook, already parked once (squealing pack) | Yes | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency | Yes | Parked |

Alignment-vs-balance was selected because it is a diagnostic-confusion hook
(like the brakes pack) rather than a pure informational one, it maps cleanly
onto the account's own already-approved slate framing without inventing new
claims, and it lets the pack cite a genuine shop-sourced fact (§3) instead of
only general automotive knowledge — an improvement on the sourced-fact gap
every prior pack has flagged.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Alignments are a setting service... not a guarantee against future tire wear, pulling, vibration, or noise" (backs: vibration/shaking is not what alignment fixes) | `apps/nickstire/server/services/businessFacts.ts` `SEED_FACTS`, `factKey: "alignment.warranty"` — `source: INVOICE`, `approvedBy: "Nour"`, `verifiedDate: "2026-07-21"` (code-read, not a live DB read — the DB-override path in `getFact()` was not queried) | **Supported** — this is the shop's own invoice legal text, git-versioned and operator-approved, directly grounding the script's core distinction. Stronger footing than any prior pack's claim evidence, which relied on general mechanical knowledge only. |
| "Shaking in the wheel at speed usually points to a balance issue" / "pulling or one-edge wear usually points to alignment" | General automotive mechanical knowledge, also the pre-existing framing in `REEL-SLATE-2026-07-31.md` item #4 (written and implicitly approved 2026-07-31, before this run) | **UNKNOWN against this repo's formal evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read); no `EvidenceRecord` citation is attached. Phrasing uses "usually points to" (the approved-pattern shape — "can point to" / "may indicate" from `facelessReelStudio.ts:570-571` — not a verbatim match but the same hedge, avoiding the banned `no-you-need` / `no-definitely-need` / `no-this-means-bad` patterns at lines 542/550/551) rather than an absolute. |
| No price, warranty payout, or "we'll fix it free" claim is made anywhere in this script | `businessFacts.ts` reviewed in full (read-only, code file) | **N/A — deliberately avoided.** The script cites what the warranty text says alignment is *not* a guarantee of; it never promises a repair outcome or price, which sidesteps the `FactChannel` gap below. |

**Gap, stated plainly (recurring, not new):** `businessFacts.ts`'s
`FactChannel` type is `"sms" | "voice" | "web"` only — there is no `"reel"`
channel. This script leans on a SEED_FACTS record for grounding but does not
quote it verbatim to the viewer (only its underlying distinction), which
avoids needing that channel scoping — but any future reel wanting to quote
warranty or price text verbatim would be blocked by this gap.

---

## 4 · Full production pack

### Script — word-for-word, timed (29s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Shaking at highway speed? You might be fixing the wrong thing." |
| 2 · SETUP | 0:03–0:09 | "Balance and alignment get mixed up constantly. They are different repairs." |
| 3 · VALUE | 0:09–0:15 | "Shaking in the wheel at speed usually points to a balance issue." |
| 4 · VALUE | 0:15–0:22 | "Pulling to one side, or wear on just one edge, usually points to alignment." |
| 5 · CTA | 0:22–0:29 | "Not sure which? Send this to them — or bring it by. Nick's Tire and Auto, link in bio." |

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

- Beat 1: "steering wheel highway driving pov" / "dashboard steering wheel closeup"
- Beat 2: "wheel balancing machine tire shop" / "tire balancer spinning"
- Beat 3: "wheel weight closeup rim" / "tire balance weight macro"
- Beat 4: "wheel alignment rack laser" / "car alignment machine garage"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 29s budget.

### Captions

[`captions.srt`](./captions.srt) — 11 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path; both are manual,
neither was run this session)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/cool tones on beats 1–2 (road/mechanical mood), slight
   warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 29s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is a slow camera move, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 29s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc; check whether today's
  slots are already claimed by the daily autonomous cron or another pending
  pack before scheduling
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — the slate item's original "📌 Save this
  before your next appointment" annotation predates the slate's own 2026-07-31
  correction, which found `saved = 0.00` across all 8 posted reels and
  reset the account's objective to SEND/watch-time. This pack follows the
  corrected objective, not the item's original inline note.

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check — this file was read from the checkout, not queried live):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.90 (5 clips × ~5.8s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run (live
DB, and no `DATABASE_URL` present in this session regardless). Account
balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed, and no credential to probe it with.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
two other packs (#1614, #1615) already open and unmerged as of this run, the
feed cap for whichever day they land on may already be spoken for — an
operator should sequence these three packs' actual publish dates rather than
assume all three post the same day.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same
finding as every prior pack — 2026-08-15 tread-fingerprint, 2026-08-16
battery, 2026-08-16 brakes). This pack sidesteps it deliberately rather than
asserting a track is cleared: **no music bed is assigned.** The reel is
voiceover + captions + optional single royalty-free ambient/SFX layer
(garage room tone, one soft mechanical click), which also scores well on the
pipeline's muted-first requirement since the captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (63/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> Shaking at highway speed? You might be fixing the wrong thing.
>
> Balance and alignment get mixed up constantly — they're different repairs.
>
> Shaking in the wheel at speed usually points to balance. Pulling to one
> side, or wear on just one edge, usually points to alignment.
>
> Not sure which one you've got? Send this to them, or bring it by.
>
> #wheelalignment #cartips #clevelandohio #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your steering wheel is shaking — but is it the repair you think it
> is?"
> Caption: Shaking at speed is usually balance. Pulling or one-edge wear is
> usually alignment. Two different fixes, two different bills.
> CTA: Not sure which one? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Balance or alignment — do you actually know which one your car
> needs?"
> Caption: Shaking at highway speed points to balance. Pulling to one side
> or wearing on one edge points to alignment. Knowing which saves you from
> paying for both.
> CTA: Bring it by — we'll tell you straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (63/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, held back
mainly by **loop** (the CTA frame doesn't loop cleanly back into the hook
frame) and **sourced fact** (the shop's own `alignment.warranty` record
backs the "alignment ≠ vibration fix" distinction, but no formal
`EvidenceRecord` in `evidenceResolver.ts` covers the "shaking = balance"
claim itself, and that store wasn't queried live this run to check). Not
`PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`, nothing
was generated, rendered, or posted; this session additionally has no
`ADMIN_API_KEY`, Higgsfield credential, TTS credential, or `ffmpeg` binary
available, so no MP4 exists and none is claimed to exist. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a live-authorized
session with real render tooling) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"balance vs alignment"}`, let
the server re-score and re-render for real, and only then move toward
publish.
