# Reel production pack — "Blue spark at night: a cracked plug wire/coil boot misfire clue" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **ARCSPARK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog note (shorter than prior packs — the situation has improved):**
before this run the repo carried **69 merged reel-pack topics** and **only
1 open, unmerged draft PR** (#1769, "stuck PCV valve burning oil," opened
2026-08-21T16:32Z). Today's `git log` shows four other 2026-08-21 packs
already merged (#1750, #1754, #1758, #1762) — review cadence has clearly
picked up since the five-pack pileup warning raised 2026-08-16 through
2026-08-21. No pileup-scale flag is warranted this run; see §9 for the
current, much smaller state.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL"` returned nothing in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query either. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/ | grep -v '\.md$' | wc -l          → 69 merged packs
    list_pull_requests state=open                                         → 1 open PR (#1769, stuck PCV valve)

69 merged topics span every major system: tires (tread, pressure, sidewall,
valve stem, rotation, plug-vs-patch, spare), brakes (squeal/grind, pads,
rotor warp, spongy pedal, caliper stick, fluid moisture), battery/electrical
(terminal corrosion, parasitic drain, dashboard lights, check-engine light,
gas-cap trigger), engine (overheating, idle shake, timing belt, burning
smell, PCV valve — open PR), cooling/AC (coolant color, AC not cold, AC
recharge myth, musty AC smell, heater not hot), steering/suspension (CV
joint, power steering whine, tie rod wobble, strut bounce, sway
bar/ball-joint clunk, wheel bearing hum, heat shield rattle), exhaust
(smoke color, tailpipe condensation, catalytic converter theft),
transmission fluid, differential whine, and general (penny test,
road-salt corrosion, pothole damage, wiper blades, E-Check readiness,
cloudy headlights, lug-nut retorque, oil dipstick color, oil change
intervals).

**A visible electrical arc at a spark plug wire / coil boot, seen at night,
is not among any of the above.** The closest neighbors are "idle shake
(spark plug vs. motor mount)" — an audio/feel symptom, not a visual arc —
and "check engine light" — a generic dashboard-indicator topic, not this
specific ignition-system visual. This pack's hook (a literal visible blue
spark in a dark engine bay) is a distinct macro visual not used by any
merged pack to date, and the open PCV-valve pack (#1769) covers a different
system (oil consumption, not ignition) with a different visual (no puddle
under the car, not a spark in the dark).

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Spark plug wire / coil boot arcing at night (blue spark misfire clue) | Strong — a literal visible spark in the dark is a rare, high-contrast, scroll-stopping visual with no direct prior use | Yes | No | ✅ **Selected** |
| Serpentine belt dry-rot cracking (visual inspection, distinct from the merged belt-squeal audio pack) | Moderate — good macro but thematically close to the merged "serpentine belt squeal" pack | Yes | Adjacent to an existing merged pack (same component, different symptom) | Parked |
| AC compressor clutch not engaging (visual cycling test) | Moderate — decent diagnostic value but close to two merged AC packs (AC not blowing cold, AC recharge myth) | Yes | Thematically adjacent to two merged packs | Parked |

"Spark plug wire arcing" was selected for the strongest, least-overlapping
visual hook of the three, and because a literal in-frame spark satisfies the
motion-first requirement (a moving/flickering light source, not a static
macro) more directly than either parked option.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A cracked spark plug wire or coil boot lets voltage jump to the block instead of the plug" | General automotive ignition-system diagnostic knowledge (standard "spark plug wire/coil arcing" failure mode, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "That's lost voltage the cylinder never gets, which shows up as a misfire, a rough idle, or a check-engine light" | Same — standard ignition-system diagnostic knowledge | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "shows up as" (hedged, not asserted as certain). |
| "A flicker near the plugs is the clue, not the problem itself" | Deliberately hedged inference, not a diagnosis | **UNKNOWN against this repo's evidence store**, same reasoning; explicitly frames the flicker as a symptom to check, not a certain fault. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap noted below. |

**Gap, stated plainly (same one noted in every prior pack, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

**Safety note specific to this topic:** the script does not instruct anyone
to touch, remove, or probe live ignition components — it only says to look.
No claim implies it is safe to handle a running engine's ignition system by
hand; that omission is deliberate, not an oversight.

---

## 4 · Full production pack

### Script — word-for-word, timed (26s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your engine bay is sparking blue in the dark and you didn't even know it." |
| 2 · SETUP | 0:04–0:09 | "A cracked spark plug wire or coil boot lets voltage jump to the block instead of the plug." |
| 3 · VALUE | 0:09–0:16 | "That's lost voltage the cylinder never gets, which shows up as a misfire, a rough idle, or a check-engine light." |
| 4 · VALUE | 0:16–0:21 | "Pop the hood at night and look for a flicker near the plugs — that flicker is the clue, not the problem itself." |
| 5 · CTA | 0:21–0:26 | "Nick's Tire and Auto checks plug wires and coils free with any diagnostic visit. Link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

- **Footage (per beat), Higgsfield-style generation prompts** — see
  `brief.json` `beats[].visualPrompt`, each paired with a
  `stockSearchTerms` fallback for a licensed stock-footage lane if
  generation isn't used. Standing negative prompt on every beat:
  `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.
- **Voiceover:** not generated this run (no TTS route connected in this
  session). Script source is the narration column above, fed verbatim to
  `reelVoice.ts` at real render time.
- **Music bed:** none assigned — see §6 (real gap, not an oversight).
- **Captions:** [`captions.srt`](./captions.srt), 10 cues, bottom-third
  safe-zone timing, all-caps short-line style matching prior packs on this
  account.

### Editing instructions

1. **Layer order (bottom to top):** background footage → subtle color grade
   (crushed blacks for the night beats) → caption burn-in (bottom-third) →
   CTA end-card text on beat 5 only.
2. **Transitions:** hard cuts between beats 1→2→3→4 (dark-frame-to-dark-frame
   reads cleanly on a hard cut); a cross-fade (8–10 frames, slightly longer
   than usual to sell the dark-to-daylight shift) into beat 5's wide shop
   shot to signal the tonal shift from diagnostic to CTA.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale — increase contrast/stroke
   weight on the dark beats (1–4) since the background is mostly black.
4. **Color:** near-black, high-contrast grade on beats 1–4 (night engine
   bay, spark as the only bright element), warm shift on beat 5 (CTA,
   inviting daylight shop).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 26s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime — the spark
   flicker itself supplies strong frame-to-frame motion on beats 1 and 3,
   which helps clear the ≥3-distinct-MD5s-of-5-sampled-frames check; beats
   2 and 4 still need their own camera move (static-with-flicker is not
   enough on its own if the flicker doesn't land in a sampled frame).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 26s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone who just heard a
  weird engine sound at night"), matching the account's corrected objective
  (a SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels, per an earlier pack's finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.60 (5 clips × ~5.2s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). Operator-tunable
estimate, not a metered price — directional only.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, not reachable this run (no
`DATABASE_URL`, no live server). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN`.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily
autonomous cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`) or by
the four other 2026-08-21 packs merged today, this pack should wait for the
next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional electrical-crackle
SFX under the arc beats, which also scores well on the pipeline's
muted-first requirement since captions alone carry full meaning. If the
operator wants a music bed, that requires a specific track with asset ID,
source, license scope, territory, and expiry tracked by hand — this pack
does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (50/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your engine bay is sparking blue in the dark and you didn't even know it.
>
> A cracked spark plug wire or coil boot lets voltage jump to the block
> instead of the plug. That's lost voltage the cylinder never gets — it
> can show up as a misfire, a rough idle, or a check-engine light.
>
> Pop the hood at night and look for a flicker near the plugs. That flicker
> is the clue, not the problem itself.
>
> We check plug wires and coils free with any diagnostic visit. Send this
> to someone who just heard a weird engine sound at night.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Ever popped the hood at night and seen a blue spark?"
> Caption: A cracked spark plug wire or coil boot lets voltage arc instead
> of firing the plug — lost voltage shows up as a misfire or rough idle.
> CTA: Not sure what you're looking at? Call (216) 862-0005 or stop by
> 17625 Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Why does your check-engine light come on for no reason?"
> Caption: Sometimes it's a cracked plug wire or coil boot arcing instead
> of firing the plug — a flicker in the dark is the clue, and it's free to
> check.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a daylight shop bay,
doesn't feed back into the HOOK frame, a dark engine bay with a spark — no
loop plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the arcing/misfire claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"cracked spark plug wire or coil boot arcing at
night: the blue spark misfire clue"}`, let the server re-score and
re-render for real, and only then move toward publish.

**Backlog state this run, for contrast with the five-consecutive-pack
warning raised 2026-08-16 through 2026-08-21:** 69 merged packs, **1** open
unmerged draft PR (#1769), and four other 2026-08-21 packs already merged
today. This is a materially healthier state than the 61-topics/8-open-drafts
snapshot the prior pack reported — review cadence has caught up. No
pileup-scale recommendation is warranted this run. The one open PR (#1769,
stuck PCV valve) is a single normal review-queue item, not a backlog.
