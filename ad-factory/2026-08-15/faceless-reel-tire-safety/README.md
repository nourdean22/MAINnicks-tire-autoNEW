# Faceless short-form video pack — "3 Tire Warning Signs" (Nick's Tire & Auto)

Scheduled content-generation run, 2026-08-15. No live operator was present to confirm a topic, so
this pack is grounded in the one subject the repo actually has ground truth for: Nick's Tire &
Auto (Cleveland/Euclid, OH) tire safety, using the existing `ServiceAlertReel` faceless-video
template already built in `packages/reel-engine`. If this isn't the intended topic, swap the
script in `script.md` — every other file (captions, asset list, edit instructions, posting specs)
is written to be topic-agnostic and works with any 30s script of the same shape.

## 1. Tool availability check (per task step 1)

| Capability | Status | Detail |
|---|---|---|
| Script/copywriting (ChatGPT-class LLM) | ✅ Available | This session (Claude) wrote `script.md` directly. |
| TTS (voiceover) | ❌ Not available | No TTS/voice-synthesis tool is connected to this session. `mcp__Adobe-for-creativity__media_enhance_speech` *cleans up* existing speech audio, it doesn't generate speech from text. No ElevenLabs/OpenAI-TTS/etc. MCP server is connected. |
| Higgsfield (AI video/motion gen) | ❌ Not available | No Higgsfield MCP or API is connected. |
| Meta posting (Reels/TikTok/IG publish) | ❌ Not available, and gated even if it were | No Facebook/Instagram/TikTok posting MCP is connected. Independent of tooling, `AGENTS.md` classifies social publishing as a **protected operation** — copy/draft only, never auto-posted, and this is an unattended scheduled run with no live operator to authorize a send. |
| Shell / render pipeline | ⚠️ Partial | No `ffmpeg` binary on this container, no stock-footage API. `@nour/reel-engine` (Remotion, in this repo) CAN render a real branded 1080×1920 H.264 MP4 for the on-screen text/graphics layer — but it renders **silent, no audio mux step exists in `render.ts`**, and its two templates default to a fixed 15s (450 frames @30fps). It does not composite voiceover or burned-in captions. |
| CapCut / video editor | ❌ Not available | No CapCut integration; this is a manual step for the operator (or Adobe Express, see below). |
| Adobe Express / Creative Cloud tools | ✅ Available (partial fit) | `mcp__Adobe-for-creativity__*` can resize/quick-cut/render video and generate/edit images, but has no text-to-speech and no stock-footage search — it can assemble a video from assets you already have, not originate voiceover or licensed b-roll. |
| Static image generation | ✅ Available | `mcp__huggingface-skills__gr1_z_image_turbo_generate` (image only, no motion) could produce the background stills listed in `asset-list.md` if the operator wants AI-generated stills instead of stock/branded-graphic backgrounds. |

**Conclusion:** voiceover generation and licensed stock footage sourcing are hard blockers to an
end-to-end rendered MP4 with VO + captions. Per task step 5, this defaults to the **production-ready
pack** below rather than claiming a finished video exists. No video file has been rendered in this run.

## 2. What's in this folder

| File | Contents |
|---|---|
| `script.md` | Word-for-word narration, timed to the second, VO direction, on-screen text per beat |
| `captions.srt` | Standard SRT caption file matching the script timing exactly |
| `asset-list.md` | Background footage/image sources (stock + AI-gen prompts), music track picks, on-brand asset notes |
| `editing-instructions.md` | Layer order, transitions, timing, both a CapCut manual path and a code path via the existing `@nour/reel-engine` templates |
| `posting-specs.md` | Platform dimensions, hashtags, metadata, and the manual-posting gate |

## 3. What still requires manual work

- **Generate the voiceover audio** — feed `script.md` into any TTS tool (ElevenLabs, Play.ht, or a
  human VO read) to produce the audio track. Not done here — no TTS tool is connected.
- **Source or license the background footage/images** — either from the stock links in
  `asset-list.md`, or by rendering `ServiceAlertReel`/a new reel-engine composition, or by
  generating stills via the HuggingFace image tool. Not done here.
- **Assemble the final cut** — in CapCut (or Adobe Express, Premiere, etc.) per
  `editing-instructions.md`. Not done here — no CapCut/editor is connected to this session.
- **Render the final MP4.** Not done here.
- **Post to any platform.** Protected operation — requires an explicit, live operator instruction
  every time per `AGENTS.md`; not authorized by this scheduled run.
