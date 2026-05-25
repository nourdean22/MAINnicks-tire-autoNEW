# Replicate FLUX Cutover · Runbook

**Owner:** operator (Nour)
**Module:** `apps/statenour/lib/ai/replicate-flux.ts` + `lib/ai/venice-image.ts` (delegation hook)
**Skill-port:** Category 8 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`
**Wave:** AJ
**Last updated:** 2026-05-26

## Why migrate

| Backend | Cost / image | Quality | Latency |
|---|---|---|---|
| **Venice flux-2-pro** (current) | $0.04 | High · matches FLUX paper | 8-15s |
| **Replicate flux-schnell** (Wave AJ) | $0.003 | High · 4-step distilled · slight quality dip vs dev | 1-3s |
| Replicate flux-dev | $0.025 | Highest · 28-step · matches Venice | 4-8s |

At current image-gen volume (50 blog/OG/programmatic-SEO images/day) Venice bill is ~$60/mo. Replicate flux-schnell brings it to ~$5/mo at comparable marketing quality. **12-20× savings**.

The flux-schnell quality dip is real but mostly invisible on graphic-design/marketing imagery (the bulk of operator's image use). For high-fidelity product photos, use flux-dev (still 1.6× cheaper than Venice).

## What we shipped (Wave AJ)

3 files · additive, OFF by default:

1. **`lib/ai/replicate-flux.ts`** (NEW · ~170 lines)
   - `generateReplicateFluxImage(prompt, options)` · matches `generateVeniceImage` return shape (ImageResult)
   - Replicate sync-wait create + poll fallback
   - Default model `flux-schnell` · `flux-dev` selectable via option OR `REPLICATE_FLUX_MODEL` env
   - Auto width/height (FLUX accepts multiples of 16 · clamped 256-1792)
   - Fetches result URL + base64-encodes for Venice-compat shape

2. **`lib/ai/venice-image.ts`** (MODIFIED · 17 lines inserted)
   - Early check · if `REPLICATE_FLUX === "true"` AND `REPLICATE_API_KEY` set, delegate to Replicate
   - Falls back to Venice silently on Replicate failure
   - Zero call-site changes · existing `generateVeniceImage(prompt, ...)` callers work unchanged

3. **`lib/feature-flags.ts`** (MODIFIED)
   - `REPLICATE_FLUX` registered in FLAG_REGISTRY (experimental status)

## Activation (operator-action)

### Step 1 · Get a Replicate API token

(If Wave AI or AZ are activated, the same key works · skip to Step 2.)

1. Sign up at https://replicate.com (Github OAuth, free trial credits)
2. Account settings → API tokens → create new
3. Copy the `r8_xxxxxx` value

### Step 2 · Set env vars on Vercel

```
REPLICATE_API_KEY=r8_xxxxxxxxxxxxxxxx
REPLICATE_FLUX=true
```

Optional · pin a specific model variant:

```
REPLICATE_FLUX_MODEL=flux-schnell  # default · 4-step · $0.003/img
# OR
REPLICATE_FLUX_MODEL=flux-dev      # 28-step · $0.025/img
```

### Step 3 · Deploy

Push the Wave AJ commits · Vercel redeploys.

### Step 4 · Verify routing

Trigger any image-gen path · the chat image-generation, blog hero generation, or a manual test:

```typescript
import { generateVeniceImage } from "@/lib/ai/venice-image";
const result = await generateVeniceImage("a Cleveland tire shop at sunset, vintage poster style");
console.log(result.model);  // → "replicate:flux-schnell" instead of "flux-2-pro"
console.log(result.imageUrl);  // Direct Replicate URL · valid ~1hr
```

If `model` still shows `flux-2-pro`, the flag isn't honored · check env vars on Vercel.

### Step 5 · A/B quality compare

Generate the same 10 prompts via both backends. Eyeball results. Replicate flux-schnell should be:
- Same or slightly worse text rendering
- Same composition / color
- Faster generation
- ~12× cheaper

If quality regression is noticeable, switch to `REPLICATE_FLUX_MODEL=flux-dev` (still 1.6× cheaper than Venice with equal quality).

### Step 6 · Monitor 1 week

Watch for:
- Replicate API errors in logs (`[venice-image] Replicate FLUX failed · falling back to Venice`)
- Operator complaints about image quality (if Replicate is producing visibly worse output)
- Cost drop on Replicate dashboard

After 1 week of green telemetry, the migration is stable.

## Image quality notes per model

| Model | Best for | Avoid for |
|---|---|---|
| flux-schnell | Marketing graphics · social posts · OG images · programmatic SEO banners | Photorealistic product shots · highly-detailed text |
| flux-dev | Photorealistic · detailed product shots · text-heavy compositions | Anything you'd use schnell for (overkill) |
| Venice flux-2-pro | (current) Same as flux-dev · slightly different style | n/a |

## Rollback

Pure flag-flip:
1. Set `REPLICATE_FLUX=false` (or unset) on Vercel
2. Redeploy OR wait for the next request · venice-image.ts skips delegation, calls Venice directly
3. Zero code change

If Replicate is unstable for a specific call:
- The wrapper's try/catch automatically falls through to Venice on any thrown error
- Operator sees the fallback in logs · doesn't impact the image being generated

## Cost ceiling

At various volume levels:

| Daily images | Venice ($0.04) | Replicate schnell ($0.003) | Replicate dev ($0.025) |
|---|---|---|---|
| 10/day | $12/mo | $0.90/mo | $7.50/mo |
| 50/day | $60/mo | $4.50/mo | $37.50/mo |
| 200/day | $240/mo | $18/mo | $150/mo |
| 1000/day | $1200/mo | $90/mo | $750/mo |

The savings compound with volume. Even at 10 images/day the flag is worth flipping.

## Anti-patterns

### "Use schnell for everything"

flux-schnell is fast + cheap but quality has a ceiling. For hero images on customer-facing pages, opt up to flux-dev OR Venice. Schnell shines on bulk social/OG/programmatic uses.

### "Flip the flag without A/B"

Image quality differences are subjective · you have to look at side-by-side outputs to decide. Generate 10 representative prompts via both backends before committing.

### "Cache nothing"

Replicate image URLs expire after ~1 hour. If you're storing images for OG meta tags or blog headers, persist them to S3/R2 immediately OR base64-inline them in the page response (the wrapper already returns base64 by default · don't discard it).

### "Forget to monitor"

The fall-back path silently calls Venice when Replicate fails · without monitoring, you might think you're saving money while Replicate is broken every other call. Check the Replicate dashboard weekly · if >5% of calls falling back, investigate.

## Skill-port lineage

Category 8 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `apps/statenour/lib/ai/venice-image.ts` (the unchanged caller-side · just adds delegation hook)
- `apps/statenour/lib/feature-flags.ts` (REPLICATE_FLUX registered)
- Wave AG (BGE rerank · SAME REPLICATE_API_KEY · though rerank doesn't actually use Replicate · the key is shared infra)
- Wave AI (XTTS-v2 voice clone · SAME REPLICATE_API_KEY · voice + image both flow through Replicate)
- Wave AZ (Photo-damage MMS · SAME REPLICATE_API_KEY · vision in / image out · all Replicate)

Future · once flux-schnell is stable, the next move is per-request model picking · "this prompt is a social post → schnell · this is a blog hero → dev." A small classifier (HF strategy Cat 3) could decide on the fly.
