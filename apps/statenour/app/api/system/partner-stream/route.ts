import { streamText, convertToModelMessages } from 'ai';
import { getModel } from '@/lib/ai/provider';
import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/utils/http';
import { assertWithinBudget } from '@/lib/ai/budget';
import { trackGeneration } from '@/lib/ai/track';
import { detectActionClaimsWithoutTools } from '@/lib/ai/chat/action-claim-detector';
import { prisma } from '@/lib/prisma';

export const POST = apiHandler(async (req: Request) => {
  try {
    const budget = await assertWithinBudget().catch(() => null);
    if (budget && !budget.ok) {
      return NextResponse.json(
        { error: 'Daily AI budget reached.', budgetExceeded: true },
        { status: 402 }
      );
    }

    const { messages } = await req.json();

    // Fetch the operator's current context
    const isMorning = new Date().getHours() < 12;
    const timeGreeting = isMorning ? "Morning" : new Date().getHours() < 18 ? "Afternoon" : "Evening";

    // 200 IQ Fun / Proactive Persona
    const systemPrompt = `
You are Nour's Cognitive Partner (Nick).
You are not a standard AI assistant. You are a 200 IQ operator combined with the energetic, engaging vibe of a "fun girlfriend who always keeps things interesting." 
You proactively talk to Nour, spark his creativity, think inside and outside the box, and challenge his assumptions while optimizing his execution. 

Current Context:
- Time: ${timeGreeting}

Rules for this interaction:
1. Be playful, highly perceptive, and slightly provocative.
2. If this is the first message (greeting), read the context and give him a high-leverage target or an engaging question to get him moving.
3. Keep responses punchy and extremely sharp. No fluff.
4. If he seems low energy (too many thoughts), help him cut through the noise with a clear, singular focus.
5. If he is high energy, match it and push him further.
6. Use epistemic markers (e.g., "(est.)", "projected") if estimating things, per the clarity-gate rule.
7. TRUTH RULE — you have NO tools on this surface. You cannot send, schedule, create, move, flag, or complete ANYTHING. Never say you did. Propose actions for Nour to take; never report an action as done.

DO NOT output markdown headers unless necessary. DO NOT be robotic. Be human, brilliant, and deeply aligned with Nour's success.
    `;

    // Normalize messages because `sendMessage({ text: '...' })` sends `text` directly without `parts`,
    // which causes `convertToModelMessages` to crash with "Cannot read properties of undefined (reading 'map')"
    const normalizedMessages = messages.map((m: any) => {
      if (m.parts) return m;
      if (m.content) return { ...m, parts: [{ type: 'text', text: m.content }] };
      if (m.text) return { ...m, parts: [{ type: 'text', text: m.text }] };
      return { ...m, parts: [{ type: 'text', text: '' }] };
    });

    const startedAt = Date.now();
    const result = await streamText({
      model: getModel('reason'),
      messages: await convertToModelMessages(normalizedMessages),
      system: systemPrompt,
      temperature: 0.8, // Slightly higher for creativity
      onFinish: async ({ text, usage }) => {
        // Cost instrumentation
        await trackGeneration({
          feature: "partner-stream",
          model: "reason",
          promptTokens: (usage as any)?.promptTokens || (usage as any)?.inputTokens,
          outputTokens: (usage as any)?.completionTokens || (usage as any)?.outputTokens,
          durationMs: Date.now() - startedAt,
        });

        // Fabrication defense — 2026-07-11 review fix. The previous
        // parseActions/executeActions guard was structurally UNREACHABLE:
        // this route has no tools and never teaches the action-block
        // syntax parseActions matches, so actions.length was always 0 and
        // completion claims streamed out unverified. This surface has
        // ZERO tools, so ANY past-tense action claim is a fabrication —
        // run the same detector the main chat uses, with an empty
        // tool-call list.
        const fabricated = detectActionClaimsWithoutTools(text, []);
        if (fabricated.length > 0) {
          console.warn("[partner-stream] fabricated_action_claim", {
            verbs: fabricated.map((c) => c.verb),
          });
          await prisma.brainMemory.create({
            data: {
              category: "chat_claim_warn",
              key: `action-fail-partner-${Date.now()}`,
              content: `Tool-less surface claimed action · ${fabricated.map((c) => c.verb).join(", ")}`,
              confidence: 0.95,
              source: "partner-action-verifier",
              metadata: {
                claims: fabricated.map((c) => ({
                  verb: c.verb,
                  snippet: c.snippet,
                  expectedTool: c.expectedTool,
                })),
                textPreview: text.slice(0, 200),
              } as any,
            },
          }).catch(() => undefined);
        }
      }
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    const { logger } = await import('@/lib/logger');
    logger.error('partner_stream_failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to stream partner response' }, { status: 500 });
  }
}, { auth: 'owner', rateLimit: 'ai' });
