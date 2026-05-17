# ADR-0007 · Morning brief · multi-channel delivery (push + voice)

> **Status**: Accepted (2026-05-17 · Wave-200 Phase 5)
> **Decision drivers**: operator wants the morning brief as a one-tap
> push · pre-rendered audio · still keep Telegram path during cutover

---

## Context

The morning brief composer (`lib/services/morning-brief.ts`) has been
production-stable since v10.0.524. It produces a tight ~15-line brief
with four slices (personal · shop · wellbeing · anticipated). Today's
delivery channel is Telegram only · the legacy `/api/cron/morning-brief`
route pushes the brief text to the operator's Telegram chat at 7:15am
ET via `sendTelegram(brief.text)`.

Wave-200 commits to "system-push" (the AI initiates value delivery)
and "mobile-first" surfaces (push notifications + voice). Telegram is
a chat app the operator has to open · it's not the right surface for
"the OS pushes the brief to you while you're brushing your teeth".

Three new channels we want:

1. **Web Push** — the OS-native notification surface the operator
   already grants permission to. Tap → opens `/command` with the brief
   visible. The VAPID Web Push pipeline is already wired
   (`lib/notifications/push.ts`) · the brief just needs to use it.
2. **Pre-rendered audio** — `today.mp3` available at a stable URL the
   operator can tap from the PWA at `/voice` or from a home-screen
   shortcut. Voice + brief in 1 tap with zero typing.
3. **(future)** LiveKit outbound voice call — the brief is read to
   the operator as part of a live conversation, with follow-up
   questions answerable in the same call. Phase 4 (LiveKit voice)
   ships the substrate; the actual outbound call lives in a follow-up
   when the Cartesia voice clone is paid for.

## Decision

**Layer the new channels on top of the existing composer via an
Inngest orchestrator.** The composer stays the single source of
truth — every channel reads the same `brief.text` + `brief.payload`.
Channels are independent steps so partial delivery (e.g. push lands,
audio file fails) doesn't lose the working channel.

### File changes (Phase 5)

| File | Purpose | Lines |
|---|---|---|
| `apps/statenour/src/inngest/functions/morning-brief.ts` | New Inngest function `operator-morning-brief` · 3 steps · cron 10:00 UTC daily | ~190 |
| `apps/statenour/src/inngest/functions/index.ts` | Export new function for serve endpoint pickup | +1 |
| `apps/statenour/app/api/morning-brief/today.mp3/route.ts` | Owner-only GET that serves the cached audio for today from BrainMemory | ~60 |
| `docs/adr/0007-morning-brief-multichannel.md` | This ADR | — |

### Step semantics (Inngest)

The orchestrator runs three `step.run` checkpoints:

1. **`compose`** — read today's brief from `BrainMemory(category=
   "morning_brief")`. The legacy mega-morning cron at 9:00 UTC writes
   this row by ~9:05 UTC, so by our 10:00 UTC trigger it's typically
   present. Fallback: call `buildMorningBrief()` directly if the row
   isn't there yet (race window or legacy cron failure).
2. **`web-push`** — `sendPush({ title, body, chatSeed: ... })`.
   Graceful: returns `{ sent: 0, failed: 0 }` if no subscriptions or
   VAPID unset. Failure of this step retries 2x then surfaces in the
   Inngest dashboard.
3. **`voice-file`** — POST to Cartesia `/tts/bytes` with
   `model_id=sonic-2`. Decode bytes, base64-encode, upsert into
   `BrainMemory(category="morning_brief_audio", key=date)`. Graceful:
   skipped (returns `{ status: "skipped" }`) if `CARTESIA_API_KEY`
   missing. Failure retries.

### Why 10:00 UTC (6am ET)

- The legacy cron at 9:00 UTC (5am ET) writes the brief row · we
  read from it 55 minutes later · zero race risk
- 6am ET is when the operator's day starts · push lands at the
  moment of "first phone reach"
- Cartesia audio is fresh · no chance of stale data
- The legacy Telegram push at 7:15am ET still fires during the
  cutover window · operator can compare the two channels for a few
  days before fully migrating

### Backward compatibility

- Legacy `/api/cron/morning-brief` STAYS unchanged · still composes
  + pushes to Telegram + writes the BrainMemory row
- New Inngest path is additive · the BrainMemory row is its dependency
- If Inngest is unavailable (env unset · service down) the operator
  still gets the brief on Telegram
- Operator can disable the Telegram push later by removing the
  `sendTelegram(brief.text)` line from the legacy route · purely a
  follow-up · no rush

### Audio caching strategy

Why BrainMemory + base64 instead of a real file store:

- The brief is ~30-60 seconds of audio · typically 80-200 KB
- BrainMemory's `content` column is `Text` · easily holds this
- Zero new infrastructure (no S3 · no Vercel Blob · no Cloudflare R2)
- Operator-only access · BrainMemory rows are owner-scoped
- TTL is implicit · old rows can be reaped by a future cron without
  breaking anything (today's audio is what matters)

If we ever need to serve audio for arbitrary historical dates the
size could grow uncomfortably · at that point we move to a real
blob store. For now: simplest thing that works.

## Rejected alternatives

### Direct integration in the legacy cron route

Add Web Push + Cartesia calls to `/api/cron/morning-brief/route.ts`.
Rejected because:
- The legacy route's failure mode is "all or nothing" — one bad call
  loses the durable BrainMemory write
- Vercel route timeout (max 60s) is tighter than Inngest's per-step
  budget · Cartesia audio gen can take 30s · risky to combine
- Loses the per-step retry semantics that are the whole reason we
  adopted Inngest in Phase 3

### Server-Sent Events for "brief just landed"

Push a real-time event to the chat surface when the brief is ready.
Rejected because:
- The operator isn't in the chat surface at 6am · SSE requires an
  open connection
- Web Push lands regardless of app state · strictly better fit

### iCloud / Google Calendar event for the brief

Create a calendar event at 6am with the brief text in the description.
Rejected because:
- Calendar surfaces are noisy · the operator has real events to track
- The OS doesn't surface calendar event descriptions as push
  notifications by default
- Adds two OAuth integrations we don't currently need

### Self-rendered audio with Web Speech API

Use the browser's built-in `SpeechSynthesis` API instead of Cartesia.
Rejected because:
- iOS Safari's built-in voices are robotic and inconsistent across
  device generations
- Quality matters for daily-listen content · the operator will
  silence robotic voices within a week
- Cartesia Sonic-2 is the existing Phase 4 voice stack · reusing it
  costs $0 in marginal infrastructure (just the per-character TTS
  cost · ~$0.001/brief)

## Consequences

### Positive

- One-tap brief delivery · zero typing · zero app-switching
- Audio path uses existing Phase 4 voice infra · no new vendors
- Per-step retry · Web Push failure doesn't kill audio generation
- Inngest dashboard surfaces brief health · daily one-glance check
- Operator can pause individual channels (e.g. mute Web Push during
  vacation) without touching the composer

### Negative

- Three places now generate operator-facing content from the same
  brief: legacy Telegram cron · Inngest Web Push · Inngest audio.
  Mitigation: composer is the single source · channels are thin
  wrappers · the change surface stays small
- Cartesia daily cost · ~$0.001 per brief · negligible but real
- BrainMemory grows by ~150 KB/day in audio rows · ~55 MB/year ·
  future hygiene cron prunes rows > 30d if storage ever becomes an
  issue

### Neutral

- The audio endpoint is owner-only · no public exposure surface
- The PWA `/voice` page will gain a "play today's brief" button in
  a follow-up (small change · waits for operator to confirm they
  want it next to the push-to-talk surface vs. on `/command`)

## Operator action items

None blocking. Optional (when ready):

1. Subscribe to Web Push on phone (Settings page already has the
   "Enable notifications" toggle · should be on already if VAPID
   was wired previously)
2. Verify `VAPID_PRIVATE_KEY` set in Railway env (already required
   by the existing push pipeline)
3. After the Inngest function ships and runs cleanly for 7 days,
   remove the `sendTelegram(brief.text)` call from
   `/api/cron/morning-brief/route.ts` if the operator prefers
   push-only delivery (purely a preference call)

## References

- `apps/statenour/lib/services/morning-brief.ts` — the composer
- `apps/statenour/lib/notifications/push.ts` — Web Push surface
- `apps/statenour/src/inngest/functions/morning-brief.ts` —
  the new orchestrator
- `apps/statenour/app/api/morning-brief/today.mp3/route.ts` —
  audio playback endpoint
- ADR-0003 · LiveKit operator voice (Cartesia is the same TTS stack)
- ADR-0005 · Inngest durable workflows (the runtime this lives on)
- `docs/WAVE-200-PLAN.md` · Phase 5 entries
