# Reel production pack — "One new tire on an AWD car" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **AWDTIRES**

**No generation, DB read, or publish call was made against production this
run.** This firing is automated with no live operator present. The operator
skill's hard rule is explicit that a stored scheduled prompt does not
authorize `reel-canary` generation or publish calls, and that a
repetition-ledger or quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start` / `advance` / `qa` / `publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — commands actually executed, not assumed:**

| Capability the task asked about | Status this run | Basis (actual probe) |
|---|---|---|
| ChatGPT / any external LLM API | **Not available** | No OpenAI/Anthropic/Gemini key in this shell. `env \| grep -E '^(REEL_\|HIGGSFIELD_\|META_\|ADMIN_API_KEY\|DATABASE_URL\|GEMINI_\|OPENAI_\|ELEVEN)'` returned **zero rows**. |
| TTS / voiceover | **Not available** | `command -v espeak piper say` → all MISSING. `reelVoice.ts` needs a running app + provider key; neither exists here. |
| Higgsfield | **Not available** | `command -v hf higgsfield` → both MISSING. No `HIGGSFIELD_CREDENTIALS_JSON`. `getHiggsfieldAccountHealth()` is unreachable without the app server, so `credsValid` and `balanceCredits` are both `UNKNOWN`. |
| Meta / Instagram posting | **Not available, and blocked regardless** | No `META_PAGE_ACCESS_TOKEN` / `META_IG_USER_ID` / `META_PAGE_ID`. Even if present, publishing is a protected customer-facing action under root `AGENTS.md` and needs a live per-run operator instruction, which a scheduled firing is not. |
| Shell / render pipeline | **Not available** | `command -v ffmpeg ffprobe` → **both MISSING**. Shell itself works (`python3`, `node` present), but there is no video encoder, so even the free `template_stock` local lane cannot run here. |
| CapCut or equivalent editor | **Not available** | No GUI, no NLE binary in this container. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` records prod as pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |

**Conclusion: this run has zero motion route and zero audio route.** Per the
skill's "Producing a pack when the motion route is unavailable" section and
the task's own rule 5, the correct output is a full production-ready pack —
not a claimed render, and not a quietly weaker deliverable presented as
finished. **No MP4 exists.** §4 is the pack.

**Repetition context — directory + open-PR check** (not the live `reel_jobs`
table, which this session cannot reach):

    ls apps/nickstire/docs/reel-packs/                     → 54 merged pack directories
    list_pull_requests(state=open) ... "reel pack" titles  → 3 open draft PRs

Open draft reel-pack PRs right now (3): lug-nut re-torque after wheel service
(#1741), musty AC smell / evaporator drain vs. cabin filter (#1739), wheel
wobble test / tie rod vs. wheel bearing (#1738).

**Backlog note.** `BACKLOG-STATUS-2026-08-20-0900.md` in this directory
recorded **17** unreviewed open reel-pack PRs at 09:00 today and recommended
that a run skip entirely whenever the open count exceeds ~5. That backlog has
since been triaged — the count is now **3**, under the threshold — so this run
proceeds and writes a pack rather than another status file. The 09:00 note's
standing ask about this task's *firing cadence* is unchanged and still belongs
to the operator: this session confirmed again that its `CronList` tools address
an in-process session scheduler, not the external trigger that fired it.

**Topic-collision check.** "One new tire on an AWD car / tread-depth matching"
appears in none of the 54 merged directories and none of the 3 open PRs. The
nearest neighbours were checked individually and are different failure
families:

- `2026-08-17-tire-rotation` — rotation pattern and interval, not what happens
  when one tire's diameter no longer matches the other three.
- `2026-08-18-uneven-tire-wear-patterns` — reading a wear pattern to diagnose
  alignment/inflation, not drivetrain tolerance.
- `2026-08-17-spare-tire-mileage` — the temporary donut's speed/distance
  limit. Closest neighbour, and genuinely adjacent (a donut is a
  mismatched-diameter wheel), but it is a "how far can I drive on this"
  message; this pack is a "before you buy one tire" purchase-decision message.
  Flagged as the one real overlap to weigh, not hidden.
- `2026-08-18-allseason-vs-winter-tires` — compound and season choice.

> **This is a filesystem + PR-title check, not the real ledger.** A `reel_jobs`
> row for a rejected brief that never produced a pack would not appear in
> either search. Treat "not found" as directional, not a guarantee.

---

## 2 · Candidate scores and selection

Scored 0–5 per dimension; highest total selected.

| Candidate | Hook | Muted-first legibility | Faceless feasibility | Evergreen | Non-overlap | Total |
|---|---|---|---|---|---|---|
| **One new tire on an AWD car (tread-depth matching)** | 5 — a purchase people are about to make, with a consequence they've never heard of | 5 — deep tread vs. bald tread is a pure visual contrast, no text needed | 5 — tires, driveshaft, gauge; no hands or faces anywhere | 5 | 4 — donut/spare pack is adjacent but a different message | **24** ✅ **Selected** |
| Sidewall max PSI vs. door-jamb placard | 4 — strong misconception | 3 — the whole point is two printed numbers, and generated clips can't render legible text; would lean entirely on burned-in captions | 4 | 5 | 3 — crowds two existing pressure packs (`summer-heat-tire-pressure`, `cold-weather-tire-light`) | 19 |
| Nitrogen vs. air in tires | 2 — low stakes, "does it matter?" energy | 4 | 4 | 5 | 5 | 20 |
| Sudden drop in gas mileage | 3 — relatable but sprawling, many causes | 3 — no single clean visual | 4 | 4 | 5 | 19 |

Selected on the strongest hook plus the best muted-first fit: the entire
argument is carried by one shot of a deep tread beside a bald one, which is
exactly what the pipeline's muted-first and motion-first floors reward. The
PSI candidate scored second on idea but was parked specifically because its
payload is *printed text*, which the generated-clip route cannot render
reliably (the M10 preflight blocks generated in-frame text for this reason).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "All-wheel drive works by keeping all four tires turning at nearly the same rate" | Standard drivetrain mechanics — a coupling/differential distributes torque across axles and tolerates only small rotational-speed differences | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live (would be a prod DB read; no `DATABASE_URL` in this session). No `EvidenceRecord` is cited. Hedged in-script with "nearly". |
| "One taller tire turns slower than the other three. That difference **can** put constant strain on the drivetrain" | Same | **UNKNOWN**, same reasoning. Uses "can", an approved soft-language pattern (`client/src/lib/facelessReelStudio.ts`), not "will" and not a repair-cost figure. |
| "Most all-wheel-drive owner's manuals list a maximum tread-depth difference" | Manufacturer-specific; the actual tolerance varies by make and model | **UNKNOWN and deliberately not quantified.** No "2/32-inch" or any other number appears in the script — that figure is real for some manufacturers and wrong for others, so the reel points the viewer at their own manual instead of asserting a universal spec. This is the single most important claim-safety decision in this pack. |
| Shop identity in the CTA | `businessFacts.ts` `SEED_FACTS` (code file read, not a live DB read): "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" | **Used, name/address/phone only.** |
| No price, "free", warranty, or policy claim anywhere | Checked by hand against `PRICE_CLAIM_PATTERN` in `facelessReelStudio.ts` | **N/A — deliberately avoided.** |

**Deliberate divergence from prior packs, flagged rather than copied.** Every
earlier pack in this directory closes on "Nick's Tire and Auto checks it
free." **"Free" is a shop-policy claim**, and `businessFacts.ts`'s
`FactChannel` type is `"sms" | "voice" | "web"` only — there is no `"reel"` or
`"social"` channel, so no fact in that store is cleared for public video use.
Prior packs asserted it anyway. This pack does not: the CTA is "Stop by Nick's
Tire and Auto and we'll check all four," which uses approved soft language and
carries no policy claim. If the operator wants "free" back in the CTA, that is
a one-word edit and an operator decision, not something an unattended run
should assert.

---

## 4 · Full production pack

### Script — word-for-word, timed (30s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:05 | "Buying one new tire for an all-wheel-drive car? Worth checking the other three first." |
| 2 · SETUP | 0:05–0:12 | "All-wheel drive works by keeping all four tires turning at nearly the same rate. Deeper tread means a bigger tire." |
| 3 · VALUE | 0:12–0:19 | "One taller tire turns slower than the other three. That difference can put constant strain on the drivetrain." |
| 4 · VALUE | 0:19–0:25 | "Most all-wheel-drive owner's manuals list a maximum tread-depth difference. One clue: measure all four, not just the flat one." |
| 5 · CTA | 0:25–0:30 | "Don't guess. Stop by Nick's Tire and Auto and we'll check all four." |

82 words over 30s ≈ 2.7 words/sec — a comfortable read-aloud pace with room
for a beat of silence at each cut. Machine-readable version with per-beat
visual prompts: [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Full prompts are in `brief.json`. Standing negative prompt on every
beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

Beat 4 is the one to watch: a tread-depth gauge is normally filmed being held.
Its prompt specifies the tool alone descending into the groove, no hand
present. If the generator keeps inserting a hand, re-roll rather than accept
it — a hand fails the faceless contract.

**Fallback / actual-prod route — `template_stock`** (free, local ffmpeg, no API
spend). Per `docs/operations/REEL-PIPELINE.md` this is what prod currently
renders on. Stock search terms for free libraries (Pexels / Pixabay / Coverr —
**search manually; no specific clip URL is asserted here, because none was
verified live this run and an unverified URL in a pack is worse than none**):

- Beat 1: "row of tires shop floor" / "new tire tread closeup macro"
- Beat 2: "driveshaft rotating underneath car" / "car differential underbody closeup"
- Beat 3: "tire tread macro rotating" / "worn tire tread closeup"
- Beat 4: "tread depth gauge tire" / "car on lift wheels garage"
- Beat 5: "tire shop garage bay interior" / "stack of tires warehouse daylight"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run (no TTS available — see §1). Route the
script above through `reelVoice.ts` at render time; it is already timed to the
30s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not
one-word-at-a-time) for short-form readability, timed to the narration above
and aligned to beat boundaries at 5s / 12s / 19s / 25s.

Styling: white bold sans (Inter/Montserrat Black or DejaVu Sans Bold, which is
what the Railway service actually ships via
`RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg fonts-dejavu-core`), ~64px at 1080×1920,
2–3px black outline plus a soft drop shadow, centred, bottom-third safe zone
(keep above y≈1500 so the IG UI chrome doesn't cover it). Burn in via ffmpeg's
`subtitles` filter. **Never** as a generated in-frame element — the generators
can't spell, and the M10 preflight blocks generated text for exactly that
reason.

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom → top):** background video clip per beat → optional
   low-level shop room-tone under beats 1–4 → voiceover track → burned-in
   caption track → end-card shop name/address on beat 5 only.
2. **Assembly:** concatenate the 5 beat clips in order. **Hard cut on every
   beat boundary, no crossfade** — the render-integrity gate samples distinct
   frames, and a dissolve blurs exactly the frames it samples.
3. **Captions:** burn in per `captions.srt`, styling above.
4. **Colour:** cool, slightly desaturated grade on beats 1–4 (diagnostic
   mood); warm shift on beat 5 (CTA, inviting). The warm/cool split is also
   what keeps the designed loop from reading as a jump cut.
5. **Loop:** beat 5's last frame is framed to match beat 1's first frame (four
   tires upright in a row, same low lens height, same forward push). Trim beat
   5's tail so the final frame lands on that framing rather than drifting past
   it.
6. **Output contract — must hold for the pipeline's own render-integrity gate
   (`reelAssembly.ts`, #800/#801):** container duration within 0.75s of 30s;
   video-stream duration within 0.75s (container duration lies via the audio
   track when the video track ends early); ≥80% of the expected 30fps frame
   count (≥720 frames); ≥3 distinct MD5s among 5 sampled frames. Every beat
   here has continuous camera movement plus subject movement, which is the
   motion proof — a still with a Ken-Burns zoom is not.
   Reference command shape (**not executed this run — no ffmpeg in this
   container**):
   `ffmpeg -f concat -safe 0 -i beats.txt -vf "subtitles=captions.srt" -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook cross-post, `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps, AAC audio
- **Duration:** 30s (inside the 15–60s target band)
- **Posting slot:** the account's fixed cadence (7:00 AM or 2:00 PM ET). Do not
  post ad hoc, and check §5's guardrail order if the day's feed slot is already
  consumed by the autonomous cron.
- **Caption / hashtags:** §8
- **CTA type:** SEND-oriented ("send this to someone about to buy one tire") —
  a SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels, per an earlier pack's finding.

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labelled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total on the prod-pinned route:** ~$0.06 (VO + brief only; clips
free). Operator-tunable estimate, not a metered price — directional only.

**Daily budget ceiling: `UNKNOWN`** — `maxGenerationCostPerDayUsd` lives in the
latest `autonomy_policy_versions` row, unreachable this run. Higgsfield
balance (`getHiggsfieldAccountHealth().balanceCredits`): **`UNKNOWN`** — no
CLI, no credentials.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA`
(72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
`REEL_AUTOPOST_ENABLED=true` and `dailyReelPost.ts` already consumed today's
feed cap, this pack should wait for the next open slot rather than force a
same-day post.

---

## 6 · Audio / music rights

**No music-rights ledger exists in this repo** — a confirmed capability gap,
not a new finding, and reported rather than dropped. This pack therefore
assigns **no music bed** instead of asserting a track is cleared. Audio is
voiceover + captions, with an optional low-level shop room-tone under beats
1–4. That also scores well on the muted-first requirement, since the captions
carry the full argument with sound off.

If the operator wants a music bed, it needs a specific track tracked by hand
with asset ID, source, license scope, territory, expiry, and organic-vs-ad
clearance. This pack supplies none, and none of the fields above can be filled
from anything in this repo today.

Voiceover rights: n/a this run — no VO was generated (no TTS available).

---

## 7 · QA matrix

No rendered asset exists, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | Not called. `brief.json` carries a hand-computed self-estimate (**59/75**) that is explicitly *not* this function's output |
| Render-integrity (#800/#801) | `reelAssembly.ts` | `BLOCKED` | No file rendered; no ffmpeg/ffprobe in this container to probe one |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not invoked — this is the gate that must return `proceed` before any real publish |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |
| Repetition ledger | `getRecentReelSignals()` | `UNKNOWN` | Live `reel_jobs` read not possible (no `DATABASE_URL`). Substituted the directory + open-PR check in §1, which is weaker |

---

## 8 · IG / FB copy

**Primary caption (SEND-oriented):**

> Buying one new tire for an all-wheel-drive car? Worth checking the other
> three first.
>
> AWD works by keeping all four tires turning at nearly the same rate. A new
> tire has deeper tread, so it rolls slightly bigger — and one taller tire
> turns slower than the other three. That difference can put constant strain
> on the drivetrain.
>
> Most AWD owner's manuals list a maximum tread-depth difference. One clue:
> measure all four, not just the flat one.
>
> Send this to someone about to buy one tire.
>
> #cartips #awd #clevelandohio #tires #autorepair

**Ad-ready variant A — consequence-forward:**

> Hook: "If your car is all-wheel drive, replacing one tire isn't the same
> decision as replacing one tire."
> Caption: A new tire has deeper tread, so it rolls slightly bigger than the
> three worn ones — and on AWD, that mismatch works against the drivetrain
> every mile. Your owner's manual lists how much difference is acceptable.
> CTA: Not sure where yours stands? Stop by 17625 Euclid Ave or call
> (216) 862-0005 and we'll measure all four.

**Ad-ready variant B — question-forward:**

> Hook: "One tire went flat. Do you replace one, two, or all four?"
> Caption: On a front- or rear-wheel-drive car, one is often fine. On
> all-wheel drive, tread depth across all four has to stay close — and the
> limit is in your manual, not on the tire.
> CTA: Bring it by and we'll check all four before you buy anything.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

- **Not `PRODUCTION-READY`.** The hand-computed self-estimate is **59/75**,
  below the pipeline's real 70/75 floor, on three specific dimensions:
  **sourced fact** (0/10 — no `EvidenceRecord` backs the AWD tread-tolerance
  claims, and `evidenceResolver.ts` could not be queried without DB access),
  **winning concept ≥57/60** (0/5 — `scoreReelConcept()` was not invoked, so
  scored 0 rather than assumed passing), and **loop** (4/5 — a loop is
  designed this time, but frame-match is unverified). The server re-scores at
  enqueue regardless; this estimate is not a substitute for that.
- **Not `PUBLISHED WITH READ-BACK`.** No `reel-canary` call, no `jobId`, no
  `igPostId`, no permalink. Nothing was generated, rendered, or posted.
- **Not `BLOCKED`.** The pack itself is complete and usable.

### What still requires manual work

1. **Generate or source the 5 beat clips** — Higgsfield/Seedance via the
   prompts in `brief.json`, or free stock via the §4 search terms. *Cannot be
   done here: no `hf` CLI, no credentials.*
2. **Generate the voiceover** — feed §4's script to `reelVoice.ts`. *Cannot be
   done here: no TTS.*
3. **Render the MP4 — in CapCut, or via ffmpeg per §4's command shape.**
   *Cannot be done here: no ffmpeg in this container.* Must satisfy §4 step 6's
   output contract.
4. **Run the real quality + QA gates** by handing the topic to the live
   pipeline: `POST /api/admin/reel-canary {action:"start", topic:"one new tire
   on an all-wheel-drive car: tread depth has to match"}`, then `advance`
   until `status:"assembled"`, then `qa`. Let the server re-score for real.
5. **Approve and post via the human-approval door** (`instagramAdmin.approveDraft`
   → `instagramAdmin.publishPost`), or manually via Meta Business Suite.
   *Requires an explicit live operator instruction — a scheduled run can never
   authorize this.*
6. **Operator decision:** whether to restore "free" to the CTA (see §3).

This session did not merge, close, or otherwise touch any other PR. The three
open reel-pack PRs noted in §1 are the operator's to review.
