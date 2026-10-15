# Fit map: pattern to repo asset

Repo facts, checked 2026-10-14 against main 5aef53ae6. Line numbers drift: grep the symbol before citing.
Upstream claims live in `techniques.md`; this file holds only what this repo can and cannot do.

| Pattern | Buildable-with | Asset |
|---|---|---|
| RUNTIME_FIRST | existing | `REEL_OUTPUT_RULES` (minSeconds 15, maxSeconds 35) in `apps/nickstire/client/src/lib/facelessReelStudio.ts`. `maxClipSeconds` clamps each beat to a real clip: budget narration against it. |
| NUMBERED_BEATS, ONE_CHANGE_PER_BEAT | existing | `StoryboardBeat` (4 to 6 contiguous beats; `visual`, `motion`, `onScreenText`) in the same file. |
| PROBLEM_FIRST_ARC, CURIOSITY_GAP_HOOK | existing, copy only | Hook line plus beat 1 `onScreenText`. Keep soft phrasing; a curiosity gap never becomes fear. |
| STILL_PER_BEAT_CHECK | existing | Read the storyboard and run the QA step in `nickstire-reel-operator` before any render. The render is spend and needs a live operator instruction. |
| ONE_ACCENT | existing | `BRAND_ACCENT_RULE`, `LENS_PALETTES` in `facelessReelStudio.ts`. |
| SOUND_OFF_CAPTIONS | existing | `validateMutedFirstClarity`; `apps/nickstire/server/services/reelAssembly.ts` burns each beat's `onScreenText`. |
| LOOP_SEAM | existing | `satisfying_loop` archetype in `facelessReelStudio.ts`. |
| REAL_NUMBERS_ONLY | existing, facts BLOCKED | `validateSourceGrounding`, `detectFabricatedStats`. `FactChannel` in `apps/nickstire/server/services/businessFacts.ts` is sms, voice or web: no reel value, so a business fact in a reel is BLOCKED until cleared. No prices. |
| REVEAL_IN_ORDER_LABELLED, ONE_OBJECT_NO_CUT | needs new composition (NOT built) | Code-drawn graphics exist only as `ReviewVideoReel.tsx` and `ServiceAlertReel.tsx` in `packages/reel-engine/src/compositions/`, both fixed 15 s. No storyboard-driven code-graphics composition exists. |
| DETERMINISTIC_FRAME | no action | Render-side rule of an HTML-to-video pipeline that `docs/UPSTREAMS.md` rejects (HyperFrames row: duplicate of the Remotion reel-engine). |

Free local lane: `apps/nickstire/server/services/templateStockStudio.ts` makes ffmpeg-only moving backdrops with no text.
Text rule: `validateNoInFrameText` bans text generated inside a clip; text burned by assembly is allowed.

## Overlap verdict

Pack folders are `apps/nickstire/docs/reel-packs/YYYY-MM-DD-topic` (202 merged on 2026-10-14). Grep the topic words across that folder and the open PR titles.
- DUPLICATE: same topic and same angle already merged or open.
- NEAR: same topic, different angle or different opening line.
- NEW: no match.
