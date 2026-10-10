# Reel music beds — license and provenance

Four instrumental beds from **Mixkit** (Envato), downloaded 2026-10-10 from
`https://assets.mixkit.co/music/<id>/<id>.mp3` under the **Mixkit Stock Music Free License**
(https://mixkit.co/license/#musicFree): free for personal and commercial use in videos, social
media, websites, podcasts and online ads; **no attribution required**; may not be redistributed
on their own, remixed and claimed, or used in CDs/DVDs/video games/TV-radio broadcast. Titles were
matched to the listing by asset id and by duration (the files carry no ID3 tags).

| file | Mixkit title | id | length | use |
|---|---|---|---|---|
| `upbeat-uplifting-bass-mixkit-726.mp3` | Uplifting Bass | 726 | 1:36 | energetic / promotional reels |
| `calm-valley-sunset-mixkit-127.mp3` | Valley Sunset | 127 | 2:14 | educational / calm reels, the default under a Higgsfield master (`archetype: calm`) |
| `cinematic-vastness-mixkit-184.mp3` | Vastness | 184 | 3:50 | evidence / mystery reels |
| `soft-relaxation-05-mixkit-749.mp3` | Relaxation 05 | 749 | 1:58 | soft background under narration |

Replaced the same day: `calm.mp3`, `upbeat.mp3`, `rock.mp3`, `hiphop.mp3` (ffmpeg-synthesised tone
pads, two of them byte-identical duplicates under different names) and `lofi.mp3` (no recorded
provenance). Nothing published so far carried any of them: the pilot Reels bypassed the assembler.

`pickMusicBed()` (`server/services/reelAssembly.ts`) prefers a file whose name contains the brief's
archetype or tone, otherwise rotates deterministically by brief id. Drop another `.mp3`/`.wav`/`.m4a`
here and it is used automatically; record its source and license in this table first. If a platform
ever files a claim on a Mixkit track, Mixkit's published remedy is to email them with the link.
