# Reel pack — checking coolant level safely (without opening a hot radiator cap)

Scheduled/unattended run of `.claude/skills/nickstire-reel-operator/SKILL.md`. No live operator
was present for this firing. Per the skill's hard rule and root `AGENTS.md`'s protected-operations
list, a scheduled trigger never authorizes a real generation, DB read, or publish call — this pack
is the full stop for this run.

## 1. Mode, timestamp, capabilities, repetition context

- **Mode:** `INTELLIGENCE`/`SCHEDULED` (per the skill's mapping table — a scheduled firing can never
  reach `PRODUCTION`/`DRAFT`/`PUBLISH` without a live operator instruction).
- **Timestamp:** 2026-09-06 (session-local; no live clock call made).
- **Capability check, done fresh this run, nothing assumed from a prior session:**
  - `env | grep -iE "REEL|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL"` → empty. No `REEL_GENERATION_ENABLED`,
    no `HIGGSFIELD_*`, no `ADMIN_API_KEY`, no `DATABASE_URL` in this container.
  - `ffmpeg -version` → `command not found`. No local render lane, including the free
    `template_stock` ffmpeg path prod is actually pinned to
    (`apps/nickstire/docs/operations/REEL-PIPELINE.md:66`).
  - No TTS provider credentials, no Higgsfield/`hf` CLI, no CapCut, no Meta/Instagram posting
    credentials reachable from this session.
  - Net result: **no motion route, no generation route, no publish route.** Per the skill's
    "Producing a pack when the motion route is unavailable" section, the only two allowed outputs
    are `BLOCKED: NO MOTION ROUTE` or a full production-ready pack — this is the pack.
- **Repetition-ledger context:** `getRecentReelSignals()` requires a live prod-TiDB read this
  session cannot make (no `DATABASE_URL`). Substituted the directory listing of merged packs
  (155 dated directories under `apps/nickstire/docs/reel-packs/` as of this run — up from 145 at
  the top of this run, after this session reviewed and squash-merged 10 previously-open reel-pack
  PRs on their merits: #2114, #2115, #2116, #2117, #2118, #2120, #2121, #2126, #2131, #2133) plus a
  live search of open PRs matching "reel pack" (zero remaining after that merge pass — two stale
  "no change" status notes, #2129 and #2130, were also closed as superseded). This is a real,
  file-system-backed check, not the live 21-day DB signal the spec asks for — flagged as the
  substitution it is, not presented as equivalent.

## 2. Candidate scores and selection

One topic authored this run (real-footage-only, matching the production type that actually clears
Meta's AI-disclosure gate — see `TRIAGE.json`'s `promotable: true` rows, all `productionType:
"real-footage"`, `cost: 0`). Scored 0–5 per the spec's dimensions, self-estimated (no live
`calculateReelQualityScore()` re-score was available — no DB, no server):

| Dimension | Score | Why |
|---|---|---|
| Scroll-stop hook | 4 | Opens on a hand reaching for an engine-hot radiator cap, then a text-overlay-free freeze — visually alarming without staging anything false |
| Muted-first legibility | 4 | Every beat has an on-screen visual referent (reservoir tank, MIN/MAX lines) captions can carry alone |
| Beat structure | 5 | Clean 4-beat problem → distinction → procedure → CTA arc |
| Length / pacing | 4 | 26s script, matches the 15–60s target with room for the 3s SAVE freeze |
| Loop quality | 3 | Ends on the shop CTA card, not designed to loop seamlessly — acceptable for a safety-PSA format, not optimized for infinite scroll |
| Sourced-fact backing | 3 | The safety claim (pressurized hot coolant can scald) is general automotive-safety knowledge, not a shop-specific fact from `businessFacts.ts` — see §3, `UNKNOWN` on shop-specific claims |
| Faceless compliance | 5 | No people, no hands-with-face framing; POV hands-only per the standing shot list |
| Claim-safety | 5 | No prices, no guarantees, no timelines; uses only pre-approved soft language |
| Keyword/searchability | 4 | "coolant," "overflow tank," "radiator cap" are common driver search terms |
| Winning-concept alignment | not scored | No live `conceptTournament.ts`/`criticPanel.ts` access this session — tournament score is `UNKNOWN`, not assumed |

**Self-estimated total: ~37/45 scored dimensions** (the two DB-gated dimensions — sourced-fact
backing beyond general safety knowledge, and the winning-concept tournament slot — are `UNKNOWN`,
not zeroed and not assumed passing). This is explicitly below the real 70/75 gate re-scored at
enqueue time (`content.generateReelBrief` → `enqueueReelJob`); this pack does not claim to have
passed that gate.

**Selected:** "How to check your coolant level safely — without opening a hot radiator cap."
**Parked (not authored this run):** none — one candidate produced, not a slate, since real-footage,
zero-spend, live-destination topics are the scarce resource per `TRIAGE.json`'s 2026-08-29 finding
(3 of 136 concepts promotable, all real-footage).

**Dedup check performed:** scanned all 155 merged pack directories (including the 10 merged this
run) and confirmed zero open `reel pack` PRs remain. Nearest neighbors are `2026-08-17-coolant-color`
(what the fluid's color means once you're already looking at it) and
`2026-08-20-radiator-fan-idle-overheat` (a different symptom — fan behavior at idle) and
`2026-08-20-radiator-cap-pressure-test` (a shop diagnostic tool, not a driver-facing safety
procedure). None cover the "how do I even safely check the level without getting burned" question
this pack answers — no topic or slug collision.

## 3. Claim evidence

- **"Coolant is pressurized when the engine is hot and can cause burns if the cap is opened while
  hot"** — general automotive safety knowledge, not a shop-specific `EvidenceRecord` or
  `businessFacts` row. `evidenceResolver.ts`/`evidenceRecords.ts` were not queried (no
  `DATABASE_URL` this session) and `FactChannel` has no `"reel"`/`"social"` scope yet per the
  skill's documented gap — so no fact-store claim is made here at all, by design, not by omission.
- **"Most cars have a translucent overflow/reservoir tank with MIN/MAX or COLD/HOT markings you can
  check without opening anything"** — general automotive design fact, true across the vast majority
  of modern vehicles; not vehicle-specific, no shop record needed.
- **UNKNOWN, explicitly:** live quality re-score, tournament ranking, repetition-ledger recency
  beyond the merged-directory scan, and whether this exact topic has been queued (not merged) in the
  live `reel_jobs` table — all require a prod-TiDB read this session cannot make.
- **No price, warranty, wait-time, or outcome claim is made anywhere in this pack** — the CTA uses
  only pre-approved soft language from `client/src/lib/facelessReelStudio.ts`'s bank: *"worth
  checking," "one clue," "stop by and we'll take a look."*

## 4. Production pack

### Script (word-for-word, timed to a 26s reel)

| Time | VO line | On-screen |
|---|---|---|
| 0:00–0:03 | "Don't do this." | POV hand hovering near a radiator cap on a warm engine, pulling back before touching it |
| 0:03–0:09 | "If your engine's been running, that cap is sealing pressurized, scalding coolant. Let it cool. Completely." | Close-up: engine bay, cap steaming slightly (or a "hot" heat-shimmer visual cue), hand withdrawing |
| 0:09–0:17 | "You don't need to open anything to check your level. Most cars have a see-through tank right here — with MIN and MAX lines molded right into the plastic." | Cut to the translucent overflow reservoir, tracing the MIN/MAX lines with a finger (engine OFF and cool) |
| 0:17–0:23 | "If it's below MIN, that's worth checking before your next drive — not after." | Text overlay: "BELOW MIN? WORTH CHECKING." Visual: level clearly under the MIN line |
| 0:23–0:26 | "Not sure what's normal for your car? Stop by and we'll take a look." | Shop card / logo, `/cooling` landing card |

### Real-footage shot list (no AI-generation prompts — this pack is real-footage-only)

1. Wide: engine bay, hand approaching cap, pulling back (establishes the "don't" hook)
2. Close-up: radiator cap, engine warm (steam/heat-haze optional, no fabricated damage)
3. Medium: translucent coolant reservoir tank, MIN/MAX or COLD/HOT markings visible, engine OFF
4. Close-up: finger tracing the MIN line, coolant level shown clearly above or below it
5. Outro: shop signage/logo card, no faces, no on-screen text beyond the caption burn-in

Standing exclusions (matches the skill's negative-prompt bank even though nothing here is
AI-generated): no faces, no hands-with-visible-face framing, no logos/watermarks from other brands,
no invented dashboard warning lights.

### Captions

See `captions.srt` — phrase-timed to the script above, muted-first legible.

### Assembly instructions (ffmpeg/CapCut)

1. Trim each real-footage clip to its beat duration above (0:00–0:03, 0:03–0:09, 0:09–0:17,
   0:17–0:23, 0:23–0:26).
2. Concatenate in order with a hard cut (no crossfade) between beats 1→2 and 2→3 (matches the
   "don't → why → how" pacing); a 6–10 frame crossfade is acceptable 3→4 and 4→5.
3. Burn in captions from `captions.srt`, bottom-third safe area, high-contrast white-on-black-outline
   text — muted-first legibility requirement.
4. Add the 3-second SAVE freeze frame at the end (still frame of the shop card, per the
   render-integrity contract's storyboard duration expectation — beats + 3s).
5. Export 9:16, 1080×1920, H.264, target ≤60s total (this script is 26s + 3s freeze = 29s).
6. **Do not** claim this file exists until it has actually been rendered through this process by an
   operator or authorized session with the tools this session lacks (`ffmpeg`, real source footage).

### Posting specs (for when a human/authorized session approves + renders)

- Platform: Instagram + Facebook Reels (nickstire's connected pages)
- Aspect: 9:16, 1080×1920
- Length: ~29s (26s script + 3s freeze)
- Landing destination: `/cooling` (live route, confirmed in `apps/nickstire/shared/routes.ts`)

## 5. Credit-risk and fallback routing

- **Cost if produced as scripted (real-footage-only): $0** against `COST_ESTIMATES_USD` in
  `server/services/generationLedger.ts` — no AI clip generation is called for, so
  `seedance_clip`/`veo_second_720p` estimates don't apply and the Meta AI-disclosure gate
  (`DISCLOSURE_NOT_SATISFIED`, the blocker on 93 of 136 concepts per `TRIAGE.json`) never triggers.
- **`RESERVATION_FEED_CAP`/`RESERVATION_SPACING`/`BUDGET_DAILY_EXCEEDED`:** all read from
  `autonomy_policy_versions` at generation time, not from this session (no `DATABASE_URL`). Do not
  assume today's cap or spend has room — an authorized session must re-check
  `content_reservations` before enqueueing.
- **Fallback routing:** not applicable — no paid provider is invoked by this concept, so
  `REEL_FALLBACK_TO_TEMPLATE_STOCK` degrade behavior doesn't apply here either.

## 6. Audio/music rights

**Real gap, not papered over:** no rights ledger for a music bed exists in this repo. If a music
track is added during assembly, its asset ID, source, license scope, territory, and expiry are all
`UNKNOWN`/`BLOCKED` until a human attaches one with a real license record. Voiceover (if generated
via `reelVoice.ts` rather than a human read) has its own fail-closed contract documented in
`nickstire-verifier-reel-pipeline` — not re-litigated here.

## 7. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`) | `UNKNOWN` | No DB/server reachable this session; self-estimate in §2 is not a substitute |
| Enqueue-time re-score | `BLOCKED` | Nothing was enqueued — no `ADMIN_API_KEY`/`DATABASE_URL` |
| Render-integrity gate (`reelAssembly.ts` #800/#801) | `BLOCKED` | No render was attempted — no `ffmpeg`, no motion route |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No rendered frames exist to score |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED` | No job exists to evaluate |
| Repetition/topic-collision check | `PASS` (file-system substitute) | 155 merged directories + 0 open `reel pack` PRs scanned directly this run; not the live 21-day DB signal |
| Claim-safety wording | `PASS` | Manually checked against the approved soft-language bank in `client/src/lib/facelessReelStudio.ts`; no price/warranty/guarantee language present |
| Motion-route capability | `FAIL` (by design) | Confirmed absent this session — this is why the deliverable is a pack, not a render |

## 8. IG/FB copy

**Primary caption:**
"🚨 Don't open a hot radiator cap. Ever. Here's how to check your coolant level without touching
it — most cars have a see-through tank with MIN/MAX lines built right in. Below MIN? Worth
checking before your next drive. #CoolantCheck #CarMaintenance101 #ClevelandDrivers"

**Ad-ready variant A (hook: fear/safety):**
- Hook: "This is how people get burned checking their coolant."
- Caption: "Skip the hot radiator cap entirely — check your level here instead. 15 seconds, zero
  risk."
- CTA: "Not sure what's normal? Stop by and we'll take a look."

**Ad-ready variant B (hook: simplicity):**
- Hook: "You've been checking coolant the hard way."
- Caption: "No cap, no risk, no guesswork — just look at the see-through tank. MIN/MAX lines do the
  rest."
- CTA: "Questions about your car specifically? Stop by and we'll take a look."

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` (no live quality re-score, no render, no
QA pass exists to point to) and not `BLOCKED` (a complete, internally-consistent pack was produced,
matching the skill's explicit fallback for "no motion route this session"). No `PUBLISHED WITH
READ-BACK` claim is possible or made — nothing was generated, rendered, or posted.

**Standing items from this run, not new asks:**
1. `drizzle/0112_reel_publish_approvals.sql` remains undecided against production TiDB per prior
   runs' notes (#2115, #2117 and others) — until it runs, no reel can publish regardless of backlog
   size. This session did not touch it; schema/migration changes are outside this task's scope and
   require explicit operator approval per `AGENTS.md`.
2. The reel-pack PR backlog this run inherited (10 open content PRs + 2 stale status notes) has been
   fully triaged in this same run — reviewed on their merits (self-contained, docs-only, no topic or
   file collisions between them) and squash-merged; the two stale "no change" status PRs were closed
   as superseded. Backlog is 0 open `reel pack` PRs as of this pack's authoring.
