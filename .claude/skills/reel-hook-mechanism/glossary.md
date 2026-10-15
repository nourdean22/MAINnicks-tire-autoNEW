# Glossary

Format: term · definition · section id. Definitions quote or restate the source; entries marked "this skill" are our own usage.

- seek(t) · upstream's name for the one function that paints frame t with no timers and no randomness; draw(t) is the same idea · ulyssexbt-205279
- beat · upstream means a musical beat on a BPM grid (120 or 128 BPM) where a change lands; in this skill a beat is one numbered storyboard beat (4 to 6 per reel), not a music beat. Its footage length depends on its source: a generated or undeclared beat is clamped to 4 s, so cap generated beats at 4 s; a real shop clip runs up to its probed length, 12 s at most; a deterministic card up to 8 s; the floor is 0.8 s. A beat authored longer is clamped, so the render runs shorter than the storyboard says (`segmentCapSeconds` in `reelAssembly.ts`) · verbove-268381
- contact sheet · one frame per beat rendered first and reviewed before the full render. In this repo a sheet exists only after assembly (`buildContactSheet` in `renderedQa.ts`), so a pre-render sheet is plan-only · verbove-268381
- accent · the single named colour that carries transitions, such as "one orange accent" · koushikde-937635
- prompt_partial · videos.json flag: the creator shared only part of the prompt or only described the result · readme
- viral · the list's own label for its entries; unmeasured, no metric field exists · readme
- evidence-class, confidence · this skill's usage, not upstream: usage evidence in the pinned text and recurrence in the list; never proof of calls or bookings · none (see techniques.md header)
- pack · repo term, not upstream: one reel content pack under apps/nickstire/docs/reel-packs/ · none (repo term)
