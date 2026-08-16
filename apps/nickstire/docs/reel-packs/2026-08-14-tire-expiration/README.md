# Reel production pack — "Tires have an expiration date" (2026-08-14)

> Full shot-by-shot production pack for **slate item #6** in
> [`REEL-SLATE-2026-07-31.md`](./REEL-SLATE-2026-07-31.md) (caption already
> brand-voice-approved). That slate has captions only; this doc adds the
> timed script, real asset candidates, caption burn-in timing, editing
> instructions, and posting spec so the item is ready to hand to the
> existing pipeline in [`REEL-PIPELINE-HANDOFF.md`](./REEL-PIPELINE-HANDOFF.md).
> **No video was rendered and nothing was posted — see "Tool check" below.**

## 0. Tool check (this session)

| Tool | Needed for | Status this session |
|---|---|---|
| Script/creative direction | Beats, hook, VO copy | ✅ done below (Claude, not ChatGPT — same job) |
| TTS (Google Neural2 / ElevenLabs) | Voiceover audio | ❌ not connected — no TTS tool or API key in this session |
| Higgsfield | AI-generated B-roll | ❌ not connected — `apps/nickstire/docs/faceless-videos-v2.md`'s protocol needs it and a browser session |
| Meta Graph API posting | Publishing to @nicks_tire_euclid | ❌ not connected — also a **protected customer-facing action** per `AGENTS.md`; requires an explicit operator go-ahead every time regardless of tooling |
| Local render (ffmpeg) | Stitching/burning captions | ❌ `ffmpeg` not installed in this container |
| Adobe stock search/license | Real B-roll + music candidates | ✅ connected — used below to source real clips (search only; **not licensed**, licensing spends account credits) |
| CapCut | Manual edit fallback | ❌ desktop app, not available here |

Per the task's own rule ("don't claim a finished file exists unless you rendered it"): **no MP4 exists.** What follows is the full pack, ready for a session with the Higgsfield/TTS/hosting pipeline wired (see `REEL-PIPELINE-HANDOFF.md`) — or for manual assembly in CapCut/Premiere.

## 1. Concept

**Hook psychology:** Weaponized Intelligence / Common Enemy framing per `faceless-videos-v2.md` — this isn't a "tip," it's a warning the driver didn't know to look for. Enemy: tires that *look* fine (deep tread) but are chemically past safe use.

**Cross-domain metaphor:** Expiration (food/pharma framing) — "this isn't food, but it has a sell-by date too."

**Archetype:** The overlooked label — insider knowledge hiding in plain sight on the sidewall.

## 2. Timed script (20s, on-screen text — this account is muted-first; VO is an optional secondary layer)

Format: `beat | time | on-screen text (burned in) | camera direction | VO line (optional, same meaning, spoken)`

| Beat | Time | On-screen text (≤6-8 words, bold, brand yellow `#FDB913` on dark) | Camera / motion | VO line (word-for-word, optional layer) |
|---|---|---|---|---|
| 1 — HOOK | 0.0–1.8s | **"YOUR TIRES ARE EXPIRING."** | Whip-pan hard cut into a stack of worn tires, dim/gritty lighting, no fade-in | "Your tires are expiring." |
| 2 | 1.8–5.0s | "Tread isn't the only thing that wears out." | Push-in on a mechanic's gloved hands working a wheel, hands only, no face in frame | "Tread isn't the only thing that wears out." |
| 3 | 5.0–9.0s | "There's a 4-digit code stamped on the sidewall." | Hard cut to macro insert on a tire sidewall date-code stamp *(shop-shot needed — see §3 gap)* | "Rubber ages. There's a four-digit date code stamped right on the sidewall." |
| 4 | 9.0–13.0s | "Week. Then year. That's the birthday." | Whip pan/spin on a rolling wheel, motion blur | "First two digits are the week it was made. Last two are the year." |
| 5 | 13.0–17.0s | "Deep tread can still mean an old, unsafe tire." | Cut to wet-road tire spray, low angle, rain risk visual | "A tire with deep tread can still be too old to trust — especially in the rain." |
| 6 — LOOP OUT | 17.0–19.7s | "Go read your sidewall today." | Pull back to reframe on the same worn-tire-stack composition as Beat 1 (last 0.3s matches frame 1 for the seamless loop) | "Go read your sidewall before you drive today." |
| — | 19.7–20.0s | *(silent, matches opening frame exactly)* | Loop point | — |

Total: **20s**, within the account's proven 15–22s window.

## 3. Asset list (real Adobe Stock candidates — searched, not licensed)

Adobe Stock IDs below are real search results (`asset_search`, `entityScope: StockAsset`) from this session, listed for the operator/next session to review and license via `asset_license_and_download_stock` before use. Thumbnails only were returned; nothing was downloaded or paid for.

| Beat | Candidate | Stock ID | Note |
|---|---|---|---|
| 1, 6 (loop bookend) | "old used worn tires" | `327179475` | Best match for the gritty, unglamorous "common enemy" open the brand style wants |
| 2 | "Close-up of a car mechanic unscrewing the bolts on the wheel with an electric screwdriver at a service station" | `679250317` | Hands-only framing — crop tight to avoid any face in frame per the faceless rule |
| 3 | **GAP — no stock match found.** Searched "hand pointing tire sidewall text numbers," "macro tire sidewall," nothing returned a real DOT/date-code stamp shot. | — | **Recommend an in-house phone macro shot** of an actual sidewall date code on a shop tire — 10 seconds, iPhone macro mode, is genuinely faster and more authentic than searching further. This is the one beat that needs a real Nick's Tire asset. |
| 4 | "Spinning motorbike wheel tire." | `1303082407` | Closest spin/motion-blur texture found; a real car-wheel spin shot (in-house or Higgsfield) would read better than the motorbike substitute |
| 5 | "Rain splashing and car tire in rainwater." | `500267355` | Strong risk visual, matches brand danger framing |

**Music bed (Adobe Stock Audio, royalty-free tier searched):**

| Candidate | Stock ID | Note |
|---|---|---|
| "Into The Fire - Loop" | `676139677` | Primary pick — tense/moody, no vocals |
| "Action Hybrid Cinematic (loop 15s)" | `513025058` | Backup — more percussive, works if the cut wants harder hits on the beat changes |

**Negatives (per `faceless-videos-v2.md`):** no on-screen faces, no logos/text baked into any generated or licensed clip (all text is a separate ffmpeg overlay), no glossy/plastic renders.

## 4. Caption burn-in timing (SRT — on-screen text track)

```srt
1
00:00:00,000 --> 00:00:01,800
YOUR TIRES ARE EXPIRING.

2
00:00:01,800 --> 00:00:05,000
Tread isn't the only thing that wears out.

3
00:00:05,000 --> 00:00:09,000
There's a 4-digit code stamped on the sidewall.

4
00:00:09,000 --> 00:00:13,000
Week. Then year. That's the birthday.

5
00:00:13,000 --> 00:00:17,000
Deep tread can still mean an old, unsafe tire.

6
00:00:17,000 --> 00:00:19,700
Go read your sidewall today.
```

**Known gotcha (from `REEL-PIPELINE-HANDOFF.md`):** use half-open intervals (`gte(t,a) * lt(t,b)`) in the ffmpeg `drawtext`/ASS filter, not inclusive `between()` — inclusive bounds double-render one frame at every cut.

## 5. Editing instructions (layer order, transitions, timing)

1. **Trim** each licensed/shot clip to its beat duration from §2 (3.2–4.2s per beat).
2. **Concat** beats 1→6 in order, hard cuts only (no crossfades — "kinetic density" rule forbids soft transitions between beats; only the loop point at 19.7→0.0s should read as seamless via matched framing, not a dissolve).
3. **Layer order (bottom to top):**
   - L1: video track (concatenated beats)
   - L2: music bed (`676139677`), full duration, normalized, ducked −8dB under any VO
   - L3 (optional): VO track from §2, google Neural2 or ElevenLabs per `gen-vo.ts`, +4dB per house spec
   - L4: burned-in caption text (§4), brand yellow `#FDB913` on a semi-opaque dark plate, center-safe margins (keep clear of the bottom 15% where IG's UI overlays)
4. **Export:** 1080×1920, H.264, 30fps, `-crf 26 -vcodec libx264 -pix_fmt yuv420p -b:a 128k`. Check file size; if over 9.5MB re-encode at `-crf 28` (10MB cap, per house spec).
5. **Render each beat as a discrete file first**, then a fast `-c:v copy` mux to stitch — avoids platform render-timeout limits on longer single-pass renders (documented failure mode in the existing pipeline).

## 6. Posting spec

| Field | Value |
|---|---|
| Platform | Instagram Reels, `@nicks_tire_euclid` |
| Dimensions | 1080×1920 (9:16) |
| Duration | 20s |
| Format | MP4, H.264, 30fps, ≤10MB |
| Caption (IG post copy — already brand-voice-approved, use verbatim from the slate) | "Tread is not the only thing that wears out. Rubber ages. There is a four digit date code on the sidewall. First two digits are the week, last two are the year. A tire with deep tread can still be too old to trust. 📌 Save this and go read your sidewall. #tiresafety #cartips #clevelandohio #carmaintenance" |
| Posting slot | 7:00 AM or 2:00 PM ET (the slate's two fixed test slots — hold constant, don't add a third) |
| Facebook cross-post | **Opt out** — the existing protocol explicitly toggles this off (`[role="switch"]` containing "Facebook" → click → verify `aria-checked="false"`) |

## 7. What still requires manual work

1. **Render** — no MP4 exists yet. Needs either: (a) a session with the Higgsfield + TTS + ffmpeg pipeline from `REEL-PIPELINE-HANDOFF.md` wired, or (b) manual assembly in CapCut/Premiere from the licensed clips + this SRT.
2. **License the Adobe Stock clips** (§3) — `asset_license_and_download_stock`, spends account credits; operator call.
3. **Shoot the sidewall date-code macro** (§3 gap) — genuinely faster in-house than continuing to search stock.
4. **Voiceover** (optional layer) — `gen-vo.ts <reel> google` per the existing script, if the muted/text-only cut tests worse than expected.
5. **Publish** — customer-facing social publishing is a protected operation (`AGENTS.md`) and requires an explicit operator instruction for this specific post, every time, regardless of pipeline readiness. Post via the admin Instagram tab or Meta Business Suite once rendered.
6. **Brand-voice lint** — run `pnpm run lint:brand-voice` on the caption and on-screen text in §2/§4 before publish; the caption text is carried verbatim from the already-approved slate, but the shortened on-screen phrases in §2 are new and haven't been through the lint gate yet.
