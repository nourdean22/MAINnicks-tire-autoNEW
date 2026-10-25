# Reel pack: mount, balance, torque (aired 2026-10-25)

Written after the post, from the local build record. It is a record of what aired plus the method, not a draft to post.

AIRED: 2026-10-25 instagram 18036349070892926

This pack is an aired record. Do not re-render, re-post or queue it. The `AIRED:` line above is the marker
`scripts/build-reel-triage.mjs` reads, so `pnpm run triage:reels` counts it as aired, not as a draft or a blocked pack.

Build files: `C:\Users\nourd\NattyNour\shop-media\reels-draft\mount-balance-2026-10-25\` (build.md, receipts.txt,
captions.srt, caption.txt). Format research (summarised, not pasted): `C:\Users\nourd\NattyNour\shop-media\research\reels-formats.md`
("The 19 s flagship (mounting/balancing)").

## What aired

| Field | Value |
|---|---|
| Posted | 2026-10-25 13:23Z |
| Instagram media id | 18036349070892926 |
| Permalink | https://www.instagram.com/reel/De6zhQTD9ZR/ |
| Posted file | `final.mp4`, 23,570,908 bytes, 19.0 s, md5 `6fd3e6724aad17d95a832590cf52976f` |
| S3 key | `reels/mount-balance-2026-10-25/final.mp4` |
| Path | publishToSocial, `isAiGenerated` false |
| Generated content | Two generated stills: the hero wheel in beat 0 (cover) and the tire row in beat 6 (both ChatGPT, product shots). Every other beat is real shop media. |
| Label | Off by Nour's decision of 2026-10-11 ("remove the AI label completely forever"). In code, `META_AI_SELF_DISCLOSURE = false` in `shared/reelDisclosure.ts` gates `is_ai_generated` in `server/services/metaSocial.ts`, so the flag is not sent whatever `isAiGenerated` says. Rule 1 (no generated footage framed as real) still applies. Meta may still label a reel from file metadata. |

Caption, as posted (`caption.txt`):

> Cleveland drivers: here is what happens between mounting a tire and putting the wheel back on. Mount, balance, torque. Walk-ins 7 days on Euclid Ave, first come, first served. 17625 Euclid Ave, (216) 862-0005. #ClevelandOhio #ClevelandAutoRepair #TireShop #NicksTireAndAuto

On-screen captions: `captions.srt` in this folder.

## Two content flags (what the picture does not show)

1. **No balancer footage exists in the library.** All 128 videos and the photo triage were checked. The CEMB unit in
   156 and 446 is an aligner, and the black machine in 806 is an old tire changer. The "Balance." beat shows a freshly
   mounted wheel on the changer, the wheel that gets balanced next. The label says more than the picture shows.
2. **No torque-wrench footage exists.** The "Torque." beat shows the hub, studs, jack and impact gun, then an impact
   wrench on the lug nuts. "Torqued" in the voice describes the step; the picture is an impact gun, not a wrench click.

Fix: film three hands-only phone clips of 5 s each (balancer spinning a wheel, a weight clipped on, a torque wrench
clicking on a lug). Swap them in by changing two SRC lines in `scripts\build.py`: `SRC["p623"]` (beat 3) and
`SRC["p668"]` (beat 4b), each to a video plus its in-point, then run `python build.py`.

## Beat table

1080x1920, 30 fps. Source numbers are shop-media library ids.

| Beat | Time (s) | Source | Label | Plate / face check |
|---|---|---|---|---|
| 0 | 0.0-1.5 | generated `gen\hero-wheel.png` (product shot), push 1.00-1.06 | What happens before your wheel goes back on? | Unmarked tire, no plate; no faces |
| 1 | 1.5-4.0 | 813 video, 2.9-5.4 s, real sound, 450x800 crop tracked off the face track | none | No car. Tech's face kept out of frame; a background person blurred (tracked box), every 3rd frame viewed |
| 2 | 4.0-6.5 | 624 photo, 9:16 crop, push 1.00-1.08 | Mount. | No car; jacket and arm only |
| 3 | 6.5-10.0 | 623 photo, crop, push 1.00-1.07 | Balance. (flag 1) | No car; legs at top right only |
| 4a | 10.0-11.5 | 1056 video, 64.0-65.5 s, real sound | Torque. (flag 2) | Jeep side and hub; plate area off frame; boots and hand only |
| 4b | 11.5-13.0 | 668 photo, crop, push 1.00-1.06 | Torque. | No plate; gloved hand only |
| 5 | 13.0-15.5 | 718 video, 0.5-3.0 s, real sound | none | SUV side, rolling wheel, no plate in frames 390-464 |
| 6 | 15.5-17.0 | generated `gen\tire-row.png` (product shot), lateral drift | Walk in any day. Seven days a week. | Generated, no plate; upper third blurred and darkened |
| 7 | 17.0-19.0 (60 frames) | 476 `post3-storefront.jpg`, end card | Nick's Tire & Auto / 17625 Euclid Ave / Walk-ins 7 days | GBP still, plates already blurred |

Clips came from the text-free originals (byte copies of the library files). Triage 468 (a recognizable mechanic), still
814 and the 325-327 tire-machine clips (possible minor) are not used. Text is Arial Bold in the top safe zone: white 72
for the hook and beat 6, brand yellow 124 for the step labels. No prices, times, guarantees or names.

## Voice and sound chain

- Voice: Google `en-US-Neural2-J` through `apps/nickstire/server/services/reelVoice.ts` `generateVoiceover`, speakingRate 1,
  pitch -1.5, run under `railway run` (env read only). Words: "Mounting is one step. Balancing is the other. Torqued before
  it goes back on. Walk in any day, seven days a week." Spoken 5.9 s. Each sentence cut at its measured silence.
- Speech windows in the final (s): 4.25-5.58, 6.85-7.98, 10.30-11.79, 15.65-17.64.
- Real clip sound from frame one (813, then 1056, then 718, with 0.1 s crossfades). Each piece: highpass 80 Hz, 2:1
  compressor, bed to -18 LUFS, 6 dB duck under speech, 1.0 s final fade.
- Music rights (from `apps/nickstire/assets/reel-music/LICENSE.md`; no separate rights ledger exists): file
  `soft-relaxation-05-mixkit-749.mp3`, Mixkit "Relaxation 05", asset id 749; source URL pattern
  `https://assets.mixkit.co/music/749/749.mp3`; acquired 2026-10-10; license Mixkit Stock Music Free License
  (https://mixkit.co/license/#musicFree), scope: free for personal and commercial use in videos, social media and online
  ads, no attribution, no redistribution on its own; territory UNKNOWN (not recorded in LICENSE.md); expiry UNKNOWN (none
  recorded); organic or ad clearance: license text lists social media and online ads, but no repo record confirms
  clearance for this post, so UNKNOWN. Treatment: from 6.0 s at -36 LUFS, 0.5 s fade in, 1.0 s
  fade out. It carries the source joins and the end card. Voice: 3:1 compressor to -16 LUFS. Mix to -16 LUFS, limiter at -2.5 dBFS.

## Receipts (from `receipts.txt`)

- ffprobe: h264 1080x1920, 30/1 fps, 19.000 s, 570 of 570 frames; AAC 48 kHz stereo, 23,570,908 bytes.
- 7 of 7 sampled frames distinct (t=0, 3, 6, 9, 12, 15, 18 s).
- ebur128: -16.1 LUFS integrated, true peak -1.8 dBTP, LRA 4.1 LU. loudnorm measure: -16.3 LUFS.
- No silence of 0.3 s or more; a silence canary proved the detector fires on real silence.
- Face scan (YuNet, every frame, positive control 0.90 on the uncropped source): 39 of 570 frames hit at 0.50-0.82. Every
  hit region viewed at 100%: arm, machine parts, rack, brake rotor, wheel spokes. No face.
- Not done: nobody listened to it (the clip sound under beats 0-2 could be the changer or crew voices); no ASR run on the
  voice; the 813 crop is a 2.4x enlargement of 1080p video, so it is soft on a big screen.

## Rule 1 notes

- Generated stills (hero wheel, tire row) are product imagery only, never framed as the shop's bay, building or crew.
- The tire row's garage background is blurred and darkened so it never reads as our bay; neither still carries a line
  claiming our premises or work.

## Deviations from the repo contracts (what aired did not follow these)

1. **Two silent beats.** `validateMutedFirstClarity` (`client/src/lib/facelessReelStudio.ts`) fails a storyboard with any
   blank `onScreenText` beat. Beats 1 (1.5-4.0 s) and 5 (13.0-15.5 s) carry no on-screen text, so the reel does not teach
   muted at those two points (`captions.srt` has no cue for either).
2. **Two asks.** `shared/editorialContract.ts` reserves the reel's one ask for the end card. Beat 6 burns "Walk in any day.
   Seven days a week." into the picture and the voice, and the end card repeats "Walk-ins 7 days".
3. **End card too dense.** `validateOnScreenReadability` blocks more than 4 words per second of beat. The 2 s end card
   carries 9 words (4.5 per second): "Nick's Tire & Auto", the address and "Walk-ins 7 days".

## Method, seven steps (reuse for reel 3)

1. Pick the process and its words. Here: three steps (mount, balance, torque) in one sentence set under 9 s of speech.
   Declare the one ask once.
2. Find one real 2.5 s shot per step in the library. If a step has no footage, say so in the build record and film it;
   do not let a label claim more than the picture shows. Every beat carries on-screen text, including the shots that
   only show the machine; no beat carries a call to action.
3. Check every shot for plates and faces (crop, track-blur, face scan with a positive control), then view the hits at 100%.
4. Voice with `reelVoice.ts` (Neural2-J), place each sentence at its measured silence; keep real clip sound, duck 6 dB under
   speech, add a licensed Mixkit bed, mix to -16 LUFS. One ask, end card only: a 2.0 s card of at most 8 words (for example
   "Nick's Tire & Auto" and "Walk-ins 7 days", with the address in the caption), and the voice does not speak the ask before it. Name any generated still and its
   beat in the pack, as above.
5. Run the receipts script (ffprobe, frame MD5s, ebur128, silencedetect with canary, face scan), view `beats.jpg`.
6. Before handoff, a person plays the final file once with sound on and records who, when and what they heard in
   `build.md` (here the clip sound under beats 0-2 was never identified). Numbers alone do not count as a listen.
7. Hand to Nour. Post only on his go, through publishToSocial.
