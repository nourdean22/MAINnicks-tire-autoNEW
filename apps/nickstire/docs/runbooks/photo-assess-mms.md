# Photo-Assess MMS · Runbook

**Owner:** operator (Nour)
**Modules:**
- `apps/nickstire/server/services/vision-analyzer.ts`
- `apps/nickstire/server/services/photo-assess-pipeline.ts`
- Webhook wiring · `routes/webhooks/twilio.ts` + `routes/webhooks/smsGateway.ts`
- Admin route · `POST /api/admin/photo-assess`

**Skill-port:** Category 4 of `docs/eval-rubrics/huggingface-model-strategy.md`
**Wave:** AZ
**Last updated:** 2026-05-26

## What this enables

Customer texts a photo of a tire, brake pad, or vehicle issue to 216-862-0005 (or the Twilio number). The pipeline:

1. **MMS detected** · webhook handler picks up the photo URL
2. **Vision model** analyzes the image via Replicate Qwen2-VL-72B (or HF LLaVA fallback)
3. **Structured output** · description + suggested service + urgency
4. **SMS reply** · automated (via NickGPT or template) sent through F25e gateway

Net effect: **after-hours photo inquiries become qualified leads automatically**. The customer gets a response in 5-10 seconds (vs waiting until tomorrow), the operator sees a fully-qualified lead in the admin SMS inbox in the morning.

## What we shipped (Wave AZ)

5 files · all additive, OFF by default:

1. **`server/services/vision-analyzer.ts`** (~290 lines)
   - `analyzePhoto({ photoUrl, prompt?, provider?, model? })`
   - Replicate Qwen2-VL-72B-Instruct (default · pinned version)
   - HF LLaVA-1.5-7b-hf (fallback · cheaper)
   - Automotive-tuned default prompt · returns `description` + parsed `serviceSuggest` + `urgency`
   - URL safety (rejects localhost/private-IPs · Replicate/HF servers can't reach them anyway)
   - 30s timeout · sync-wait + poll fallback

2. **`server/services/photo-assess-pipeline.ts`** (~150 lines)
   - `runPhotoAssess({ phone, photoUrl, source, skipSmsSend? })`
   - Orchestrates vision → optional NickGPT draft → SMS send via `sendSms({ via: "shop" })`
   - Default reply templates for the 5 service categories (operator-pre-vetted)
   - Skips SMS if `skipSmsSend: true` (for preview/test mode)

3. **`server/routes/webhooks/twilio.ts`** (MODIFIED)
   - Reads `NumMedia` + `MediaUrl0` from Twilio webhook body
   - Routes to photo-assess pipeline fire-and-forget when `NumMedia ≥ 1`
   - Empty-body MMS no longer 400s

4. **`server/routes/webhooks/smsGateway.ts`** (MODIFIED)
   - Reads `payload.attachments[]` OR `payload.mediaUrl` from Capevace webhook
   - Routes to photo-assess pipeline fire-and-forget when attachment present
   - Compatible with both Capevace v1 and v2 webhook shapes

5. **`POST /api/admin/photo-assess`** (NEW · in `_core/index.ts`)
   - Admin-key-gated manual trigger · body: `{ phone, photoUrl, skipSmsSend? }`
   - Returns the structured outcome for testing without firing the SMS

## Activation (operator-action)

### Step 1 · Get a Replicate API token

1. Sign up at https://replicate.com (Github OAuth, free $0 trial credits)
2. Account settings → API tokens → create new
3. Copy the `r8_xxx` token

Replicate charges ~$0.0008 per Qwen2-VL-72B inference (~$0.05 per second of compute · ~2-3s per photo). At 50 photos/day = ~$1.20/day = $36/mo. Each photo that converts to a lead is worth $400+ avg ALG ticket · ROI is trivial.

### Step 2 · Set env vars on Railway

```
REPLICATE_API_KEY=r8_xxxxxxxxxxxxxxxx
PHOTO_ASSESS_PROVIDER=replicate
```

If you prefer HF fallback (cheaper · slightly lower quality on automotive imagery):

```
PHOTO_ASSESS_PROVIDER=hf
HF_API_KEY=hf_xxxxxx   # already set if Wave AF/AG/AH are on
```

### Step 3 · Test before enabling

Fire the admin route with `skipSmsSend: true` to validate without spamming a customer:

```bash
curl -X POST https://nickstire.org/api/admin/photo-assess \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12165550100",
    "photoUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Worn_tire_2.JPG/640px-Worn_tire_2.JPG",
    "skipSmsSend": true
  }'
```

Expected:

```json
{
  "ok": true,
  "description": "This tire shows significant tread wear · the tread blocks are visibly worn down to near-bald in the center · this tire is unsafe and needs replacement. SERVICE_SUGGEST: tire-replacement. URGENCY: immediate.",
  "serviceSuggest": "tire-replacement",
  "urgency": "immediate",
  "smsSent": false,
  "visionLatencyMs": 3200,
  "visionSource": "replicate"
}
```

Eyeball the description. If it's accurate on 5-10 sample photos, proceed. If hallucinating (e.g. says "brake damage" on a tire photo), try the HF fallback OR adjust the prompt in vision-analyzer.ts.

### Step 4 · Enable the feature flag

```typescript
fetch("/api/trpc/featureFlags.toggle", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({"0":{"json":{"key":"photo_assess_enabled","value":true}}})
})
```

OR via the admin REST API:

```bash
curl -X POST https://nickstire.org/api/admin/flags/toggle \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"photo_assess_enabled","value":true}'
```

### Step 5 · Verify production flow

Send yourself an MMS from your phone to 216-862-0005 with a photo of a tire. Within 10 seconds you should:
1. See the pipeline fire in logs · `photo_assess_start` + `photo_assess_vision_ok`
2. Receive an SMS reply on your phone matching the default template

If reply doesn't arrive:
- Check `sendSms` logs · maybe TCPA opt-out / hours / rate-limit blocked
- Check `photo_assess_sms_failed` log · maybe gateway routing failed
- Run `/api/health` · confirm `photo_assess.providerReachable: true`

### Step 6 · Monitor the first week

Eyeball every photo-assess outcome in admin SMS inbox. Watch for:

- **False positives** · model says "tire replacement" on a brake photo. If >10% wrong-category, switch to LLaVA OR tighten the prompt.
- **Hallucination** · model invents damage that isn't there. Lower the temperature or add a "describe only what you can see" instruction.
- **Customer confusion** · template reply doesn't match the actual damage. Customize `DEFAULT_REPLIES` in photo-assess-pipeline.ts.

## Anti-patterns

### "Auto-reply without operator-review period"

Vision models hallucinate. Spending one week eyeballing every outcome BEFORE going hands-off is mandatory · not optional. The operator-edit-rate signal tells you when to trust auto-reply.

### "Public photo URL not actually public"

Replicate/HF fetch the photo from URL · they can't reach localhost / private S3 buckets / signed URLs that expire fast. ALWAYS verify the URL is publicly reachable with a `curl -I` before debugging the pipeline.

### "Skip the URL safety check"

`vision-analyzer.ts isValidPublicUrl()` rejects localhost/private IPs but does NOT validate content. A malicious customer could send a URL pointing to disturbing content. Consider rate-limiting per-phone OR running a NSFW classifier (HF strategy Cat 3) before the vision call.

### "Forget TCPA on the reply"

The reply goes through `sendSms` which applies opt-out + sending-hours · GOOD. But if you switch to a different reply path, you re-introduce the compliance gap. Keep all customer-facing replies routing through sendSms.

### "Send to wrong number"

The webhook's `from` field is the CUSTOMER's number. Double-check before adding any path that reuses `to` (the shop number) · sending Nick replies to himself is a fast way to disable the pipeline by misroute.

## Cost ceiling

| Item | Cost | Notes |
|---|---|---|
| Per Replicate Qwen2-VL inference | $0.0008-0.002 | 2-4s on Replicate · billed per second |
| Per HF LLaVA inference (fallback) | $0.0001-0.0003 | Cheaper but 7B vs 72B · lower quality on automotive |
| SMS reply via shop gateway | $0 marginal | F25e routes through your Verizon line · unlimited |
| **Per photo total** | **~$0.001-0.002** | Trivial at any volume |

50 photos/day = ~$0.10/day = $3/mo. The conversion uplift dwarfs this.

## Spanish-language photos

Qwen2-VL handles non-English text in images natively. For Spanish-speaking customers texting photos with Spanish captions, the model auto-detects and reasons accordingly. The reply template should be Spanish — translate `DEFAULT_REPLIES` using HF's `Helsinki-NLP/opus-mt-en-es` (Cat 10 unlock).

## Combine with other waves

The full personalized after-hours funnel is:

1. Customer texts photo (Wave AZ · this runbook)
2. Vision analyzes → `service_suggest: tire-replacement`
3. NickGPT (Wave AE) drafts a reply in operator voice
4. Reply sent via shop gateway with `{ via: "shop" }`
5. Operator follows up next morning · OR
6. If service is `tire-replacement` + `urgency: immediate`, optionally trigger an outbound voicemail (Wave AI XTTS-v2) at 8AM the next day saying "Hey, this is Nick · saw your tire pic last night..."

All shipped. Operator wires it together per cohort policy.

## Rollback

Pure flag-flip:

```bash
curl -X POST https://nickstire.org/api/admin/flags/toggle \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"photo_assess_enabled","value":false}'
```

MMS detection still fires the pipeline · but `analyzePhoto` returns `{ ok: false, reason: "disabled" }` immediately · webhook returns its normal 200 ack · no customer-facing change.

To fully bypass: unset `REPLICATE_API_KEY` and `HF_API_KEY` · pipeline returns no_provider · webhook unchanged.

## Skill-port lineage

Category 4 of `docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `docs/eval-rubrics/huggingface-model-strategy.md` Cat 11 (domain datasets · fine-tune a tire/brake-specific vision model when corpus is large enough)
- `docs/runbooks/nickgpt-finetune.md` (Wave AE · drafts the reply in operator voice)
- `docs/runbooks/voice-clone-setup.md` (Wave AI · outbound voicemail follow-up on `urgency: immediate`)
- `docs/runbooks/classifiers.md` (Wave AF · NSFW classifier could pre-filter photos · prompt-injection screen on caption text)
- F25e SMS gateway (the reply routes through `{ via: "shop" }` · same path as every other customer-facing SMS · TCPA compliance free)
- `docs/eval-rubrics/autonomous-action-tiers.md` (Tier-2 reviewable · auto-reply with explicit operator-set defaults · upgrade to Tier-3 once operator-edit-rate < 20%)

Future · fine-tune a vehicle-damage classifier on operator-labeled photos (`tire-wear: heavy/medium/light` · `brake-pad-mm: 3/5/8`) for cheaper + more accurate routing than the general-purpose VLM.
