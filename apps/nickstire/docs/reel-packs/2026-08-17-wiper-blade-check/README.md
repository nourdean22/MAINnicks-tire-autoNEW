# Reel production pack — "Your wipers aren't broken, they're worn"

Scheduled faceless-video run · 2026-08-17 · mode: **INTELLIGENCE/PRODUCTION (no render route this session)**

> **Read this first:** this session (a docs/coding session, not the running nickstire
> server) has no path to call `/api/admin/reel-canary`, no `ADMIN_API_KEY`, and no live
> Higgsfield/ffmpeg render environment. Per `nickstire-reel-operator`'s explicit fallback
> rule, that means **produce the full pack, do not fake a render**. Nothing below is a
> finished MP4. Final status: **READY FOR HUMAN APPROVAL** (see §9).

---

## 0. Backlog flag — read before adding a 15th open PR

At the time this pack was written, **14 open draft PRs** already sit unmerged in this repo,
all titled `reel production pack`, most opened by this same scheduled task within the last
~13 hours (`#1614`–`#1627`, roughly hourly since 2026-08-16 22:38). Only 5 packs have ever
been merged (`2026-08-14-penny-test`, `2026-08-14-tire-expiration`,
`2026-08-15-tread-fingerprint`, `2026-08-16-battery-summer-heat`,
`2026-08-16-squealing-vs-grinding-brakes`). Nobody is reviewing or merging as fast as the
schedule is firing. This run checked both the merged-pack directory and open PRs before
picking a topic (per the skill's collision-avoidance step) and chose **wiper blades**,
which does not overlap any of the 19 topics already in flight or merged. But the operator
should know the queue is growing faster than it's being cleared — worth either slowing the
schedule interval or batching a merge pass.

---

## 1. Capabilities and context (receipt point 1)

| Check | Result |
|---|---|
| ChatGPT-equivalent (script authoring) | Available — this session wrote the script below |
| TTS | **Not available** in this session — no TTS tool connected |
| Higgsfield (paid AI video) | **Not reachable** — no live `getHiggsfieldAccountHealth()` read possible from this session; separately, prod's own `REEL_VIDEO_PROVIDER` is documented as pinned to `template_stock` (free local ffmpeg lane), not Higgsfield, as of 2026-08-11 (`apps/nickstire/docs/operations/REEL-PIPELINE.md:32`) |
| Meta/IG posting | **Not available** — no posting tool connected, and this is a scheduled (non-live) run, so publishing would be blocked by policy even if a tool existed |
| Shell/render (ffmpeg) | Bash is available, but there is no source footage, no rendered voice track, and no path to `/api/admin/reel-canary` in this session — nothing to assemble |
| CapCut or similar | Not available |
| Repetition ledger (`getRecentReelSignals`) | **Not read** — no live DB access from this session (prod TiDB, and a live read/write here would be a protected operation anyway). Substituted: manual check of `apps/nickstire/docs/reel-packs/` (merged) + `gh`/GitHub search for open "reel pack" PRs (§0) |
| `REEL_GENERATION_ENABLED` | Not verifiable this session — treat as `UNKNOWN` |

**Conclusion: no motion route this session.** Per `nickstire-reel-operator`, output is the full production-ready pack below, not a claimed render.

## 2. Candidate concepts and scores (receipt point 2)

Scored 0–5 on: hook strength, sourced-fact solidity, visual availability (stock/generatable), claim safety, loop potential.

| Concept | Hook | Fact | Visual | Safety | Loop | Total /25 | Status |
|---|---|---|---|---|---|---|---|
| **Wiper blade wear — streak/chatter vs. actually failing** | 4 | 3 | 5 | 5 | 3 | **20** | **Selected** |
| Power steering fluid leak signs | 3 | 3 | 3 | 4 | 3 | 16 | Parked — weak visual variety without hands/engine-bay close-ups that risk the no-hands rule |
| Headlight yellowing / restoration | 3 | 2 | 4 | 4 | 3 | 16 | Parked — cosmetic framing risks reading as an upsell, not a safety hook |
| AC not blowing cold before a trip | 4 | 2 | 3 | 4 | 2 | 15 | Parked — heat/summer angle already heavily used this week (`battery-summer-heat`, `summer-heat tire-pressure`) |

Wiper blades wins on visual availability (rain-on-glass, streaking, cracked rubber close-up are all standard stock/generatable footage) and claim safety (no price, no diagnosis-at-a-distance claim, clean fit to the approved soft-language bank) without repeating this week's heat/tire themes.

## 3. Claim evidence (receipt point 3)

- **No `business_facts` row was used.** `FactChannel` in `apps/nickstire/server/services/businessFacts.ts` is currently `"sms" | "voice" | "web"` only — there is no `"reel"`/social channel clearance. Per the skill's own rule, that's treated as `BLOCKED` for public-video use, not an implicit yes. Nothing in this script quotes a business_facts value.
- **No `EvidenceRecord` was read** — no live DB access this session, so `entailment` status is `UNKNOWN` for every mechanical claim below, not `"supported"`.
- Every claim in the script is therefore phrased as **general automotive-safety guidance**, using only the pre-approved soft-language bank from `client/src/lib/facelessReelStudio.ts` (*can point to · may indicate · worth checking · one clue · do not guess · stop by and we'll take a look*) — no specific interval claimed as fact, no price, no guarantee, no "always/never."
- **Local/weather claim:** none made. The script does not assert current Cleveland weather or season — it references heat/UV generically as a known wear mechanism for rubber, not as a live condition.

**Explicit UNKNOWNs:** exact wiper-replacement interval (industry range is commonly cited as 6–12 months, but that figure is not sourced from this repo's evidence store, so the script hedges it as "most shops say" rather than asserting it as this shop's claim); whether Nick's Tire currently stocks/installs wiper blades as a discrete line item (not present in `SEED_FACTS` — omitted from the CTA, which stays generic "stop by, we'll take a look" rather than naming a service or price).

## 4. Production pack — selected concept

### Script (word-for-word, timed)

Total runtime: **30s**. Structure = 5 narration beats + a 3s SAVE freeze end card, matching the render-integrity contract (`reelAssembly.ts` "#800/#801": container duration within 0.75s of storyboard, ≥3 distinct frame hashes proving motion in every beat before the freeze).

| # | Time | VO (word-for-word) | Words | Pace |
|---|---|---|---|---|
| 1 (HOOK) | 0:00–0:04 | "If your wipers are smearing instead of clearing, that's not just rain." | 12 | 3.0 wps |
| 2 | 0:04–0:09 | "Cracked, hardened rubber can't hold an edge — it drags instead of wiping clean." | 13 | 2.6 wps |
| 3 | 0:09–0:14 | "Chattering or skipping across dry glass is often that same worn edge." | 12 | 2.4 wps |
| 4 | 0:14–0:19 | "Most shops say six months to a year, but heat and UV wear rubber faster." | 14 | 2.8 wps |
| 5 | 0:19–0:27 | "One clue: a hairline crack, or a rough, glazed edge instead of a clean line — worth checking before the next storm." | 20 | 2.5 wps |
| SAVE (freeze) | 0:27–0:30 | "Stop by and we'll take a look." (on-screen text on the end card; VO optional/low, muted-first design assumes silent playback) | 7 | — |

**Muted-first check:** every beat's meaning survives with sound off — beat 1's smear-across-glass visual carries the hook alone, and captions (§captions.srt) carry 100% of the VO. Loop point: the end card cuts cleanly back to the beat-1 streak shot, so autoplay looping doesn't show a hard freeze-to-black jump.

### Per-beat visual — two lanes, because prod's live render route and the spec's requested route disagree

**Lane A — what prod actually renders on (`REEL_VIDEO_PROVIDER=template_stock`, free local ffmpeg lane):** stock footage search terms, no generation prompt needed.

| Beat | Stock footage search terms | Notes |
|---|---|---|
| 1 | "windshield wiper streaking rain glass close up", "wiper blade smear windshield" | Wide-to-medium, muted-first legible |
| 2 | "cracked wiper blade rubber macro", "worn wiper blade close up" | Extreme close-up, side-lit to show the crack line |
| 3 | "wiper blade skipping juddering windshield POV" | Interior POV looking through windshield, no driver visible in frame |
| 4 | "sun glare parked car windshield timelapse", "hot sun car exterior daytime" | Establishes UV/heat as the wear cause without a weather claim |
| 5 | "rain streaking windshield wiper night traffic blur" | Wide shot, headlight bokeh, no faces/plates in focus |
| SAVE | Static end-card graphic (built in post, not stock footage) | Shop-neutral card: text + CTA, no logo asset currently in this pack |

**Lane B — if/when a paid generative route (Higgsfield/Seedance) is armed,** standing negative prompt applies to every beat: `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.

| Beat | Generation prompt |
|---|---|
| 1 | "Rain streaking down a car windshield at dusk, wiper blade dragging a visible smear across the glass instead of clearing it, close-to-medium shot, moody blue-grey lighting, no people, no text" |
| 2 | "Extreme macro shot of a cracked, hardened rubber wiper blade edge, side-lit to reveal the crack line and glazed texture, shallow depth of field, no people, no text" |
| 3 | "POV from inside a car looking through the windshield, a wiper blade juddering and skipping across dry glass, daylight, no driver or hands visible, no text" |
| 4 | "Timelapse-style shot of harsh sun moving across a parked car's windshield, heat shimmer visible, no people, no text" |
| 5 | "Wide shot through a rain-streaked windshield at night, oncoming headlights softly blurred, wipers mid-stroke, no people, no text" |

### Captions

See `captions.srt` in this folder — timed to the beat table above, burned-in style: bottom-third, high-contrast white-on-black-outline, max 2 lines / ~32 characters per line for 9:16 legibility.

### Assembly instructions (ffmpeg-style, matches the render-integrity contract)

1. **Trim** each beat's source clip to its exact duration from the table above (4s / 5s / 5s / 5s / 8s / 3s freeze) — no clip may run short, since the render-integrity gate checks video-stream duration against the storyboard, not just container duration.
2. **Concatenate** in beat order 1→5, then append a 3s **freeze frame** of the last frame of beat 5 (or a dedicated end-card graphic) for the SAVE card — this matches the "beats + 3s SAVE freeze" contract `reelAssembly.ts` checks for.
3. **Crop/scale** every clip to 1080×1920 (9:16), center-crop if source is landscape.
4. **Burn in captions** from `captions.srt`, bottom-third safe zone (keep clear of the last ~250px for platform UI overlap).
5. **Overlay end-card text** ("Stop by and we'll take a look — Nick's Tire & Auto") on the freeze frame only, not earlier beats (matches the no-on-screen-text-in-generated-footage rule; text lives in the post-production overlay layer, not the AI-generated clip).
6. **Audio layer:** VO track (not available this session — no TTS tool connected) ducked under a light ambient/ticking-clock-style bed if a cleared music track is available (see §6 — currently none is). If no VO exists yet, this step is the actual blocker to a finished file, not the visuals.
7. **Verify before calling it done:** ffprobe the output — container duration 30s ±0.75s, video-stream duration 30s ±0.75s (audio track must not run longer than video), ≥80% of expected 30fps frame count, ≥3 distinct MD5 hashes across 5 sampled frames per beat (motion proof, not a still).

### Posting specs

- **Platform:** Instagram Reels + Facebook Reels (cross-post)
- **Dimensions:** 1080×1920 (9:16), H.264, ≤60s
- **IG account:** `@nicks_tire_euclid` (per `docs/operations/REEL-PIPELINE.md` / `businessFacts.ts` handle) — **not posted by this run**, draft only
- **Caption (primary):**
  > Streaking instead of clearing? That's not the rain's fault. 🌧️ Worn wiper rubber drags instead of wiping — worth a quick check before the next storm. Stop by, we'll take a look. #NicksTireAndAuto #Euclid #CarCare #WiperBlades #DriveSafe
- **Hashtags:** `#NicksTireAndAuto #EuclidOhio #CarMaintenance101 #WiperBlades #WinterReady #DriveSafe`

## 5. Credit-risk and fallback routing (receipt point 5)

- Per-clip cost estimate (`generationLedger.ts` `COST_ESTIMATES_USD`, labeled ASSUMPTION in source): `template_stock_clip: $0.00` (the lane prod actually pins to) vs. `seedance_clip: $0.25`/clip if Lane B were ever armed. At 5 generated beats, Lane B would estimate **~$1.25**, Lane A **$0.00** — but neither was actually spent; this is a pre-estimate for the operator's reference, not a ledger read.
- Daily policy caps (`autonomy_policy_versions.limits`) were **not read** this session — no live DB access. Do not assume budget headroom; check the live policy row before any real enqueue.
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` is documented as **off by default** in prod — if this pack is ever run through the real pipeline on a paid provider, degrade-to-free-lane on a `PAUSE_PROVIDER` verdict is not automatic unless that flag is explicitly set.

## 6. Audio / music rights (receipt point 6)

**Real gap, not filled in:** this repo has no music-rights ledger. No asset ID, license scope, territory, or expiry can be supplied for a music bed — status is `UNKNOWN`/`BLOCKED` for any music track. VO would go through `reelVoice.ts` in the real pipeline, but no TTS tool is connected in this session, so no VO audio file exists either. **This is the actual blocker to a finished asset**, not the visuals or script.

## 7. QA matrix (receipt point 7)

| Gate | Result | Basis |
|---|---|---|
| Motion-first quality score (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — this pack was authored outside the app; no client/server call made |
| Render-integrity gate (`reelAssembly.ts` #800/#801) | `UNKNOWN` | No file was rendered; nothing to probe |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | Requires a rendered file, which does not exist |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job row exists to evaluate |
| Claim-safety wording check | `PASS` (manual) | Script uses only the approved soft-language bank (§3); no price, no guarantee, no diagnosis-at-a-distance phrasing — verified by re-reading the script above against `facelessReelStudio.ts`'s approved list, not by running the validator |
| Repetition check vs. existing packs | `PASS` (manual) | Checked `apps/nickstire/docs/reel-packs/` (5 merged) + open PR titles (14 open, §0) — no topic overlap with "wiper blades" |

## 8. IG/FB copy + ad-ready variants (receipt point 8)

**Organic caption:** see §4 posting specs.

**Ad variant A (problem-first hook):**
- Hook: "Your wipers aren't broken. They're just worn out."
- Caption: "Streaking and chattering usually means the rubber edge is cracked or glazed — not that your wipers need force. Worth a 2-minute check before your next rainy drive."
- CTA: "Stop by — we'll take a look, no charge to check."

**Ad variant B (curiosity-first hook):**
- Hook: "One thing most drivers never check until it's raining."
- Caption: "A hairline crack in your wiper rubber won't show until the glass is wet and you can't see. Heat and sun age that rubber faster than most people think."
- CTA: "Swing by Nick's Tire & Auto — quick check, no appointment needed."

## 9. Final status

**READY FOR HUMAN APPROVAL.**

Not `PRODUCTION-READY` — no VO audio, no rendered file, no cleared music exist yet (§6 is the
real blocker). Not `BLOCKED` outright — script, shot list, captions, assembly instructions, and
posting copy are complete and internally consistent. Not `PUBLISHED WITH READ-BACK` — nothing
was posted; this is a scheduled, non-live run and publishing is a protected operation that
requires an explicit live operator instruction every time, which this run does not have.

**Next manual steps** (explicitly labeled, since none of these happened here):
1. Source or license the 6 stock clips in Lane A (or arm a generative route and use Lane B prompts).
2. Generate VO audio via a TTS tool (**not available this session**) reading the script in §4 verbatim.
3. Clear a music bed or run VO-only (no cleared track currently identified, §6).
4. Assemble per the ffmpeg steps in §4, verify against the render-integrity checklist.
5. Render in CapCut or ffmpeg — **manual, not performed here.**
6. Post via Meta Business Suite / the app's `instagramAdmin.publishPost` door — **manual, requires an explicit live operator go-ahead, not performed here.**
