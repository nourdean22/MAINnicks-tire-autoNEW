# Reel pack — "Hit remote start and nothing happens — fob battery, fuse, or hood pin?"

Produced by a **scheduled task** firing (2026-09-04), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-04 (session clock).
- Capability check this session:
  `env | grep -ioE '^[A-Z_]+=' | grep -iE 'higgsfield|reel|admin_api|instagram|meta|database_url|openai|anthropic|elevenlabs|tts'`
  returned only `ANTHROPIC_BASE_URL` (empty value) — no Higgsfield credential, no `ADMIN_API_KEY`, no
  `DATABASE_URL`, no TTS provider key, no Meta/Instagram token. Also checked local binaries:
  `ffmpeg` — **missing**, `hf`/`higgsfield` CLI — **missing**. Result: **BLOCKED: NO MOTION ROUTE**
  this session -> full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it). No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this
  session's toolset either — confirmed by search, not assumed.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **136 merged pack directories**
    (`2026-08-14` through `2026-08-28`), spanning tires, brakes, cooling, electrical, drivetrain,
    HVAC, and emissions. Count matches PR #2076's own count exactly, confirming nothing new has
    merged since that run.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **9 open PRs** at time of this run: #2107 (heated seats), #2106 (fall car-care
    checklist), #2104 (backup camera), #2076 (a "no new pack, backlog status" note), #2046 (sticky
    gas pedal), #2045 (power seat), #2044 (seatbelt warning light), #2041 (car alarm false-trigger),
    #2037 (clutch pedal sinking).
  - **Backlog trend, read honestly, not glossed over:** PR #2076 (2026-09-02) explicitly flagged
    "~141 banked/pending topics," recommended a batch merge/close pass, and asked whether the
    trigger's cadence should be reduced or paused pending that review. Since then the open count has
    actually *fallen* to 9 — but three brand-new topic packs were opened in the ~28 hours before
    this run (#2104, #2106, #2107), meaning the trigger kept firing and kept producing after the
    flag, not pausing on it. This run follows that same continued-production pattern (see operator
    note in §9) rather than adding a second "no new pack" status note on top of #2076's, which
    already said everything a repeat status note would say.
  - Checked this pack's topic (remote start not responding — fob battery/fuse/hood-pin fault tree)
    against all 136 merged topics and all 9 open-PR titles — **no direct overlap found.** Nearest
    neighbor is `wont-start-battery-starter-alternator` (2026-08-19), but that pack is about the
    **ignition key failing to crank the engine at all** — a different failure mode from a
    **remote-start convenience feature** silently doing nothing while the vehicle itself is
    otherwise capable of starting normally by key/push-button. This script is framed explicitly
    around the remote-start feature, not general no-start diagnosis, to stay distinguishable.
  - Separately unresolved from #2076, and still unresolved here (no DB access this session either):
    whether migration `0112_reel_publish_approvals.sql` has been applied to production TiDB. Until
    it has, per #2076's own posture, no reel — this one included — can move past `PUBLISH` even if
    fully rendered. Treating the publish door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 3/5 | A silent remote-start attempt is a relatable, seasonally-timed annoyance (fall cold-start season approaching) but a quieter visual hook than a warning light or a swollen battery |
| Distinct symptom cluster | 5/5 | No existing pack covers the remote-start convenience feature; nearest neighbor (`wont-start-battery-starter-alternator`) is a different failure mode (key-crank no-start, not remote-start silence) |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 136+9 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/cutaway/exterior shots; no dealership-specific footage or moving-hand shots required |

Selected: **"Hit remote start and nothing happens — fob battery, fuse, or hood pin?"** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The fob-battery/fuse/hood-pin fault-tree claim below is **general automotive
  knowledge** (most factory and aftermarket remote-start systems require the hood fully latched and
  doors locked before arming, and will silently no-op rather than error if that precondition fails;
  separately, a dead key-fob battery or a blown remote-start-circuit fuse produces the same
  no-response symptom), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** —
  mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- One seasonal/timing claim is implied ("before the cold snap hits" in the CTA) — this is a generic
  seasonal reference, not a verified local-weather claim, and names no specific date, temperature, or
  event. Kept intentionally vague per the skill's "no verified live weather source is wired into this
  pipeline — label UNKNOWN and omit rather than assume" rule; the phrase reads as ordinary seasonal
  framing, not a factual weather assertion.
- **UNKNOWN, explicitly:** live entailment status of the fob-battery/fuse/hood-pin fault-tree claim;
  whether Nick's Tire & Auto specifically services remote-start/aftermarket-alarm diagnosis
  (near-certain for a general repair shop, but not confirmed against a live `business_facts` row
  this session); whether `0112_reel_publish_approvals.sql` has run against production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Hit remote start and... nothing happens?" |
| 0:04–0:09 | SYMPTOM | "No engine sound, no dash lights, no confirmation flash — nothing." |
| 0:09–0:15 | EXPLANATION | "One clue: it's usually a dead fob battery, a blown remote-start fuse, or the hood not latched all the way." |
| 0:15–0:21 | CONSEQUENCE / DIFFERENTIATOR | "Most systems won't even try unless the hood's fully closed and the doors are locked first." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which one it is. A quick check can point to the actual cause." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before the cold snap hits. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Exterior shot of a car in a driveway at dusk, engine off and dark, a key fob
   resting on a nearby ledge/railing in the foreground (no hand in frame), static camera, cool
   overcast light.
2. **0:04–0:09** — Interior-through-windshield shot of a dark, unlit dashboard and instrument
   cluster, static camera, no ambient glow, subtle exterior reflection only.
3. **0:09–0:15** — Macro/cutaway shot: a key fob with its rear cover removed, coin-cell battery
   compartment visible and empty/exposed, resting on a workbench, slow push-in, no hands or tools
   visible in frame.
4. **0:15–0:21** — Close-up on a vehicle hood latch/safety-pin mechanism, hood shown slightly ajar,
   dim garage lighting, static mounted camera.
5. **0:21–0:26** — Close-up on a vehicle fuse box panel, one fuse slot illuminated, dim garage
   lighting, static mounted camera.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
4 into two sub-shots each (angle change or push-in) to reach ~10–12 sub-clips at ~2.5–3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #RemoteStart #CarElectrical #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #CarProblems`
- Caption (feed): "🔑 Remote start doing nothing? One clue: it's usually a dead fob battery, a blown
  fuse, or the hood not fully latched. Don't guess which one. Stop by and we'll take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — curiosity angle**
- Hook: "Remote start not firing? It's not always the module."
- Caption: "No response from remote start — could be the fob battery, a fuse, or the hood latch.
  One quick check tells you which. Worth knowing before the cold hits."
- CTA: "Stop by and we'll take a look."

**Variant B — seasonal/cost-avoidance angle**
- Hook: "Don't replace your remote-start module before checking this."
- Caption: "A dead-looking remote start can just be a fob battery or a fuse — not the whole system.
  One clue narrows it fast, before the first cold morning."
- CTA: "Worth checking first. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10): **not
  read live this session** — treat as UNKNOWN, not assumed available.
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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by #2076; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | A silent remote-start attempt is a quieter hook than a warning light or a swollen battery |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> symptom -> explanation -> consequence -> safe action -> CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "remote start," "fob," "fuse," "hood" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Hit remote start and nothing happens — fob
battery, fuse, or hood pin?"}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** 9 open, unreviewed `reel pack` draft PRs exist at time of this run (down from 19
on 2026-08-28, but PR #2076 already flagged a much larger ~141-item backlog on 2026-09-02 and asked
whether this trigger's cadence should be reduced or paused pending a merge/close pass). In the ~28
hours since #2076, the trigger fired at least three more times and produced three more packs
(#2104, #2106, #2107) rather than pausing — this run is a fourth continuation of that same pattern,
not a deviation from it. Repeating the recommendation rather than escalating further, since #2076
already said it once and it evidently has not yet reached a decision: **review/merge or close the
open topic-pack PRs, and confirm the publish-approvals migration status, before this trigger fires
again** — a backlog of unreviewed packs, however well-formed each one is individually, does not
convert to a customer-facing Reel on its own.
