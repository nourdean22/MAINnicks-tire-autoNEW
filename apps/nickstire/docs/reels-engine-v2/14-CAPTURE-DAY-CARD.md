# Capture day card (print this, 90 minutes, one harvest for all three flagships)

Phone vertical. Lock focus and exposure (tap and hold). Clamp mount; the mount does not move
between a "before" and an "after". 5 to 8 seconds per clip, with a second of handle each end.
Clean the lens every few clips. Never plates, VINs, faces without consent, paperwork, customer
voices or identifying screens. An unusable clip is marked unusable, never forced into an edit.

## Light

- One large soft source from the side (a work light bounced off a white wall or a sheet), not the
  phone light from the front.
- A black mat or shop rag behind the tire gives the rubber an edge.
- For bubbles, dust and tread edges, a second small light from behind and to the side.

## The clips (name each file like this: `P1-nail-macro.mp4`)

| Job | Clip | What the frame must show |
|---|---|---|
| Puncture (Reel C) | P1 | nail head in the tread, raking light, the evidence card beside it |
| | P2 | quarter-inch reference held to the injury |
| | P3 | tire coming off the wheel |
| | P4 | inner liner under raking light, the puncture visible from inside |
| | P5 | buffing the inside |
| | P6 | plug-patch seating from the inside |
| | P7 | a shoulder or sidewall puncture on a SCRAP tire (the "replace" case) |
| | P8 | final soap leak check, no bubbles |
| Balance (Reel B) | B1 | wheel spinning at full speed on the balancer, locked mount |
| | B2 | the readout, held 2 s |
| | B3 | weight going on |
| | B4 | hands rocking the wheel at twelve and six, then nine and three |
| | B5 | any real bulge or flat spot |
| | B6 | re-spin reading zero |
| Tread pair (Reel A) | T1 | worn tire and new tire side by side, same light |
| | T2 | gauge in a worn groove, held 2 s |
| | T3 | gauge in a new groove, held 2 s |
| | T4 | wear-bar macro |
| | T5 | finger on the worn edge |
| | T6 | water poured across both treads (demonstration, not a test) |
| Shop identity | S1-S10 | bay door, lift, wheel roll, impact, compressor, hands, signage |
| Audio, 5 s each | A1-A6 | ratchet, impact, air release, balancer start, shop door, room tone |

Hands and tools are fine on every clip. No faces.

## After capture (10 minutes at the laptop)

1. Copy the files to one folder. Delete the unusable ones; do not rename the rest.
2. Register each clip (dry run first, then `--execute`):

```bash
cd apps/nickstire && railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/register-real-shop-clip.mts C:/captures/P1-nail-macro.mp4 --slug P1-nail-macro --job "puncture 2026-10-12" --execute
```

   It probes the clip, refuses anything that is not vertical video with a duration, uploads the
   exact bytes, registers a `real_shop` video row and prints `"realAssetId": "ma_..."`.
3. Put that id on the matching beat in the pack's `brief.json` (the three proof packs already
   declare `hands_only_real` and their card lines). The lane binds the exact clip, keeps it up to
   12 s on screen, re-hashes the bytes at assembly, and the AI label stays off when every shot is
   real or drawn.
4. Enqueue as usual. A clip shorter than its beat, a wrong id, or a still instead of footage is
   refused by name before anything is spent.
