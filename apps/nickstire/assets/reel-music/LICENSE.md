# Reel music beds — license

These instrumental beds are **self-generated** (synthesized with ffmpeg from pure tones —
warm chord pads). They are released to the **public domain (CC0)**: no copyright, no
attribution required, free for commercial use. Zero Content-ID / takedown risk on Instagram.

| file | mood | use |
|------|------|-----|
| `calm.mp3` | warm, slow | educational / calm reels |
| `upbeat.mp3` | brighter, pulsed | promotional / energetic reels |

They are intentionally simple, unobtrusive beds (played ducked at ~0.16 under the voiceover).
**To upgrade the sound:** drop any royalty-free loop (`.mp3`/`.wav`/`.m4a`) into this folder —
`pickMusicBed()` (in `server/services/reelAssembly.ts`) picks up whatever is here automatically,
preferring a file whose name matches the reel's archetype/tone. Good license-clean sources:
YouTube Audio Library, Uppbeat, Pixabay Music (verify the license allows commercial use; if a
source needs attribution, note it here).
