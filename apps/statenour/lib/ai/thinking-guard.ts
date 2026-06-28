import { ToolLoopAgent, stepCountIs, LanguageModel } from "ai";

interface GuardOptions {
  model: LanguageModel;
  fallbackModel: LanguageModel;
  messages: any[];
  systemPrompt: string;
  thinkingBudgetMs?: number; // Time allowed to think before fallback (e.g. 3500ms)
  tools?: any;
  temperature?: number;
  maxSteps?: number;
  onFinish?: any;
  onStepFinish?: any;
}

export async function createGuardedAgentStream({
  model,
  fallbackModel,
  messages,
  systemPrompt,
  thinkingBudgetMs = 3500,
  tools,
  temperature,
  maxSteps = 5,
  onFinish,
  onStepFinish,
}: GuardOptions) {
  const abortController = new AbortController();
  let hasCommittedStream = false;

  // Race the local reasoning model against our strict execution timer
  const budgetTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (!hasCommittedStream) {
        abortController.abort();
        reject(new Error("THINKING_BUDGET_EXCEEDED"));
      }
    }, thinkingBudgetMs);
  });

  try {
    const agent = new ToolLoopAgent({
      model,
      tools,
      instructions: systemPrompt,
      stopWhen: stepCountIs(maxSteps),
      temperature,
      onFinish,
      onStepFinish,
    });

    const result = await Promise.race([
      agent.stream({
        messages,
        abortSignal: abortController.signal,
      }),
      budgetTimeout,
    ]);

    const reader = result.fullStream.getReader();
    let textBuffer = "";
    let insideThinkBlock = false;
    let visibleTextAccumulated = "";

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Failsafe check: if we finished with zero visible text and no tool calls, trigger fallback
              const hasTools = result.toolCalls && (await result.toolCalls).length > 0;
              if (visibleTextAccumulated.trim().length === 0 && !hasTools) {
                controller.error(new Error("EMPTY_STRIPPED_OUTPUT"));
              } else {
                controller.close();
              }
              break;
            }

            if (value.type === "text-delta" && typeof (value as any).text === "string") {
              textBuffer += (value as any).text;

              // Stream-safe state machine to strip out <think> tags on-the-fly
              while (textBuffer.length > 0) {
                if (!insideThinkBlock) {
                  const thinkStart = textBuffer.indexOf("<think>");
                  if (thinkStart !== -1) {
                    // Send text before <think>
                    const visiblePart = textBuffer.slice(0, thinkStart);
                    if (visiblePart.length > 0) {
                      visibleTextAccumulated += visiblePart;
                      hasCommittedStream = true;
                      controller.enqueue({ type: "text-delta", text: visiblePart });
                    }
                    insideThinkBlock = true;
                    textBuffer = textBuffer.slice(thinkStart + 7);
                  } else {
                    // No <think> found, check for partial tags
                    const lastOpenBracket = textBuffer.lastIndexOf("<");
                    if (lastOpenBracket !== -1 && "<think>".startsWith(textBuffer.slice(lastOpenBracket))) {
                      const visiblePart = textBuffer.slice(0, lastOpenBracket);
                      if (visiblePart.length > 0) {
                        visibleTextAccumulated += visiblePart;
                        hasCommittedStream = true;
                        controller.enqueue({ type: "text-delta", text: visiblePart });
                      }
                      textBuffer = textBuffer.slice(lastOpenBracket);
                      break; // wait for next chunk
                    } else {
                      visibleTextAccumulated += textBuffer;
                      hasCommittedStream = true;
                      controller.enqueue(value);
                      textBuffer = "";
                    }
                  }
                } else {
                  const thinkEnd = textBuffer.indexOf("</think>");
                  if (thinkEnd !== -1) {
                    insideThinkBlock = false;
                    textBuffer = textBuffer.slice(thinkEnd + 8);
                  } else {
                    // Still inside think block, discard text buffer except potential partial </think>
                    const lastOpenBracket = textBuffer.lastIndexOf("<");
                    if (lastOpenBracket !== -1 && "</think>".startsWith(textBuffer.slice(lastOpenBracket))) {
                      textBuffer = textBuffer.slice(lastOpenBracket);
                      break; // wait for next chunk
                    } else {
                      textBuffer = "";
                    }
                  }
                }
              }
            } else {
              // Pass through tool-calls and other pipeline events immediately
              controller.enqueue(value);
            }
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return {
      result,
      fullStream: stream,
      toUIMessageStreamResponse: () => new Response(stream, {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" }
      })
    };
  } catch (error) {
    console.warn("Local thinking budget failed or empty response returned. Hot-swapping to cloud provider...", error);
    
    const fallbackAgent = new ToolLoopAgent({
      model: fallbackModel,
      tools,
      instructions: systemPrompt,
      stopWhen: stepCountIs(maxSteps),
      temperature,
      onFinish,
      onStepFinish,
    });

    const fallbackResult = await fallbackAgent.stream({
      messages,
    });
    
    return {
      result: fallbackResult,
      fullStream: fallbackResult.fullStream,
      toUIMessageStreamResponse: () => fallbackResult.toUIMessageStreamResponse()
    };
  }
}
