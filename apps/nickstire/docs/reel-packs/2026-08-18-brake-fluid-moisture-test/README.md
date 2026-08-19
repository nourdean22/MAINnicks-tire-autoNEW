# Reel production pack — "Brake fluid moisture test" (2026-08-18)

Scheduled-task run · 2026-08-18 · mode `INTELLIGENCE/SCHEDULED` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **FLUIDCHECK**
· source: no tracked slate file — topic selected fresh this run (see §2)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present. The operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls.

---

## 0 · Backlog flag — read this first

Before writing this pack, `gh`-equivalent search for open reel-pack PRs turned
up **26 open draft PRs**, spanning 2026-08-16 22:38 through 2026-08-18 03:32 —
roughly one every hour, none merged, none closed. Every prior scheduled firing
of this exact prompt produced a new draft PR and none appear to have been
reviewed. This pack is technically correct and non-duplicative (topic list
checked below), but **adding a 27th unmerged draft does not fix the underlying
problem**: either nobody is triaging this queue, or the schedule that fires
this prompt is running far more often than any human can review its output.
Flagging this to the operator directly rather than burying it in a normal
run — see the final note after §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `INTELLIGENCE/SCHEDULED` — research, score, and produce a full
written pack. No `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
was made, and no live read against the production TiDB database was made.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane), last verified in-repo 2026-08-11/16 packs. Treat as last-known, not live-confirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate lives on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, and this run
made no production reads. Instead, checked both required file-based proxies
per the operator skill:

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs: penny test, tire
  expiration date, tread fingerprint, battery summer heat, squealing vs.
  grinding brakes.
- Open-PR search (`reel pack in:title`, open, this repo) — **26 open drafts**
  covering: coolant color, spare-tire mileage, balance vs. alignment,
  check-engine light, wheel-bearing hum, repair-authorization questions,
  cabin-vs-engine air filter, "noises that mean stop driving now," tire
  rotation, exhaust-smoke color, strut bounce-test, summer-heat tire
  pressure, oil-change intervals, why-car-pulls, pothole damage,
  transmission-fluid color test, plug-vs-patch tire repair, tread-depth
  rain-vs-snow, serpentine-belt squeal, road-trip pre-check, road-salt
  brake-line corrosion, tire sidewall bulge, CV-joint clicking, cold-weather
  tire light, all-season-vs-winter tires.

That's **31 topics already produced** across merged + open-draft state. This
run's topic — brake fluid moisture / the 2-year test-strip check — is
distinct from all of them, including the fluid-color-focused
transmission-fluid pack (different fluid, different failure mode: moisture
absorption and boiling point, not color/varnish) and the brake-noise pack
(pad wear sound, not fluid chemistry). This is a file/PR-listing check, not a
substitute for the real ledger — a rejected brief that never got a written
pack would not show up here, so treat "not found in either list" as
directional, not a guarantee of zero repetition against the actual
`reel_jobs` table.

---

## 2 · Candidate scores and selection

No tracked slate file covers this topic, so candidates were generated fresh
against the gap in the 31-topic list above — deliberately avoiding anything
overlapping an existing merged pack or open draft:

| Candidate | Hook strength | Evergreen? | Distinct from existing 31? | Selected? |
|---|---|---|---|---|
| Brake fluid moisture / 2-year test-strip check | Strong — counter-intuitive "your fluid is absorbing water right now" hook, visual color-strip payoff | Yes | Yes — no fluid-moisture pack exists; brake-noise pack covers pads, not fluid | ✅ **Selected** |
| Wheel-speed-sensor / ABS light meaning | Moderate — informational, less visceral hook | Yes | Yes, but weaker hook | Parked |
| Timing belt vs. timing chain interval | Moderate — niche, engine-specific, harder to make universally relatable | Yes | Yes | Parked |
| Uneven tire wear patterns (feathering/cupping) | Moderate — overlaps conceptually with the already-packed tread-fingerprint and tread-depth-rain-vs-snow topics | Yes | Borderline — risk of near-duplication | Rejected for this run |

Brake fluid was selected for the strongest counter-intuitive hook (most
drivers have never thought about their brake fluid "absorbing water") paired
with a fast, visual proof point (a test strip changing color) that fits the
5-beat structure without inventing new format.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Brake fluid is hygroscopic — it absorbs moisture through the lines over time, even sealed" | General automotive/chemistry knowledge (glycol-ether brake fluids are well-documented as hygroscopic; this is standard, non-shop-specific mechanical fact) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached to this claim. |
| "More water in the fluid means a lower boiling point" | Same — standard fluid-dynamics/chemistry fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids a specific boiling-point number (no "drops X degrees" claim) precisely because that number was not verified against a sourced spec sheet this run. |
| "It's also how corrosion starts inside steel brake lines" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** "We'll check it free" is a service offer, not a priced claim, and matches the approved soft-language pattern rather than a guarantee. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store (no price/warranty line), which sidesteps the gap
for this specific pack but doesn't close it.

---

## 4 · Full production pack

### Script — word-for-word, timed (26s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Your brake fluid is quietly pulling water out of the air. That's not a defect. That's chemistry." |
| 2 · SETUP | 0:03–0:09 | "Brake fluid is hygroscopic — it absorbs moisture through the lines over time, even sealed." |
| 3 · VALUE | 0:09–0:15 | "More water in the fluid means a lower boiling point — and a spongier pedal exactly when you need it firm." |
| 4 · VALUE | 0:15–0:20 | "It's also how corrosion starts inside steel brake lines, from the inside out, where you can't see it." |
| 5 · CTA | 0:20–0:26 | "Fifteen seconds with a test strip tells you which one you are. Bring it by — we'll check it free." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on (last verified in-repo 2026-08-11/16; not re-verified live this
run). Search terms for free stock (Pexels/Pixabay/Coverr — search manually; no
specific clip URLs are asserted here since none were verified live this run):

- Beat 1: "brake fluid reservoir cap open macro"
- Beat 2: "brake fluid test strip dip" / "fluid test strip color chart"
- Beat 3: "brake fluid test strip comparison macro"
- Beat 4: "brake line fitting corrosion macro" / "rusted brake line"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 26s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone — burn
in via ffmpeg `subtitles` filter, never as a generated in-frame element
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
4. **Color:** slight desaturation + cooler white balance on beats 1–3 (fluid
   reservoir / test strip), shifting slightly warmer on beats 4–5 (workbench,
   garage interior) to visually separate "problem" from "resolution."
5. **Export:** 1080×1920 (9:16), H.264, target 15–30 Mbps, AAC audio, MP4
   container — matches the render-integrity gate's expectations (container
   duration within 0.75s of the 26s storyboard contract plus a 3s SAVE
   freeze, ≥80% of expected 30fps frame count, ≥3 distinct MD5s among 5
   sampled frames as motion proof).
6. **SAVE freeze:** hold the final CTA frame (garage bay wide shot with
   caption "Nick's Tire and Auto — link in bio") for a 3-second static tail
   per the storyboard contract above.

### Posting specs

- **Platform:** Instagram Reels + Facebook Reels (cross-post, same asset).
- **Dimensions:** 1080×1920, 9:16, MP4, ≤26s content + 3s freeze = 29s total.
- **Hashtags:** `#brakes #brakefluid #cartips #clevelandohio #carmaintenance`
- **Metadata:** alt text — "Brake fluid test strip comparison showing
  moisture-related color change, tire and auto shop garage bay." No location
  tag asserted here (would require a live Meta/IG connection this run doesn't
  have).

---

## 5 · Credit-risk and fallback routing

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate from `generationLedger.ts`'s `COST_ESTIMATES_USD`
table, not a metered price — treat as directional, consistent with every
prior pack's estimate.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run (live
DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is
likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
the volume of same-week reel packs already produced (§0/§1), if any of these
were actually enqueued in sequence, `REPEAT_TOPIC`/`RESERVATION_SPACING`
would very likely block most of them same-day — another reason this queue
needs human triage rather than mechanical enqueueing of all 27 packs at once.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** — same confirmed gap
noted in every prior pack since 2026-08-15. This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient/SFX layer (garage room tone, one soft liquid "drip" sting), which
also scores well on the pipeline's muted-first requirement since the
captions alone carry full meaning. If the operator wants a music bed, that
requires a specific track with asset ID, source, license scope, territory,
and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (58/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Your brake fluid is quietly pulling water out of the air. That's not a
> defect. That's chemistry.
>
> Brake fluid is hygroscopic — it absorbs moisture through the lines over
> time, even sealed. More water means a lower boiling point, and a spongier
> pedal exactly when you need it firm. It's also how corrosion starts inside
> steel brake lines, from the inside out.
>
> Fifteen seconds with a test strip tells you which one you are.
>
> #brakes #brakefluid #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your brake fluid is absorbing water right now. That's not a defect
> — that's just what it does."
> Caption: More moisture means a lower boiling point and a softer pedal when
> you need it firm most. A 15-second test strip tells you where you stand.
> CTA: Bring it by — we'll test it free, no pressure. (216) 862-0005 ·
> 17625 Euclid Ave.

**Ad-ready variant B (question-forward):**

> Hook: "When's the last time anyone actually tested your brake fluid?"
> Caption: Not changed — tested. Moisture creeps in over years even in a
> sealed system, and it's the kind of thing you can't see or feel until the
> pedal already feels soft.
> CTA: Free test, straight answer, no upsell. Stop by anytime.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (58/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on
multiple dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the hygroscopic/boiling-point/corrosion
claims, and that store wasn't queried live this run to check), **first-frame
scroll-stop** (a fluid-cap open shot is a moderate hook, not a top-tier one),
and **loop** (the CTA frame doesn't loop cleanly back into the hook frame).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"brake fluid moisture test"}`,
let the server re-score and re-render for real, and only then move toward
publish.

---

**Operator note on §0:** this run produced one more pack on top of an
existing 26-open-draft, 5-merged backlog. Recommend the operator either (a)
triage/merge or explicitly close the existing drafts so the file-based
duplication check in §1 stays meaningful, or (b) reduce how often this
scheduled prompt fires, since roughly-hourly firing is outpacing any
plausible human review cadence. This pack does not attempt to fix that by
itself — it's a scheduling/process decision, not something a single run
should decide unilaterally.
