# Reel Brief Pack — "The Penny Test" (tire tread depth)

**Status:** production-ready pack, NOT a rendered file. See "What's real vs. what's manual" below.
**Duration:** 23s (20s narrated + 3s freeze end-card) — within the 15-60s short-form window.
**Format:** faceless, hands-only, 9:16, muted-first (captions carry the story with sound off).
**Brand:** Nick's Tire & Auto, Cleveland OH. Voice patterns used: #2 anti-promise ("No upsell
script"), #1 mundane comparison ("Two seconds"). Kept to one strong line per the 1:3 ratio rule —
see `apps/nickstire/docs/brand/VOICE.md`.

---

## Why this task, and why it's a pack instead of a file

This session checked what's actually wired in this repo before producing anything:

- **ChatGPT-equivalent (script/brief generation):** yes, in effect — `reelBriefGen.ts`
  (Gemini 2.5 Flash, two-pass with a critic, 70/75-point quality gate). Not called here.
- **TTS:** yes, in effect — `reelVoice.ts` (Google Neural2 default, ElevenLabs fallback, SSML).
  Not called here — no audio was synthesized.
- **Footage generation ("Higgsfield"):** present in code, but **prod currently pins
  `REEL_VIDEO_PROVIDER=template_stock`** (the free ffmpeg/stock lane) per
  `apps/nickstire/docs/operations/REEL-PIPELINE.md` — Higgsfield was deliberately dropped
  2026-08-05/11. No clips were generated here.
- **Render (shell/ffmpeg):** `reelAssembly.ts` does trim/xfade/captions/music + a render-integrity
  gate. Not invoked here — there's no source footage or VO audio to feed it.
- **Meta posting:** `instagramAdmin.publishPost` is real and live-wired to the shop's actual
  Instagram account, gated behind manual operator approval in the admin Queue tab. This is a
  **protected, customer-facing side effect** (`AGENTS.md` → Protected operations) and this task
  is an unattended scheduled run with no operator present to approve it — so nothing was
  generated against production, enqueued as a `reel_jobs` row, or posted. That gate is not
  optional for an automated session.

So: no ChatGPT/TTS/render/posting tool was exercised, and the one path that could reach a real
customer-facing action (publish) is intentionally left untouched. Per the task's own fallback
rule, this is the production-ready **pack**, not a claimed finished video.

**Fastest path to an actual rendered file:** paste the brief below into the Studio wizard
(`/admin` → Growth → Instagram → Studio → Advanced Reel Studio) and let the real pipeline run —
it already has Gemini, TTS, the free ffmpeg render lane, and the render-integrity gate wired up.
An operator still has to hit Approve before anything reaches Instagram.

---

## 1. Script — word-for-word, timed

VO style: Google Neural2 (or ElevenLabs) conversational read, ~2.2-2.5 words/sec, `<break
time="150ms"/>` between beats. Hands-only footage throughout — no faces, matches the pipeline's
faceless contract.

| Beat | Time | VO (word-for-word) | Words |
|---|---|---|---|
| 1 — Hook | 0:00–0:04 | "Stick a penny in your tread — Lincoln's head down." | 9 |
| 2 | 0:04–0:08 | "See his whole head? You're already shopping for tires." | 9 |
| 3 | 0:08–0:12 | "Head disappears in the groove? You've got life left." | 9 |
| 4 | 0:12–0:16 | "Two seconds, every wheel — we check it free, every visit." | 10 |
| 5 | 0:16–0:20 | "No upsell script. Just the depth, on camera, every time." | 10 |
| End card (silent) | 0:20–0:23 | *(no VO — on-screen text only, see §5)* | — |

Total spoken: 20.0s across 5 beats (4.00s each, matches the pipeline's per-beat clip contract).
Freeze/end-card: 3.0s (matches the storyboard contract "beats + 3s SAVE freeze" in
`REEL-PIPELINE.md`).

---

## 2. Asset list

No fabricated stock-footage URLs below — search terms/prompts only, so whoever sources footage
(Higgsfield prompt, `template_stock` free lane, or manual Pexels/Pixabay search) can produce the
real clip. All clips: 9:16, 4.00s, hands/tools only, no faces, natural daylight or shop lighting.

| Beat | Footage prompt / search terms |
|---|---|
| 1 | Close-up: hand (no face) holds a penny, inserts it into a worn tire's tread groove, Lincoln's head visible pointing down toward the rubber. Shallow depth of field, auto-shop bay background. |
| 2 | Continuation/push-in: same penny, camera tightens until Lincoln's full head is clearly visible above the tread line (illustrates "worn"). |
| 3 | Cut to a second, healthier tire: penny sinks deeper into the groove, Lincoln's head disappears below the rubber (illustrates "life left"). |
| 4 | Wider shot: gloved hands (Nick's Tire branded polo sleeve visible, no face) run a tread-depth gauge across several tires in the shop bay. |
| 5 | Hands set the gauge down; tire stays in frame; soft push-out reveals shop signage, out of focus, in the background. |
| End card | Static branded graphic: Nick's Tire & Auto logo, tagline, phone number, "SAVE THIS" prompt. Build as a still (Satori/`@nour/social-assets` `google-post`-style template, or a plain PNG) — no video generation needed for this one. |

**Music:** royalty-free instrumental bed, 90–100 BPM, light percussion, no vocals (avoids
platform copyright claims on Reels/TikTok/Shorts). Ducked to −18 dB under VO for beats 1–5, full
level under the silent end card.

---

## 3. Captions — SRT

Full file: [`tire-tread-penny-test.srt`](./tire-tread-penny-test.srt) (same directory). Styling
for burn-in: bold sans (Montserrat Bold or similar), ~68px at 1080px width, white fill, 4px black
stroke, bottom-third safe area, muted-first (video must read with sound off).

---

## 4. Editing instructions (matches `reelAssembly.ts`'s real contract)

1. Trim each of the 5 source clips to exactly **4.00s**.
2. Sequence beats 1→5 with **0.35s crossfade (xfade)** transitions between each.
3. Layer order (bottom to top): background video → background music bed (−18 dB under VO) →
   VO track (SSML, `<break time="150ms"/>` between beats) → burn-in captions (bottom-third,
   per §3 styling) → end-card static graphic (video track ends, or freeze the last frame if no
   separate end-card asset exists).
4. Hold the end card for exactly **3.00s**, silent except full-level music.
5. Export: 1080×1920, H.264, yuv420p, AAC audio, 30fps, ~15–25 Mbps.
6. Before treating any render as final, run the same forensic check the real pipeline's
   render-integrity gate uses (documented in `REEL-PIPELINE.md`):
   ```bash
   ffprobe -v error -select_streams v -show_entries stream=duration,nb_frames -of compact <file>
   for t in 1 6 12 18 21; do ffmpeg -v error -ss $t -i <file> -frames:v 1 -f md5 -; done
   ```
   Identical MD5s across the *moving* portion (beats 1–5) means a frozen/broken render — reject
   it. The frozen end card (last 3s) is expected to repeat, that's by design.

---

## 5. Posting specs

- **Primary platform:** Instagram Reels (matches this shop's live pipeline: `template_stock` →
  `instagramAdmin.publishPost` → Meta Graph API). Cross-post candidates: TikTok, YouTube Shorts —
  same 1080×1920 export works for all three.
- **Cover frame:** first frame of Beat 1 (the hook), not the end card — better scroll-stop on the
  feed thumbnail.
- **On-screen end-card text:** "Nick's Tire & Auto · Cleveland, OH · Hold your spot — link in bio"
  (uses the CTA microcopy library's "Hold a bay" pattern from `VOICE.md`).
- **Caption (post copy):**
  > Penny test, 2 seconds, every wheel. Free every visit — no upsell script. Nick's Tire & Auto,
  > Cleveland. Hold your spot before the ice does.*
  > *Unless the part has to come from Cincinnati. We'll call.
- **Hashtags:** #TireTread #TreadCheck #ClevelandOhio #NicksTireAndAuto #CarMaintenanceTips
  #TireSafety #WinterTires #AutoRepairCleveland
- **Alt text:** "Hands testing tire tread depth with a penny, then with a gauge, in an auto repair
  shop bay."
- **Geo-tag:** Cleveland, OH (shop location).
- **Suggested post time:** weekday morning (commute-adjacent), ahead of a cold snap if one is
  forecast — tread-depth content performs better as a seasonal prompt.

---

## 6. What still requires manual work

- [ ] **Generate/source the 5 footage clips** — no Higgsfield credentials or stock library were
  called from this session. Prompts are in §2.
- [ ] **Synthesize the VO audio** — no TTS engine was invoked. Script is in §1, ready for Neural2
  or ElevenLabs.
- [ ] **Render the MP4** — no render tool with real source assets was available here. Instructions
  in §4; or paste the brief into the Studio wizard and let `reelAssembly.ts` do it.
- [ ] **Build the end-card graphic** — quick job for `@nour/social-assets`'s template renderer.
- [ ] **Post to Instagram/TikTok/YouTube** — protected, customer-facing action. Requires explicit
  operator approval through the admin Queue tab (or manual upload) — never automatic.
