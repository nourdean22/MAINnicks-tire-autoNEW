# Techniques

Source: yihui-dev/awesome-opus5-5-videos at 92aee2f (2026-10-13). Section ids are in chapters/map.md.
Each entry: claim / source-section / quote-anchor (verbatim, 15 words or fewer) / also (more slug + anchor pairs, same rule) / evidence-class / confidence.

How to read the labels here (this skill's meaning, see glossary.md):
- `author_evidenced` = the pinned prompt text itself shows creators applying the pattern. It is USAGE evidence. No entry has outcome evidence: videos.json has no views, likes or any metric.
- confidence = how firmly the pattern is established as a recurring practice in the list, by verified slug count and prevalence. It is never confidence that the pattern earns calls or bookings.
- Prevalence is a crude regex re-count over 170 prompts (75 full explainers + 95 full motion prompts of 240-1500 chars), counted per prompt with copies of one template not collapsed. Each regex, its count and the false positives found by reading the matches are in `provenance/source.json` under `recount`. Read the matches before quoting a number.

## RUNTIME_FIRST
- claim: Open the spec with one exact runtime in seconds before any content; the upstream range is 15 to 60 s.
- source-section: alex-prompter-997524
- quote-anchor: "Build a 30-second animated explainer for my business as a single HTML page."
- also: astrothewizard-618782 "I want you to make a 60-second, fully animated explainer video" | koushikde-937635 "Make a 15s motion video in code" | woojinrad-455731 "make a 25-second animated explainer"
- evidence-class: author_evidenced
- confidence: high
- prevalence: 53/170 carry a number of seconds in the first 200 characters (3 of the 53 are not runtimes: a build time, a fill-in template and a segment time)

## NUMBERED_BEATS
- claim: Fix the scene or beat count, or a timecoded storyboard, before writing any beat content.
- source-section: archiveexplorer-560622
- quote-anchor: "Write my launch video as 9 beats"
- also: alex-prompter-997524 "single HTML page. 5 scenes." | gdgtify-130294 "STORYBOARD"
- evidence-class: author_evidenced
- confidence: medium
- prevalence: 6/170 by regex name a beat or scene count or a timecode range starting at 0; on reading 4 are storyboard marks and 2 count music beats. Looser variants (8 and 10) are named in `provenance/source.json`

## PROBLEM_FIRST_ARC
- claim: Open on the viewer's problem (pain) and let the answer and the name come after. The arc name is this skill's label; the beat order is the creators'.
- source-section: alex-prompter-997524
- quote-anchor: "The customer's problem, what I do, how it works in 3 steps"
- also: archiveexplorer-560622 "9 beats: pain, reframe, name, how it works"
- evidence-class: author_evidenced
- confidence: low

## CURIOSITY_GAP_HOOK
- claim: Two explainer prompts ask the opening hook itself to create a curiosity gap about why the topic matters in real life.
- source-section: michaelraspuzzi-740595
- quote-anchor: "make sure hook creates a curiosity gap"
- also: cryptoxorz-359201 "with a curiosity hook, counter-intuitive points"
- evidence-class: author_asserted
- confidence: low

## REVEAL_IN_ORDER_LABELLED
- claim: Show a process one item at a time, each item named by one short label as it appears.
- source-section: 0xspikez-483865
- quote-anchor: "suck, squeeze, bang, blow, every stage labelled:"
- also: sarut0bisasuke-069973 "showing the ingredients and measurements as they go into the glass." | aichrislee-408244 "every part slides apart along the lens with its name on a label."
- evidence-class: author_evidenced
- confidence: medium

## ONE_CHANGE_PER_BEAT
- claim: A change lands on every beat of a fixed grid. Reading that as one visible change per storyboard beat is this skill's inference; upstream grids are music BPM, not storyboard beats.
- source-section: verbove-268381
- quote-anchor: "Something happens on every bea"
- also: koushikde-937635 "every state change sits on the beat" | ai9app-989009 "every move lands on the beat"
- evidence-class: derived_inference
- confidence: medium

## ONE_ACCENT
- claim: Name the palette and let one accent colour carry the transitions.
- source-section: koushikde-937635
- quote-anchor: "one orange accent carries every transition"
- also: sanjeevn72-151834 "pure black and white or one accent color" | verbove-268381 "Never fade black directly into the accent color."
- evidence-class: author_evidenced
- confidence: low
- prevalence: rare, 3/170 use the word accent (palette wording not counted)

## ONE_OBJECT_NO_CUT
- claim: One object morphs between states with no hard cuts, so the viewer's eye never resets.
- source-section: verbove-268381
- quote-anchor: "One shape, never cut"
- also: diamai-157697 "Ensure one element morphs through 8-12 states without a cut." | noah-z-zhang-765393 "One continuous timeline, 0 hard cuts." | thesethian-384517 "One shot, no cuts."
- evidence-class: author_evidenced
- confidence: low
- prevalence: 7/170 use no-cut wording (one hit is job-conditions text, one copies the verbove template); only verbove and diamai describe one morphing object

## LOOP_SEAM
- claim: Make the last frame equal the first so the loop has no visible seam, and check frame 0 against the final frame.
- source-section: verbove-268381
- quote-anchor: "Make the last frame equal the first so the whole thing loops"
- also: 0xkarmi-129839 "The seam check puts frame 0 against frame 720."
- evidence-class: author_evidenced
- confidence: low

## SOUND_OFF_CAPTIONS
- claim: The meaning must survive with the sound off, carried by on-screen captions.
- source-section: astrothewizard-618782
- quote-anchor: "since most people watch on X with the sound off"
- also: gdgtify-130294 "The complete speech must be understandable without audio." | woojinrad-455731 "give each a short caption taken from the text"
- evidence-class: author_evidenced
- confidence: low

## STILL_PER_BEAT_CHECK
- claim: Review one still per beat and fix problems before the full render.
- source-section: archiveexplorer-560622
- quote-anchor: "Show me one still per beat and lock the timing."
- also: verbove-268381 "First render one frame per beat as a contact sheet" | ulyssexbt-205279 "one still per beat, scored 1-10, fixes the lowest on camera" | yankis0x-174321 "render one frame per beat first, fix what is off the grid"
- evidence-class: author_evidenced
- confidence: medium
- prevalence: 5/170 by regex (one still or frame per beat); on reading 4 are review steps, the four slugs above, and notdwd-766641 is a per-beat animation timing line, not a review

## REAL_NUMBERS_ONLY
- claim: Use real data only, and make one drawn unit stand for one real thing.
- source-section: rneayan-417829
- quote-anchor: "1 marble = 1 million people."
- also: verbove-268381 "Real UI. Real data. No placeholders." | cryptoxorz-359201 "facts must be accurate and sourced" | astrothewizard-618782 "Include real numbers (core temperature, distance, travel time, years inside the Sun)"
- evidence-class: author_evidenced
- confidence: medium

## DETERMINISTIC_FRAME
- claim: Every frame is a pure function of time, so any frame renders alone and a fix is a small edit plus a re-render. This is a render-side rule of the upstream HTML pipeline.
- source-section: yankis0x-174321
- quote-anchor: "every frame is a pure function of time"
- also: ulyssexbt-205279 "seek(t) paints frame t, no timers, no randomness" | parkerrex-701462 "every frame a pure function of time" | verbove-268381 "One draw(t) function"
- evidence-class: author_evidenced
- confidence: medium
- prevalence: 9/170 use seek(t), draw(t), pure-function or no-timer wording (two share one opening template)

## SPEC_BEFORE_BUILD
- claim: Core mechanism of the list: agree a short spec first (runtime, numbered beats, one change per beat, a named accent, a still per beat), then build. This is the skill's synthesis of the entries above, not one author's rule.
- source-section: woojinrad-455731
- quote-anchor: "Show me the storyboard first, then render it to MP4."
- also: archiveexplorer-560622 "Build each beat as a wireframe first"
- evidence-class: derived_inference
- confidence: medium
