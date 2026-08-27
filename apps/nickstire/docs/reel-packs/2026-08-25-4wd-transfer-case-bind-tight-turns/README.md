# Reel pack: 4WD/AWD binds or chatters in tight turns on dry pavement

**Date:** 2026-08-25 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this GitHub-scoped session has no
connected TTS, Higgsfield, Meta-posting, or CapCut tool, and no admin/render credential is
reachable from here (checked, none found), so there is no path to call
`/api/admin/reel-canary` or any render/publish route. Per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the motion route is
unavailable," this is the full production-ready pack delivered instead of a silently-downgraded
asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions, assembly, and copy
below are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies the
repo's own hard rule: a scheduled firing is never live operator authorization to generate, spend,
or publish (`AGENTS.md` protected operations; skill hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| ChatGPT / LLM scripting tool | This session (Claude) wrote the script/prompts directly — no separate ChatGPT tool connected or needed |
| TTS tool connected to this session | Not connected |
| Higgsfield MCP / API connected to this session | Not connected |
| Meta posting tool connected to this session | Not connected |
| CapCut / editing tool connected to this session | Not connected |
| Shell/render (Bash) | Available, but no video assets or render pipeline wired into this GitHub-scoped session |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `DATABASE_URL` / `REEL_*` / `META_*` / TTS/ElevenLabs/OpenAI/Anthropic keys | **Absent** — `env \| grep -iE 'HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS'` returned zero matches this run |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (per `docs/operations/REEL-PIPELINE.md`, last doc-verified 2026-08-11) | Doc states prod pins `template_stock` (free local-ffmpeg lane), not Higgsfield/Seedance — **not re-verified live this session**, treat as the doc's word, not a fresh read |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session (no live path) |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path (repo's only `DATABASE_URL` is production TiDB; not queried). Substituted with a filesystem + PR check instead, below. |

**Duplication check performed** (per skill §"Where the pack goes"):
- `git ls-files apps/nickstire/docs/reel-packs/` — **103 merged files across ~97 distinct topic
  directories**, most recent same-day siblings `2026-08-25-o2-sensor-rough-idle-poor-mpg`,
  `2026-08-25-misfire-shudder-coil-vs-plug`, `2026-08-25-collapsing-radiator-hose`,
  `2026-08-25-alternator-bearing-whine-vs-belt-squeal`,
  `2026-08-25-ac-blend-door-actuator-hot-cold-split`. Closest adjacent topics already merged:
  `differential-whine-on-turns` (08-21, a constant turn-dependent **whine/moan** from the
  ring-and-pinion gearset), `cv-joint-click` (08-18, an acceleration-**and**-turn click from a worn
  joint), `awd-one-new-tire` (08-20, tread-depth mismatch across an AWD driveline), and
  `tie-rod-steering-wobble-test` (08-20, a **wobble/vibration** from a worn steering component).
  None of these is the same failure mode: **driveline bind/chatter** is a shudder-hop-and-release
  felt specifically in a **tight, low-speed turn on dry/high-traction pavement** in a part-time or
  limited-slip 4WD/AWD system, caused by wheel-speed mismatch the drivetrain can't absorb — a
  distinct mechanism from a gear whine, a CV click, tread wear, or a loose steering component. Also
  checked `grep -r "transfer case" apps/nickstire` — the term appears only in blog/SEO copy
  (`shared/guides.ts`, `shared/blog.ts`, `shared/seo-pages.ts`), never in an existing reel-pack
  directory.
- Open PR search (`search_pull_requests`, `repo:nourdean22/mainnicks-tire-autonew is:pr is:open`,
  cross-checked against `list_pull_requests(state=open)`) — **11 open PRs total**, of which **4**
  are in-flight reel packs: exhaust manifold leak / cold-start tick (#1835), AC compressor clutch
  not engaging / low-pressure cutoff switch (#1857), rear defroster partial-clear / grid-line break
  test (#1865), brake light switch / cruise control + shift-lock (#1867) — plus one backlog-status
  note (#1842, not a production pack). None of the 4 in-flight topics overlaps 4WD driveline bind.
  Open-PR reel-pack count (4) is at the "proceed" side of the skip threshold (5) this task's own
  prior scheduled runs established in `BACKLOG-STATUS-2026-08-20-0900.md` and
  `BACKLOG-STATUS-2026-08-21-0729.md` — see §8 for why this run produces a pack instead of a third
  status-only note.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the ~97 topics already merged/in-flight · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the approved-phrasing /
no-diagnosis-promise rules · **Evidence** = how groundable the core claim is · **Local** =
Cleveland/seasonal relevance (Ohio winters push AWD/4WD ownership high, so this is evergreen local
demand, not a one-season topic).

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **4WD/AWD bind or chatter in tight turns on dry pavement (selected)** | 5 | 4 | 5 | 3 | 4 | **21** |
| One headlight noticeably dimmer than the other (bulb vs. ground fault) | 4 | 3 | 4 | 3 | 2 | 16 |
| Manual clutch pedal drops to the floor (hydraulic release, not the clutch disc) | 4 — small % of the local fleet drives manual | 3 | 4 | 3 | 2 | 16 |

Selected: **4WD/AWD driveline bind in tight turns.** It is mechanically distinct from every
turn-related noise/vibration topic already in the library, it gives drivers a concrete, safe
self-test (a slow, full-lock turn on dry pavement in an empty lot — not a highway test), the
underlying claim is standard drivetrain-engineering knowledge (part-time/limited-slip 4WD and AWD
systems need a wheel-speed differential across all four corners in a tight turn; a transfer case or
center differential that can't absorb it binds instead), and it is not a shop-specific
pricing/warranty claim.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "A shudder, hop, or binding feeling in a tight, slow turn on dry pavement — most noticeable in a parking lot — points to the transfer case or center differential, not the tires" | `UNKNOWN` per this repo's evidence store — general drivetrain-engineering fact (a 4WD/AWD system without enough slip capacity binds when all four tires are forced to travel different arc lengths on high-traction pavement), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "Old or low transfer case fluid can make that binding worse, and driving through it repeatedly can wear the drivetrain faster" | `UNKNOWN`, same basis — standard mechanic knowledge, phrased with the approved soft-language pattern ("can point to" analog: "can make ... worse"), not asserted as a diagnosis. |
| Shop name / address / phone in the CTA card | Sourced: `SEED_FACTS` `legal.entity`, read directly from `apps/nickstire/server/services/businessFacts.ts` this session — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005". **Gap, not silently cleared:** `FactChannel` (same file) is `"sms" \| "voice" \| "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. Treat the CTA card's address/phone as needing a human eyeball-check against the current live fact before publish, not as auto-cleared. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection against `businessFacts.ts` categories — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "Your 4WD binding up in tight turns? That's not your tires."
**Total run time:** 31s of motion beats + 3s branded freeze = **34s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** reframe-then-caution (hook redirects a common misdiagnosis — drivers who feel this
often check tire pressure/alignment first — mid-reel earns the one safety beat, CTA is soft, not
alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "Your 4WD or AWD binding up in tight turns? That's probably not your tires." |
| 2 — Symptom | 0:03–0:08 (5s) | "A shudder, hop, or binding feeling in a slow, tight turn — usually noticed in a parking lot or driveway on dry pavement." |
| 3 — Explanation | 0:08–0:14 (6s) | "That points to your transfer case or center differential — the part that lets all four wheels travel different paths in a turn." |
| 4 — Consequence/proof | 0:14–0:20 (6s) | "Old or low transfer case fluid can make that binding worse, and pushing through it again and again wears the drivetrain faster." |
| 5 — Safe action | 0:20–0:26 (6s) | "One clue is not a diagnosis — worth having the transfer case fluid checked before a tight parking lot turn becomes a bigger repair." |
| 6 — Branded CTA | 0:26–0:31 (5s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:31–0:34 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "points to" (beat 3,
analogous to the approved "can point to"), "worth having...checked" and "one clue" (beat 5), "stop
by and we'll take a look" (beat 6, verbatim approved CTA). Avoids all banned patterns (`you need`,
`this means your X is bad/shot/gone`, "you definitely need", unqualified "free" other than "free
check", "guaranteed same-day") — confirmed by inspection, not by running the real validator (no
live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: light, camera motion, an unseen mechanism).

1. **Hook (0–3s).** *Prompt:* "Close-up on the underside of an SUV's transfer case housing between
   the front and rear driveshafts, sunlight catching a faint sheen on the metal casing, subtle
   engine-idle vibration visible in the frame; shallow depth of field, driveway pavement blurred in
   the background." *Opening frame:* the housing sharply lit and centered, strongest possible first
   frame, unbranded, wordless. *Action complete by:* 2.5s. *Physical action:* idle-vibration shimmer
   (motion-gate qualifying beat).
2. **Symptom (3–8s).** *Prompt:* "Bird's-eye drone-style shot of an SUV slowly tracing a tight,
   complete circle in an empty parking lot at full steering lock, all four tires' contact patches
   visibly scrubbing sideways against the dry pavement through the turn." *Continues conceptually
   from beat 1's vehicle.*
3. **Explanation cutaway (8–14s).** *Prompt:* "Object-only technical cutaway of an open transfer
   case gear-and-chain assembly, the front and rear output shafts visibly rotating at very slightly
   different speeds as if the vehicle were mid-turn; clean diagrammatic lighting, slow orbiting
   camera move; no text or labels rendered in-scene." *Physical action:* chain-drive + differential
   gear rotation animation.
4. **Consequence/proof (14–20s).** *Prompt:* "Close-up comparison: two shallow dishes side by side
   under even studio light — one holding clean amber gear oil, the other holding dark,
   metal-fleck-flecked gear oil — camera does a slow rack-focus between them, no hands present."
   *Physical action:* rack-focus move contrasting fresh vs. degraded fluid (visual proof beat).
5. **Safe action (20–26s).** *Prompt:* "A shop inspection light on a stand sweeps its beam across a
   transfer case housing's fill-plug bolt, the bolt's threads and a faint oil weep line clearly
   visible under the light — no hands present, the light beam itself is the only motion besides a
   slow rack-focus." *Physical action:* light-beam sweep + rack-focus (object moves on its own).
6. **Branded CTA (26–31s), freeze to 34s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, tire stack in foreground, late-afternoon light, logo signage visible and
   legible; camera holds steady for a clean end-card composite." *Then:* static hold from 31s–34s
   with logo + address/phone end-card composited in post (per §3 gap, human-verify the card text
   against the current live `legal.entity` fact before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3–6s each); no beat may be shorter
   than 1.5s or the render-integrity motion gate's per-beat visual-change cadence fails.
2. Order: beat 1 → 2 → 3 → 4 → 5 → 6, hard cuts or ≤0.3s crossfades between beats 1–5 (keep the
   cadence brisk — a visual change every 1.5–2.5s is the floor the real gate checks).
3. Freeze the last frame of beat 6 for exactly 3.0s (the SAVE freeze) — do **not** loop or repeat an
   earlier beat to pad length; the render-integrity gate treats a repeated-frame loop as a
   motion-floor violation, not a valid freeze.
4. Burn in captions per `captions.srt`, bottom-safe-zone, high-contrast caption style (white text,
   dark outline/box) — reel plays muted-first, captions are not optional.
5. Composite the logo + address/phone end-card onto the frozen final 3s only, not earlier — keep
   branding off the motion beats per the faceless/no-logo-in-scene generation rule.
6. Export: MP4, H.264, 1080×1920 (9:16), ≥30fps, target ≥80% of expected 30fps frame count over the
   34s runtime (render-integrity floor), audio track (voiceover) muxed in, container duration and
   video-stream duration both within 0.75s of 34.0s.
7. Voiceover: warm, plain, unhurried delivery — no TTS engine is connected this session, so this step
   is **manual** (`nickstire`'s live pipeline uses its own TTS route in `reelVoice.ts`, not run
   here). A human should record or generate the 6 narration lines above at the stated per-beat timing
   and mux them in during step 6.

### Audio / music rights

**Real gap, not filled in:** no music-rights ledger exists in this repo (per the skill's own audit).
This pack does not select a specific music bed. If a background bed is added, it must carry a
tracked license (asset ID, source, license scope, territory, expiry, organic-vs-ad clearance) before
publish — track that manually; nothing here asserts a track is cleared.

### Credit-risk and fallback routing (estimates, not a live read)

From `generationLedger.ts`'s `COST_ESTIMATES_USD` (operator-tunable, not metered pricing):

- If rendered on the current prod-pinned lane (`REEL_VIDEO_PROVIDER=template_stock`, free local
  ffmpeg): **$0.00** — `template_stock_clip: 0`.
- If rendered on the paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25` (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**, against a daily `maxGenerationCostPerDayUsd` cap
  reported elsewhere as $10 (not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free lane
  mid-render instead of terminal-failing — current default per docs is **off**.
- Guardrail order that a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP` (2
  posts/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Since the repetition ledger wasn't read live this session, an operator
  should re-check `getRecentReelSignals()` before enqueueing, in case another job posted today.

## 5. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — no live path to the scorer this session; script self-checked against the approved-phrasing/faceless rules by inspection only, not the real validator |
| Server re-score at enqueue | `UNKNOWN` | No enqueue attempted |
| Render-integrity gate (#800/#801: duration match, frame count, ≥3 distinct MD5s) | `BLOCKED` | No render attempted — nothing exists to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render attempted |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job exists to evaluate |
| Human approval / hash-checked approval integrity | `BLOCKED` | Nothing to approve yet — this pack is the input to that step, not past it |
| Evidence entailment (`shared/claimEntailment.ts`) on the two automotive claims | `UNKNOWN` | See §3 — general knowledge, not read against `evidenceRecords.ts` live |

No `PASS` is claimed anywhere in this matrix — a `jobId` or "the command exited 0" is explicitly not
evidence of a finished Reel in this repo's own runbooks, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> Your 4WD or AWD binding up when you turn tight? It's probably not your tires. 🔧
> That shudder or hop in a slow, tight turn on dry pavement usually points to the transfer case or
> center differential — not tread, not alignment. Old or low transfer case fluid can make it worse
> over time.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #4WD #AWD #AutoRepairTips #CarMaintenance

**Ad-ready variant A** (hook-forward, curiosity):
- Hook: "Everyone blames the tires for this. It's almost never the tires."
- Caption: "That bind or hop in a tight, slow turn is a driveline clue, not a tire clue. Here's the 30-second parking-lot way to tell."
- CTA: "Stop by and we'll take a look — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "4WD chatter in tight turns? Don't replace your tires yet."
- Caption: "That's a transfer case sound, not a tire sound. Catch it early and it's a fluid check, not a rebuild."
- CTA: "Free check, honest answer — stop by Nick's Tire & Auto on Euclid."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS/Higgsfield/Meta-posting/CapCut tool and no live credential
is reachable from this session, and per the skill's hard rule a scheduled/automated firing is never
live authorization to spend, render, or publish even if a route existed. The pack itself (script,
prompts, captions, assembly, copy) is **PRODUCTION-READY** and waiting on a human to run it through
the live Studio wizard (`admin → Growth → Instagram → Studio`), record/generate the voiceover, and
carry it through the real quality/render-integrity/approval gates end to end. Nothing was rendered.
Nothing was published. No spend occurred.

**Still requires manual work:**
1. Record or TTS-generate the 6 voiceover lines at the stated timings.
2. Run the brief through the real Studio wizard to get a live quality score and repetition-ledger
   check (this pack's checks were done by filesystem/PR search, not the live DB).
3. Generate the 6 motion clips (Higgsfield/Seedance or the prod-pinned `template_stock` lane) and
   assemble per §4's ffmpeg/CapCut instructions.
4. Select and clear a music bed if one is wanted (real rights gap — see §4).
5. Human-verify the end-card address/phone text against the current live `legal.entity` fact before
   publish.
6. Run it through the real render-integrity gate, rendered QA, and human-approval door before any
   publish action — publish only ever on an explicit, live, in-the-moment operator instruction.

## 8. Secondary finding — the approved-pack rotation queue, not just PR review, is the real bottleneck

Not a blocker for this pack, but worth surfacing because it's a sharper diagnosis than the prior two
`BACKLOG-STATUS-*.md` notes gave: `apps/nickstire/server/services/approvedReelPackRotation.ts`
(`APPROVED_REEL_PACK_SLUGS`, lines 6–39) is the **operator-curated** queue the daily autonomous cron
(`dailyReelPost.ts`) draws its topic from first. It lists exactly **32 slugs, all dated
2026-08-16 through 2026-08-19**. Every one of the ~65 topics merged since 2026-08-20 (through today,
plus the 4 currently open) is fully produced, sitting in this directory, and **not** in that array.

This is not a stall — `dailyReelPost.ts:236-274` confirms `approvedReelPackAt()` returns `null` once
the rotation index exceeds 32, and the cron then falls back to the live topic miner
(`contentTopicSignals`/`contentTopicMiner`), which is a designed, working fallback, not a broken
path. But it does mean the operator's own curation step — reviewing a produced pack and adding its
slug to this array — hasn't happened since 08-19, while pack *production* has continued at roughly
9-10/day for six more days. Extending `APPROVED_REEL_PACK_SLUGS` with already-merged, already
brand-voice-vetted topics is a small, reversible, docs/config-only change (not a customer-facing
side effect under `AGENTS.md`'s protected-operations list), but per that same array's own comment —
"**Operator**-approved human-review packs" — it is not this session's call to decide which of the 65
are approved; that judgment is the actual missing step, not something a scheduled firing should
assume for the operator. Flagging it here as the concrete, file-and-line version of what the last
two status notes described only as "review isn't keeping up."
