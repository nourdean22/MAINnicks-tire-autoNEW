# Reel production pack — "Clunk over bumps: sway bar link vs. ball joint" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CLUNK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Cadence note, read before triaging this PR — see §1.** This is the 6th
distinct reel-pack topic produced today (2026-08-19) alone, across 5 still-open
draft PRs (#1701, #1702, #1708, #1712, #1717) plus one already-merged pack
earlier today. This scheduled trigger appears to fire roughly hourly. This
pack adds a genuinely new, non-duplicate topic per this run's instructions,
but the cadence itself is worth an operator look — see the closing note in §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 2 localhost:3000/api/health` returned connection-refused (exit 7) — no server process in this session's container. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` | **Not present** | `env \| grep -iE "higgsfield\|database_url\|admin_api_key"` returned nothing this session. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (last verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job. |
| Voiceover TTS (`reelVoice.ts`) / any TTS tool | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| ChatGPT / external LLM tool | N/A | This session's own model wrote the script directly — no separate LLM tool call needed or used. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| CapCut / video editor | Not available | No editor application or MCP tool connected to this session. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                → 37 merged pack directories on disk
    list_pull_requests(state=open)                     → 5 open PRs, all reel-pack topics, all dated today

Open PR topics today: metallic rattle on acceleration (#1717), engine
overheating first 60 seconds (#1712), steering wheel shakes when braking /
warped rotors (#1708), timing belt with no warning light (#1702), windshield
chip repair-before-it-spreads (#1701). Merged earlier today: won't-start
battery/starter/alternator triage. **"Clunk over bumps: sway bar link vs.
ball joint" is not among any of the above** — distinct from wheel-bearing-hum
(a hum, not a bump-impact clunk), CV-joint-click (turning-only click, no bump
correlation), strut-bounce-test (a DIY diagnostic method, not this symptom
pair), and sidewall-bulge/pothole-damage (tire/wheel damage, not a chassis
noise). Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Clunk over bumps: sway bar link vs. ball joint | Strong — common, relatable noise every driver has heard, clean 2-way diagnostic hook | Yes | No | ✅ **Selected** |
| Differential/axle whine on turns | Moderate — real symptom but less universally recognized by name | Yes | No | Parked — noise-diagnosis theme overlap risk with today's rotor/rattle/bump packs; deprioritized to avoid three noise-diagnosis reels queued the same day |
| Shocks vs. struts — what's the difference | Moderate — informational, weaker "stop scrolling" hook than a symptom-first hook | Yes | Adjacent to merged strut-bounce-test pack (a DIY test, not this comparison) | Parked |

"Clunk over bumps" was selected for a clean two-way diagnostic structure
that maps onto the account's 5-beat shape without inventing structure, and
confirmed non-overlap with both the merged-pack directory and today's 5 open
PR titles.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Clunk on rough roads, steering feels normal → can point to a sway bar link" | General automotive diagnostic knowledge (standard roadside/shop heuristic: sway bar end links wear from repeated bump-flex, not turning load) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`) rather than an absolute — correct hedge for an unverified-in-store claim. |
| "Clunk when turning AND hitting a bump → may indicate a ball joint" | Same — standard mechanical fact, not shop-specific (ball joints carry combined lateral + vertical load, so they clunk under the combined motion, distinct from a link's bump-only signature) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate" (`facelessReelStudio.ts:581`). |
| "We check your full suspension free" (beat 5 CTA) | `businessFacts.ts` `SEED_FACTS`, `factKey: "repair.pricing_policy"`, category `policy`: *"For any repair beyond the fixed prices, never quote a number blind — free check, written quote, you don't pay until you say yes."* (code file, read-only — not a live DB read) | **Grounded, with a scoping caveat below.** The policy fact supports "free check" language generically for non-fixed-price repair work, which a suspension inspection is. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. The pricing-policy fact above is cited as
directional grounding for the CTA's tone, not as a channel-cleared quote;
an operator should confirm "free suspension check" is accurate shop policy
before this line goes to render, same as any other reel CTA line drawing on
this store today.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Hear a clunk every time you hit a bump? The way it happens is one clue to why." |
| 2 · SETUP | 0:04–0:10 | "Clunk on rough roads, but steering feels normal? That can point to a sway bar link." |
| 3 · VALUE | 0:10–0:16 | "Clunk when you turn AND hit a bump at the same time? That may indicate a ball joint." |
| 4 · VALUE | 0:16–0:22 | "Left alone, worn suspension parts are worth checking before a long trip." |
| 5 · CTA | 0:22–0:28 | "Don't guess — Nick's Tire and Auto checks your full suspension free. Link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "car driving over rough road pothole suspension" / "front wheel well bump dusk"
- Beat 2: "car suspension sway bar link underbody closeup" / "front bumper undercarriage macro"
- Beat 3: "car lower control arm ball joint closeup" / "front suspension component macro shop"
- Beat 4: "car raised on shop lift front suspension" / "auto repair lift underside car"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   single suspension-clunk SFX on beat 1's bump impact (optional, see §6) →
   voiceover track → burned-in caption track → end-card CTA text (beat 5
   only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–3 (diagnostic
   mood), warm shift on beats 4–5 (reassurance → CTA).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see the guardrail order in
  §5 if today's feed slot is already consumed by the 5 other topics queued
  today
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("tag someone whose car does this over
  bumps"), matching the account's corrected objective (a SAVE-oriented CTA
  measured `saved = 0.00` across the account's first 8 reels, per the
  brakes pack's finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
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
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. **6
topics have been produced today against a stated 2-posts/day feed cap** —
even if every pack today is individually distinct and well-formed, at most
2 can actually clear the reservation cap today. This pack should wait for
an open slot, same as the other 5 already queued.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + one optional royalty-free
suspension-clunk SFX on beat 1, which also scores well on the pipeline's
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (55/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Hear a clunk every time you hit a bump? The way it happens is one clue to
> why.
>
> Clunk on rough roads but steering feels normal — that can point to a sway
> bar link. Clunk when you turn AND hit a bump at the same time — that may
> indicate a ball joint.
>
> Don't guess. Tag someone whose car does this.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That clunk over bumps isn't nothing — and it's not always the same
> part."
> Caption: Clunk on bumps only, steering fine = sway bar link. Clunk on
> bumps AND turning = ball joint. Two different parts, two different fixes.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave — we
> check the full suspension free.

**Ad-ready variant B (question-forward):**

> Hook: "Does your car clunk every time you hit a bump — and you've just
> learned to ignore it?"
> Caption: That noise has an address. Rough-road-only points one way,
> turning-plus-bump points another. Guessing means paying for the wrong
> part first.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (55/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a residential road at dusk — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the sway-bar-link/ball-joint triage
claims, and that store wasn't and couldn't be queried live this run — no DB
access), and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"clunk over bumps: sway bar link vs ball joint"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Separately: this scheduled trigger has now produced 6 distinct reel-pack
topics today against a stated 2-posts/day feed cap**, and the prior
same-day merged pack (`2026-08-19-wont-start-battery-starter-alternator`)
already raised this same cadence concern once today. This session did not
merge, close, or otherwise touch any of the other 5 open PRs — that is
outside this run's assigned scope. Recommended next step for the operator:
review and merge/close the current 5-PR backlog (all are docs-only, zero
live side effects, explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`),
and consider whether this trigger's firing frequency should be reduced to
something closer to the account's actual 2-posts/day throughput.
