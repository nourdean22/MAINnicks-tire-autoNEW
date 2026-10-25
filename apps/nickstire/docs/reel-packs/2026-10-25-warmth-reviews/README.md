# Reel pack: warmth reviews (aired 2026-10-25)

Written after the post, from the local build record. It is a record of what aired plus the method, not a draft to post.
Build files: `C:\Users\nourd\NattyNour\shop-media\reels-draft\warmth-2026-10-25\v2\` (build.md, receipts.txt, captions.srt).
Format research it follows (summarised, not pasted): `C:\Users\nourd\NattyNour\shop-media\research\reels-formats.md`.

## What aired

| Field | Value |
|---|---|
| Posted | 2026-10-25 12:51:04Z |
| Instagram media id | 18048091778822545 |
| Permalink | https://www.instagram.com/reel/De6v1Q7DtJb/ |
| Posted file | `v2\final.mp4`, 25,414,584 bytes, 19.0 s |
| S3 key | `reels/warmth-2026-10-25/final-v2.mp4` |
| Path | publishToSocial, `isAiGenerated` false (Nour's settled no-label rule, 2026-10-11) |

Caption, as posted:

> Every quoted review line in this video is from a Google review, word for word. Walk-ins 7 days on Euclid Ave, first come, first served. 17625 Euclid Ave, (216) 862-0005.
>
> #Cleveland #EuclidAve #TireShop #AutoRepair #NicksTireAndAuto

On-screen captions: `captions.srt` in this folder.

## Beat table

1080x1920, 30 fps, hard cuts throughout. Source numbers are shop-media library ids.

| Beat | Time (s) | Source | On-screen line | Plate / face check |
|---|---|---|---|---|
| 1 | 0.0-2.5 | 903 `post1-nour-sign.jpg`, push-in 1.00-1.08 | What drivers write about the people at Nick's. | Plate hidden behind Nour; Nour only |
| 2 | 2.5-5.5 | 845, 0.0-3.0 s | "Good friendly nice respectful people there." | Plate tracked-blurred, every frame checked; no people |
| 3 | 5.5-8.5 | 468, 11.0-14.0 s | "They inspected my car before they did any work..." | No car; hands only |
| 4 | 8.5-11.5 | 481 original, poster blurred, brakes sign framed out, push-in | "I was comfortable waiting." | Window car shows no plate; no people |
| 5 | 11.5-14.5 | 806, push-in | "Attitude and courtesy matter and I appreciated them." | No car; a tech's back only |
| 6 | 14.5-17.0 (75 frames) | generated `gen\tire-row.png`, left-to-right pan, no zoom | Walk in any day. Seven days a week. | Generated: no people, hands, plates or lettering |
| 7 | 17.0-19.0 (60 frames) | 476 `post3-storefront.jpg`, end card | Nick's Tire & Auto / 17625 Euclid Ave / Walk-ins 7 days / Quoted lines from Google reviews, word for word. | Plate hidden by banner; no people |

Beats 2 to 4 are quotes from public Google reviews, kept word for word. Beat 6 is the shop's own words and carries no
quotation marks. Still 814 is not used.

## Voice and sound chain

- Voice: Google `en-US-Neural2-J` through `apps/nickstire/server/services/reelVoice.ts`, rendered under `railway run`
  (env read only, nothing printed). Words: "Here is what drivers write about the people at Nick's on Euclid. Friendly and
  respectful. An inspection before any work. A comfortable wait. Walk in any day, seven days a week."
- Placement (s): 0.31-3.46, 3.87-5.00, 5.88-7.35, 9.09-9.92, 14.70-16.75. The last sentence sits on beat 6. The end
  card is music only.
- Music: `calm-valley-sunset-mixkit-127.mp3` from 8.0 s, Mixkit Stock Music Free License. Base -22 LUFS, 12 dB duck over
  each speech window, 0.5 s fade in, 1.0 s fade out. Mix to -16 LUFS, peak limiter at -2.5 dBFS.

## Receipts (from `receipts.txt`, run after the build)

- ffprobe: h264 1080x1920, 30/1 fps, 19.000 s, 570 of 570 frames; AAC 48 kHz stereo, 25,414,584 bytes.
- 6 of 6 sampled frames distinct (t=0, 4, 8, 12, 16, 18.5 s; needs 4).
- ebur128: -16.0 LUFS integrated, true peak -2.5 dBTP, LRA 7.7 LU. loudnorm measure: -16.3 LUFS.
- No silence of 0.3 s or more (silencedetect -50 dB).
- Beats 1 to 5 decode identically to the v1 build (segment MD5s match), so v1's plate and face checks carry over.
- Not done: nobody listened to it; sound was judged by numbers only.

## Rule 1 notes

- Generated stills are product imagery only, never framed as the shop's bay, building or crew.
- A generated exterior (`gen\shop-golden-hour.png`) was dropped because it is not Nick's building.
- The only generated image in the cut is the tire-row still in beat 6. It has no quote on it and no claim about the premises.

## Improve next

- Beat 6 is a generated product shot in a reel whose other frames are real. Replace it with a real hands-only phone clip
  of tires on the rack (5 s), then drop the generated still. Nour was asked to confirm he is fine with it; the post went
  out with it.
- Listen once with sound on before the next cut of this format.

## Method, five steps (reuse for reel 3)

1. Pick the claim and its proof. Here: public Google review lines, copied word for word, plus the shop's own walk-in line.
2. Match each line to one real 3 s shot from the library. Check each shot for plates and faces; blur or crop what shows.
3. Voice it with `reelVoice.ts` (Neural2-J) under `railway run`, cut each sentence at its measured silence, place it on its
   beat. Keep spoken time under 9 s.
4. Mix: licensed Mixkit bed ducked under speech, mix to -16 LUFS, limiter at -2.5 dBFS. End on a 2.0 s card with name,
   address and walk-in line.
5. Run the receipts script (ffprobe, frame MD5s, ebur128, silencedetect), view `beats.jpg`, then hand to Nour. Post only
   on his go, through publishToSocial.
