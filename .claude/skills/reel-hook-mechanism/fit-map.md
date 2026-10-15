# Fit map: pattern to repo asset

Repo facts, re-checked 2026-10-15 against main 5aef53ae6. Line numbers drift: grep the symbol before citing.
Upstream claims live in `techniques.md`; this file holds only what this repo can and cannot do.

Buildable-with values. `existing`: code in this repo does it today. `plan-only`: no code produces or checks it, so the session or operator has to; never report it as a pipeline step. `needs new composition (NOT built)`: nothing in the repo can render it.

| Pattern | Buildable-with | Asset |
|---|---|---|
| RUNTIME_FIRST | existing | `REEL_OUTPUT_RULES` (minSeconds 15, maxSeconds 35) in `apps/nickstire/client/src/lib/facelessReelStudio.ts`. 35 s is the acceptance ceiling, not what renders. `briefToSegments` in `apps/nickstire/server/services/reelAssembly.ts` clamps each beat by source (`segmentCapSeconds`): generated or undeclared 4 s (`maxClipSeconds`), a real shop clip up to its probed length (12 s max, 4 s if none was probed), a deterministic card 8 s, floor 0.8 s. Budget narration against the clamped sum plus the 3 s SAVE freeze. |
| NUMBERED_BEATS, ONE_CHANGE_PER_BEAT | existing; one change per beat is writer discipline (no check found) | `StoryboardBeat` (4 to 6 contiguous beats; `visual`, `motion`, `onScreenText`) in the same file. The nearest checks are `checkEditorialContract` in `apps/nickstire/shared/editorialContract.ts` (warns on a card with two or more sentences and over 9 words) and `evaluateRenderIntegrity` in `reelAssembly.ts` (needs 3 distinct sampled frames across the whole reel); neither tests that each beat shows one visible change. |
| PROBLEM_FIRST_ARC, CURIOSITY_GAP_HOOK | existing, copy only | Hook line plus beat 1 `onScreenText`. Keep soft phrasing; a curiosity gap never becomes fear. |
| STILL_PER_BEAT_CHECK | plan-only before the render; post-render check exists | Before the render the only checks read text and timing: `runReelPreflight` in `facelessReelStudio.ts` (no model, no spend). No code makes or inspects a still per beat before the paid render. After assembly, `runRenderedQaOnJob` in `apps/nickstire/server/services/renderedQa.ts` extracts the first frame, a midpoint frame per beat and the final frame from the mp4, builds a contact sheet and has a vision critic score the frames; it returns null when the job has no `mp4Url`. The render is spend and needs a live operator instruction. |
| ONE_ACCENT | existing | `BRAND_ACCENT_RULE`, `LENS_PALETTES` in `facelessReelStudio.ts`. |
| SOUND_OFF_CAPTIONS | existing | `validateMutedFirstClarity`; `apps/nickstire/server/services/reelAssembly.ts` burns each beat's `onScreenText`. |
| LOOP_SEAM | plan-only | The `satisfying_loop` archetype in `facelessReelStudio.ts` supplies a prose essence only. `validateLoopPlan` passes any non-empty `loopIdea`, and grep found no code that compares frame 0 with the final frame (`renderedQa.ts` included). Assembly clone-holds the last rendered frame for the 3 s SAVE freeze and, when an ask is declared, burns the ask text over that tail, so the delivered last frame does not equal frame 0. Promise a seamless loop only after a seam-aware render or a first-versus-final-frame check exists. |
| REAL_NUMBERS_ONLY | existing, facts BLOCKED | `validateSourceGrounding`, `detectFabricatedStats`. `FactChannel` in `apps/nickstire/server/services/businessFacts.ts` is sms, voice or web: no reel value, so a business fact in a reel is BLOCKED until cleared. No prices. |
| REVEAL_IN_ORDER_LABELLED | existing for text labels; needs new composition (NOT built) for a code-drawn graphic | Text labels: one beat per revealed item (a reel has 4 to 6 beats), each with a short `onScreenText` label that assembly burns on that beat's own window, so a label replaces the last and items do not accumulate. For a card instead of a clip, declare the beat deterministic (`source`, or a leading DETERMINISTIC tag in `visual`) and give `cardLines` in the pack file (up to 4 lines of 24 characters, "Illustration" badge): `renderDeterministicCardClip` in `apps/nickstire/server/services/deterministicCard.ts`, reached through `localBeatResolution.ts` (2026-10-09). A beat that claims real shop work needs a real clip; cards and generated beats are illustrative. Not built: a diagram with real geometry (cutaway, cross-section, force arrows), a filling counter or measurement graphic, crops, masks, callouts. |
| ONE_OBJECT_NO_CUT | needs new composition (NOT built) | A reel is 4 to 6 separate beat clips (`briefToSegments`: one segment per beat, 4 s each when generated), so nothing carries one object through states without a cut. The only code-drawn compositions are `ReviewVideoReel.tsx` and `ServiceAlertReel.tsx` in `packages/reel-engine/src/compositions/`, fixed at 450 frames (15 s) in `RootComposition.tsx`. No storyboard-driven code-graphics composition exists. |
| DETERMINISTIC_FRAME | no action | Render-side rule of an HTML-to-video pipeline that `docs/UPSTREAMS.md` rejects (HyperFrames row: duplicate of the Remotion reel-engine). |

Doctrine caveat: the table rows in `apps/nickstire/docs/reels-engine-v2/02-PRODUCTION-DOCTRINE.md` still say diagram cards are MISSING, which stays true for geometry. Its item 5 (2026-10-09) records the labelled card as BUILT + WIRED. Trust the code.

Free local lane: `apps/nickstire/server/services/templateStockStudio.ts` makes ffmpeg-only moving backdrops with no text.
Text rule: `validateNoInFrameText` bans text generated inside a clip; text burned by assembly is allowed.

## Overlap verdict

Pack folders are `apps/nickstire/docs/reel-packs/YYYY-MM-DD-topic` (202 merged on 2026-10-14). Grep the topic words across that folder and the open PR titles.
- DUPLICATE: same topic and same angle already merged or open.
- NEAR: same topic, different angle or different opening line.
- NEW: no match.
