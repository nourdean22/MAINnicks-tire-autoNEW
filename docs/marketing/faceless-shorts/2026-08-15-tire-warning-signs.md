# Faceless Short — "3 Signs You Need New Tires"

**Status: PRODUCTION-READY PACK, NOT A RENDERED VIDEO.** No finished MP4 exists. This
session has no TTS engine, no Higgsfield/video-generation tool, no stock-footage license
in hand, no `ffmpeg`/render pipeline, and no Meta-posting integration — see "Tool
availability" below. Everything a human editor needs to assemble and post the video is
in this pack; nothing here should be read as "the video is done."

No specific topic was supplied by the scheduling prompt, so this pack uses a concrete,
on-brand example — a Nick's Tire Auto educational short — as a fully worked template.
Swap the script/assets for a different topic and the rest of the pack (timing method,
layer order, posting specs) still applies.

## Tool availability (checked this run)

| Capability | Status | Notes |
|---|---|---|
| Script writing (ChatGPT-equivalent) | ✅ Available | Written by Claude below — no external LLM call needed |
| TTS voice synthesis | ❌ Not available | No TTS tool connected this session |
| Higgsfield / AI video generation | ❌ Not available | Not connected this session |
| Stock footage sourcing | ⚠️ Partial | Adobe Stock search/license tools are connected but no footage has been searched, licensed, or downloaded — search terms provided below instead |
| Shell render (ffmpeg) | ❌ Not available | `ffmpeg` is not installed in this environment |
| Adobe `video_render` (timeline compositor) | ⚠️ Partial | Tool exists but requires already-uploaded source media assets (video/audio) as input — none exist yet, so it cannot produce a real render from just a script |
| CapCut or similar NLE | ❌ Not available | Manual step — instructions below |
| Meta / social posting | ❌ Not available, and gated | No posting tool connected; even if one were, this repo's `AGENTS.md` treats social publishing as a protected operation requiring explicit operator instruction each time — draft-only by policy |

Conclusion: per the task's own fallback rule, this is the **production pack**, not a
rendered file.

---

## 1. Script — word-for-word, timed to seconds

Target pace: ~150 words/minute (natural, unhurried voiceover) + short breath pauses
between sentences. Total runtime **≈ 52 seconds** (within the 15–60s window).

| # | Timecode | Narration (read exactly as written) |
|---|---|---|
| 1 | 0:00–0:03.5 | "Your tires are trying to tell you something." |
| 2 | 0:03.5–0:07.4 | "Here are three signs it's time for new ones." |
| 3 | 0:07.4–0:09.7 | "Sign one — the penny test." |
| 4 | 0:09.7–0:12.8 | "Flip a penny upside-down into the tread." |
| 5 | 0:12.8–0:18.3 | "If you can see all of Lincoln's head, your tread is too worn." |
| 6 | 0:18.3–0:21.0 | "Sign two — cracks on the sidewall." |
| 7 | 0:21.0–0:26.9 | "Weather and age dry out rubber, and a cracked sidewall can fail without warning." |
| 8 | 0:26.9–0:33.6 | "Sign three — your car pulls to one side, or you feel a vibration at highway speed." |
| 9 | 0:33.6–0:35.5 | "That's uneven wear talking." |
| 10 | 0:35.5–0:40.6 | "Bald tires take almost twice as long to stop in the rain." |
| 11 | 0:40.6–0:42.9 | "That's not a small risk." |
| 12 | 0:42.9–0:47.6 | "If you're not sure, a free visual check takes two minutes." |
| 13 | 0:47.6–0:51.7 | "Nick's Tire Auto — stop by, we'll check for free." |

**Manual step required:** generate the actual voiceover audio from this script. Any of
the following work — pick one and record actual timestamps once rendered, since real
TTS/voice pacing will drift slightly from the estimates above:
- ElevenLabs / OpenAI TTS / Google Cloud TTS (natural voice)
- CapCut's built-in "Text to Speech" (free, fast, good enough for this format)
- A real human VO read, timed against the table above

---

## 2. Asset list

No footage has been sourced or licensed yet — these are **search terms / generation
prompts** to hand to a stock library or AI video tool, plus a free-tier-safe music
category. Do not treat any of the below as a confirmed license or a working URL.

### B-roll (one clip per script line, ~3–6s each, 9:16 vertical or 16:9 cropped to fill)

| Line | Stock search terms (Pexels / Pixabay / Storyblocks) | AI-generation prompt (if using an image/video generator) |
|---|---|---|
| 1–2 | "car tire close up rain road", "mechanic inspecting tire" | "Close-up of a worn car tire on wet pavement, cinematic, shallow depth of field, 9:16" |
| 3–5 | "penny tire tread test", "coin in tire groove" | "Hand inserting a penny upside-down into a tire tread groove, macro shot, studio lighting" |
| 6–7 | "cracked tire sidewall macro", "old tire close up" | "Extreme close-up of dry, cracked rubber sidewall texture, macro lens" |
| 8–9 | "car driving highway steering wheel", "tire vibration road" | "Interior POV of hands on a steering wheel on a highway, slight vibration motion blur" |
| 10–11 | "car braking wet road slow motion", "rain splashing tires" | "Slow-motion shot of a car's tires braking on a rain-soaked road, water spray" |
| 12–13 | "auto shop exterior sign", "mechanic waving welcome" | "Friendly mechanic in a tire shop bay giving a thumbs up, warm daylight, 9:16" |

### Music
- Category: light, upbeat, non-distracting background bed — "corporate motivational" or
  "soft ukulele/piano tech" preset, 90–100 BPM, no vocals.
- Safe royalty-free sources: CapCut's built-in sound library (licensed for export),
  YouTube Audio Library, Pixabay Music. **Manual step:** pick one track inside the editor
  — no specific track name/URL is asserted here since none has been verified this session.
- Duck music to ~-18dB under the voiceover; bring to -8dB during silent gaps.

### On-screen graphics
- Nick's Tire Auto logo (use existing brand asset from `apps/nickstire/client/public/` —
  do not regenerate).
- End-card: shop name + phone/address, pulled from the **public, already-allowlisted**
  shop contact info per this repo's PII policy — do not source customer data.

---

## 3. Caption timing (SRT)

Delivered as a companion file: **`captions.srt`** (same folder). Cards are split to
2–8 words each for short-form readability, cued to the script table above. Import
directly into CapCut/Premiere/Resolve as a subtitle track, or auto-style captions using
the timing as a reference if using CapCut's word-by-word "Auto Captions" on the real VO
track instead (recommended once real TTS audio exists — its timing will be more
accurate than these estimates).

---

## 4. Editing instructions (CapCut or equivalent NLE)

**Canvas:** 1080×1920px, 9:16, 30fps.

**Track/layer order (bottom to top):**
1. **V1 — B-roll track:** one clip per script line per the asset table, cut on the
   sentence boundary timecodes above (hard cuts only — no crossfades; short-form
   retention favors cuts on the beat/word, not dissolves).
2. **V2 — Dim/contrast overlay:** black, ~20% opacity, over B-roll only where captions
   sit, so white text stays legible on bright footage.
3. **V3 — Voiceover audio** (once rendered) aligned to 0:00.
4. **V4 — Music bed**, ducked as noted above.
5. **V5 — Captions**, bottom-third safe zone (keep clear of the bottom ~250px, which
   TikTok/Reels UI chrome covers), bold sans-serif, white with a thin dark stroke or
   drop shadow, punch-in animation per card.
6. **V6 — Logo watermark**, small, top-right corner, present for the full duration.
7. **V7 — End card** (last ~4s, lines 12–13): shop name, phone, "free visual check" CTA
   text overlay, logo centered.

**Pacing:** cut on every sentence boundary from the script table (13 cuts total). Add a
subtle zoom-in (105%→110% over the clip) on B-roll for retention — CapCut's "Zoom" or
"Ken Burns" preset.

**Manual step required:** this whole assembly step happens in CapCut (or Premiere/
Resolve/DaVinci) by a human editor, or via a video-generation tool this session doesn't
have connected. No render has been produced.

---

## 5. Posting specs

| Field | Value |
|---|---|
| Platforms | TikTok, Instagram Reels, YouTube Shorts |
| Dimensions | 1080×1920px (9:16), export at 1080p, 30fps, H.264 MP4 |
| Duration | ~52s (fits all three platforms' short-form limits) |
| Safe zones | Keep captions and CTA text inside the center 1080×1420px — top ~150px and bottom ~250px are covered by platform UI on IG/TikTok |
| Caption/description | "Bald tires cost you stopping distance, not just money. Here's how to check yours in 30 seconds. 🛞 #TireCare #CarMaintenance #NicksTireAuto #TireSafety #CarTips" |
| Hashtags | `#TireCare #CarMaintenance #TireSafety #CarTips #AutoRepair #ClevelandOhio` (swap the location tag to match the shop's actual service area) |
| Thumbnail/cover | Use the first B-roll frame (tire close-up) — Shorts/Reels don't require a separate custom thumbnail upload |
| Posting cadence | One post; no auto-scheduling configured |

**Manual step required — and policy-gated:** actually publishing to TikTok/Instagram/
YouTube. This repo's `AGENTS.md` classifies social/GBP publishing as a protected,
customer-facing side effect that requires an explicit operator instruction for that
specific post, every time — so even with a finished render, this session would stop at
a draft and would not auto-post. Post manually via TikTok Studio, Meta Business Suite
(IG/FB), or YouTube Studio.

---

## What's done vs. what's manual

| Deliverable | Status |
|---|---|
| Script (word-for-word, timed) | ✅ Done — see §1 |
| Asset list (search terms + generation prompts + music category) | ✅ Done — see §2 |
| Caption file (SRT) | ✅ Done — `captions.srt` |
| Editing instructions | ✅ Done — see §4 |
| Posting specs | ✅ Done — see §5 |
| Voiceover audio render | ❌ Manual — needs a TTS tool or human VO |
| B-roll sourcing/licensing/generation | ❌ Manual — needs Adobe Stock license or AI video tool |
| Final video assembly | ❌ Manual — CapCut/Premiere/Resolve |
| Rendered MP4 | ❌ Does not exist |
| Posting to any platform | ❌ Manual, and gated on explicit operator go-ahead |
