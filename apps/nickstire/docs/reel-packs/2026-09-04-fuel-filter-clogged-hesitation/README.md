# Reel pack — "Hesitation or stalling under load? It's not always the fuel pump."

Produced by a **scheduled task** firing (2026-09-04), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

**Operator note — overproduction risk, flagged not silently absorbed.** This is the **5th** reel
pack this session found produced today (2026-09-04): 4 already merged
(`backup-camera-black-screen`, `fall-car-care-checklist`, `heated-seats-not-working`,
`remote-start-not-working`) plus 2 more open as draft PRs (#2114 blind-spot-monitor-light, #2115
CV-axle-boot-grease-sling) at the time this pack was built. The feed-post cap
(`RESERVATION_FEED_CAP`) is **2/day**. A scheduled task firing this often is generating roughly
3x the inventory the pipeline can ever post same-day, which is exactly the collision risk this
skill's "Where the pack goes" section was written to prevent — flagging so the operator can retune
the schedule interval, not fixing it from an unattended run.

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-04 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC_API|META_|INSTAGRAM|FACEBOOK|ELEVENLABS|TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**
  (`command -v ffmpeg` exit 1), `gh` CLI — **missing** (GitHub access this session goes through
  the connected GitHub MCP tools instead). Result: **BLOCKED: NO MOTION ROUTE** this session →
  full pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md:66` (re-read live this session): prod pins
  `REEL_VIDEO_PROVIDER=template_stock` (verified 2026-08-11 per that doc's own note) — the free
  local-ffmpeg lane, not Higgsfield/Seedance/Veo. If this pack is fed to the real pipeline today,
  per-clip generation cost is expected to be **$0**.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the two offline checks the skill itself requires:
  - `ls apps/nickstire/docs/reel-packs/` — **149 merged pack directories** (`2026-08-14` through
    `2026-09-04`), covering tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust, interior
    controls and emissions. Fuel-system topics already merged: `fuel-gauge-sending-unit` (sender
    unit accuracy), `fuel-pump-whine` (pump noise/failure), `fuel-injector-tick-at-idle` (injector
    clicking), `fuel-smell-in-cabin` (leak/vapor odor). **None of them covers fuel-filter clogging
    or the hesitation/stalling-under-load symptom cluster.**
  - `search_pull_requests` (GitHub MCP, `is:pr is:open` in this repo) — **2 open reel-pack PRs**:
    #2114 "blind spot monitor light" and #2115 "CV axle boot grease-sling" — neither overlaps a
    fuel-delivery topic.
  - Checked this pack's topic (clogged fuel filter causing hesitation/stalling under
    acceleration/load, distinct from pump noise, injector tick, gauge accuracy, or cabin odor)
    against all 149 merged + 2 open topics — **no overlap found.**

## 2. Candidate scores and selected concept

Two candidates were scored; one selected, one parked — against the skill's rubric out of 5 per
dimension, self-estimated (no live critic panel — no DB/tournament access this session):

| Candidate | Scroll-stop hook | Distinct symptom cluster | Claim safety | Novelty vs. 149 merged + 2 open | Producibility (faceless) |
|---|---|---|---|---|---|
| **A — Clogged fuel filter: hesitation/stalling under load, not the pump** | 4/5 | 5/5 — starvation-under-demand is a distinct fault tree from the merged pump-whine (noise), injector-tick (idle click), gauge (sender), and cabin-smell (leak/vapor) packs | 5/5 | 5/5 — no overlap found | 4/5 — all beats plausible AI-gen/stock, no dealership-specific footage |
| B — Vacuum leak causing rough idle and high RPM hunting — parked | 4/5 | 3/5 — reads close to the merged `egr-valve-clogged-rough-idle` and `idle-air-control-valve-rough-idle-stall` packs; distinguishing hook (hissing sound, boost-adjacent) is thin without a live critic to confirm separation | 5/5 | 3/5 — meaningful overlap risk with two merged idle-fault packs | 4/5 |

Selected: **"Hesitation or stalling under load? It's not always the fuel pump."** Candidate B
parked — too close to two already-merged rough-idle packs to clear the novelty bar without a
sharper distinguishing hook than this session could verify offline.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a fuel
  filter traps debris/rust/varnish from the fuel line; as it clogs, flow restricts under high
  demand — acceleration, hills, highway merging — before it noticeably restricts at idle or light
  cruise; a fuel pump forced to push against a growing restriction over time runs hotter and can
  fail prematurely), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** —
  mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is asserted as current fact.
- **UNKNOWN, explicitly:** live entailment status of the filter-restriction/pump-strain claim;
  whether Nick's Tire & Auto's actual diagnostic process orders these same checks (near-certain
  for any general shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Hesitating or stalling under load? It's not always the fuel pump." |
| 0:04–0:09 | SYMPTOM | "Sluggish on hills, bogging when you merge, or stalling that only shows up under real load." |
| 0:09–0:16 | EXPLANATION / CUTAWAY | "A clogged fuel filter can point to fuel starving the engine exactly when it needs more — not at idle, only under demand." |
| 0:16–0:22 | CONSEQUENCE / PROOF | "Leave it long enough and the fuel pump straining against that clog can wear out early too." |
| 0:22–0:26 | SAFE ACTION | "Don't guess — a stall on the highway is the wrong place to find out." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it strands you. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can point to · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "The fuel pump straining against that clog can wear out early
too" alludes to a real mechanical-strain pattern without naming a specific outcome or timeline as
fact. Ran the approved-pattern-bank check by hand against `facelessReelStudio.ts`'s deny rules
(`no-you-need`, `no-this-means-bad`, `no-definitely-need`) — no matches in this script.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Road POV shot, static-mounted dash camera angle, car climbing a gentle grade,
   engine bay implied through subtle vibration/shake in frame, overcast daylight.
2. **0:04–0:09** — Split-style cut: close-up on a tachometer needle dipping/surging under an
   implied throttle input, then a wide highway-merge-lane shot from a static roadside angle.
3. **0:09–0:16** — Macro/cutaway shot: an inline fuel filter held near a workbench with visible
   sediment/discoloration inside a clear housing (part visible, no hand in frame), slow push-in;
   cut to a fuel line routed along an underbody, shop-bay lighting.
4. **0:16–0:22** — Close-up on a fuel pump module resting on a shop bench, dim bay lighting, static
   hold, subtle heat-haze shimmer to suggest thermal strain.
5. **0:22–0:26** — Empty highway shoulder at dusk, hazard-light glow implied via ambient orange
   cast, static wide shot, no vehicle or person in frame — mood shot only.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md:81`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2 and 3
into two sub-shots each (quick punch-in or angle change) to reach ~8–10 sub-clips at ~3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by
   the render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #FuelFilter #CarTips #AutoRepair #CheckEngineLight #ClevelandAuto #NicksTireAndAuto #CarCare`
- Caption (feed): "⛽ Bogging on hills or stalling when you merge? It's not always the fuel pump —
  a clogged filter shows up under load, not at idle. Don't wait for a stall to find out. Stop by
  and we'll take a look. 🔧"

Ad-ready variant A (hook/caption/CTA): Hook — "Your car hesitates only when you actually need
power?" Caption — "That's a load-demand clue, not a random glitch — could be a clogged fuel
filter starving the engine right when it needs more." CTA — "Stop by Nick's Tire & Auto — we'll
take a look."

Ad-ready variant B (hook/caption/CTA): Hook — "Stalling on the highway and assuming it's the fuel
pump?" Caption — "Check the filter first — a clogged one strains the pump and can take it down
with it. Don't guess before you're stranded." CTA — "Nick's Tire & Auto — worth checking, no
pressure."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts:28-37` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip
  = $0.25` (labeled ASSUMPTION in source), `template_stock_clip = $0`, `veo_second_720p = $0.10`
  (the one Google-published figure).
- Per `REEL-PIPELINE.md:66` (re-read live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~8–10 sub-clips on the free ffmpeg lane.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd`: **not read live this
  session** — treat as UNKNOWN, not assumed available.
- Fallback routing: `REEL_FALLBACK_TO_TEMPLATE_STOCK` behavior not exercised — no generation was
  attempted.

## 6. Audio/music rights status

**Real gap, not papered over:** no music-rights ledger exists in this repo (documented gap in the
`nickstire-reel-operator` skill). No music bed is assigned to this pack. Voiceover-only audio via
TTS (not produced this session — no TTS credential available in this session's environment) plus
captions is the safe default until a rights-tracked bed exists.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~49/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (149 merged) + open-PR title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Highway-hill POV is a plausible hook but less visually distinctive than an interior/dashboard cold-open |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline; hand-checked against deny patterns |
| Keyword (5) | 4 | "fuel filter," "fuel pump," "stalling," "hesitation" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Hesitation or stalling under load? It's not
always the fuel pump."}` to re-score, render, and move toward publish.

**Separately, and outside this pack's own scope:** with 6 packs produced today against a 2/day
feed cap, the operator may want to reduce this scheduled task's firing frequency — the backlog is
growing faster than the pipeline can post it, which raises stale-topic and duplicate-effort risk
over time even with per-run overlap checks in place.
