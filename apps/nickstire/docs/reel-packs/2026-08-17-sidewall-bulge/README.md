# Reel production pack — "Tire sidewall bulge / bubble" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · off-slate topic (not one
of the 20 items in [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md)
— same precedent as the 2026-08-15 tread-fingerprint pack)

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that
repetition-ledger/quality-score reads against the live database are
themselves a production read, not a free action. This session made none of
those calls. See §1 and §9.

**Backlog note, disclosed here rather than left implicit:** at the time of
this run, 22 prior scheduled runs of this same task had each produced a pack
and a draft PR that remains open and unmerged (`gh`/GitHub PR list, checked
before picking this topic — see §1). This pack was still produced because
that is what the scheduled task asks for each firing, but the accumulation
itself is worth an operator's attention independent of this pack's content.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + credentials; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` (last verified 2026-08-11) states prod is pinned to **`template_stock`** — the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead,
checked the two file-based records the skill instructs:

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs: penny test, tire
  expiration, tread fingerprint, battery-summer-heat,
  squealing-vs-grinding-brakes. None is a sidewall-damage topic.
- Open draft PRs with "reel pack" in the title (`list_pull_requests`,
  state=open) — **22 open**, covering: road-salt brake-line corrosion,
  road-trip pre-check, serpentine-belt squeal, tread-depth rain-vs-snow,
  plug-vs-patch repair, transmission-fluid color, pothole damage, wiper
  blades, tire rotation, exhaust-smoke color, strut bounce-test, summer-heat
  tire pressure, oil-change intervals, why-car-pulls, repair-authorization
  questions, "noises that mean stop driving now", cabin-vs-engine air
  filter, coolant color, spare-tire mileage, balance-vs-alignment,
  check-engine-light, wheel-bearing-hum. None is sidewall-bulge either.

This is a file/PR-listing check, not a substitute for the real ledger — a
rejected brief that never got a pack written would not show up here, so
treat "not found" as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

The 20-item slate is now almost fully covered (merged or open-PR) except a
few winter-seasonal items deprioritized as premature in mid-August. Rather
than force a 21st variation of an already-covered slate item, this run
scored fresh off-slate candidates for a genuinely new hook, same discipline
as the tread-fingerprint pack:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Sidewall bulge/bubble | Strong — visually alarming, universal "is my tire about to explode" fear | Yes | No | ✅ **Selected** |
| Uneven tire wear patterns | Moderate — close to the merged tread-fingerprint pack's territory | Yes | Adjacent/overlapping | Parked (too close to existing pack) |
| TPMS light vs. visibly low tire | Moderate — informational, lower emotional hook | Yes | No | Parked |
| Winter/all-season swap timing | Moderate — seasonal, premature in mid-August | Seasonal | Slate #11, open as "all-season vs winter" territory | Parked (seasonal + near-duplicate) |

Sidewall bulge was selected for the strongest visual first-frame (a
literal deformation in the rubber reads as "something is wrong" instantly,
satisfying the muted-first / scroll-stop weight) and because it is a
distinct failure mode from every already-packed brake/tread/battery/
pothole topic — impact-caused internal cord separation, not wear.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A bulge means the inner layers tore loose, usually from hitting a curb or a hard pothole" | General tire-industry mechanical knowledge (impact breaks/separates the internal body plies; the outer rubber can still hold air over the damaged area) — not shop-specific | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "usually" (approved soft-language pattern, `facelessReelStudio.ts`) rather than an absolute. |
| "There is no patch or plug for this — a bulge means the tire needs replacing" | Same — standard tire-safety guidance (NHTSA/tire-industry consensus: sidewall bulges are non-repairable), not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Hedged with "can" rather than a guaranteed-outcome claim. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't quote a price/warranty line, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has flagged, not a new
finding):** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — no `"reel"` channel. This script doesn't
lean on that store, so the gap doesn't block this pack, but it would block
any future reel wanting to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "That bump on your tire's sidewall isn't a warranty problem. It's a blowout waiting to happen." |
| 2 · SETUP | 0:03–0:08 | "A bulge means the inner layers tore loose — usually from hitting a curb or a hard pothole." |
| 3 · VALUE | 0:08–0:15 | "There is no patch or plug for this. A bulge like that means the tire needs replacing." |
| 4 · VALUE | 0:15–0:21 | "It can hold air for weeks, then let go without warning — especially at highway speed." |
| 5 · CTA | 0:21–0:28 | "See a bulge on your sidewall? Send this to them today. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

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

- Beat 1: "tire sidewall bulge closeup" / "tire bubble damage macro"
- Beat 2: "car hitting pothole" / "curb impact tire" (b-roll, non-graphic)
- Beat 3: "tire shop technician inspecting sidewall" (hands/faces excluded per standing negative — favor a static tire-on-rack shot instead)
- Beat 4: "highway traffic driving exterior" / "car on highway wide shot"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and M10 preflight blocks
generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/documentary tone on beats 1–2 (matter-of-fact
   inspection mood), slightly desaturated/tense on beat 3–4 (risk framing),
   warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or a
   real cut, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET
  cadence per `REEL-SLATE-2026-07-31.md` — do not post ad hoc, and check
  the day's feed-post cap/spacing isn't already consumed by
  `dailyReelPost.ts` if `REEL_AUTOPOST_ENABLED=true`
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the slate's corrected objective; a
  "save this" CTA measured `saved = 0.00` across the account's first 8 reels

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
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run
(live DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`)
is likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily
autonomous cron, this pack should wait for the next open slot rather than
force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a
new finding — same gap noted in every prior pack). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient SFX layer (quiet garage/road ambience), which also scores well on
the pipeline's muted-first requirement since the captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (61/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> That bump on your tire's sidewall isn't a warranty problem. It's a
> blowout waiting to happen.
>
> A bulge means the inner layers tore loose — usually from hitting a curb
> or a hard pothole. There is no patch or plug for this.
>
> It can hold air for weeks, then let go without warning — especially at
> highway speed.
>
> See a bulge on your sidewall? Send this to them today.
>
> #tiresafety #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That bulge in your sidewall isn't cosmetic — it's your tire's
> structure, already torn."
> Caption: No patch fixes a sidewall bulge. It can hold air for weeks, then
> fail without warning, often at highway speed.
> CTA: See one on your tire? Call (216) 862-0005 or stop by 17625 Euclid
> Ave — free look, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Ever run your hand along your tire and feel a bump that shouldn't
> be there?"
> Caption: That's a sidewall bulge — internal damage from a hard hit, and
> the only fix is a new tire. Waiting on it is the risky part.
> CTA: Not sure if what you're feeling is a real bulge? Bring it by — we'll
> tell you straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (61/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the impact/no-repair claims, and that
store wasn't queried live this run to check). Not `PUBLISHED WITH
READ-BACK` — no `reel-canary` call, no `igPostId`, nothing was generated,
rendered, or posted. Not `BLOCKED` outright — the pack is complete and
usable; an operator (or a live-authorized session) can hand it to the real
pipeline via `/api/admin/reel-canary {action:"start", topic:"tire sidewall
bulge"}`, let the server re-score and re-render for real, and only then
move toward publish.

**Separately from this pack's own readiness:** with 22 open, unmerged
reel-pack PRs already sitting in this repo before this run added a 23rd,
the operator may want to review/merge or prune that backlog, or reconsider
the firing cadence of the scheduled task producing them — this pack does
not attempt to resolve that on its own initiative.
