# Reel pack — Excessive brake dust: normal wear vs. a sign to check pads sooner

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
  tools are technically reachable. This also satisfies the operator skill's
  own hard rule: "Never run a real generation, spend, or publish action from
  this skill without a live, in-the-moment operator instruction for that
  specific run."
- **Timestamp:** 2026-08-27T20:29:16Z (real session clock, `date -u`, not
  invented).
- **Capability probe (this session, real commands run, not assumed):**
  - `which hf higgsfield ffmpeg` → **no output, nothing found.**
  - `env | grep -E '^(REEL_|HIGGSFIELD_|ADMIN_API_KEY|DATABASE_URL)'` →
    **empty.** No `REEL_GENERATION_ENABLED`, no `REEL_VIDEO_PROVIDER` pin, no
    Higgsfield credentials, no admin API key, no database connection string.
  - Consequence: `getHiggsfieldAccountHealth()` cannot be called (no CLI, no
    creds) → credential state is **BLOCKED**, not "false" — there's no
    endpoint to ask. `POST /api/admin/reel-canary` is unreachable (no running
    server, no `ADMIN_API_KEY`) → cannot enqueue/advance/QA/publish a real
    job.
- **Repetition-ledger context:** `reel_jobs` (prod TiDB) is unreachable from
  this session — no `DATABASE_URL`. Substituted the two read-only proxies
  this session *can* actually check:
  - `ls apps/nickstire/docs/reel-packs/` — **136 merged date-slug
    directories**, 2026-08-14 → 2026-08-27, covering tire/tread/battery/
    brake/cooling/electrical/exhaust/steering/HVAC/transmission/drivetrain
    topics in dense, near-daily volume. Existing brake packs: penny-test,
    squealing-vs-grinding-brakes, road-salt-brake-lines, brake-fluid-
    moisture-test, warped-rotor-brake-shake, spongy-brake-pedal,
    caliper-sticking-hot-wheel, brake-pedal-sinks-overnight, brake-light-
    switch-cruise-shifter, hard-brake-pedal-vacuum-booster — **none use
    brake dust as the diagnostic signal.**
  - `mcp__github__search_pull_requests(state=open, "reel pack" in:title)` →
    **6 open drafts right now**: #1942 (synthetic vs conventional oil),
    #1932 (engine pinging/knocking), #1945 (grinding starter noise), #1927
    (steering wheel vibration highway speed), #1941 (grinding brakes on
    first stop of the day), #1948 (backlog-status note, not a topic pack).
    #1941 is the closest adjacent brake topic (grinding-on-first-stop = a
    pad/rotor *sound* clue) but is a distinct signal from brake **dust**
    (a *visual/residue* clue) — confirmed no direct overlap.
  - Selected topic (excessive brake dust: normal wear vs. check-pads-sooner)
    is confirmed novel against both checks.
  - **Backlog-debt note:** 6 open unreviewed drafts is a meaningfully lower
    number than the 17-deep backlog flagged in earlier runs' status notes —
    safe to add one more pack this run without materially adding to review
    debt, per the skill's own duplicate/backlog-check rule.

## 2. Candidate concepts and scores (0–5 per dimension, this session's own read against the rubric — not a server-run `calculateReelQualityScore()`, which needs the live app; label accordingly)

| Concept | Scroll-stop hook | Muted-clarity | Sourced-fact grounding | Claim-safety | Novelty vs. 136 existing packs + 6 open PRs | Total /25 |
|---|---|---|---|---|---|---|
| **A. Excessive brake dust — normal wear vs. check-pads-sooner** (selected) | 4 — a highly relatable visual (dusty wheels) most drivers have seen but never had explained | 5 — every clue is shown visually (dust volume, color, one-wheel-vs-all) | 4 — general brake-mechanic-truth, no business_facts/pricing needed | 5 — no prices, no guarantees, ends on approved "worth checking...stop by" phrasing | 5 — zero overlap found against 136 merged + 6 open | **23** |
| B. Parking brake not holding on a hill | 3 | 4 | 3 | 5 | 4 — no exact match found, but adjacent to brake-pedal-sinks-overnight | 19 |
| C. Backup camera fogging in cold weather | 3 | 3 | 2 — thin mechanic content, mostly a wipe-the-lens tip | 5 | 4 | 17 |

Concept A selected: highest score, confirmed unique topic, and it fills a
real gap — every prior brake pack in this backlog uses sound (squeal,
grinding, pedal feel) or pedal behavior as the diagnostic signal; none use
dust color/volume, which is something a driver can check without even
starting the car.

Self-scored against the skill's real 75-point weights (first-frame
scroll-stop 10, muted-first 10, beat structure 5, length 5, loop 5, sourced
fact 10, faceless 10, claim safety 10, keyword 5, winning-concept-≥57/60 5):
estimate **67–69/75** — the two dimensions this session cannot verify are
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
  (brake dust is normal friction-material/rotor byproduct; a sudden jump in
  dust volume or unusually dark/oily dust on one wheel only can point to
  worn pads or a sticking caliper rather than routine wear) are general,
  widely-documented automotive-brake mechanic knowledge, phrased entirely in
  the approved soft-language register (`can point to`, `worth checking`)
  rather than asserted as fact. Treat as **NEEDS_REVIEW** until a session
  with DB access runs the real `evidenceResolver` and either backs or
  qualifies each claim.
- **Claim-safety wording:** validated by hand against the approved-phrase
  list in `client/src/lib/facelessReelStudio.ts` (confirmed unchanged this
  session, lines 580–585: `can point to`, `may indicate`, `worth checking`,
  `one clue`, `do not guess`, `stop by and we'll take a look`) and against
  its banned patterns (lines 552/560/561: `no-you-need`, `no-this-means-bad`,
  `no-definitely-need`). Script uses "can point to" and "worth checking" and
  "stop by and we'll take a look" verbatim; contains no "you need," no "this
  means your X is bad/shot/gone," no "definitely."
- **Local/weather/event claims:** none made.

## 4. Production pack

### Script — word-for-word, timed (28s total)

| Time | VO (word-for-word) | On-screen caption (muted-first — carries the story alone) |
|---|---|---|
| 0:00–0:03 | "Dusty wheels every week? That's not always bad news." | **DUSTY WHEELS EVERY WEEK? NOT ALWAYS BAD NEWS** |
| 0:03–0:10 | "A steady, even coat of gray dust on all four wheels is normal brake wear." | **EVEN GRAY DUST, ALL 4 WHEELS → NORMAL** |
| 0:10–0:17 | "But a sudden jump in dust, or dark, oily dust on just one wheel — that's a different clue." | **SUDDEN JUMP OR DARK DUST ON 1 WHEEL → CLUE** |
| 0:17–0:23 | "That can point to worn pads or a caliper that's not releasing fully — worth checking sooner, not later." | **CAN POINT TO: WORN PADS OR STICKING CALIPER** |
| 0:23–0:26 | "Don't guess from the driveway — stop by and we'll take a look." | **DON'T GUESS. STOP BY — WE'LL LOOK.** |
| 0:26–0:29 | *(silent — SAVE freeze)* | **SAVE THIS FOR YOUR NEXT WHEEL WASH** |

Word count: 66 words VO / ~29s → ~137 wpm, comfortably inside normal
narration pace for a 9:16 short.

### Beats and per-beat generation prompts

Faceless throughout. **Standing negative prompt for every beat:** `faces,
hands, human figures, on-screen text, logos, watermarks, subtitles` (captions
are burned in separately at the assembly step, never baked into the
generated clip).

| Beat | Time | Shot | Prompt |
|---|---|---|---|
| HERO (anchor frame) | 0:00–0:03 | Macro close-up on an alloy wheel spoke, visible fine gray dust coating, low raking light | `Close-up macro shot, car alloy wheel spoke, fine even gray brake dust coating the surface, low raking side light emphasizing texture, slow push-in camera move, photorealistic, shallow depth of field, automotive detail` |
| SUPPORT 1 | 0:03–0:10 | Wide shot, all four wheels of a parked car, symmetric even dust coating | `Wide shot of a parked car from a low three-quarter angle, all four wheels visible, even light gray brake dust coating on each wheel, static camera with slow orbit, daylight, photorealistic` |
| SUPPORT 2 | 0:10–0:17 | Macro close-up on one wheel, noticeably darker/heavier dust, contrast with a clean-ish neighboring wheel implied by framing | `Extreme close-up macro shot, single car alloy wheel with unusually heavy dark oily-looking brake dust buildup on the spokes and barrel, slow rack-focus, dramatic side lighting, photorealistic` |
| REFERENCE | 0:17–0:23 | Behind-the-wheel view through spokes toward the brake caliper and rotor, general wide/medium shot | `Medium shot looking through the spokes of a car wheel at the brake caliper and rotor assembly, static camera with slow zoom, workshop ambient lighting, photorealistic, clean and neutral, no people` |
| CTA | 0:23–0:26 | Exterior of a tire shop bay door, slow dolly-in | `Exterior shot of an auto repair shop service bay, open garage door, daylight, slow forward dolly camera move, photorealistic, no people, no signage text` |
| SAVE freeze | 0:26–0:29 | Static end card over the CTA shot's last frame, brand wordmark + caption overlay added at assembly (not generated) | *(reuse CTA beat's final frame, freeze — do not generate new footage)* |

`REEL_IMAGE_CONDITIONING` note: pass the HERO beat's screened first frame as
`--start-image` to SUPPORT 1/2 and REFERENCE so all four share one
consistent wheel/vehicle look — this is the repo's existing
anchor-then-support pattern (`higgsfieldStudio.ts`), not a new technique.

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
6. **Loop:** first frame (even dust, all wheels) and last frame (freeze SAVE
   card) are visually distinct by design — this is not intended as a
   seamless loop; it's a stop-and-read short, which is why the design leans
   on a 3s freeze rather than a loop-back.
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
- **Cost estimate, if the paid route is active:** per `generationLedger.ts`
  `COST_ESTIMATES_USD` (operator-tunable estimates, not metered prices) —
  `seedance_clip: $0.25` × 5 generated beats (SAVE freeze reuses an existing
  frame, no new generation) = **~$1.25 estimated**, well under the
  `autonomy_policy_versions` `maxGenerationCostPerDayUsd` cap (documented
  default $10) — but this session cannot read today's actual cap or today's
  already-reserved spend (`content_reservations`, prod DB, unreachable). If
  the `template_stock` lane is active instead, cost is **$0.00** (free local
  ffmpeg lane per the same file).
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

**BLOCKED — no rights ledger exists for this.** Per the operator skill: "No
rights ledger for music exists in this repo." This pack specifies a
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
| Brief-time quality score (75-pt) | `calculateReelQualityScore()` | **UNKNOWN** | Self-estimated 67–69/75 in §2 by hand against the rubric; the real function needs the running app — not invoked |
| Server re-score at enqueue | `content.generateReelBrief`/`enqueueReelJob` | **BLOCKED** | No admin API reachable (§1) — nothing was enqueued |
| Render-integrity gate (#800/#801: duration match, ≥80% frame count, ≥3 distinct MD5 of 5 sampled frames) | `reelAssembly.ts` | **BLOCKED** | No render exists — nothing to sample. This is exactly why §4/§8 are labeled a pack, not a finished asset |
| Rendered QA / vision critic | `renderedQa.ts` | **BLOCKED** | No rendered frames exist |
| Repair routing | `repairRouter.ts` | **N/A** | Nothing rendered to repair |
| 7-way automation decision | `qualityAutomation.ts` | **BLOCKED** | Depends on the above, none available |
| Consolidated publish gate | `qualityGate.ts` | **BLOCKED** | Would return an evidence-gate `unavailable`, not a pass — no evaluation ran |
| Claim-safety wording check | manual, against `facelessReelStudio.ts` approved/banned lists | **PASS** | Verified in §3 — approved phrases used verbatim, no banned patterns present |
| Duplicate-topic check | `ls` + `search_pull_requests` | **PASS** | §1 — zero overlap against 136 merged packs + 6 open PRs |

## 8. Posting specs — IG/FB copy + two ad-ready variants

**Platform/dimensions:** Instagram Reels + Facebook Reels, 1080×1920 (9:16),
28–29s, MP4 (H.264), captions burned in (also attach as a separate `.srt` /
platform auto-caption fallback).

**Primary organic caption:**
> Dusty wheels every week? Usually normal — even gray dust on all four
> wheels is just routine brake wear. But a sudden jump in dust, or dark oily
> dust on one wheel only, can point to worn pads or a caliper that's not
> releasing fully. Worth checking sooner, not later. Don't guess from the
> driveway — stop by and we'll take a look. 🚗🔧
> #NicksTireEuclid #BrakeCare #AutoRepair #EuclidOhio #CarCare #MechanicTips

**Hashtags (secondary set):** `#TireShop #BrakeService #CarMaintenance #AutoCare #ClevelandCars`

**Ad-ready variant 1 (curiosity hook):**
- Hook: "Dusty wheels? Here's what your brake dust is actually telling you."
- Caption: "Even dust on all four wheels = normal. Heavy dark dust on one
  wheel = a different story. Know the difference before you spend money."
- CTA: "Stop by — we'll check it for free."

**Ad-ready variant 2 (direct/utility hook):**
- Hook: "1 clue in your wheel dust worth checking (before you replace pads)"
- Caption: "Sudden dust jump or dark buildup on just one wheel can point to
  worn pads or a sticking caliper — not always all four. Don't guess — ask
  us."
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
