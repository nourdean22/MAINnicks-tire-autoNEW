# Reel pack — Musty AC smell: evaporator drain vs. cabin filter

Scheduled "faceless short-form video workflow" run, produced per
`.claude/skills/nickstire-reel-operator/SKILL.md`. **This is a production-ready
pack, not a rendered file.** No motion-render route was available in this
session (see §1) — per the skill's own rule, that means BLOCKED-with-pack, not
a silently weaker deliverable.

## 1. Mode, timestamp, connected capabilities

- **Mode: PRODUCTION** (single approved concept → production-ready pack).
  Never PUBLISH/SCHEDULED — this is an unattended scheduled firing with no
  live operator present, and root `AGENTS.md` requires explicit live
  authorization for any social-publish action regardless of what posting
  tools are technically reachable.
- **Timestamp:** 2026-08-20T13:29:50Z (session clock at pack creation).
- **Capability probe (this session, real commands run, not assumed):**
  - `which hf higgsfield ffmpeg` → **no output, nothing found.**
  - `env | grep -E '^(REEL_|HIGGSFIELD_|ADMIN_API_KEY|DATABASE_URL)'` →
    **empty.** No `REEL_GENERATION_ENABLED`, no `REEL_VIDEO_PROVIDER` pin, no
    Higgsfield credentials, no admin API key, no database connection string.
  - Consequence: `getHiggsfieldAccountHealth()` cannot be called (no CLI, no
    creds) → credential state is **BLOCKED**, not "false" — there's no
    endpoint to ask. `POST /api/admin/reel-canary` is unreachable (no running
    server, no `ADMIN_API_KEY`) → cannot enqueue/advance/QA/publish a real
    job. This matches every prior scheduled firing of this task — this
    session has never had a motion-render route, per the six prior status
    notes in this same directory (2026-08-18 through 2026-08-20).
- **Repetition-ledger context:** `reel_jobs` (prod TiDB) is unreachable from
  this session for the same reason — no `DATABASE_URL`. Substituted the two
  read-only proxies this session *can* actually check:
  - `ls apps/nickstire/docs/reel-packs/` — 55 merged date-slug directories,
    2026-08-14 → 2026-08-20, covering tire/tread/battery/brake/cooling/
    electrical/exhaust/steering topics. No existing pack on AC odor, cabin
    filter, or evaporator drain.
  - `mcp__github__list_pull_requests(state=open)` on this repo → **one** open
    PR right now: **#1738**, "reel pack: wheel wobble test (tie rod vs wheel
    bearing)," opened 2026-08-20T12:34Z, draft. Backlog that six prior runs
    flagged as 17-deep unreviewed drafts (blocking new packs per the skill's
    own duplicate-check rule) has since been cleared to 1 — safe to add a
    new pack this run without adding to review debt. No topic overlap with
    #1738.
  - Selected topic (musty AC smell / evaporator drain vs. cabin filter) is
    confirmed novel against both checks.

## 2. Candidate concepts and scores (0–5 per dimension, this session's own read against the rubric — not a server-run `calculateReelQualityScore()`, which needs the live app; label accordingly)

| Concept | Scroll-stop hook | Muted-clarity | Sourced-fact grounding | Claim-safety | Novelty vs. 55 existing packs + open PR | Total /25 |
|---|---|---|---|---|---|---|
| **A. Musty AC smell — evaporator drain vs. cabin filter** (selected) | 4 — a smell-based hook is unusual among the mostly noise/light packs already in the backlog | 5 — every clue is shown visually (mist, drip, dust in light beam) | 4 — general HVAC mechanic-truth, no business_facts/pricing needed | 5 — no prices, no guarantees, ends on "do not guess...stop by" | 5 — zero overlap found | **23** |
| B. Squeaky window regulator on roll-up | 3 | 4 | 3 | 5 | 3 — adjacent to serpentine-belt-squeal and door-adjacent noise packs already shipped | 18 |
| C. Dashboard "gas cap" light nuance | 3 | 3 | 3 — thinner, mostly restates check-engine-light pack | 5 | 2 — overlaps 2026-08-20-dashboard-light-colors and 2026-08-16-check-engine-light heavily | 16 |

Concept A selected: highest score, confirmed unique topic, and it fills a real
gap — every prior pack in this backlog is a noise/light/temperature clue;
none use smell as the diagnostic signal.

Self-scored against the skill's real 75-point weights (first-frame
scroll-stop 10, muted-first 10, beat structure 5, length 5, loop 5, sourced
fact 10, faceless 10, claim safety 10, keyword 5, winning-concept-≥57/60 5):
estimate **68–70/75** — the two dimensions this session cannot verify are
sourced-fact (no live `evidenceResolver.ts`/`businessFacts` read — see §3)
and the render-integrity motion floor (no render exists yet — see §7). Report
this as a self-estimate, not a passed gate.

## 3. Claim evidence

- **Dynamic/business facts:** none used. `businessFacts.ts` `FactChannel` is
  `"sms" | "voice" | "web"` only — there is no `"reel"` channel, so no
  `business_facts` row (pricing, warranty, policy) is channel-cleared for a
  Reel. This script deliberately carries **zero** prices, warranty terms, or
  policy claims for that reason, not just as house style.
- **Claim-level evidence (`evidenceResolver.ts` / `EvidenceRecord`):**
  **UNKNOWN** — this session has no `DATABASE_URL`, so no `EvidenceRecord`
  lookup or `entailment` verdict could be read. The script's mechanic claims
  (evaporator condensate drain, cabin air filter as separate musty-smell
  causes, both being distinct from and cheaper to check than the AC
  compressor) are general, widely-documented automotive-HVAC mechanic
  knowledge, phrased entirely in the approved soft-language register (`can
  point to`, `not necessarily`) rather than asserted as fact. Treat as
  **NEEDS_REVIEW** until a session with DB access runs the real
  `evidenceResolver` and either backs or qualifies each claim.
- **Claim-safety wording:** validated by hand against the approved-phrase
  list in `client/src/lib/facelessReelStudio.ts` (`can point to`, `may
  indicate`, `worth checking`, `one clue`, `do not guess`, `stop by and we'll
  take a look`) and against its banned patterns (`no-you-need`,
  `no-this-means-bad`, `no-definitely-need`). Script uses "can point to" and
  "do not guess ... stop by and we'll take a look" verbatim; contains no
  "you need," no "this means your X is bad/shot/gone," no "definitely."
- **Local/weather/event claims:** none made.

## 4. Production pack

### Script — word-for-word, timed (28s total)

| Time | VO (word-for-word) | On-screen caption (muted-first — carries the story alone) |
|---|---|---|
| 0:00–0:03 | "That musty AC smell? Not just an 'old car' thing." | **THAT AC SMELL ISN'T "JUST OLD CAR"** |
| 0:03–0:10 | "If it hits hardest right when you start the car — that's clue one." | **HITS HARDEST AT STARTUP → CLUE #1** |
| 0:10–0:17 | "No water dripping under the car after you park — that's clue two." | **NO DRIP UNDER THE CAR → CLUE #2** |
| 0:17–0:23 | "Together, those can point to a clogged evaporator drain or a dirty cabin filter — not necessarily the AC compressor." | **CAN POINT TO: DRAIN OR FILTER — NOT THE COMPRESSOR** |
| 0:23–0:26 | "Do not guess which one — stop by and we'll take a look." | **DO NOT GUESS. STOP BY — WE'LL LOOK.** |
| 0:26–0:29 | *(silent — SAVE freeze)* | **SAVE THIS FOR THE NEXT MUSTY-AC DAY** |

Word count: 62 words VO / ~29s → ~128 wpm, comfortably inside normal
narration pace for a 9:16 short.

### Beats and per-beat generation prompts

Faceless throughout. **Standing negative prompt for every beat:** `faces,
hands, human figures, on-screen text, logos, watermarks, subtitles` (captions
are burned in separately at the assembly step, never baked into the
generated clip).

| Beat | Time | Shot | Prompt |
|---|---|---|---|
| HERO (anchor frame) | 0:00–0:03 | Macro push-in on a car's dashboard AC vent, faint visible mist drifting out, cool blue-white cabin light | `Close-up macro shot, car dashboard air vent, faint white mist/condensation drifting out of the vent slats, slow push-in camera move, cool blue-white interior lighting, shallow depth of field, photorealistic, automotive interior detail` |
| SUPPORT 1 | 0:03–0:10 | Side-angle of vents blowing, dust motes visible in a shaft of light | `Side-angle shot inside a car cabin, air vents blowing, visible dust particles floating in a shaft of sunlight through the windshield, slow horizontal pan, photorealistic, shallow depth of field` |
| SUPPORT 2 | 0:10–0:17 | Low exterior angle under the front of a parked car, no drip, dry pavement close-up | `Low-angle close-up shot under the front bumper of a parked car, dry concrete pavement, static camera with subtle handheld micro-motion, overcast daylight, photorealistic` |
| REFERENCE | 0:17–0:23 | Engine bay / HVAC intake area, general wide shot, no hands or people | `Wide shot of a car engine bay from above, cowl and HVAC intake area visible, static camera with slow zoom, daylight, photorealistic, clean and neutral, no people` |
| CTA | 0:23–0:26 | Exterior of a tire shop bay door, slow dolly-in | `Exterior shot of an auto repair shop service bay, open garage door, daylight, slow forward dolly camera move, photorealistic, no people, no signage text` |
| SAVE freeze | 0:26–0:29 | Static end card over the CTA shot's last frame, brand wordmark + caption overlay added at assembly (not generated) | *(reuse CTA beat's final frame, freeze — do not generate new footage)* |

`REEL_IMAGE_CONDITIONING` note: pass the HERO beat's screened first frame as
`--start-image` to SUPPORT 1/2 and REFERENCE so all four share one consistent
cabin/vehicle look — this is the repo's existing anchor-then-support pattern
(`higgsfieldStudio.ts`), not a new technique.

### Captions — see `captions.srt` in this directory (SRT, matches the table above exactly)

### Editing / assembly instructions (CapCut or ffmpeg)

1. **Canvas:** 1080×1920 (9:16), 30fps, target total runtime 28–29s.
2. **Layer order (bottom → top):** background video clip for the active beat
   → subtle dark gradient at bottom third (for caption legibility) → burned
   caption text (top-loaded, per the SRT) → brand wordmark watermark
   (bottom-right, low-opacity) only on the SAVE freeze frame.
3. **Beat order/transitions:** HERO → SUPPORT 1 → SUPPORT 2 → REFERENCE → CTA,
   hard cuts only (no crossfades/wipes — hard cuts read as more "mechanic
   truth," matches existing packs in this backlog). Hold the CTA beat's last
   frame as a static 3s freeze to close (the render-integrity gate's
   "beats + 3s SAVE freeze" contract — do not generate new footage for this,
   freeze-extend the CTA clip).
4. **Audio:** voiceover track per the script above, ducked to make room for a
   short instrumental music bed under it (see §6 — no cleared track
   identified yet, do not attach one blind).
5. **Captions:** burn in per `captions.srt`, bold sans-serif, high-contrast
   white-on-dark-scrim, centered lower-third, each caption on screen for its
   full beat duration (this is a muted-first design — the caption alone must
   carry the story with sound off).
6. **Loop:** first frame (mist at the vent) and last frame (freeze SAVE card)
   are visually distinct by design — this is not intended as a seamless
   loop; it's a stop-and-read short, which is why the design leans on a
   3s freeze rather than a loop-back.
7. **ffmpeg assembly sketch** (once real clip files exist locally):
   ```bash
   ffmpeg -i hero.mp4 -i support1.mp4 -i support2.mp4 -i reference.mp4 -i cta.mp4 \
     -filter_complex "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[outv]" \
     -map "[outv]" -r 30 -s 1080x1920 assembled_silent.mp4
   # then burn captions.srt and mux the VO track separately before final export
   ```
   This is illustrative, not executed — no source clips exist in this
   session (§1).

## 5. Credit-risk and fallback routing

- **Provider pin:** `REEL_VIDEO_PROVIDER` env var is **unset in this
  session** (§1) — cannot confirm whether prod is currently pinned to
  `template_stock` (per `docs/operations/REEL-PIPELINE.md`, that's the
  documented current pin) or a paid Higgsfield/Seedance route. Do not assume;
  re-check the live env before generating.
- **Cost estimate, if the paid route is active:** per
  `generationLedger.ts` `COST_ESTIMATES_USD` (operator-tunable estimates, not
  metered prices) — `seedance_clip: $0.25` × 5 generated beats (SAVE freeze
  reuses an existing frame, no new generation) = **~$1.25 estimated**, well
  under the `autonomy_policy_versions` `maxGenerationCostPerDayUsd` cap
  (documented default $10) — but this session cannot read today's actual
  cap or today's already-reserved spend (`content_reservations`, prod DB,
  unreachable). If the `template_stock` lane is active instead, cost is
  **$0.00** (free local ffmpeg lane per the same file).
- **Fallback:** if a paid provider hits a terminal verdict mid-run,
  `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs degrade-to-free-lane behavior —
  unread in this session, state **UNKNOWN**.
- **Guardrail order this run would hit if actually enqueued (from
  `docs/runbooks/reel-pipeline.md`):** preflight (M10) → topic-repetition
  check (7-day) → reservation (`RESERVATION_FEED_CAP` currently 2/day,
  `RESERVATION_SPACING` 3h) → `REPEAT_CTA` (72h) → `BUDGET_DAILY_EXCEEDED`.
  None of these were actually run — no DB, no admin API (§1) — this is the
  documented order, not a result.

## 6. Audio / music rights status

**BLOCKED — no rights ledger exists for this.** Per the operator skill:
"No rights ledger for music exists in this repo." This pack specifies a
voiceover track (script above, to be generated via the repo's `reelVoice.ts`
route when that's reachable) but **no music bed track is selected or
attached**, because there is no mechanism in this repo to record its asset
ID, license scope, territory, expiry, or organic/ad clearance. Whoever
assembles this pack manually must source and clear a music bed
independently (e.g. Instagram/Meta's in-app licensed audio library at
publish time is the lowest-risk path for organic-only use since it doesn't
require an external license record) — do not attach an arbitrary track and
call it cleared.

## 7. QA matrix

| Gate | Module | Result | Backing evidence |
|---|---|---|---|
| Brief-time quality score (75-pt) | `calculateReelQualityScore()` | **UNKNOWN** | Self-estimated 68–70/75 in §2 by hand against the rubric; the real function needs the running app — not invoked |
| Server re-score at enqueue | `content.generateReelBrief`/`enqueueReelJob` | **BLOCKED** | No admin API reachable (§1) — nothing was enqueued |
| Render-integrity gate (#800/#801: duration match, ≥80% frame count, ≥3 distinct MD5 of 5 sampled frames) | `reelAssembly.ts` | **BLOCKED** | No render exists — nothing to sample. This is exactly why §4/§8 are labeled a pack, not a finished asset |
| Rendered QA / vision critic | `renderedQa.ts` | **BLOCKED** | No rendered frames exist |
| Repair routing | `repairRouter.ts` | **N/A** | Nothing rendered to repair |
| 7-way automation decision | `qualityAutomation.ts` | **BLOCKED** | Depends on the above, none available |
| Consolidated publish gate | `qualityGate.ts` | **BLOCKED** | Would return an evidence-gate `unavailable`, not a pass — no evaluation ran |
| Claim-safety wording check | manual, against `facelessReelStudio.ts` approved/banned lists | **PASS** | Verified in §3 — approved phrases used verbatim, no banned patterns present |
| Duplicate-topic check | `ls` + `list_pull_requests` | **PASS** | §1 — zero overlap against 55 merged packs + 1 open PR |

## 8. Posting specs — IG/FB copy + two ad-ready variants

**Platform/dimensions:** Instagram Reels + Facebook Reels, 1080×1920 (9:16),
28–29s, MP4 (H.264), captions burned in (also attach as a separate `.srt` /
platform auto-caption fallback).

**Primary organic caption:**
> That musty AC smell isn't always "just an old car." Two quick clues can
> point to a clogged evaporator drain or a dirty cabin filter — not
> necessarily the compressor. Don't guess which one. Stop by and we'll take
> a look. 🚗💨
> #NicksTireEuclid #CarAC #AutoRepair #EuclidOhio #CarCare #MechanicTips

**Hashtags (secondary set):** `#TireShop #ACRepair #CarSmell #AutoMaintenance #ClevelandCars`

**Ad-ready variant 1 (curiosity hook):**
- Hook: "Musty AC smell? It's probably not what you think."
- Caption: "Two clues tell you whether it's the drain, the filter, or
  something bigger — before you spend money guessing."
- CTA: "Stop by — we'll check it for free."

**Ad-ready variant 2 (direct/utility hook):**
- Hook: "2 clues for musty AC smell (before you replace anything)"
- Caption: "Startup timing + no drip under the car = point to drain or
  filter, not the compressor. Don't guess — ask us."
- CTA: "Come by the shop, we'll look it over."

**Manual-work labels (explicit, per the task's own instruction not to claim
a finished file exists):**
- [ ] Generate the 5 video beats via Higgsfield/Seedance (or confirm
      `template_stock` free lane) — **not done, no route in this session**
- [ ] Generate voiceover via `reelVoice.ts` (or a manual TTS pass) —
      **not done**
- [ ] Source and clear a music bed — **not done, no rights ledger exists (§6)**
- [ ] Assemble per §4 instructions in CapCut or ffmpeg — **not done**
- [ ] Run the real render-integrity + QA gates (§7) on the actual output —
      **not done**
- [ ] Post via Meta Business Suite / the repo's `instagramAdmin.publishPost`
      human-approval door — **explicitly out of scope for this run** (no
      live operator authorization; publishing is a protected operation)

## 9. Final status

**READY FOR HUMAN APPROVAL** (as a production pack). Not `PRODUCTION-READY`
in the stricter sense the skill defines (no render exists, §7 is entirely
BLOCKED pending a session with real Higgsfield/DB/admin-API access), and
absolutely not `PUBLISHED WITH READ-BACK` — no publish action was taken or
attempted, per the hard rule at the top of the operator skill and root
`AGENTS.md`'s protected-operations list.
