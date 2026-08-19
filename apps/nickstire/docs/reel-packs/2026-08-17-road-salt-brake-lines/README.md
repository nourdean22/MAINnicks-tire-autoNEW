# Reel production pack — "Road salt is rusting your brake lines" (SALT)

**Mode:** INTELLIGENCE + PRODUCTION (scheduled, automated run — no live operator present)
**Generated:** 2026-08-17, by the `nickstire-reel-operator` skill
**Final status: `READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY`. Self-scored quality estimate is
below this repo's real 70/75 gate (`calculateReelQualityScore`, `client/src/lib/facelessReelStudio.ts`).
See §7. Nothing in this pack has been rendered, generated, or published — see §0 and §9.

---

## 0. Capability and duplication preflight (read this first)

**This session cannot call live generation/publish routes or read production data.** It is an
automated web session with no `ADMIN_API_KEY`/prod DB access wired in, so per this skill's hard rule
("never run a real generation, spend, or publish action without a live, in-the-moment operator
instruction") and root `AGENTS.md`'s protected-operations list, this run did not attempt any of:

| Check | Result |
|---|---|
| `getHiggsfieldAccountHealth()` (live creds/balance) | **UNKNOWN** — not called this session |
| `REEL_GENERATION_ENABLED`, `REEL_VIDEO_PROVIDER` (live Railway env) | **UNKNOWN live value** — per `docs/operations/REEL-PIPELINE.md` (verified 2026-08-11), prod is documented to pin `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane), not Higgsfield/Seedance. Treat that as the operating assumption, not a fresh read. |
| `getRecentReelSignals()` (live `reel_jobs` repetition ledger, prod TiDB) | **UNKNOWN** — not read; this is a production database read and this session has no live-operator instruction to make one |
| `POST /api/admin/reel-canary` (`start`/`advance`/`qa`) | **not called** — no render was attempted |
| `{action:"publish"}` / `instagramAdmin.publishPost` | **not called** — no publish was attempted or authorized |

**What this run substituted instead — directory + open-PR dedup check (non-optional per this skill):**

```
ls apps/nickstire/docs/reel-packs/
gh (via GitHub MCP) search_pull_requests: repo:nourdean22/mainnicks-tire-autonew is:pr
```

Results, both read live this session:

- **Merged packs (5):** `2026-08-14-penny-test`, `2026-08-14-tire-expiration`,
  `2026-08-15-tread-fingerprint`, `2026-08-16-battery-summer-heat`,
  `2026-08-16-squealing-vs-grinding-brakes`.
- **Open draft PRs for reel packs (23, ALL still `draft:true`/unmerged as of this run):** #1614
  wheel-bearing-hum, #1615 check-engine-light, #1616 balance-vs-alignment, #1617 spare-tire-mileage,
  #1618 coolant-color, #1619 cabin-vs-engine-air-filter, #1620 "noises that mean stop driving now",
  #1621 repair-authorization-questions (TRUSTCHECK), #1622 why-car-pulls, #1623 oil-change-intervals,
  #1624 summer-heat tire-pressure, #1625 strut bounce-test, #1626 exhaust-smoke-color, #1627
  tire-rotation, #1631 wiper-blade-check, #1633 pothole-damage, #1634 transmission-fluid-color-test,
  #1635 plug-vs-patch tire repair, #1636 tread-depth rain-vs-snow, #1637 serpentine-belt-squeal,
  #1638 road-trip pre-check (plus #1632, a non-pack feature PR, and #1629, a dependency-bump PR —
  excluded from the topic count).

**⚠️ Operational flag, not part of this pack's content — surfacing because a human should see it:**
28 distinct reel topics have now been generated in roughly the last 24 hours (2026-08-16 22:38 through
2026-08-17 21:33, close to one new draft PR per hour) and **zero of the last 23 have been merged or
closed**. This looks like a scheduled task firing on a cadence nobody is reviewing at, not a healthy
production cadence — this repo's own guardrail table caps *published* feed posts at 2/day with 3h
spacing. Recommend an operator either (a) triages/merges or closes the #1614–#1638 backlog, or (b)
reduces the firing frequency of whatever schedule is invoking this skill. This pack was still produced,
on a topic verified not to duplicate any of the 28, because the task explicitly asked for a production
pack and producing one is a safe, additive, non-publishing action — but adding a 29th unreviewed draft
does not by itself fix the backlog.

**Topic selected:** none of the 28 above touch road-salt corrosion of brake lines. This pack picks that
gap, tagged to the `SALT` keyword (`CAMPAIGN_KEYWORDS` in `facelessReelStudio.ts` — `BATTERY` was
already spent on the summer-heat pack, `SALT` was not yet used by any merged or open pack) and the
built-in `cleveland_survival` archetype ("Potholes, salt, freeze-thaw — surviving these specific
roads").

---

## 1. Candidate concepts considered (0–5 per dimension)

| Concept | Keyword fit | Novelty vs. 28 existing | Evidence safety | Hook strength | Selected? |
|---|---|---|---|---|---|
| **Road salt corroding steel brake lines** | 5 (`SALT`, unused) | 5 (no overlap) | 3 (general automotive-safety knowledge; no `EvidenceRecord` in this repo — see §3) | 4 (visceral, high-stakes, not fear-mongering if worded as "worth checking") | **Yes** |
| Ohio E-Check emissions test myths | 5 (`ECHECK`, unused) | 5 (no overlap) | 2 (needs exact program specifics — county coverage, frequency, fees — this session has no verified source for those; higher risk of a wrong factual claim) | 3 | No — parked, better as a future pack once county/frequency specifics are sourced |
| TPMS light staying on after a tire rotation | 4 (`TPMS`, unused) | 3 (adjacent to the merged summer-heat tire-pressure pack) | 4 | 3 | No — parked, real overlap risk with #1624 |
| Clunk-over-bumps (worn end links/strut mounts) | 3 (`CLUNK`, unused) | 2 (noise territory already covers 3 packs: wheel-bearing-hum, "noises that mean stop driving now", serpentine-belt-squeal) | 3 | 3 | No — parked, noise territory is saturated |

---

## 2. Script — word-for-word, timed to seconds

Total runtime: **31s** (28s of beats + 3s branded SAVE freeze, per the render-integrity contract in
`docs/operations/REEL-PIPELINE.md` §"Render-integrity gate"). 6 beats — within the 5–8 beat floor.

| Beat | Time | VO (word-for-word) | On-screen caption (verbatim, muted-first — carries full meaning alone) |
|---|---|---|---|
| 1. HOOK | 0:00–0:03 | "This is what road salt is doing to your brake lines right now." | THIS IS WHAT ROAD SALT IS DOING TO YOUR BRAKE LINES RIGHT NOW |
| 2. SYMPTOM | 0:03–0:07 | "Bare steel brake lines rust from the outside in — and you can't see it happen." | BARE STEEL BRAKE LINES RUST FROM THE OUTSIDE IN. YOU CAN'T SEE IT HAPPEN. |
| 3. EXPLANATION | 0:07–0:13 | "By the time a line rusts through, the fix isn't a warning light. It's a soft pedal, or no pedal at all." | BY THE TIME IT RUSTS THROUGH, THERE'S NO WARNING LIGHT — JUST A SOFT PEDAL, OR NONE |
| 4. CONSEQUENCE/PROOF | 0:13–0:18 | "That's not something that gives you advance notice. It fails, then you find out." | NO ADVANCE NOTICE. IT FAILS, THEN YOU FIND OUT. |
| 5. SAFE ACTION | 0:18–0:23 | "A yearly undercarriage rinse and a visual brake-line check can point to trouble early. Worth checking before winter, not after." | A YEARLY RINSE + VISUAL CHECK CAN CATCH IT EARLY. WORTH CHECKING BEFORE WINTER. |
| 6. BRANDED CTA | 0:23–0:28 | "Stop by and we'll take a look — no guessing, just a look underneath." | STOP BY AND WE'LL TAKE A LOOK |
| SAVE freeze | 0:28–0:31 | (silence, or a 2–3s music tail) | NICK'S TIRE & AUTO — [logo/brand card, composited in post] |

Claim-safety note: every line was checked against the approved phrasing bank in
`client/src/lib/facelessReelStudio.ts` (`APPROVED_SOFT_PHRASES` / brief-time validators). Uses "can
point to" and "worth checking" (approved), avoids "you need," "definitely," "guaranteed," any price,
and any "this means X is broken" framing (banned patterns `no-you-need`, `no-definitely-need`,
`no-this-means-bad`, `no-sameday-guarantee`, `no-free-claims`). No price or warranty claim is made —
none was needed for this topic, so the `businessFacts.ts` gap noted in §3 doesn't block this specific
script, only the general practice of citing shop facts in a Reel.

---

## 3. Claim evidence

- **Core factual claim** ("road salt corrodes exposed steel brake lines over time, and failure can be
  sudden rather than gradual-and-warned"): this is well-established automotive-safety knowledge
  (documented via NHTSA investigations into road-salt brake-line corrosion in high-salt-use states),
  but **no `EvidenceRecord` exists for it in this repo's `evidenceRecords.ts`**, so
  `evidenceResolver.ts` has nothing to resolve and `entailment` is `not_evaluated` — this repo's own
  rule treats that as needing a qualifier or a human, not a silent pass. The script already qualifies
  every claim ("can point to," "worth checking," never "will fail" or "your brakes are bad") to stay
  inside that rule, but a human should still confirm this claim before it ships, ideally by adding an
  `EvidenceRecord` so the next brief on this topic has one.
- **No `businessFacts.ts` row is cited.** Also worth flagging again since it recurs every pack: the
  live `FactChannel` type is `"sms" | "voice" | "web"` only — there is still no `"reel"`/`"social"`
  channel, so even if a price/warranty fact were relevant here, it would not be channel-scoped for
  video use. This pack avoids the issue by not needing a business fact, not by resolving it.
- **Local/weather/event claims:** none made. "Before winter" is a seasonal generality, not a
  time-sensitive claim tied to a specific date or event.

---

## 4. Asset list

Prod's documented default lane (`REEL_VIDEO_PROVIDER=template_stock`, verified 2026-08-11 per
`docs/operations/REEL-PIPELINE.md` — **not re-verified live this session**) renders on local ffmpeg
from stock/template footage, not AI generation. This pack gives both a stock-footage brief (matches
that default) and Higgsfield-style generation prompts (for the paid HERO/SUPPORT lane, if an operator
re-arms it) — pick whichever route is actually live before rendering.

### 4a. Stock footage search terms (template_stock / free lane)

| Beat | Search terms | Notes |
|---|---|---|
| 1 | "car driving through slush spray slow motion", "winter road salt spray wheel well" | Daytime, wet/slushy street, no visible driver, no faces |
| 2 | "rusted corroded steel brake line macro close up", "rust flaking metal automotive close up" | Macro/close-up, no hands in frame |
| 3 | "car rising on hydraulic lift undercarriage view", "auto shop lift raising vehicle" | Empty bay preferred, or a lift with no visible operator in frame |
| 4 | "brake fluid drip concrete floor slow motion", "hydraulic pressure gauge needle drop macro" | Either works; pick whichever the stock library actually has |
| 5 | "pressure washer rinsing car undercarriage wheel well", "spray rinse wheel well close up" | Physical-action beat |
| 6 | "car pulling out of auto shop bay exterior wide", "garage bay door open exterior daylight" | End on a wide, brand-card-friendly shot |

### 4b. Higgsfield/Seedance-style generation prompts (paid HERO/SUPPORT lane, if re-armed)

Standing negative prompt for every beat (per this skill's contract): `faces, hands, human figures,
on-screen text, logos, watermarks, subtitles`.

| Beat | Prompt |
|---|---|
| 1 | "Slow-motion close-up of a car's rear wheel well as it drives through slushy, salted winter street water, spray arcing up, daylight, photorealistic, cinematic, 9:16" |
| 2 | "Macro close-up of a corroded, rust-pitted steel automotive brake line along a wheel well, flecks of rust flaking off, shallow depth of field, photorealistic, 9:16" |
| 3 | "A car rising on an automotive shop hydraulic lift, camera tracking upward along the dark undercarriage revealing brake lines running along the frame rail, photorealistic, 9:16" |
| 4 | "Extreme close-up, a single drop of brake fluid falling and pooling on a concrete garage floor, slow motion, photorealistic, 9:16" |
| 5 | "A pressure-washer spray rinsing road grime and salt residue from a car's wheel well, close-up, water droplets, photorealistic, 9:16" |
| 6 | "Wide exterior shot of a car pulling out of an open auto-shop garage bay into daylight, photorealistic, cinematic, 9:16" |

`REEL_IMAGE_CONDITIONING` guidance: use beat 1's approved first frame as the `--start-image` anchor for
beats 2–4 (same wheel-well/undercarriage environment) to hold visual continuity; beats 5–6 can anchor
off beat 3's lift/bay environment instead.

### 4c. Music

**No cleared track is specified — this is a real gap, not an oversight.** This repo has no music-rights
ledger (asset ID / license scope / territory / expiry / organic-vs-ad clearance) for any bed. Use a
royalty-free instrumental in the "tense-then-resolved" register (rises through beats 1–4, resolves at
beat 5–6) from whatever licensed library the shop's Meta/Instagram account has actual clearance for —
**do not treat "royalty-free" as self-clearing**; an operator should confirm the specific track's
license before it ships. Status: **BLOCKED/UNKNOWN**, carried into §6.

### 4d. Voiceover

Route: `reelVoice.ts` (ElevenLabs, per `COST_ESTIMATES_USD.elevenlabs_vo`). Tone: calm, direct,
slightly urgent on beats 1 and 4, warm on beat 6. Not generated this session (no live TTS call made).

---

## 5. Caption timing (SRT)

See `captions.srt` in this directory — matches the VO table in §2 exactly, muted-first (captions carry
the full claim without audio), one caption per beat.

---

## 6. Editing / assembly instructions

Target: 1080×1920 (9:16), 30fps, H.264, matching the render-integrity gate in
`docs/operations/REEL-PIPELINE.md` (container AND video-stream duration within 0.75s of the beats+3s
contract, ≥80% of expected 30fps frame count, ≥3 distinct frame MD5s across 5 samples — i.e., it must
actually move, not freeze).

1. Trim each beat's source clip to its exact duration from §2 (beat 1: 3s, beat 2: 4s, beat 3: 6s, beat
   4: 5s, beat 5: 5s, beat 6: 5s = 28s), 1080×1920 crop/pad, 30fps.
2. Within beats 3 and 5 (the two longest, 5–6s), cut once at the midpoint to an alternate angle of the
   same setup — this is what earns the "visual change every 1.5–2.5s" motion-floor requirement across
   the full 28s, not just six macro-cuts.
3. Concatenate with short crossfades (`xfade`, ~0.2–0.3s) between beats — avoid a bare `zoompan`/stills
   filter on any single clip; this repo's own regression history (`reelAssembly.test.ts`) is two
   different frozen-frame publishing incidents caused by exactly that.
4. Append the 3s branded SAVE freeze: static end card, "NICK'S TIRE & AUTO" wordmark + the CTA line,
   using `tpad`-style freeze clones (non-advancing PTS) — note prod ffmpeg is 5.1 and has previously
   dropped `tpad` freeze clones that render fine locally on 8.x; verify the actual rendered output, not
   just that the command exited 0.
5. Burn in captions per `captions.srt`, bottom-third safe area, high-contrast (white text, dark
   outline/shadow) — legible muted and at thumbnail size.
6. Mix VO at approximately -3dB louder than the music bed; duck music under VO on beats 1–6, let it
   swell slightly under the SAVE freeze.
7. Export 1080×1920, 30fps, H.264, target ≤20 Mbps, AAC audio.
8. Before calling it finished, run the manual forensics recipe from `docs/operations/REEL-PIPELINE.md`
   ("is the video real?") — `ffprobe` the video-stream duration (not the container's, which can lie via
   the audio track) and MD5-sample 5 frames across the timeline to confirm motion. **A `jobId` or an
   exit-0 render command is not evidence of a finished Reel** — only that ffprobe/MD5 read-back is.

---

## 7. Quality-score self-check against the real gate

`calculateReelQualityScore` (`client/src/lib/facelessReelStudio.ts`), min 70/75, re-scored server-side
at enqueue. This session cannot execute that function or `conceptTournament.ts` — the estimate below is
a manual walkthrough of the same rubric, not a code-verified score. Treat it as directional.

| Dimension | Max | Self-estimate | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 9 | Salt spray hitting a wheel well in slow motion is a strong, motion-first open |
| Muted-first | 10 | 9 | Captions restate the full claim per beat, not a fragment of the VO |
| Beat structure | 5 | 5 | Full hook → symptom → explanation → consequence → safe action → branded CTA |
| Length | 5 | 5 | 31s total, inside the 20–35s window |
| Loop | 5 | 4 | SAVE freeze card is a hard stop rather than a seamless loop back to beat 1; an editor could add a 0.5s echo of the opening spray shot just before the freeze to improve this |
| Sourced fact | 10 | 3 | No `EvidenceRecord` backs the core claim (§3) — this is the real weak point, not a scripting fix |
| Faceless | 10 | 10 | No faces or hands in any beat, by design and by the standing negative prompt |
| Claim safety | 10 | 10 | Uses only approved soft phrasing, no price/guarantee/"you need" language |
| Keyword | 5 | 5 | `SALT` is in `CAMPAIGN_KEYWORDS` and unused elsewhere in the current backlog |
| Winning concept ≥57/60 | 5 | 0 | Requires actually running `conceptTournament.ts`'s scored panel, which this session did not execute — not fabricating a pass |
| **Total** | **75** | **~60** | **Below the 70/75 gate** |

**This is why the final status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY`.** The two real
gaps (no sourced `EvidenceRecord`, no executed concept-tournament score) need either a human decision
or an actual run through the real admin route — not something this pack can resolve by itself.

---

## 8. Credit-risk and fallback routing

Estimates from `COST_ESTIMATES_USD` (`server/services/generationLedger.ts`) — not a live metered price:

- **Free lane (`template_stock`, prod's documented default):** $0 marginal generation cost. Brief
  generation (`gemini_brief`, $0.01) and VO (`elevenlabs_vo`, $0.05) still apply if run through the
  real pipeline — total ≈ **$0.06**.
- **Paid lane (Seedance/Higgsfield, if re-armed):** 6 beats × `seedance_clip` ($0.25) = $1.50, +
  `gemini_brief` ($0.01) + `elevenlabs_vo` ($0.05) ≈ **$1.56**. `REEL_FALLBACK_TO_TEMPLATE_STOCK`
  degrades a paid beat to the free lane on a `PAUSE_PROVIDER` verdict rather than going dark.
- **Daily budget / reservation caps** (`autonomy_policy_versions`, `RESERVATION_FEED_CAP`,
  `RESERVATION_SPACING`, `REPEAT_TOPIC` 7-day, `BUDGET_DAILY_EXCEEDED`): **not read live this
  session** (a production DB read this session has no live-operator instruction to make). Per the
  skill's documented guardrail table, `RESERVATION_FEED_CAP` is 2 feed posts/day with 3h spacing — an
  operator approving this pack should check the day's actual reservation count before enqueueing, given
  §0's backlog of 23 unmerged drafts already competing for that cap.

---

## 9. Audio/music rights status

**Gap, not resolved by this pack** — see §4c. No music-rights ledger exists in this repo. Do not treat
any "royalty-free" library track as pre-cleared; confirm license scope, territory, and
organic-vs-paid-ad clearance before this reel is used in any paid placement.

---

## 10. QA matrix

| Gate | Module | Status | Basis |
|---|---|---|---|
| Rendered QA / vision critic | `renderedQa.ts` | **BLOCKED** | No render exists; nothing to critique |
| Repair routing | `repairRouter.ts` | **BLOCKED** | No job exists |
| 7-way automation decision | `qualityAutomation.ts` | **BLOCKED** | No job exists |
| Consolidated publish gate | `qualityGate.ts` (`evaluateReelPublishGate`) | **BLOCKED** | No job exists to evaluate; absence of a render is not evidence of a pass |
| Render-integrity gate (#800/#801) | `reelAssembly.ts` | **BLOCKED** | Nothing rendered — the ffprobe/MD5 checks in §6 step 8 are instructions for whoever renders this, not a result |
| Repetition ledger (`reel_jobs`, live) | `reelRepetitionHistory.ts` | **UNKNOWN** | Not read live (prod DB); directory + open-PR check in §0 substitutes as the practical dedup evidence for this run |
| Evidence gate | `evidenceResolver.ts` | **needs_review** | No `EvidenceRecord` for the core claim (§3) |

---

## 11. IG/FB copy + ad-ready variants

**Primary caption:**
> Cleveland winters mean road salt — and road salt means your brake lines are quietly rusting from the
> outside in. No warning light for this one. A yearly undercarriage rinse and a quick visual check can
> catch it early. Worth checking before winter, not after. Stop by and we'll take a look. #ClevelandDrivers #WinterCarCare #BrakeSafety #NicksTireAndAuto

**Variant A (hook/caption/CTA — direct):**
- Hook: "Your brake lines are rusting and you can't see it."
- Caption: "Road salt corrodes bare steel brake lines from the outside in, with no warning light before
  it fails. A yearly rinse + visual check catches it early."
- CTA: "Stop by and we'll take a look — no guessing, just a look underneath."

**Variant B (hook/caption/CTA — myth-buster framing):**
- Hook: "Most people think brake failure gives you a warning. This kind doesn't."
- Caption: "Bare steel brake lines exposed to years of road salt can rust through with no dashboard
  warning — the first sign is a soft or failing pedal. A yearly undercarriage check is worth it before
  winter hits."
- CTA: "Worth checking before winter, not after. Stop by anytime."

Platform: Instagram Reels + Facebook Reels (cross-post). Dimensions: 1080×1920 (9:16). Duration: 31s.
Hashtags: #ClevelandDrivers #WinterCarCare #BrakeSafety #RoadSaltDamage #NicksTireAndAuto
#CarMaintenanceTips.

---

## 12. Manual work still required (nothing here is finished)

- [ ] **Human review of the core claim** (§3) — either accept the general-knowledge framing as-is or add
  an `EvidenceRecord`.
- [ ] **Source or license a music track** (§4c) — real gap, not automatable from this session.
- [ ] **Render** — through the real `/api/admin/reel-canary` route (`start` → `advance`×N → `qa`), by an
  operator/session with live access, on whichever provider (`template_stock` or a re-armed paid lane)
  is actually configured. This session made no render call.
- [ ] **QA + approval** — `renderedQa.ts` critic, then human approval in the admin Queue tab
  (`instagramAdmin.approveDraft`) before any publish.
- [ ] **Publish** — only ever with an explicit, live, in-the-moment operator instruction naming this
  exact asset. Never from a scheduled/automated run, per this skill's hard rule.
- [ ] **Triage the #1614–#1638 backlog** (§0) — separate from this pack, but blocking real production
  throughput more than any single script ever could.

No file exists yet. This is the production-ready pack, per this skill's own fallback rule: return
`BLOCKED: NO MOTION ROUTE` or a full pack — never a silently weaker asset presented as finished.
