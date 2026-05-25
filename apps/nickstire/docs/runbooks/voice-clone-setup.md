# Voice Clone Setup · XTTS-v2 Outbound Voicemail

**Owner:** operator (Nour)
**Module:** `apps/nickstire/server/services/voice-clone.ts`
**Skill-port:** Category 6 of `docs/eval-rubrics/huggingface-model-strategy.md`
**Last updated:** 2026-05-26

## What this enables

Personalized outbound voicemails in the operator's actual voice. Customer's voicemail plays:

> "Hey Linda, this is Nick from Nick's Tire & Auto · quick follow-up on those brakes we estimated last week. Call me back at 216-862-0005 when you get a chance."

vs. a generic robot voice. Conversion lift on declined-work recovery is 2-4× per industry benchmarks (Datadog · Cartesia case studies). Same play applies to:

- 30-day retention voicemails (cohort that hasn't been in for 6 months)
- Booking-confirmation voicemails (when SMS isn't read)
- High-value VIP outreach
- Spanish-language outbound (XTTS-v2 supports Spanish · pairs with Cat 10 HF strategy)

## What we shipped (Wave AI)

One file · the inference client:

- `apps/nickstire/server/services/voice-clone.ts` (~250 lines)
  - `cloneVoice({ text, voiceSampleUrl?, language?, provider? })` → `{ audioUrl }` or error
  - Replicate backend (default) · synchronous wait + poll fallback
  - Modal backend (self-host alternative)
  - `checkVoiceCloneHealth()` for `/api/health` surface
  - Feature-flag gated · `outbound_voicemail_enabled` OFF default

This does NOT place calls. It generates audio URLs. The caller (cron / endpoint) places the call via Twilio Voice and uses TwiML `<Play>` on the URL. The full pipeline below.

## Activation (operator-action)

### Step 1 · Record the voice sample

Record 6-30 seconds of operator (Nour) speaking clearly. Tips:
- Quiet room, no background music
- Read a representative sentence: "Hey, this is Nick from Nick's Tire and Auto. I'm calling about your appointment."
- Save as WAV (preferred) or 320kbps MP3
- Closer to 10-15 seconds is better quality than 6

### Step 2 · Host the sample publicly

The Replicate API fetches the sample server-side. Options:
- **S3 / R2** · upload to a public bucket · use the direct object URL
- **GitHub** · commit to a `voices/` dir on a public repo · use the raw URL (e.g. `https://raw.githubusercontent.com/.../voices/nour-2026.wav`)
- **Static asset on nickstire.org** · drop in `client/public/voices/` · serve at `https://nickstire.org/voices/nour-2026.wav` (cleanest · couples voice asset to the deploy)

Verify the URL is reachable:

```bash
curl -I "https://your-host/voices/nour-2026.wav"
# Expect: 200 OK · content-type: audio/wav or audio/mpeg
```

### Step 3 · Set env vars on Railway

```
REPLICATE_API_KEY=r8_xxxxxxxxxxxxxxxxxxxxxxx
XTTS_VOICE_SAMPLE_URL=https://nickstire.org/voices/nour-2026.wav
XTTS_PROVIDER=replicate
```

For Modal alternative:

```
XTTS_PROVIDER=modal
XTTS_MODAL_URL=https://your-modal-deployment.modal.run
XTTS_MODAL_AUTH=optional-bearer-token
```

### Step 4 · Enable the feature flag

From admin tab:

```typescript
fetch("/api/trpc/featureFlags.toggle", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({"0":{"json":{"key":"outbound_voicemail_enabled","value":true}}})
})
```

### Step 5 · Verify reachability

```typescript
const { checkVoiceCloneHealth } = await import("./services/voice-clone");
console.log(await checkVoiceCloneHealth());
// { enabled: true, provider: "replicate",
//   sampleReachable: true, providerReachable: true }
```

### Step 6 · Test inference (one-off)

```typescript
const { cloneVoice } = await import("./services/voice-clone");
const result = await cloneVoice({
  text: "Hey Linda, this is Nick from Nick's Tire and Auto. Quick follow-up on your brakes. Call me back at 216-862-0005.",
});
console.log(result);
// { ok: true, audioUrl: "https://replicate.delivery/...mp3", source: "replicate", latencyMs: 3200 }
```

Open the audio URL in a browser · listen · verify it sounds like operator. If quality is off:
- Re-record the sample with better mic / quieter room
- Try a longer sample (15-30s)
- Switch `cleanup_voice: false` in voice-clone.ts cloneViaReplicate input (rare · usually cleanup helps)

## The full outbound-voicemail pipeline (operator next steps · NOT shipped in AI wave)

The voice-clone client is one piece. The full outbound voicemail pipeline (not yet wired) needs:

### Component 1 · Audio storage

Replicate-returned URLs expire after ~1 hour. For voicemails placed minutes later this is fine. For batch generation OR retention voicemails scheduled days out, MUST cache the MP3:

```typescript
// pseudocode · download from Replicate, store in S3 with public URL
const replicateResp = await cloneVoice({ text, voiceSampleUrl });
const audioBuffer = await fetch(replicateResp.audioUrl).then((r) => r.arrayBuffer());
const persistentUrl = await uploadToS3({
  key: `voicemails/${customerPhone}-${Date.now()}.mp3`,
  body: Buffer.from(audioBuffer),
  contentType: "audio/mpeg",
  acl: "public-read",
});
```

### Component 2 · Twilio Voice call

Use Twilio's REST API to place an outbound call · pass a TwiML URL that returns `<Play>` instructions:

```typescript
const call = await twilioClient.calls.create({
  to: customerPhone,
  from: process.env.TWILIO_PHONE_NUMBER,
  url: `${process.env.SITE_URL}/api/twiml/play-voicemail?audioUrl=${encodeURIComponent(persistentUrl)}`,
  machineDetection: "Enable",
  machineDetectionTimeout: 30,
});
```

The `machineDetection: "Enable"` makes Twilio detect if it hit voicemail vs human · the TwiML endpoint should only play the audio AFTER beep on voicemail. For voicemail-only delivery, use `AmdStatusCallback` or `machineDetectionSilenceTimeout`.

### Component 3 · TwiML response

New route `apps/nickstire/server/routes/api/twiml/play-voicemail.ts`:

```typescript
router.post("/play-voicemail", (req, res) => {
  const audioUrl = req.query.audioUrl as string;
  const isMachine = req.body.AnsweredBy === "machine_start" || req.body.AnsweredBy === "fax";
  if (!isMachine) {
    // Live human picked up · we can either play the voicemail (rude) or hang up politely
    res.type("text/xml").send(`<Response><Hangup/></Response>`);
    return;
  }
  res.type("text/xml").send(`<Response><Play>${audioUrl}</Play><Hangup/></Response>`);
});
```

### Component 4 · TCPA compliance + timing

Outbound calls are MORE TCPA-sensitive than SMS. Operator MUST:
- Respect 8AM-8PM ET sending window (same as SMS · cross-ref `apps/nickstire/server/sms.ts` isWithinSendingHours)
- Honor opt-out · customer can text STOP to the shop gateway OR press 1-2 during a previous call to opt out
- Maintain a do-not-call internal list separate from SMS opt-out
- Max 1 voicemail per customer per 30 days (industry guidance)
- Track + log every call for the 4-year TCPA retention requirement

### Component 5 · The triggering cron

Daily cron · loop over a target cohort (declined-work, 30-day retention, etc.) · for each customer:
1. Skip if opted-out / DNC list / last-voicemail < 30d
2. Generate text (could use NickGPT drafter · Wave AE)
3. Call `cloneVoice()` to generate MP3 URL
4. Optionally cache to S3 for durability
5. Place the call via Twilio
6. Log to `outbound_voicemails` table

## Cost

| Item | Replicate | Modal (self-host) |
|---|---|---|
| Per voicemail generation | ~$0.012 (XTTS-v2 ~3s on A10G) | ~$0.005 (Modal A10G $0.50/hr · 4s per call) |
| Twilio outbound call | ~$0.014/min | $0.014/min |
| Audio storage (S3/R2) | $0 trivial for MP3s | $0 trivial |
| **Per voicemail total** | **~$0.025-0.05** | **~$0.02-0.04** |

At 50 voicemails/day = ~$1.50-2.50/day = ~$50-75/mo. Pays for itself with one converted estimate (avg ALG ticket $400).

## Anti-patterns

### "Voice clone without sample-quality check"

Bad samples produce bad clones · the customer hears "Nick" but it sounds robotic / off-cadence. The conversion lift evaporates. Spend 20 minutes on a clean recording before deploying.

### "Place call without machine-detection"

Living humans hearing a clone of your voice playing a 30-second message is creepy at best, brand-damaging at worst. ALWAYS use Twilio's machine-detection · only play on voicemail · hang up on live answers.

### "No opt-out path"

TCPA violations are $500-$1500 per call. The voicemail MUST end with: "If you'd rather not receive these, text STOP to 216-862-0005." OR similar. Verify every script.

### "Skip the time-window check"

Calling at 7AM is a TCPA violation. The cron MUST gate on the 8AM-8PM ET window same as SMS. Don't trust caller-provided timestamps.

### "Cache nothing"

Replicate audio URLs expire after ~1hr. If you queue voicemails for later delivery, the URL is dead by then. Cache to S3 OR generate just-in-time before the call.

## Spanish-language voicemail (Cat 10 unlock)

XTTS-v2 supports Spanish natively. Same operator voice sample + `language: "es"` parameter → cloned voice in Spanish. The text-to-speak should be Spanish (use HF Inference's Helsinki-NLP/opus-mt-en-es to translate, per Cat 10).

This unlocks the Cleveland Spanish-speaking customer base for personalized outreach · zero additional infrastructure beyond what's already in this wave + Cat 10 translation client.

## Rollback

If the voicemails cause complaints:
1. Toggle `outbound_voicemail_enabled` OFF · cron stops generating
2. Investigate · sample quality? Wrong cohort? Bad time window?
3. Fix and re-enable OR keep off · pure flag rollback, no deploy

If Replicate is unstable:
1. Switch `XTTS_PROVIDER=modal` if Modal endpoint is set up
2. OR set `XTTS_PROVIDER=` empty · feature flag still on but `cloneVoice()` returns `no_provider` error · caller gracefully skips voicemails for that day

## Skill-port lineage

Category 6 of `docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `docs/eval-rubrics/huggingface-model-strategy.md` Cat 10 (Spanish unlock · XTTS supports `language: "es"`)
- `docs/runbooks/nickgpt-finetune.md` (Wave AE · NickGPT drafts the TEXT that XTTS speaks · two pieces of the personalized outreach stack)
- `docs/eval-rubrics/autonomous-action-tiers.md` (outbound voicemail is Tier-1 reviewable · operator must approve cohort + sample before bulk send)
- `docs/eval-rubrics/sms-objection-preempt.md` (the voicemail-then-SMS sequence is a documented pattern · voice catches attention, SMS lets them respond)
- Memory F25e SMS gateway (the OPT-OUT must also honor SMS STOP · voicemails do NOT have a separate opt-out cache)

Future · combine with the declined-work-recovery cron · generate per-customer personalized voicemails referencing their specific declined service · highest-leverage conversion path.
