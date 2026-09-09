# Reel production pack — "Clutch pedal sinking to the floor? It might not be the clutch." (2026-09-01)

Scheduled-task run · 2026-09-01 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CLUTCHLEAK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize a real `/api/admin/reel-canary` generate/publish call or
a live production-DB read. This session made none of those calls. See §1
and §9.

**Backlog context, read before triaging this PR.** `apps/nickstire/docs/reel-packs/BACKLOG-CLOSEOUT-2026-08-29.md`
recorded 136 merged pack directories (3 publishable, 93 needs-work, 40
dead) and closed six duplicate status-only PRs for restating that same
inventory finding without a new decision or implementation. This PR is
deliberately **not** another status report — it adds one new, non-duplicate
topic, checked against all 136 merged directories and the current open-PR
queue (§1). The closeout note's own conclusion — whether to pause or retune
the scheduled trigger given that backlog — is still an operator decision
this session has not made and is not making here.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container; this is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` credentials | **Not present** | `env \| grep -iE "reel_generation_enabled\|reel_video_provider\|admin_api_key\|higgsfield\|database_url\|reel_autopost_enabled"` returned nothing. |
| `ffmpeg` CLI | **Not present** | `command -v ffmpeg` found nothing. |
| `hf` (Higgsfield) CLI | **Not present** | `command -v hf` found nothing. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / general LLM text generation | **This session itself** | Used for script/copy authoring below — no external LLM API call made or needed. |
| CapCut / video-editing software | **Not available** | No GUI editor in this container; ffmpeg assembly instructions given instead (§4). |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. No MP4 exists; none
is claimed to exist.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                  → 136 merged pack dirs (+ closeout/backlog docs)
    search_pull_requests "reel pack in:title" repo:… is:open              → 0 open PRs
    pull_request_read #2004 (the most recent reel-pack PR)                → state: closed, not merged

**"Clutch pedal sinking / feeling loose or spongy" is not among the 136
merged topics.** The closest neighbors are `2026-08-22-clutch-slipping-rpm-flare`
(campaign keyword `CLUTCHSLIP` — that pack is about the clutch *slipping
while driving*: RPM flares without the car accelerating, a worn-friction-disc
symptom) and `2026-08-25-ac-compressor-clutch-not-engaging` (a different
part entirely — the AC compressor's electromagnetic clutch, not the
transmission clutch). Neither covers a soft/sinking clutch pedal, which is a
hydraulic-system symptom (master cylinder, slave cylinder, or clutch line) —
a distinct mechanism and a distinct diagnostic hook from both. Selected on
that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Clutch pedal sinking/spongy — hydraulic leak vs. worn clutch | Strong — common manual-transmission driver worry, clear two-branch diagnostic hook, distinct mechanism from the existing clutch-slip pack | Yes | No | ✅ **Selected** |
| Manual-transmission "won't go into gear when cold" | Moderate — narrower audience (manual-transmission owners only, same as the selected topic) and closer to `synchro`-type wear, harder to keep claim-safe without overclaiming a cause | Yes | Not found in either list | Parked — softer hook and more overlap risk with a future transmission-fluid pack |
| Handbrake/parking-brake stuck or won't release | Moderate | Yes | Not found in either list | Parked — clutch topic scored a cleaner two-branch structure this run |

"Clutch pedal sinking or feeling spongy" was selected for a clean two-branch
diagnostic structure (leak-in-the-line vs. bigger problem) that fits the
account's 5-beat shape, a genuinely different underlying mechanism than the
one existing clutch pack, and confirmed non-overlap with both the merged-pack
directory and the (currently empty) open-PR queue.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Pedal feels spongy but the clutch still grabs → can point to air or a small leak in the clutch line" | General automotive knowledge — hydraulic clutch actuation (master cylinder → line → slave cylinder) is a standard, widely taught mechanism; a spongy pedal from air/fluid loss is the same failure mode as a spongy brake pedal, just on the clutch circuit | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation attached. `grep -rn "clutch" businessFacts.ts evidenceRecords.ts` returned zero matches — nothing to cite either way. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts`) rather than an absolute. |
| "Pedal sinks all the way and stays down → may indicate a bigger fluid leak, not the clutch disc itself" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate". |
| "Fluid spot near the firewall → worth checking before paying for a clutch you might not need" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking". Deliberately steers away from asserting "you don't need a clutch" — only that it's worth checking before assuming the worst-case repair. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Same reasoning as every prior pack: `FactChannel` is `"sms" \| "voice" \| "web"` only, no `"reel"` channel, so no business fact is quoted. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type has no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this pack, but it would
block any future reel script that wants to quote a price or warranty line
verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Clutch pedal feels loose, or sinks to the floor? One clue, more than one cause." |
| 2 · SETUP | 0:04–0:10 | "Pedal feels spongy but the clutch still grabs? That can point to air or a small leak in the line." |
| 3 · VALUE | 0:10–0:16 | "Pedal sinks all the way and stays down? That may indicate a bigger fluid leak, not the clutch itself." |
| 4 · VALUE | 0:16–0:22 | "Fluid spot near the firewall? Worth checking before you pay for a clutch you might not need." |
| 5 · CTA | 0:22–0:28 | "Don't guess with a soft pedal. Nick's Tire and Auto checks it free — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md` (last-verified
2026-08-11 per prior packs; not re-confirmed live this run — no server),
this is what prod currently renders on. Search terms for free stock
(Pexels/Pixabay/Coverr — search manually; no specific clip URLs are
asserted here since none were verified live this run):

- Beat 1: "manual transmission clutch pedal closeup driver footwell"
- Beat 2: "car pedal closeup foot hovering clutch"
- Beat 3: "clutch master cylinder engine bay firewall closeup"
- Beat 4: "fluid drip under car engine bay macro"
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
element (Seedance/Higgsfield can't spell reliably, and the pipeline's M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   voiceover track → burned-in caption track → end-card CTA text (beat 5
   only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic,
   attentive mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, video-stream duration
   within 0.75s of 28s (checked separately — container duration alone can
   lie via the audio track), ≥80% of expected 30fps frame count, ≥3
   distinct MD5s among 5 sampled frames (motion proof — no static/looped
   single image; every beat here is a slow camera move or subtle drift, not
   a still). Reference command shape (documented in `facelessReelStudio.ts`
   / `reelAssembly.ts`, not executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  ~28–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone with a manual"),
  matching the account's corrected objective noted in prior packs (a
  SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md, last-verified in prior packs) | $0/clip, local ffmpeg | **$0** |
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
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily
autonomous cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`), this
pack should wait for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional royalty-free ambient
garage room-tone, which also scores well on the pipeline's muted-first
requirement since captions alone carry full meaning. If the operator wants a
music bed, that requires a specific track with asset ID, source, license
scope, territory, and expiry tracked by hand — this pack does not supply
one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (53/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Clutch pedal feels loose, or sinks to the floor? One clue, more than one
> cause.
>
> Pedal feels spongy but the clutch still grabs — that can point to air or
> a small leak in the line.
> Pedal sinks all the way and stays down — that may indicate a bigger fluid
> leak, not the clutch itself.
> Fluid spot near the firewall — worth checking before you pay for a
> clutch you might not need.
>
> Don't guess with a soft pedal.
>
> #cartips #clevelandohio #carmaintenance #autorepair #manualtransmission

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Clutch pedal gone soft or sinking? It might not be the clutch."
> Caption: Spongy pedal but the clutch still grabs? Could be a small leak
> in the line, not the clutch itself. Pedal sinking to the floor and
> staying there? Worth a real look before you assume the worst.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Soft clutch pedal — do you know if that's a leak or the clutch
> itself?"
> Caption: A hydraulic leak can feel exactly like a worn clutch. Guessing
> means possibly paying for the wrong repair.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (53/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a footwell/pedal close-up — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the hydraulic-clutch-leak claims, and
that store wasn't and couldn't be queried live this run — no DB access),
and **winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so
this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"clutch pedal sinking to the floor: leak or the
clutch itself"}`, let the server re-score and re-render for real, and only
then move toward publish.

**Separately: the reel-pack queue is currently clean, not growing.** This
run found 0 open reel-pack PRs and the last reel-pack PR (#2004) closed
without merging. This pack does not reproduce the oversupply pattern the
2026-08-29 closeout documented — it is the only reel-pack PR open against
this repo at the time of writing. The closeout's underlying question
(whether to retune the scheduled trigger's cadence, or set an explicit
inventory target against the 136 already-merged packs) remains open and is
still an operator decision this session is not making.
