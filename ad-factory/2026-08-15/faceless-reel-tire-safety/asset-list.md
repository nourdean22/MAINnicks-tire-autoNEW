# Asset list — "3 Tire Warning Signs"

None of these have been downloaded, generated, or licensed by this session — this is a sourcing
list for the operator/editor to pull from. No stock-footage API or Higgsfield/image-gen call was
made automatically because posting/production assets are the operator's call on licensing and
brand fit.

## Background footage (b-roll) — one clip per beat

| Beat | Time | Shot needed | Suggested royalty-free source (search terms) |
|---|---|---|---|
| Hook | 0:00–0:03 | Close-up, tire tread rolling on hot asphalt, slight slow-mo | Pexels/Pixabay: "tire close up road", "car tire driving asphalt" |
| Penny test | 0:03–0:08 | Hands testing tread depth with a coin/gauge | Pexels: "tire tread depth check", "mechanic tire inspection" |
| Sidewall cracking | 0:08–0:13 | Macro shot of a cracked/weathered sidewall | Pexels/Pixabay: "cracked tire sidewall", "worn tire close up" |
| Speed vibration | 0:13–0:19 | Steering wheel POV or dashboard, driving shot | Pexels: "driving pov highway", "steering wheel hands driving" |
| Stakes | 0:19–0:24 | Highway traffic, hot/hazy summer look, or a pulled-over car on a shoulder (stock only, not staged distress) | Pexels: "highway traffic summer heat", "car shoulder breakdown stock" |
| CTA / shop | 0:24–0:32 | Shop bay / technician working on a lift, or branded storefront if available in nickstire's own asset library | Pull from `apps/nickstire` marketing assets if any exist; otherwise Pexels: "auto repair shop bay" |

All Pexels/Pixabay results are royalty-free for commercial use with no attribution required — verify
each individual clip's license tag before use (a handful are contributor-restricted).

## AI-generated background alternative

If the operator prefers generated stills over stock footage (e.g. for the title-card beat or thumbnail),
`mcp__huggingface-skills__gr1_z_image_turbo_generate` is connected in this session and can produce
stills from prompts — note it generates **static images only, not motion/video**, so it fits the
title-card and CTA end-card beats better than the mid-roll action shots. Suggested prompts:

- Title card: `"tire close-up on hot asphalt, dramatic lighting, automotive photography, vertical 9:16, no text"`
- CTA end card: `"clean auto repair shop bay interior, warm lighting, professional photography, vertical 9:16, no text"`

(Generation not run in this session — operator's call given it's an extra external call per pack.)

## On-brand graphic elements (no sourcing needed — build in editor)

- Title/lower-third text cards: use `packages/social-assets` brand tokens (`packages/social-assets/src/brand.ts`)
  for consistent color/type with Nick's Tire & Auto's other social graphics.
- Warning-triangle / alert icon for beats 2–4: reuse the icon treatment already built in
  `packages/reel-engine/src/compositions/ServiceAlertReel.tsx` (pulse-scale warning triangle) for
  visual consistency with other reels this shop has produced.
- Lincoln-head / penny graphic for beat 2: simple icon overlay, any icon library (Noun Project, Flaticon —
  verify license) or a real macro photo of a penny in a tread groove (matches the stock search above).

## Music

No music-licensing API is connected. Suggested royalty-free tracks (search by mood, not exact title,
since exact catalog availability varies by platform):

- Mood: light tension → confident resolve, ~32s, no vocals, moderate tempo (100–120 BPM)
- Sources: YouTube Audio Library (free, no attribution required for most tracks), Pixabay Music,
  or the platform's own native sound library (TikTok/Reels built-in commercial sounds are often the
  best choice for algorithmic reach — check each platform's current trending-sound picker at posting time).
- Duck music to ~20% volume under VO for the entire runtime; no need for a full mix pass on a 32s reel.

## Sound effects (optional, light touch)

- Subtle "whoosh" on each on-screen text card entrance (0:00, 0:03, 0:08, 0:13, 0:19, 0:24, 0:29)
- Optional soft "alert ping" under the "1 OF 3 = ROADSIDE RISK" card at 0:19 for emphasis
