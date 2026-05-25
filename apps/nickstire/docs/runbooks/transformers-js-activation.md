# Transformers.js Activation · In-Browser AI

**Owner:** operator (Nour)
**Module:** `apps/nickstire/client/src/lib/transformers/`
**Skill-port:** Category 9 of `docs/eval-rubrics/huggingface-model-strategy.md`
**Wave:** AL
**Last updated:** 2026-05-26

## What this is

ONNX-converted HuggingFace models that run **in the customer's browser** via `@xenova/transformers`. Zero server cost · sub-100ms UX after first load · works offline-after-first-cache.

3 high-impact use cases:

| Capability | Model | Size | First-load | Use case |
|---|---|---|---|---|
| **Spanish auto-detect** | `Xenova/xlm-roberta-base-language-detection` | 170MB | ~3-5s | Chat widget auto-switches language when customer types in Spanish |
| **Sentiment tagging** | `Xenova/bert-base-multilingual-uncased-sentiment` | 170MB | ~3-5s | Contact form shows "frustrated" badge before operator replies |
| **Tire-size OCR** | `Xenova/trocr-small-printed` | 60MB | ~2-3s | Customer uploads sidewall photo · "225/65R17" extracted client-side |

## What we shipped (Wave AL)

3 files in `client/src/lib/transformers/`:

1. **`README.md`** · directory map + activation order
2. **`lazy-load.ts`** (~90 lines) · `getPipeline(task, model)` · dynamic-imports `@xenova/transformers` on first use · caches pipelines in module scope · all callers share one instance
3. **`language-detect.ts`** (~75 lines) · `detectLanguage(text)` + `isSpanish(text)` · the lowest-friction example

**Not added to `package.json` yet** · operator decides when to opt in (the dep is ~250KB gzipped, dynamically imported · doesn't bloat main bundle until first call).

## Activation (operator-action)

### Step 1 · Decide which capability to ship first

Lowest-friction first move = Spanish auto-detect on the chat widget. Validates the whole stack with one user-facing change.

### Step 2 · Install the dep

```bash
pnpm --filter @nickstire/nickstire add @xenova/transformers
```

This adds ~250KB to the **dynamically-imported chunk** · NOT to the main bundle. Main bundle stays under the current budget. Verify with `pnpm --filter @nickstire/nickstire run build` + bundle analyzer · the `@xenova/transformers` chunk should NOT appear in the entry chunk.

### Step 3 · Wire into the chat widget (example)

Edit `client/src/components/Chat.tsx` (or whatever the chat widget is named — operator confirms):

```tsx
import { detectLanguage } from "@/lib/transformers/language-detect";

const [chatLanguage, setChatLanguage] = useState<"en" | "es">("en");

const onUserMessage = async (text: string) => {
  // Fire language detection in parallel with normal send
  detectLanguage(text).then((result) => {
    if (result.modelRan && result.language === "es" && result.confidence >= 0.85) {
      if (chatLanguage !== "es") {
        setChatLanguage("es");
        // Optionally surface a "Switched to Spanish · cambiamos al español"
        // toast so customer sees the language change is intentional
      }
    }
  });
  // Continue normal send · don't block on detection
  await sendChatMessage(text, { language: chatLanguage });
};
```

The detection runs in PARALLEL with the send · zero added latency on the first message · the model loads in the background while the customer is reading the bot's response. By message 2+, detection is sub-100ms.

### Step 4 · Service-worker caching for offline

The `prerendered/` deploy pipeline already caches static assets aggressively. Transformers.js model files download from `https://huggingface.co/Xenova/<model>/resolve/main/onnx/*` · IDB is the library's first-line cache. If you want extra-aggressive caching (e.g. pre-warm on landing page), add to `service-worker.js`:

```js
const HF_MODEL_CACHE = "hf-models-v1";
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.host === "huggingface.co" && url.pathname.includes("/Xenova/")) {
    event.respondWith(
      caches.open(HF_MODEL_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        cache.put(event.request, response.clone());
        return response;
      }),
    );
  }
});
```

This makes the first-load cost amortize across the customer's entire site visit · not per-tab-reload.

### Step 5 · Roll out to other surfaces

After Spanish auto-detect ships + works for 1 week with zero complaints:

**Sentiment tagging on contact form** · 1 hour wire-up · same lazy-load pattern · new module `sentiment.ts`:

```ts
import { getPipeline } from "./lazy-load";

export async function getSentiment(text: string): Promise<"positive" | "neutral" | "negative"> {
  const classifier = await getPipeline(
    "text-classification",
    "Xenova/bert-base-multilingual-uncased-sentiment",
  );
  const output = await classifier(text);
  const top = (output as Array<{ label: string; score: number }>)[0];
  // Model labels are "1 star" through "5 stars" · map to buckets
  const stars = parseInt(top.label.charAt(0));
  if (stars <= 2) return "negative";
  if (stars >= 4) return "positive";
  return "neutral";
}
```

Wire to ContactForm submit → POST a `frustrationLevel` field with the lead. Operator sees the tag in admin LeadsBrief.

**Tire-size OCR** · larger lift · the photo-upload widget needs Canvas integration · tire sidewall ROI cropping · feed cropped image to `Xenova/trocr-small-printed`. Worth it because customers regularly text photos of sidewalls.

## Bundle size discipline

Default rule · `@xenova/transformers` MUST be dynamically imported, never top-level. Each call site uses `import("@xenova/transformers")` or routes through `lazy-load.ts`.

Verify after every PR:

```bash
pnpm --filter @nickstire/nickstire run build
ls -lh dist/assets/index-*.js  # main bundle · check size delta
ls -lh dist/assets/*xenova*.js  # transformers chunk · should be its own lazy chunk
```

Threshold · main bundle delta from Transformers.js should be **< 10KB** (the dynamic-import overhead · not the package itself).

## Anti-patterns

### "Top-level import of @xenova/transformers"

Adds the entire library (~250KB gzipped) to the main bundle · zero customers benefit · 100% pay the bandwidth cost. Always dynamic-import.

### "Run on every keystroke"

Detect-as-you-type on each character == 10× model invocations per message. Use debouncing or run only on message-send.

### "Trust 0.5 confidence"

170MB language model · 0.5 confidence means "probably wrong." Always threshold at 0.85+ for action; below that, treat as ambiguous + fall back to keyword detection.

### "Forget SSR"

`canRunTransformersJs()` returns false on SSR. Callers MUST handle the false case · don't crash the Next.js prerender.

### "Skip the offline-cache"

The 170MB first-load is the price · pay it ONCE then the SW cache makes every subsequent visit free. Without the SW cache, customers re-download on each visit · slow + expensive bandwidth-wise.

## Cost ceiling

Per session:
- First-load: 170MB download (one-time · IDB-cached after)
- Per inference: 50-200ms compute on customer's CPU
- Server cost: **$0** · entirely in-browser

Bandwidth cost is on the customer's end · same as any other static asset.

## Rollback

If browser-side AI causes complaints (slow first-load, memory pressure on old phones):

1. Revert the calling component's import · zero deploy chain
2. Optionally `pnpm remove @xenova/transformers` if you want to free the chunk slot
3. The lazy-load.ts + language-detect.ts files stay · harmless without the package

If a specific model causes issues (false-positives in Spanish detection): swap the model name in `language-detect.ts` · Xenova has alternatives (`Xenova/papluca-language-detection` is smaller · 90MB · 90% accuracy on 6 langs).

## Skill-port lineage

Category 9 of `docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- Cat 10 (Spanish unlock · this is the BROWSER-side complement to the SERVER-side HF embeddings + XTTS-v2 Spanish)
- `docs/eval-rubrics/landing-page-template.md` (the customer-facing UX surface · most relevant for chat widget + contact form integrations)
- `docs/eval-rubrics/agent-ready-apis.md` (downstream · agent uses the language-tagged messages for routing)
- `docs/runbooks/classifiers.md` (Wave AF · SERVER-side classifier counterpart · use whichever has lower latency per call site)

Future · once Transformers.js is in production, the next move is on-device fine-tuning · `Xenova/distilbert-base-uncased-finetuned-sst-2-english` can be fine-tuned in-browser via `@xenova/transformers` LoRA support · operator-corrected sentiment labels become the moat.
