# Reel production pack — "Reading your tire sidewall: the three markings that decide what fits" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **SIDEWALL**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present.
The operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger or quality-score read against the live database is itself
a production read, not a free action. This session made none of those calls.
See §1 and §9.

**No MP4 exists. None is claimed to exist.** The task asked for a rendered
file *if* the tool chain is present; §1 documents, capability by capability,
that it is not.

**Backlog status.** As of this run: **6 open PRs** match `reel pack in:title`
(#1738, #1739, #1741, #1742, #1744, #1745), plus 53 already-merged packs on
disk. That is a sharp improvement — the prior status note
(`BACKLOG-STATUS-2026-08-20-0900.md`) recorded **17** open drafts and
recommended pausing new pack authoring until the queue cleared. It has
substantially cleared, so this run authors a pack rather than filing another
status note. This pack's topic was checked against all 6 open titles and all
53 merged directories and duplicates neither (§1).

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

### Capability check — the task's step 1, answered by probe, not assumption

| Capability the task asked about | Status this run | How it was determined |
|---|---|---|
| **ChatGPT / general LLM text generation** | **Available — this session itself** | Script, captions and ad copy below were authored here. No external LLM API call was made or needed. |
| **TTS / voiceover** | **Not available** | No TTS tool is connected to this session. The app's own `reelVoice.ts` route needs a running server plus provider credentials; neither is present (rows below). Calling it unattended would also spend the shop's real quota. |
| **Higgsfield (motion generation)** | **Not available** | `which hf higgsfield` → not found. `env \| grep -E '^(REEL_\|HIGGSFIELD_\|ADMIN_API_KEY\|DATABASE_URL)'` → empty. `getHiggsfieldAccountHealth()` needs the running app; there is no server process in this container. |
| **Meta / Instagram posting** | **Not available, and blocked regardless** | No Graph API credentials in this environment. Independently, publishing is a protected customer-facing action under root `AGENTS.md` and requires an explicit live operator instruction every time — a scheduled firing is exactly the case the operator skill's hard rule refuses. |
| **Shell / render (ffmpeg)** | **Not available** | `which ffmpeg` → not found. Shell access exists, but the encoder does not, so no assembly could be performed even with assets in hand. |
| **CapCut or similar editing software** | **Not available** | No GUI editor in this headless container. ffmpeg-equivalent instructions are given instead (§4). |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md:32` — prod pins **`template_stock`** (verified 2026-08-11), not `higgsfield`; the paid lane was dropped and reels render on the free local ffmpeg lane. Last-known, not live-reconfirmed this run. |
| `REEL_FALLBACK_TO_TEMPLATE_STOCK` | Read from doc, not live env | `REEL-PIPELINE.md:36` — **off by default**; not evaluated live. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; the gate lives on the cron pulse job. |
| `ADMIN_API_KEY` | **Placeholder only** | The one match in `apps/nickstire/.env.example` is the literal template value `change-this-to-a-random-string` — not a working credential. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable presented as finished. That is what §4 is.

### Repetition-ledger context

The live `reel_jobs` table is unreachable from this session (no
`DATABASE_URL`), so repetition was checked against the two proxies the
operator skill names, **both** of them:

    ls apps/nickstire/docs/reel-packs/                      → 53 merged packs
    list_pull_requests(state=open) + search "reel pack"      → 6 open PRs

Open-PR topics (6): wheel wobble test (tie rod vs. wheel bearing) · musty AC
smell (evaporator drain vs. cabin filter) · lug-nut re-torque after wheel
service · one new tire on an AWD car (tread-depth matching) · sticking brake
caliper (one wheel hot) · why one tire keeps losing air (soapy-water leak
localization).

Merged tire-adjacent topics on disk: penny test · tire expiration (DOT date
code) · tread-wear fingerprint · sidewall bulge · plug-vs-patch · tire
rotation · tread depth rain-vs-snow · summer-heat tire pressure ·
cold-weather tire light · TPMS sensor battery · uneven tire-wear patterns ·
all-season vs. winter · spare-tire mileage · balance vs. alignment · why the
car pulls · pothole damage.

**"Reading the sidewall markings" is not among any of the above.** Its two
closest neighbors are `2026-08-14-tire-expiration` (the DOT date code — a
*different* marking on the same sidewall, about tire age) and
`2026-08-17-sidewall-bulge` (physical damage to the sidewall, not what's
printed on it). Neither decodes the size block, load index, or speed rating,
which is what this pack is about. Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** A `reel_jobs` row for a rejected brief that never produced a pack
> would not appear in either search. Treat "not found" as directional, not a
> guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Sidewall markings — size, load index, speed rating | Strong — a thing every driver has looked at and never had explained, tied to a real buying decision | Yes | No | ✅ **Selected** |
| Parasitic battery drain — car dies after sitting a few days | Moderate–strong, but overlaps the merged `wont-start-battery-starter-alternator` triage | Yes | Partially | Parked — adjacency risk |
| Tire valve stem dry rot / cracking | Moderate — narrower concern, weaker scroll-stop | Yes | Not found | Parked — third-strongest hook this run |

Selected for three reasons: it is *core tire-shop subject matter* for a tire
shop's account (most merged packs are general auto repair); it carries **zero
diagnostic-safety risk** — nothing here tells a driver whether a part is
failing, so the claim-safety surface is unusually clean; and it is
**visually native to the faceless format**, since the subject is literally
text molded into rubber, which reads perfectly with sound off.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "First group is the size — width, sidewall ratio, wheel diameter, like 225 60 R17" | Standardized P-metric tire sizing, a public, universally documented marking convention | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live (that would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation attached. The claim is descriptive, not diagnostic. |
| "A lower load index than the original can point to a tire that's under-rated for your car" | Same — load index is a standardized marking | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses the approved soft pattern "can point to" (`client/src/lib/facelessReelStudio.ts:580`). |
| "Mixing different speed ratings across one axle is worth checking before you buy" | Same — speed rating is a standardized marking | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). Deliberately framed as *check before buying*, not as a safety verdict. |
| No price, warranty, install-fee, or shop-policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed as a code file (read-only; not a live DB read) | **N/A — deliberately avoided.** This topic needs no business fact, sidestepping the channel gap below. |

**Claim-lint pre-check (static, against the real rule banks).** The reel copy
— narration, `captions.srt`, and all three IG/FB caption variants in §8 — was
swept by hand against **every** pattern bank exported from
`client/src/lib/facelessReelStudio.ts`, not just the diagnostic ones:

| Bank (real export name) | Lines | Result on this pack's copy |
|---|---|---|
| `FORBIDDEN_CLAIM_PATTERNS` | 545–556 | Clear — no `free`, `guarantee`, `best`, `in stock`, `you need`, `limited time`, `dangerous to drive`, exact wait time, or `warranty` in any reel copy |
| `OVERDIAGNOSIS_PATTERNS` | 558–562 | Clear — no `this means your X is bad`, no `definitely needs`, no `your X is broken` |
| `FEARMONGER_PATTERNS` | 564–567 | Clear — no doom or ticking-bomb framing (this topic has none available) |
| `GENERIC_MARKETING_PATTERNS` | 569–572 | Clear — no `trusted`, `experts`, `top-notch`, `one-stop shop` |
| `PRICE_CLAIM_PATTERN` | 575 | Clear — no `$`-shaped text in any reel copy. The `$` figures in §5 are the pack's own cost estimates, which are internal planning notes and never appear in the post |
| `SOFT_DIAGNOSTIC_ALLOWED` | 578–585 | Used — "can point to" (:580), "worth checking" (:582) |

**This is a manual read of the rule source, not an executed lint run** — no
Node or test runner was invoked this session, and there is no `CLAIM_LINT`
export in that file (the banks above are the real identifiers).

**Gap, stated plainly (pre-existing, not new to this pack):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` or `"social"` channel. This script doesn't lean on that
store, so the gap doesn't block this pack, but it still blocks any future
reel script wanting to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "The numbers on your tire sidewall aren't random. Three of them decide what fits." |
| 2 · SETUP | 0:04–0:10 | "First group is the size. Width, sidewall ratio, wheel diameter. Something like 225 60 R17." |
| 3 · VALUE | 0:10–0:16 | "Right after it, the load index. A lower number than the original can point to a tire that's under-rated for your car." |
| 4 · VALUE | 0:16–0:22 | "Last, the speed rating letter. Mixing different ratings across one axle is worth checking before you buy." |
| 5 · CTA | 0:22–0:28 | "Take a photo of your sidewall before you shop. Nick's Tire and Auto will read it with you. Link in bio." |

Machine-readable version (beats, per-beat visual prompts, negative prompt,
loop plan, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

> **Model-specific caution for this topic.** The subject is molded lettering,
> and generative video models cannot spell reliably. Do **not** expect a
> generated clip to render a legible `225/60R17`. Every beat prompt is written
> so the *texture and framing* of sidewall lettering carries the shot while
> the burned-in captions carry the actual characters. If a generated clip
> produces convincing-looking but wrong numerals, that is a reject, not a
> pass — this is the single most likely failure mode for this pack, and the
> reason the stock/self-shot route below is the better lane for it.

**Recommended route for this pack — real footage (self-shot or stock).**
A phone macro of an actual tire in the shop bay solves the spelling problem
outright and costs nothing. Failing that, free-stock search terms
(Pexels/Pixabay/Coverr — **search manually; no clip URLs are asserted here,
because none were verified live this run and a fabricated URL is worse than
none**):

- Beat 1: "tire sidewall macro" / "tire rubber texture closeup"
- Beat 2: "tire size marking closeup" / "tire sidewall numbers"
- Beat 3: "tire sidewall lettering macro slow pan"
- Beat 4: "tires on rack shop" / "tire stack closeup rotating"
- Beat 5: "auto repair shop bay tire" / "tire shop interior warm light"

**Fallback / actual-prod route — `template_stock`** (free, local ffmpeg, no
API spend). Per `REEL-PIPELINE.md`, this is what prod currently renders on.

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what gets
fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone,
ALL-CAPS optional per house style. **Burn in via ffmpeg's `subtitles` filter
— never as a generated in-frame element.** That rule matters more here than
in any prior pack: card 4 contains `225/60R17`, and the M10 preflight blocks
generated text precisely because models cannot spell it.

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → optional
   ambient shop room-tone → optional low "thunk" SFX under beat 5's first
   half → voiceover track → burned-in caption track → end-card CTA text
   (beat 5 only: shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order; cut hard on each beat
   boundary (no crossfade — a dissolve blurs frames together and works
   against the render-integrity gate's distinct-frame sampling).
3. **Captions:** burn in per `captions.srt`, bottom-third safe zone, sized to
   stay legible at 9:16 mobile scale. Verify card 4's `225/60R17` renders
   character-exact after burn-in.
4. **Color:** cool, slightly desaturated grade on beats 1–4 (technical,
   instructional mood); warm shift on beat 5 (CTA, inviting).
5. **Loop:** beat 5 drifts back into a sidewall macro in its final second, so
   the closing frame rhymes with the opening frame. Hold that final macro for
   roughly 0.5s before the cut so the loop reads on a replay.
6. **Output contract (must hold for the pipeline's own render-integrity
   gate, `reelAssembly.ts` #800/#801):** container duration within 0.75s of
   28s, **video-stream** duration within 0.75s of 28s (container duration can
   lie via the audio track when the video track ends early), ≥80% of the
   expected 30fps frame count, and ≥3 distinct MD5s among 5 sampled frames.
   Every beat here is a camera move — slide, push-in, track, orbit, drift —
   specifically so that last check passes on motion rather than on luck.
   Reference command shape (**not executed this run — no ffmpeg in this
   container**):
   `ffmpeg -f concat -i beats.txt -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook cross-post, `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps, AAC audio
- **Duration:** 28s (within the task's 15–60s range and the account's ~28–30s
  CTA-block convention established by prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET). Do not post ad hoc — see §5 on guardrail order if the day's feed slot
  is already consumed by the autonomous cron.
- **Caption / hashtags:** §8 below
- **CTA type:** SAVE-and-SEND hybrid. "Photo your sidewall before you shop"
  is an action the viewer takes *off* the app, which historically underperforms
  as a metric; the written caption therefore carries an explicit send prompt,
  since a SAVE-only CTA measured `saved = 0.00` across the account's first
  8 reels (finding recorded in the brakes pack in this directory).

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

**Estimated total on the actual prod-pinned route:** ~$0.06 (VO + brief only;
clips are free on `template_stock`). Operator-tunable estimate, not a metered
price — directional only.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, unreachable this run.
**Higgsfield balance** (`getHiggsfieldAccountHealth().balanceCredits`):
`UNKNOWN` — no running app to probe.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`; **not evaluated this run**): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
the daily autonomous cron (`dailyReelPost.ts`, when
`REEL_AUTOPOST_ENABLED=true`) has already consumed today's feed cap or
spacing window, this pack should wait for the next open slot rather than
force a same-day post.

---

## 6 · Audio / music rights

**No music-rights ledger exists in this repo.** This is a confirmed
capability gap noted by every prior pack, not a new finding: there is no
tracked record of asset ID, source, license scope, territory, expiry, or
organic/ad clearance for any music bed.

This pack does not paper over it — **no music bed is assigned.** The reel is
voiceover + burned-in captions + optional ambient shop room-tone and one
optional low "thunk" SFX. That also scores well on the pipeline's
muted-first requirement, since captions alone carry the full message. If the
operator wants a music bed, the rights row has to be established by hand
first; this pack does not supply one, and no track here is asserted as
cleared.

---

## 7 · QA matrix

No rendered asset exists, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | Not invoked — no running server. `brief.json` carries a hand self-estimate (57/75) that is explicitly **not** this function's output |
| Render-integrity (#800/#801: container + stream duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | Nothing rendered — no file to probe, and no ffmpeg/ffprobe in this container |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |
| Claim-safety pattern banks | `facelessReelStudio.ts:545–585` (5 banks, §3) | `PASS (manual)` | All reel copy hand-swept against every exported bank; **no linter was executed** — read this as a static review, not a green run |

---

## 8 · IG/FB copy

**Primary caption (send-oriented):**

> The numbers on your tire sidewall aren't random — three of them decide what
> actually fits.
>
> The first group is the size: width, sidewall ratio, wheel diameter.
> Something like 225/60R17.
> Right after it is the load index. A lower number than the original can
> point to a tire that's under-rated for your car.
> Last is the speed rating letter. Mixing different ratings across one axle
> is worth checking before you buy.
>
> Take a photo of your sidewall before you shop — and send this to whoever in
> your life is about to buy tires off a search result.
>
> #tires #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shortest):**

> Hook: "You've looked at these numbers a hundred times. Do you know what
> they mean?"
> Caption: Size, load index, speed rating — three markings on your sidewall
> that decide which tire you can actually put on. Buying without reading them
> is a guess.
> CTA: Photo your sidewall and bring it in. Nick's Tire & Auto, 17625 Euclid
> Ave — we'll read it with you.

**Ad-ready variant B (mistake-forward):**

> Hook: "Buying tires online by size alone? There are two more numbers on
> that sidewall."
> Caption: The size gets you close. The load index and the speed rating are
> what decide whether the tire is right for your car — and they're printed
> right there.
> CTA: Not sure what yours say? Stop by and we'll take a look.

*(Shop address and phone used in ad copy are the public, deliberately
allowlisted business contact details already used across the merged packs in
this directory — no customer PII appears anywhere in this pack.)*

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

**What still requires manual work** (the task's step 4, answered explicitly):

1. **Shoot or source the 5 beat clips** — recommended as real phone macro
   footage of a tire in the shop bay rather than generated clips, for the
   spelling reason in §4. *Manual.*
2. **Generate the voiceover** — `reelVoice.ts` at render time, or any TTS
   tool, from the exact 28s script in §4. *Manual — no TTS in this session.*
3. **Assemble and burn in captions** — in CapCut or via the ffmpeg command
   shape in §4, meeting the output contract there. *Manual — neither CapCut
   nor ffmpeg is available here.*
4. **Run the real gates** — hand the topic to
   `/api/admin/reel-canary {action:"start", topic:"reading a tire sidewall:
   size, load index, speed rating"}` so the server re-scores and re-renders
   for real, then `{action:"advance"}` to `assembled` and `{action:"qa"}`.
   *Manual, and requires a live-authorized session with a working
   `ADMIN_API_KEY`.*
5. **Post** — via Meta Business Suite or the app's human-approval door.
   *Manual, and requires an explicit live operator instruction; a scheduled
   run must never do this.*

**Why not `PRODUCTION-READY`:** the self-estimated score (57/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, on two
dimensions specifically — **sourced fact** (0/10: no `EvidenceRecord` backs
the sidewall-marking claims, and that store could not be queried live) and
**winning concept ≥57/60** (0/5: `scoreReelConcept()` was not invoked, so it
is scored zero rather than assumed passing). The **loop** dimension scores
4/5 here rather than the 0/5 every prior pack in this directory recorded,
because the CTA beat was deliberately designed to return to the opening
subject.

**Not `PUBLISHED WITH READ-BACK`** — no `reel-canary` call, no `igPostId`, no
permalink. Nothing was generated, rendered, or posted.
**Not `BLOCKED`** — the pack itself is complete and usable.

**Scope note:** this session did not merge, close, or otherwise touch any
other PR. The 6 open reel-pack drafts belong to other sessions' branches and
are the operator's call to review.
