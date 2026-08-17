# Content pack — "The Penny Test" faceless reel

> **Correction 2026-08-17.** This document cites `HIGGSFIELD_API_KEY` as
> Higgsfield's auth mechanism, quoting a comment in `reelBriefGen.ts` as evidence.
> **That env var does not exist** — nothing in the repo reads it, and the comment
> has been corrected. Higgsfield auth is a rotating CLI *session* credential in
> `app_secret_kv`, refreshed every 15 min by `higgsfield-session-keepalive`. See
> [`docs/runbooks/higgsfield-session.md`](../../runbooks/higgsfield-session.md).
> The rest of this pack is unaffected; a comment is not a source of truth about
> configuration.


Generated 2026-08-14. **No video file was rendered.** This is a production-ready
pack, per the fallback path in the source instructions — see "Tool check" below
for exactly why, and "How this plugs into the real pipeline" for how an operator
turns it into an actual MP4.

## Tool check

| Tool the workflow asked for | Status here | Why |
|---|---|---|
| Script/brief generation ("ChatGPT") | ✅ Available | Written directly below, in the app's real `ReelBrief`/`ReelAssemblyBrief` shape (`apps/nickstire/client/src/lib/facelessReelStudio.ts`, `server/services/reelAssembly.ts`) so it's pluggable, not generic. |
| TTS voiceover | ⚠️ Exists in the app, not to me | `server/services/reelVoice.ts` calls Google Neural2 (`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`KEY`) or ElevenLabs (`ELEVENLABS_API_KEY`). No TTS tool is available to me directly, and I won't spend the app's real TTS quota from an unattended run. |
| Higgsfield (video clip gen) | ❌ Not available to me | `reelBriefGen.ts:10`: *"Reel video still needs Higgsfield (`HIGGSFIELD_API_KEY`); the brief/storyboard/caption is the value."* — confirmed by the app's own source, not an assumption. No Higgsfield tool is connected to me. |
| Meta/Instagram posting | ❌ Deliberately not used | The app has a live-publish path (`contentAdmin.generateAndPublishLiveTestReel`, `routers/content.ts:1550`) that posts to the real `@nicks_tire_euclid` account and spends real money on clip generation. Per this repo's protected-operations policy, social publishing requires an explicit, specific operator instruction every time — a stored scheduled prompt doesn't count. Not invoked. |
| Shell/render (ffmpeg) | ⚠️ Exists in the app, not usable here safely | `server/services/reelAssembly.ts` has the real ffmpeg pipeline, but it draws its inputs from a `reel_jobs` row claimed out of the **production** database (the repo's only `DATABASE_URL`) — running it for real risks claiming a live operator job. The documented safe verification path (`apps/nickstire/.claude/skills/verifier-reel-pipeline`) spins up a disposable in-memory DB and a placeholder clip; it's built for testing *code changes* to the pipeline, not for mass-producing real content, and still can't substitute for real Higgsfield clips or real TTS. Not run. |
| CapCut | ❌ Not integrated | No CapCut connector exists in this environment or the app. Manual step, see below. |

Net: nothing in this workflow's tool list (ChatGPT/TTS/Higgsfield/Meta
posting/CapCut) is something I hold direct credentials or a connected tool
for, and the one in-repo pipeline that *could* do all of this end-to-end
gates its expensive/customer-facing steps behind credentials and an explicit
operator go-ahead. Per the workflow's own step 5, defaulting to the
production pack.

## The video

**Topic:** the penny test — a 10-second, at-home tire-tread check. Evergreen,
useful muted, easy to demo, no seasonal dependency. Campaign keyword `TREAD`
(from the app's own `CAMPAIGN_KEYWORDS` list).
**Format:** 1080×1920 (9:16), 30fps, 30 seconds (27s of beats + a 3s freeze-frame CTA hold — matches the app's own `SAVE_FREEZE_SECONDS` convention).
**Style:** muted-first — every beat is understandable from on-screen text alone; voiceover is a bonus layer, not a requirement.

### Voiceover script (word-for-word, ~70 words, ~29s at 0.97x speaking rate)

> Your tires might be lying to you. Here's a ten-second check. Grab a penny, flip Lincoln upside down, and push it into the tread groove. See the top of his head? You're under two-thirty-seconds — legally bald. Tread wears uneven, so check three spots per tire: inside, center, outside. Bald tires nearly double your stopping distance on wet roads. Swing by 17625 Euclid — we'll check all four, no charge.

Brand-voice checked against `apps/nickstire/shared/voice.ts` (the kernel that
gates SMS/IG/web copy) — no kill-list hits: no "trusted," "expert,"
"quality," "premium," "reliable," "comprehensive," "hassle-free," "family-
owned," "free inspection" (says "no charge" / "check," which the kernel
explicitly prefers), etc.

### Storyboard / caption timing (10 beats, 3s each)

Full machine-readable version: [`2026-08-14-penny-test-reel.brief.json`](./2026-08-14-penny-test-reel.brief.json)
— this is a valid `ReelAssemblyBrief` payload (matches `server/services/reelAssembly.ts`'s
`ReelAssemblyBrief` interface and the Studio's `ReelBrief` shape). An operator
who wants the real MP4 can hand this straight to the Faceless Reel Studio /
`reelBriefGen` flow instead of retyping it.

SRT (burned-in caption text, already uppercased to match the shipped style):
[`2026-08-14-penny-test-reel.srt`](./2026-08-14-penny-test-reel.srt)

| # | Time | On-screen text | Visual (Higgsfield generation prompt) |
|---|---|---|---|
| 1 | 0:00–0:03 | YOUR TIRES ARE LYING | Extreme macro, low push-in on worn tread, harsh shop light, no faces/logos/text-in-shot |
| 2 | 0:03–0:06 | GRAB A PENNY | Top-down macro, hand holds a penny over tread, blurred shop background |
| 3 | 0:06–0:09 | FLIP LINCOLN UPSIDE DOWN | Macro, penny flipped head-down toward tread |
| 4 | 0:09–0:12 | PUSH INTO THE GROOVE | Macro, fingertip presses penny into groove |
| 5 | 0:12–0:15 | SEE ALL OF HIS HEAD? | Extreme macro, full head visible above rubber |
| 6 | 0:15–0:18 | THAT'S BELOW 2/32 — BALD | Macro pulled back, wear band visible across tread |
| 7 | 0:18–0:21 | CHECK 3 SPOTS PER TIRE | Medium shot, penny test moved across inner/center/outer tread |
| 8 | 0:21–0:24 | WET ROADS = 2X STOPPING DISTANCE | Slow-mo, low angle, tire rolling through a wet patch |
| 9 | 0:24–0:27 | 17625 EUCLID — CHECK ALL 4, NO CHARGE | Wide shop-exterior shot, golden hour, no AI-rendered signage text |
| 10 | 0:27–0:30 | SAVE THIS (freeze-frame hold on beat 9, no new clip) | — |

### Caption styling (matches the app's real `drawtext` config in `reelAssembly.ts`, so an editor can reproduce it exactly)

- Font: **Anton** (bold display face — `packages/social-assets` ships it; fallback to a heavy uppercase sans if unavailable)
- Color: `#FDB913` (brand gold) text, black 6px border/stroke
- Background: black box behind text at 60% opacity, 28px padding
- Position: centered horizontally, lower-third band; final "SAVE THIS" card sits near the top (12% from top) at 72px
- Case: **UPPERCASE always** — captions are auto-uppercased in production; write mixed case in source, let the renderer transform it
- Wrap: max 2 lines, ≤20 characters/line where possible; the renderer auto-balances longer lines
- Size: 64px for short punchy lines (≤14 chars), stepping down to 44px for longer ones (≥28 chars) — see beat 9, which is long and should render at the smaller end
- Safe zone: keep text within the center 82% of the 1080px frame width so nothing clips on any device crop

### Editing instructions (manual, e.g. CapCut/Premiere/DaVinci — or the layer order to hand an editor)

1. Import 9 vertical clips (or AI-generated 4s clips trimmed to 3s each) in the order above; sequence them back-to-back, no transitions (hard cuts read best muted, and match the shipped style — no crossfades).
2. Scale/crop every clip to fill 1080×1920 (`force_original_aspect_ratio=increase` then center-crop) — never letterbox.
3. Lay the voiceover track under the full 27s of beats; it does not need to be trimmed to individual beats — it plays once as a continuous read.
4. Add a instrumental background bed under the VO, ducked ~-12dB under narration, full volume during the silent 3s freeze at the end.
5. Burn in the caption for each beat per the SRT/styling above, timed to that beat's 3-second window.
6. On the last frame of beat 9 (17625 Euclid shot), freeze it for 3 seconds and overlay "SAVE THIS" per the styling above — no new footage needed for this segment.
7. Export H.264, 1080×1920, 30fps, target ≤4:3 aspect never (must stay 9:16) — matches the app's own `renderMedia` output contract.

### Posting specs

- **Platform / handle:** Instagram Reels, `@nicks_tire_euclid` (also cross-postable to Facebook, `facebook.com/nickstireeuclid`, per `BUSINESS.sameAs`)
- **Dimensions:** 1080×1920 (9:16), MP4, H.264, ≤60s
- **Caption:** "10-second tire check anyone can do at home. If you can see the top of Lincoln's head, it's time. Swing by — we'll check all four, no charge."
- **Hashtags (≤5, Instagram's real cap):** #ClevelandOH #TireSafety #PennyTest #EuclidAve #WalkInShop
- **Location tag:** Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112
- **Post via:** Meta Business Suite (manual) — the app's own auto-poster (`publishToSocial`) exists but is a protected, customer-facing action that needs a specific operator go-ahead per run, not a scheduled default.

## How this plugs into the real pipeline (for the operator, not run here)

1. Feed `2026-08-14-penny-test-reel.brief.json` into the Faceless Reel Studio (or `reelBriefGen`) as a hand-authored brief, or use it as a reference to check what the LLM generator produces for `campaignKeyword: "TREAD"`.
2. Generate the 9 Higgsfield clips from the `visual` prompts (requires `HIGGSFIELD_API_KEY`).
3. Let `assembleReel()` run for real against a real `assets_ready` job (requires Google/ElevenLabs TTS creds) — this is the step that needs the production DB and should only run through the normal cron/job flow, not an ad hoc script.
4. Review the rendered MP4 before publishing.
5. Publish manually via Meta Business Suite, or authorize the app's `publishToSocial` step explicitly for this one run.

**Manual work required, explicitly:**
- Render in Higgsfield + the app's ffmpeg assembly (or CapCut, using the editing instructions above, if going fully manual).
- Generate real TTS audio (Google Neural2/ElevenLabs) or record a human voiceover.
- Review the finished MP4 for accuracy and brand fit.
- Post via Meta Business Suite (or explicitly authorize the app's autoposter for this one reel).
