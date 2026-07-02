import { streamText, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
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

DO NOT output markdown headers unless necessary. DO NOT be robotic. Be human, brilliant, and deeply aligned with Nour's success.
    `;

    const result = await streamText({
      model: openai('gpt-4o'),
      messages: await convertToModelMessages(messages),
      system: systemPrompt,
      temperature: 0.8, // Slightly higher for creativity
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Partner Stream Error:', error);
    return NextResponse.json({ error: 'Failed to stream partner response' }, { status: 500 });
  }
}
