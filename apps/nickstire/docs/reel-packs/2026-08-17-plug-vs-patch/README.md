# Reel production pack — "A plug is not a patch" (tire puncture repair)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TIRES**
(closest fit in the approved bank — see §1 note)

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s + 3s SAVE freeze, SEND-oriented CTA, no in-frame AI-generated text).
**No generation, DB read, or publish call was made against production this run** — see §1 and §7.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt
does not count as authorization. This is a pack-only run: `INTELLIGENCE` (topic research + scoring)
+ `PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — not probed, stated as such rather than assumed:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — this session is a GitHub-scoped code checkout, not attached to the Railway deployment; no `HIGGSFIELD_*` credential, `ADMIN_API_KEY`, or `DATABASE_URL` reachable here |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` last documented prod pinned to `template_stock`; not re-read live this run |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if the daily cron has `REEL_AUTOPOST_ENABLED=true`, it may already have posted today independent of this pack |
| `/api/admin/reel-canary` | **NOT AVAILABLE** — no admin key present in this session |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** |
| Higgsfield (clip generation) | **NOT CONNECTED** |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — a protected customer-facing action per root `AGENTS.md`, requiring a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | Not attempted — `reelAssembly.ts`'s real pipeline claims a job row against the **production** TiDB database; running it here risks claiming a live job from an unattended session |
| CapCut | **NOT INTEGRATED** — no connector exists in this session |

Net: nothing on the requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is connected
here. Per the source instructions' own fallback step ("if tools are missing, produce a
production-ready pack instead"), this run defaults to the pack.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB and this session has no live path to it. Paper substitute used
instead:

- `ls apps/nickstire/docs/reel-packs/` — 6 prior merged/tracked pack directories exist (penny-test,
  tire-expiration, tread-fingerprint, battery-summer-heat, squealing-vs-grinding-brakes, plus this
  one). None cover puncture repair.
- `gh`-equivalent PR search (`mcp__github__search_pull_requests`, `"reel pack" in:title`) — **28
  matches**, open and closed, spanning: penny test, tire expiration, sidewall bulge, tread
  fingerprint, battery, squealing-vs-grinding brakes, coolant color, spare-tire mileage,
  balance-vs-alignment, check-engine-light, wheel-bearing-hum, cabin-vs-engine-air-filter,
  "noises that mean stop driving now," repair-authorization-questions (TRUSTCHECK), pothole damage,
  tire rotation, wiper-blade check, exhaust-smoke color, strut bounce-test, oil-change intervals,
  why-car-pulls, transmission-fluid color, summer-heat tire pressure. **No existing pack or open PR
  covers plug-vs-patch tire repair** — confirmed distinct topic.
- `docs/REEL-SLATE-2026-07-31.md` — 20 planned topics, cross-checked against the PR list above.
  Two slate items remain uncovered by any pack/PR: #3 "Cold weather and the tire light" and #11
  "All-season vs winter tires" — both weak seasonal fits for an August posting date. **This pack's
  topic (plug vs. patch) is not on the original 20-item slate at all** — it is a new addition,
  chosen because it is a genuinely common driver question (gas-station/DIY plug kits are widely
  sold) that the slate never scoped, and because a real, sourced business fact anchors it (§3).
- Campaign-keyword note: the approved bank in `facelessReelStudio.ts` (`POTHOLE, TREAD, PRESSURE,
  BRAKES, SALT, BATTERY, WIPERS, ALIGNMENT, ECHECK, TIRES, SPARE, VIBRATION, PULLING, TPMS, NOISE,
  DOT, RAIN, CLUNK`) has no dedicated "repair" or "puncture" keyword. Closest fit used: **TIRES**.
  Flagging for an operator: a `REPAIR` or `PLUG` keyword may be worth adding to the bank if this
  topic family (see §2, parked concept) gets produced again.
- Archetype/motion-lens overlap, stated honestly: the battery pack (2026-08-16, most recent) used
  `myth_vs_reality` + `xray_cutaway`/`warning_light_world`/`product_ad_macro`. This pack selects
  `diagnostic_hud_reveal` + `xray_cutaway` (§4) — the archetype is fresh relative to the last pack,
  but `xray_cutaway` as a *lens* repeats. A real `calculateReelQualityScore()` repetition check
  should confirm lens spacing before an operator enqueues this — not verified live here.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **Manual estimates, not a live `calculateReelQualityScore()` or
critic-panel run** — flagged honestly in §5.

### Concept A — "A plug is not a patch" diagnostic reveal (SELECTED)

Cold open on a nail in a tread groove; a diagnostic scan-line sweeps in and flags the DIY plug-kit
assumption as incomplete, then reveals what actually seals a puncture from the inside.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 8 | 4 | 4 | 9 | **42** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting; this
still clears the floor for a "worth producing" pack, it does not clear the bar for a guaranteed
top-tier score.

### Concept B — "Can I just plug it myself?" straight Q&A (parked)

Direct-address Q&A framing, no reveal structure — states the plug-vs-patch answer immediately
instead of earning it with a scan/reveal beat. Parked because it scores lower on hook without a
meaningful safety trade-off in the other direction.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 5 | 9 | 7 | 4 | 2 | 9 | **36** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| A rope/string plug inserted from the outside seals the puncture channel but not the tire's inner liner, and can work loose or leak slowly | US Tire Manufacturers Association (USTMA) passenger/light-truck tire repair guidance — plug-only repairs are not considered a permanent, code-compliant repair | proof | not_evaluated |
| The industry-standard repair is a combination patch-plug installed from inside the tire, after the tire is removed from the rim and the inner liner is inspected | Same USTMA repair-procedure guidance | proof | not_evaluated |
| Punctures in or too close to the sidewall, or larger than roughly 1/4 inch, generally are not repairable and the tire needs replacement | Same USTMA repair-procedure guidance (size/location repair limits) | proof | not_evaluated |
| Drivers commonly assume a plug kit alone is a finished repair | Aggregated shop-floor pattern (common question at the counter, same class of pain-point framing used in prior packs) | pain_point | not_evaluated |

**`businessFacts.ts` row actually read (real file, this session):** the used-tire replacement
warranty entry explicitly states punctures are **not** covered — *"7-day limited replacement
warranty ... does NOT cover punctures, nails/screws, sidewall/impact/bead damage..."*
(`server/services/businessFacts.ts`). This is cited as color/context for why getting a repair done
right the first time matters, **not** quoted verbatim on-screen — the script states no price,
warranty term, or guarantee, staying inside the approved soft-language bank.

**No claim in this pack states a diagnosis as certain.** Every VO line uses the approved bank from
`client/src/lib/facelessReelStudio.ts` (*worth checking · can point to*) and avoids the banned
patterns in that file's lint rules (`no-you-need`, `no-this-means-bad`, `no-definitely-need`,
`no-free-claims` beyond "free check," `no-sameday-guarantee`). The script does not tell a viewer to
DIY-repair their own tire; it tells them what a durable repair actually requires and points them to
the shop for it.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **diagnostic_hud_reveal** ("Diagnostic HUD / Scan-Line Reveal"). Motion lenses:
**xray_cutaway** for the inside-the-tire reveal beats, **extreme_macro_push_in** for the hook nail
close-up, **product_ad_macro** for the finished patch-plug beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Extreme macro push-in on a nail lodged in a tread groove, a red diagnostic reticle locks onto it | — | "A plug from a gas-station kit is not a finished repair." |
| 2 · Setup | 0:02–0:05 | Scan-line sweeps down through the tread into the tire body, HUD text tags the plug path in amber | "PLUG SEALS THE HOLE. NOT THE LINER." | "It seals the hole. It doesn't seal the inside." |
| 3 · Value 1 | 0:05–0:11 | X-ray cutaway: translucent tire cross-section, the rope-style plug visible from outside, the inner liner behind it un-sealed and glowing red | "INNER LINER: STILL OPEN" | "Underneath, the inner liner stays open — that's where a slow leak starts." |
| 4 · Value 2 | 0:11–0:17 | X-ray cutaway continues, camera moves inside the tire as the liner is inspected; a proper patch is applied from the inside, sealing flush against the liner | "PATCH-PLUG: SEALED FROM INSIDE" | "A real repair goes in from the inside — tire off the rim, patch sealed to the liner." |
| 5 · Value 3 | 0:17–0:22 | Diagnostic HUD returns, scan-line sweeps across the tire showing a green "PASS" zone in the tread and a red "NO REPAIR" zone near the sidewall | "SIDEWALL PUNCTURE = NO REPAIR" | "A puncture near the sidewall isn't repairable — that tire gets replaced, not patched." |
| 6 · Value 4 | 0:22–0:25 | Product-ad macro: the finished repaired tire on a slow turntable, studio light, clean and mounted | — | "Worth checking before you trust it at highway speed." |
| 7 · CTA | 0:25–0:30 | Scan-line sweeps back to the opening nail-in-tread frame, dims to black — mirrors beat 1 (loop seam) | "SEND THIS TO WHOEVER JUST GOT A NAIL IN THEIR TIRE." then CTA card fades in | "Send this to whoever just picked up a nail." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "We inspect from the inside before we repair or replace.\nStop by — 17625 Euclid Ave, Cleveland · (216) 862-0005 · nickstire.org" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator). No real person's name
appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] A plug from a gas-station kit is not a finished repair.
[0:02–0:05] It seals the hole. It doesn't seal the inside.
[0:05–0:11] Underneath, the inner liner stays open — that's where a slow leak starts.
[0:11–0:17] A real repair goes in from the inside — tire off the rim, patch sealed to the liner.
[0:17–0:22] A puncture near the sidewall isn't repairable — that tire gets replaced, not patched.
[0:22–0:25] Worth checking before you trust it at highway speed.
[0:25–0:30] Send this to whoever just picked up a nail.
[0:30–0:33] (SAVE card, silent) We inspect from the inside before we repair or replace.
             Stop by — 17625 Euclid Ave, Cleveland · (216) 862-0005 · nickstire.org
```

Word count / pace check: ~74 spoken words across 30s of VO (beats 1–7) ≈ 148 wpm, inside the
comfortable 130–160 wpm range for a scan/reveal-paced reel VO.

### Per-beat generation prompts (Higgsfield/Seedance-style, when a real render route is connected)

Standing style kit for every beat: `"Diagnostic HUD / Scan-Line Reveal" + <lens grammar>`, cool
schematic glow, clean dark field, precise engineering aesthetic, photorealistic where not in x-ray
mode, 8K detail, one continuous controlled camera move per beat, **no on-screen text, no logos, no
faces/hands/human figures, no watermarks, no subtitles** (all overlays added at ffmpeg assembly).

1. **Hook (0.8–4s source, trim to 2s):** "Extreme macro push-in on a tire tread groove, a single
   nail lodged in the rubber, red diagnostic scan reticle locking onto the nail head, studio-grade
   macro lighting, shallow depth of field, photorealistic, 8K detail." — avoid: busy background,
   wide shot, fast camera movement.
2. **Setup (trim to 3s):** "Diagnostic scan-line sweeping downward through a tire tread cross
   section into the tire body, amber HUD tag highlighting a rope-style plug path, cool schematic
   glow, clean dark field." — avoid: film grain, bokeh, photorealistic product-ad lighting.
3. **Value 1 (trim to 6s):** "Technical x-ray cutaway of a tire cross-section, translucent layered
   rubber and liner materials, a rope-style plug visible from the outer surface, the inner liner
   behind it shown open and glowing red, cool schematic glow, engineering aesthetic." — avoid: film
   grain, bokeh, warm photorealistic lighting.
4. **Value 2 (trim to 6s):** "Technical x-ray cutaway continuing, camera moves to the interior
   surface of a tire, a flat repair patch being pressed flush against the inner liner sealing it,
   cool schematic glow, clean dark field." — avoid: hands, tools with visible human operator, film
   grain.
5. **Value 3 (trim to 5s):** "Diagnostic HUD scan-line sweeping across a full tire, green
   pass-zone highlight over the tread area, red no-repair zone highlight near the sidewall edge,
   cool schematic glow, engineering aesthetic." — avoid: film grain, photorealistic warm lighting.
6. **Value 4 (trim to 3s):** "Product-ad macro of a fully mounted tire slowly rotating on a studio
   turntable, clean rim, soft directional studio lighting, photorealistic, 8K detail, shallow depth
   of field." — avoid: dark schematic glow, x-ray elements, busy background.
7. **CTA (trim to 5s):** "Extreme macro pull-back from a tire tread groove with a nail, mirroring
   an opening push-in shot, scan-line fading to black, cool schematic glow." — avoid: film grain,
   fast camera movement, on-screen text.

### Assembly / editing instructions (CapCut or ffmpeg — matches the real render-integrity contract)

1. **Layer order (bottom to top):** background video clip → color grade LUT (cool desaturated for
   HUD/x-ray beats, warm/clean for the macro product beat) → on-screen text overlay layer (per beat,
   per the table above) → CTA card (beat 7–8) → audio (VO track + low ambient hum/synth bed, no
   licensed music track — see §6).
2. **Transitions:** hard cuts between beats 1→2→3→4→5→6 (no crossfades — matches the diagnostic-HUD
   pacing of the sample archetype); a slow pull-back/match-cut from beat 6→7 that mirrors beat 1's
   push-in, creating the loop seam; a straight cut to the static CTA card at 0:30 for the 3-second
   SAVE freeze.
3. **Timing/duration:** total runtime 33s (30s active beats + 3s freeze), matching the
   render-integrity gate's storyboard-duration contract (container and video-stream duration within
   0.75s of this contract when actually rendered).
4. **On-screen text:** burn in via ffmpeg `drawtext` (or CapCut text layer) at the timestamps in the
   storyboard table — safe zone: keep all text out of the top 12% and bottom 20% of frame (IG UI
   overlap). Font: match the account's existing brand kit (not respecified here — reuse whatever
   font/weight prior published reels used).
5. **Motion-continuity note:** every beat shares the tire-in-frame subject so the cutaway/HUD reveal
   reads as one continuous investigation rather than disconnected clips — this is the same
   anchor-then-support pattern `REEL_IMAGE_CONDITIONING` uses in the real pipeline (a screened
   reference frame passed as `--start-image` to keep the tire consistent beat to beat).
6. **Frame-count / motion floor:** if rendered through the real pipeline, this must clear the
   render-integrity gate's ≥80% expected-frame-count and ≥3 distinct sampled-frame-MD5s checks
   (i.e., every beat needs actual motion — the x-ray sweep and scan-line moves satisfy this by
   design, not a static overlay pretending to be a beat).

### Captions

See `captions.srt` in this directory — burned-in on-screen text timed to the storyboard beats
above, formatted as a standard SRT file (frame-accurate to the second).

### Posting specs

| Field | Value |
|---|---|
| Platform | Instagram + Facebook Reels (nickstire's connected accounts) |
| Aspect ratio | 9:16, 1080×1920 |
| Duration | 33s (30s content + 3s SAVE-card freeze) |
| Format | MP4, H.264, AAC audio — when actually rendered |
| Caption text (IG/FB post copy) | see §8 below |
| Hashtags | #TireRepair #TireTips #FlatTire #ClevelandOhio #NicksTireAndAuto #CarMaintenance |
| Posting slot | Per the account's held-fixed cadence in `REEL-SLATE-2026-07-31.md`: 7:00 AM ET or 2:00 PM ET |
| Campaign keyword | TIRES (closest approved-bank fit — see §1) |

---

## 5 · Credit-risk and fallback routing

No real generation call was made, so no ledger reservation exists for this run. If an operator
later enqueues this brief for real:

- **Cost estimate**, per `generationLedger.ts` `COST_ESTIMATES_USD` (operator-tunable estimates,
  not metered prices): 7 beats × `seedance_clip: $0.25` (labeled ASSUMPTION in source) = **~$1.75
  estimated**, or **$0** if `REEL_VIDEO_PROVIDER` is pinned to `template_stock` (per
  `docs/operations/REEL-PIPELINE.md`'s last documented prod value — not re-read live this run).
- **Account balance:** `UNKNOWN` — `getHiggsfieldAccountHealth()` was not queried this run; its
  `balanceCredits` field is a best-effort regex parse and can itself return `null`.
- **Daily budget cap:** `UNKNOWN` — `policy.limits.maxGenerationCostPerDayUsd` lives in the latest
  `autonomy_policy_versions` row, not read this run (no DB access).
- **Fallback routing:** `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs degrade-not-dark behavior if a
  paid provider hits a terminal verdict — live value not read this run.
- Concept score (42/60, §2) does not clear the sample rubric's informal "strong" bar on its own —
  an operator re-running this through the real `calculateReelQualityScore()` (min 70/75 to pass, a
  different point scale than this pack's manual 0–10 rubric) should treat this pack's score as a
  directional estimate, not a pass/fail result.

---

## 6 · Audio / music rights

**Real gap, stated plainly, not papered over:** this repo has no rights ledger for licensed music
beds. This script is scored assuming a **muted-first** design (per the quality-score weighting in
`facelessReelStudio.ts` — 10 of 75 points for muted-first legibility) with a low ambient hum/synth
bed under the VO, not a licensed track. If an operator wants a real music bed added, that asset
needs its own tracked license record (asset ID, source, license scope, territory, expiry,
organic/ad clearance) — **none exists for this pack, and none should be assumed cleared.**

---

## 7 · QA matrix

No real render exists, so almost every gate is honestly `BLOCKED` (never attempted) rather than
`PASS`/`FAIL`. Nothing below is inferred from a `jobId`, an exit code, or any other proxy signal —
per the skill's explicit instruction that neither counts as evidence of a finished Reel.

| Gate | Status | Basis |
|---|---|---|
| Brief quality score (`calculateReelQualityScore`, min 70/75) | `BLOCKED` | No brief was submitted through `content.generateReelBrief`/`enqueueReelJob`; this pack's §2 score is a manual 0–10-scale estimate on a different rubric, not this gate |
| Render-integrity gate (duration, frame-count, motion-MD5 checks, `reelAssembly.ts` #800/#801) | `BLOCKED` | No video was rendered; nothing to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No rendered frames exist |
| Repair routing (`repairRouter.ts`) | `BLOCKED` | No job exists to repair |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED` | No critic verdict exists to fold into a decision |
| Consolidated publish gate (`qualityGate.ts` → `evaluateReelPublishGate`) | `BLOCKED` | Never called — this run never reaches a publish-adjacent state |
| Claim entailment (`evidenceResolver.ts`) | `UNKNOWN` | Every claim in §3 is `not_evaluated`, not `supported` — stated explicitly, not silently passed |
| Repetition ledger (`getRecentReelSignals`) | `UNKNOWN` | Not queried against production DB; paper substitute in §1 instead |
| Brand-voice lint (`scripts/lint-brand-voice.ts`) | `NOT RUN` | Script content in §4 was hand-checked against the same banned-pattern list the linter enforces (§3), but the linter itself was not executed against this file this run |

---

## 8 · IG/FB copy + ad-ready variants

**Primary post copy:**

> A gas-station plug kit seals the hole. It doesn't seal what's underneath. 🔧
> Send this to whoever just picked up a nail in their tire.
> Nick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005
> #TireRepair #TireTips #FlatTire #ClevelandOhio #NicksTireAndAuto #CarMaintenance

**Ad-ready variant 1 (hook-forward):**
- Hook: "That plug kit isn't a finished repair."
- Caption: "A rope plug seals the hole — not the inner liner underneath it. A real repair goes in
  from the inside. Worth checking before you trust it at highway speed."
- CTA: "Stop by — we inspect from the inside, every time."

**Ad-ready variant 2 (question-forward):**
- Hook: "Plug or patch — does it actually matter?"
- Caption: "Yes. One seals the surface. One seals the tire. We'll show you which one you got."
- CTA: "Send this to whoever just got a nail in their tire."

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `PUBLISHED WITH READ-BACK`. This
pack is a complete script/asset-list/caption/assembly/posting-spec deliverable per the source
instructions' own fallback rule (step 5: "if tools are missing, produce a production-ready pack
instead" — read here as "ready for an operator to review and hand to the real pipeline," not as a
claim that generation or publishing already happened). Nothing was generated, rendered, or posted
this run. Manual work still required before this becomes a real Reel:

1. An operator reviews and approves (or edits) the script, prompts, and concept score in §2–4.
2. Submit the brief through the real pipeline (`content.generateReelBrief` → `enqueueReelJob`) so it
   gets a live `calculateReelQualityScore()` result and a real repetition-ledger check — **do not
   render outside that path**, since this session has no verified route that avoids claiming a
   production job row.
3. Render, then run the render-integrity gate and rendered QA critic — both `BLOCKED` here, both
   mandatory before any publish consideration.
4. Publish only with a live, in-the-moment operator instruction — never from a scheduled firing.
