# Editing instructions — "3 Tire Warning Signs"

Two paths, pick one. Path A needs no code and is the fastest for a one-off. Path B reuses this
repo's existing `@nour/reel-engine` Remotion templates and is worth it if this shop wants to produce
this style of reel repeatedly.

## Path A — CapCut (or any timeline editor), manual

**Canvas:** 1080×1920 (9:16), 30fps, H.264 export, 32s total.

**Layer order (bottom to top):**

1. **Background video/image track** — the b-roll clip for the current beat (see `asset-list.md`),
   cropped/zoomed to fill 1080×1920 vertically. Apply a subtle Ken Burns zoom (105%→100% over each
   beat) to keep static stock shots feeling alive.
2. **Dark gradient overlay**, bottom third only, ~40% opacity black-to-transparent — sits under the
   caption text so white captions stay readable over any background.
3. **On-screen text card layer** — the bold headline text per beat from `script.md`'s "On-screen text"
   column. Large, high-contrast, centered upper-third or as a lower-third card per beat (see timing below).
4. **Burned-in caption layer** — import `captions.srt` directly (CapCut: Text → Auto captions → or
   Import subtitle file). Bottom-center, large sans-serif, white text with black stroke/shadow for
   readability with no background box needed.
5. **Logo/watermark** — small, bottom corner, low-opacity, entire runtime.
6. **Audio: VO track** — full volume, entire runtime, once generated per `script.md`.
7. **Audio: music track** — ducked to ~20% under VO, entire runtime, fade in over first 0.5s and
   fade out over the last 0.5s.
8. **Audio: SFX** — whoosh/ping hits, see `asset-list.md`.

**Timing / transitions (cut on these exact marks to stay in sync with VO + captions):**

| Cut point | Transition | Notes |
|---|---|---|
| 0:00 | Hard cut in | Text card "3 SIGNS..." pops in with a quick scale+fade (0.2s) |
| 0:03 | Whip-pan or hard cut | New b-roll clip, new text card "1. THE PENNY TEST" |
| 0:08 | Hard cut | "2. SIDEWALL CRACKING" |
| 0:13 | Hard cut | "3. SPEED VIBRATION" |
| 0:19 | Hard cut, slight punch-in zoom | "1 OF 3 = ROADSIDE RISK" — this is the emotional peak, hold the punch-in |
| 0:24 | Hard cut | "FREE TIRE CHECK — NO APPOINTMENT" |
| 0:29 | Hard cut to end card | "NICK'S TIRE & AUTO — LINK IN BIO", hold on end card through 0:32 with a call-to-action arrow/tap animation |

Keep every transition a hard cut or a fast whip-pan — no slow crossfades. Short-form retention drops
sharply on anything that reads as "slow," and this format is built to be watched at 1x with sound on.

**Export settings:** H.264, 1080×1920, 30fps, target bitrate 8–12 Mbps (platforms re-compress anyway,
but starting high avoids compounding artifacts), audio AAC 128kbps, target file size under 50MB
(well within any platform's limit at this bitrate/duration).

## Path B — code path via `@nour/reel-engine` (this repo)

`packages/reel-engine` already renders a 1080×1920 branded template
(`ServiceAlertReel` in `packages/reel-engine/src/compositions/ServiceAlertReel.tsx`) with matching
visual language (pulsing warning triangle, banner entrance, scrolling ticker). It's a good fit for
reusing as the graphics/text layer of this reel, with caveats:

- `renderReelVideo()` in `packages/reel-engine/src/render.ts` calls Remotion's `renderMedia` with
  **no audio input** — there's no VO/music mux step. Adding one means passing an `audio` prop through
  to a Remotion `<Audio>` component in the composition, or muxing audio onto the rendered silent MP4
  as a separate post-process step (e.g. with `ffmpeg -i video.mp4 -i vo.mp3 -i music.mp3 ...` — no
  `ffmpeg` binary is present in this container, so that step would run wherever the render actually happens).
- Both existing compositions (`ReviewVideoReel`, `ServiceAlertReel`) are hardcoded to
  `durationInFrames={450}` (15s @30fps) in `packages/reel-engine/src/RootComposition.tsx`. This
  script needs 32s (960 frames @30fps) — would need either a new composition or a duration override
  exposed through `inputProps`.
- Captions are not burned in by any existing composition — would need a new `<Sequence>`-based
  caption layer inside the composition, driven by the same beat timings as `captions.srt`, or captions
  burned in during the CapCut/editor pass after render.
- This wasn't attempted in this session (no VO audio exists yet to render alongside, and it's a
  real code change to a shared package rather than a content-pack artifact) — flagging as the
  higher-leverage option if this shop wants to produce more than one of these.
