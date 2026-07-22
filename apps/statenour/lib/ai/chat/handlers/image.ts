/**
 * Chat fast-path · IMAGE handler
 *
 * "/img <prompt>" or "make me a picture of …" routes here instead of
 * going through the model pipeline. Streams a placeholder + heartbeat
 * immediately, calls the image provider (Venice → Gemini fallback),
 * then streams the final markdown. Persists both to ChatMessage.
 *
 * Apr 27 · STREAM-WITH-HEARTBEAT — was a single-shot SSE that fired
 * the entire response AFTER Venice returned (5-22s wait). Client
 * silent-retry hook fires at 6s no-token threshold and again at 22s
 * for auto-fallback, which:
 *   1. Showed Nour "reconnecting…" UI even though gen was working
 *   2. Triggered duplicate /api/ai/chat POSTs that called Venice
 *      AGAIN — explained the Venice rate-limiting + 25 images in 5min
 *   3. Made it look like image gen was broken when the response was
 *      en-route the whole time
 *
 * Now: stream a placeholder text-delta IMMEDIATELY (resets the no-
 * token clock), heartbeat every 3s while Venice works, then stream
 * the real markdown when Venice returns.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";

export async function handleImage(
  convId: string,
  userContent: string,
  isSlash: boolean,
  priorAssistantContent?: string | null,
  priorUserContent?: string | null,
): Promise<Response> {
  // Parse + brand the prompt OUTSIDE the stream so error paths return
  // a cleaner JSON 503 instead of a half-streamed SSE.
  // v10.0.333 · switched from generateVeniceImage (recraft-v4 / seedream-v4)
  // to generateOpenAiImage (gpt-image-1) per Nour's request — gpt-image-1
  // had better text rendering than the older Venice models.
  // v10.0.477 · REVERTED to generateVeniceImage. OpenAI's gpt-image-1
  // hit Nour's billing cap ($0.19-0.25/img) and the chat path failed.
  // v10.0.529.47 · NOW uses generateImageWithFallback (Venice → Gemini
  // gemini-2.5-flash-image on 402 · 429 · 5xx). Same ImageResult shape ·
  // streaming + persist pipeline unchanged. The "generateOpenAiImage"
  // alias kept for historical readability · the import target swapped
  // under the hood. Real-world rationale: Venice 402'd during the
  // 2026-05-13 outage and the chat surface had no image fallback ·
  // Gemini's nano-banana is free-tier on Google AI Studio.
  const { generateImageWithFallback: generateOpenAiImage } = await import("@/lib/ai/gemini-image");
  let imagePrompt = userContent.trim();
  if (isSlash) {
    imagePrompt = imagePrompt.replace(/^\/(img|image|picture)\s*/i, "").trim();
  } else {
    imagePrompt = imagePrompt
      .replace(
        /^(generate|make|create|draw|show\s+me|give\s+me)\s+(me\s+)?(an?\s+|the\s+)?(image|picture|photo|pic|illustration|rendering|artwork|visual)(\s+of|\s+showing|\s+for|:)?\s*/i,
        "",
      )
      .replace(/[.!?]+$/, "")
      .trim();
  }
  // Apr 27 v2 · CONTEXT-AWARE PROMPT SYNTHESIS
  //
  // Three cases the synth handles cleanly:
  //   · Empty prompt ("/img" alone) + prior content → synth from prior
  //   · Referential prompt ("now generate the picture") + prior → synth
  //   · Self-contained prompt ("a F-150 on a lift, gold accent") → pass through
  //
  // The synth call adds ~1-2s for cases 1 & 2, costs nothing for case 3.
  // Without it, "now generate the picture" went to Venice as 4 literal
  // words and produced random landscape art instead of the intended
  // tire/shop scene the user was clearly asking for in context.
  if (!imagePrompt && priorAssistantContent?.trim()) {
    // Empty prompt with prior content — let synth decide everything.
    // Setting it to a generic referential phrase ensures looksReferential
    // returns true and the synth fires.
    imagePrompt = "the picture for that";
  } else if (!imagePrompt) {
    // No prompt AND no prior context — fall back to brand identity image.
    imagePrompt =
      "A professional auto repair shop with sleek black and gold branding, modern bay with car on lift, mechanic working, neon sign reading Nick's Tire & Auto";
  }

  // Synthesize from prior conversation when user prompt is referential.
  // Pass-through (zero cost) when prompt is self-contained.
  // v6 · synth tracking — exposed so the SSE stream below can show a
  // dedicated synth heartbeat for the 2-5s synth-LLM call (otherwise
  // the user sees nothing for those seconds before "Generating image…").
  let synthesizedPrompt = imagePrompt;
  let synthFootnote = "";
  let synthHappened = false;
  let synthDurationMs = 0;
  if (priorAssistantContent?.trim() || priorUserContent?.trim()) {
    const synthStartedAt = Date.now();
    try {
      const { synthesizeImagePrompt } = await import(
        "@/lib/ai/image-prompt-synth"
      );
      const synthResult = await synthesizeImagePrompt({
        userPrompt: imagePrompt,
        priorAssistant: priorAssistantContent ?? null,
        priorUser: priorUserContent ?? null,
      });
      synthesizedPrompt = synthResult.prompt;
      synthDurationMs = Date.now() - synthStartedAt;
      if (synthResult.synthesized) {
        synthHappened = true;
        // Add a small italic footnote so the user can SEE what we synthesized
        // — no hidden behavior. They can spot drift and say "no, do X instead."
        synthFootnote = `\n\n_Synthesized from prior turn: ${synthesizedPrompt.slice(0, 140)}${synthesizedPrompt.length > 140 ? "…" : ""}_`;
      }
    } catch (synthErr) {
      // Non-fatal — fall back to literal prompt
      console.warn(
        `[handleImage] synth failed, using literal: ${(synthErr as Error).message}`,
      );
    }
  }

  // Apr 27 · Smart-inject brand context only when the prompt reads
  // as marketing / business / Nick's Tire-related. Personal asks
  // ("yellow circle on black", "my dog at the beach") get their
  // literal prompt sent to Venice with zero auto-shop pollution.
  // Tiered injection by detail level — see lib/ai/brand-context.ts.
  const { brandedPrompt: makeBrandedPrompt, isMarketingIntent, classifyDetail } = await import(
    "@/lib/ai/brand-context"
  );
  const brandedPrompt = makeBrandedPrompt(synthesizedPrompt);

  // Apr 28 v6 · LIVE BRAND-CONTEXT PREVIEW — emit a 1-line preamble so
  // Nour sees the upcoming gen plan BEFORE Venice spends 12s rendering.
  // If wrong, he can hit stop and redirect early. Saves regen loops.
  // Also surfaces the synth-latency hint so the 2-5s synth phase doesn't
  // feel like a silent stall.
  let previewLine = "";
  try {
    const isMarketing = isMarketingIntent(synthesizedPrompt);
    const detailTier = classifyDetail(synthesizedPrompt);
    const synthNote = synthHappened
      ? ` · synth=${(synthDurationMs / 1000).toFixed(1)}s ✓`
      : "";
    if (isMarketing) {
      // v6 · Apr 28 · G — Smarter subject extraction. Multi-source:
      //   1. ORIGINAL user prompt (most specific — "make me a brake post")
      //   2. SYNTHESIZED prompt (Venice's expansion of #1)
      //   3. RECENT assistant context (if Nick just wrote a brake caption,
      //      "now generate the picture" should infer brakes)
      //   4. Fallback "Cleveland auto-shop scene"
      const userPromptLower = (imagePrompt ?? "").toLowerCase();
      const promptLower = synthesizedPrompt.toLowerCase();
      const lastAssistantText = (priorAssistantContent ?? "").toLowerCase();

      const subjectCandidates: Array<[RegExp, string]> = [
        [/\b(brake|rotor|caliper|pad)/, "brakes"],
        [/\b(winter\s+tire|snow\s+tire)/, "winter tires"],
        [/\b(summer\s+tire|all-season)/, "summer tires"],
        [/\b(tire|tread|rim|wheel)/, "tires"],
        [/\b(alignment|suspension|strut|shock)/, "wheel alignment"],
        [/\b(oil\s+change|engine\s+oil)/, "oil change service"],
        [/\b(rotation|tire\s+rotation)/, "tire rotation"],
        [/\b(pothole|road\s+damage|cleveland\s+road)/, "Cleveland pothole damage"],
        [/\b(diagnostic|engine\s+light|check\s+engine)/, "diagnostics"],
        [/\b(battery|alternator|starter)/, "battery service"],
        [/\b(coolant|radiator|antifreeze|overheating)/, "cooling system"],
        [/\b(transmission|trans\s+fluid)/, "transmission service"],
        [/\b(filter|air\s+filter|cabin\s+filter)/, "filter service"],
        [/\b(belt|serpentine|timing\s+belt)/, "belt replacement"],
        [/\b(spark\s+plug|ignition|tune.up)/, "tune-up service"],
        [/\b(ac|a\/c|air\s+condition)/, "A/C service"],
        [/\b(inspection|safety\s+check)/, "safety inspection"],
        [/\b(mechanic|tech|customer\s+car|on\s+the\s+lift)/, "shop floor scene"],
        [/\b(storefront|exterior|front\s+of\s+shop)/, "shop storefront"],
      ];
      let subject = "Cleveland auto-shop scene"; // fallback
      let subjectSource: "user" | "synth" | "recent" | "fallback" = "fallback";
      // Try user prompt first
      for (const [re, label] of subjectCandidates) {
        if (re.test(userPromptLower)) {
          subject = label;
          subjectSource = "user";
          break;
        }
      }
      // Fall back to synth prompt
      if (subjectSource === "fallback") {
        for (const [re, label] of subjectCandidates) {
          if (re.test(promptLower)) {
            subject = label;
            subjectSource = "synth";
            break;
          }
        }
      }
      // Last resort: recent assistant context
      if (subjectSource === "fallback" && lastAssistantText) {
        for (const [re, label] of subjectCandidates) {
          if (re.test(lastAssistantText)) {
            subject = label;
            subjectSource = "recent";
            break;
          }
        }
      }
      previewLine = `_⚡ Plan: brand=Nick's Tire (gold #FDB913 on black) · detail=${detailTier} · subject=${subject} (${subjectSource}) · format=auto · model=flux-2-pro${synthNote}_`;
    } else {
      previewLine = `_⚡ Plan: personal/non-brand prompt · subject=${synthesizedPrompt.slice(0, 60).trim()}${synthesizedPrompt.length > 60 ? "…" : ""} · model=flux-2-pro${synthNote}_`;
    }
  } catch { /* preview is best-effort, never blocks */ }

  // Build a streaming SSE response that emits a placeholder line + a
  // heartbeat tick every 3s while Venice generates. When Venice
  // returns, replace the placeholder with the real markdown.
  const messageId = `img_pending_${Date.now()}`;
  const encoder = new TextEncoder();
  const enc = (event: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  // Lifted to the constructor scope so both start() and cancel() can
  // reach it — cancel() fires when the client disconnects before the
  // generation resolves, and must clear the heartbeat or the interval
  // leaks for the process lifetime.
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      // Immediate placeholder — keeps client's stall clock at 0s.
      controller.enqueue(enc({ type: "start", messageId }));
      controller.enqueue(enc({ type: "start-step" }));
      controller.enqueue(enc({ type: "text-start", id: "t1" }));
      // v6 · Show the brand-context preview BEFORE the heartbeat so
      // Nour sees the gen plan up front and can stop early if wrong.
      const placeholderDelta = previewLine
        ? `${previewLine}\n\n_Generating image…_\n\n`
        : `_Generating image…_\n\n`;
      controller.enqueue(
        enc({
          type: "text-delta",
          id: "t1",
          delta: placeholderDelta,
        }),
      );

      // Heartbeat every 3s — empty zero-width-space delta. Resets
      // the client's no-token timer so silent-retry never fires.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            enc({ type: "text-delta", id: "t1", delta: "​" }),
          );
        } catch {
          // Controller may already be closed if Venice raced ahead.
        }
      }, 3000);

      try {
        // v6 · autoAspect=true tells the image generator to inspect the
        // prompt for format keywords (story → 9:16, instagram → 4:5,
        // billboard → 16:9). User prompt drives the canvas choice.
        // v10.0.333 · gpt-image-1 nearest-aspect mapping: 768x1024 (Venice
        // portrait) → 1024x1536 (gpt portrait); 1024x768 (Venice landscape)
        // → 1536x1024 (gpt landscape); square stays square. Default quality
        // = "high" for marketing-grade output.
        const imgResult = await generateOpenAiImage(brandedPrompt, {
          autoAspect: true,
        });
        console.log(
          `[ai/chat] Image generated via fast path: ${imgResult.imageId}`,
        );

        const finalText = `![Generated Image](${imgResult.imageUrl})\n\n**Prompt:** ${synthesizedPrompt}\n**Model:** ${imgResult.model} · ${imgResult.size}${synthFootnote}`;
        // Wipe placeholder + heartbeat zero-widths by ending the
        // initial text-delta and starting a fresh delta with the
        // final content. The client renderer will replace the message
        // body when text-end lands.
        controller.enqueue(enc({ type: "text-end", id: "t1" }));
        controller.enqueue(enc({ type: "text-start", id: "t2" }));
        controller.enqueue(enc({ type: "text-delta", id: "t2", delta: finalText }));
        controller.enqueue(enc({ type: "text-end", id: "t2" }));

        // Persist the FINAL clean text to chat_messages (skipping the
        // placeholder + heartbeat noise). Fire-and-forget so a slow DB
        // doesn't delay the stream close.
        if (convId && convId !== "temp") {
          // v7.6 · ChatMessage Batch A · Apr 29 — image-gen result also
          // gets parts (text + file), searchable plaintext, and a
          // proper provider/streamingState. The image URL goes in as
          // a file part so reload renders the generated image natively.
          const imgParts: Array<Record<string, unknown>> = [
            { type: "text", text: finalText },
            {
              type: "file",
              url: imgResult.imageUrl,
              mediaType: "image/png",
              filename: `generated-${imgResult.imageId}.png`,
            },
          ];
          prisma.chatMessage
            .create({
              data: {
                conversationId: convId,
                role: "assistant",
                content: finalText,
                model: imgResult.model,
                // v10.0.333 · provider tag now reflects the actual lane.
                // gpt-image-1 → "openai-image" · legacy Venice rows still
                // tagged "venice-image" so history-filter regexes catch
                // both (see history filter ~line 996).
                provider: "openai-image",
                routerReason: "fast-path-image",
                streamingState: "complete",
                parts: imgParts as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["parts"],
                searchableContent: `[image:${imgResult.model}] ${synthesizedPrompt ?? ""}`.slice(0, 2000),
              },
            })
            .catch((dbErr) =>
              recordError("chat:db-write", dbErr, { path: "fast-image-final" }),
            );
          prisma.chatConversation
            .update({
              where: { id: convId },
              data: { messageCount: { increment: 1 }, lastActiveAt: new Date() },
            })
            .catch(() => null);
        }
      } catch (imgErr) {
        recordError("chat:image-gen", imgErr, {
          prompt: userContent.slice(0, 200),
        });
        // v7 · Apr 28 · Diagnose-aware error text. The provider error now
        // carries `(${status} ${kind})` so we can show the user the actual
        // failure mode instead of always claiming "rate-limited".
        const rawMsg = imgErr instanceof Error ? imgErr.message : "unknown";
        const isRateLimit = /rate_limit|429/.test(rawMsg);
        const isValidation = /validation|400|422|prompt rejected|rejected:/.test(rawMsg);
        const isAuth = /auth|401|403/.test(rawMsg);
        const isServer = /server|5\d\d/.test(rawMsg);
        // v10.0.476 · billing-cap detection · OpenAI returns the
        // "Billing hard limit has been reached" string verbatim when
        // the org-level monthly cap is hit. Surfacing this clearly
        // (instead of the generic "validation rejected" banner) lets
        // the operator know the fix is OpenAI console settings, not
        // a code change.
        const isBillingCap = /billing\s+hard\s+limit|billing.*reached|insufficient_quota|exceeded.*quota/i.test(rawMsg);
        const isModeration = /moderation|content_policy|safety_violation|blocked\s+by/i.test(rawMsg);
        // Pull the offending field name when the provider tells us
        // (e.g. "prompt rejected", "size rejected"). Lets the banner be
        // honest about whether the issue is the prompt vs. another arg.
        const fieldMatch = /(\w+)\s+rejected:/.exec(rawMsg);
        const offendingField = fieldMatch?.[1] ?? null;
        let banner: string;
        // v10.0.476 · banner provider tags updated · since v10.0.333 the
        // active path is OpenAI gpt-image-1 (not Venice). Banners now
        // say "image gen" (provider-agnostic) so the message stays
        // accurate if the provider swaps again. Billing + moderation
        // get their own clear messages.
        if (isBillingCap) {
          banner = "⚠️ OpenAI billing cap reached — image gen will resume after raising the cap in the OpenAI console (or wait for the monthly reset).";
        } else if (isModeration) {
          banner = "⚠️ Image prompt blocked by content moderation. Soften the wording (avoid trademarks · injuries · weapons · public-figure faces) and try again.";
        } else if (isRateLimit) {
          banner = "⚠️ Image gen rate-limited (quota burst) — try again in ~30s.";
        } else if (isValidation) {
          if (offendingField === "prompt") {
            banner = "⚠️ Image prompt rejected — likely too long or contains a flagged term. Try a shorter, simpler prompt.";
          } else if (offendingField === "size") {
            banner = "⚠️ Image size mismatch — the renderer didn't accept that resolution. Try `/image 1024` or `/image 1536x1024` to be explicit.";
          } else if (offendingField) {
            banner = `⚠️ Image gen rejected the \`${offendingField}\` field — bad value passed to the API.`;
          } else {
            banner = "⚠️ Image request rejected (validation). Check the prompt and try again.";
          }
        } else if (isAuth) {
          banner = "⚠️ Image gen auth error — check OPENAI_API_KEY in env.";
        } else if (isServer) {
          banner = "⚠️ Image gen server error — try again in a minute.";
        } else {
          banner = "⚠️ Image generation failed — see error below.";
        }
        const errText = `\n\n${banner} (\`${rawMsg.slice(0, 200)}\`)`;
        controller.enqueue(enc({ type: "text-delta", id: "t1", delta: errText }));
        controller.enqueue(enc({ type: "text-end", id: "t1" }));
        // Persist the error too so history reads honestly.
        if (convId && convId !== "temp") {
          // v7.6 · ChatMessage Batch A · Apr 29 — error rows get
          // streamingState="errored" + structured errorDetails so the
          // MessageStatusBadge UI surfaces a "retry" chip on reload.
          const errorContent = `_Generating image…_${errText}`;
          prisma.chatMessage
            .create({
              data: {
                conversationId: convId,
                role: "assistant",
                content: errorContent,
                // v10.0.333 · provider tag = openai-image (matches the
                // success path). model name kept as "<provider>-error" so
                // status-badge UI surfaces the right "image gen failed" tile.
                model: "openai-image-error",
                provider: "openai-image",
                routerReason: "fast-path-image",
                streamingState: "errored",
                parts: [{ type: "text", text: errorContent }] as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["parts"],
                searchableContent: `[image-error] ${rawMsg.slice(0, 500)}`,
                errorDetails: {
                  message: rawMsg.slice(0, 500),
                  provider: "openai-image",
                  retryable: !isValidation, // validation errors aren't retryable
                  occurredAt: new Date().toISOString(),
                  classification: isRateLimit
                    ? "rate_limit"
                    : isValidation
                      ? "validation"
                      : isAuth
                        ? "auth"
                        : isServer
                          ? "server"
                          : "unknown",
                } as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["errorDetails"],
              },
            })
            .catch((dbErr) => recordError("chat:db-write", dbErr, { path: "image-error-row", convId }));
          prisma.chatConversation
            .update({
              where: { id: convId },
              data: { messageCount: { increment: 1 }, lastActiveAt: new Date() },
            })
            .catch(() => null);
        }
      } finally {
        // Always stop the heartbeat — on success, on error, and on any
        // unexpected throw — so the interval never outlives the request.
        clearInterval(heartbeat);
      }

      controller.enqueue(enc({ type: "finish-step" }));
      controller.enqueue(enc({ type: "finish" }));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
    // Fires if the client disconnects before the generation resolves.
    // Without this the heartbeat keeps ticking (and enqueuing onto a
    // closed controller) for the process lifetime.
    cancel() {
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defensive: never emit the Private Lab sentinel (this path is already
      // unreachable under privateMode, but keep all three emit sites consistent).
      "X-Conversation-Id": convId && convId !== "private" && convId !== "temp" ? convId : "",
      "X-Vercel-AI-UI-Message-Stream": "v1",
    },
  });
}
