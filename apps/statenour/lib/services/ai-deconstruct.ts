import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/ai-deconstruct");

export interface DeconstructResult {
  steps: string[];
  provider?: string;
  model?: string;
}

export async function runDeconstructTask(input: {
  taskTitle: string;
  goalTitle?: string;
}): Promise<DeconstructResult> {
  const { taskTitle, goalTitle } = input;

  const prompt = `Task/Mission to deconstruct: "${taskTitle}"${
    goalTitle ? ` under goal: "${goalTitle}"` : ""
  }

Nour is struggling with starting friction or executive dysfunction. Break this task down into exactly 3 to 5 chronological, physical, trivial, low-friction steps.
Each step must be extremely small (e.g. "Open VS Code", "Write a single line", "Close the file").
Return ONLY a valid JSON array of strings:
[
  "Step 1...",
  "Step 2...",
  "Step 3..."
]`;

  let stateBlock = "";
  try {
    const { currentOperatorState, formatOperatorStateBlock } = await import(
      "@/lib/services/operator-state"
    );
    const snap = await currentOperatorState();
    if (snap.confidence > 0) {
      stateBlock = formatOperatorStateBlock(snap);
    }
  } catch {
    // best-effort
  }

  const baseSystem =
    "You are Nick, Nour's Chief of Staff and ADHD execution trainer. You specialize in breaking down overwhelming tasks into trivial, physical micro-actions. Return ONLY a valid JSON string array, no markdown wrapper, no other text." +
    (stateBlock ? `\n\n${stateBlock}` : "");

  const styledSystem = await applyOperatorStyle(baseSystem);

  const result = await tracedAiChat(
    { label: "deconstruct-task", source: "tool", metadata: { taskTitle, goalTitle } },
    [
      { role: "system", content: styledSystem },
      { role: "user", content: prompt },
    ],
    "fast",
  );

  let steps: string[] = [];
  try {
    const cleanContent = result.content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    if (Array.isArray(parsed)) {
      steps = parsed.map(String);
    } else if (typeof parsed === "object" && parsed !== null) {
      // Fallback in case LLM wrapped it in an object like { steps: [...] } or { "1": "...", ... }
      if (Array.isArray((parsed as any).steps)) {
        steps = (parsed as any).steps.map(String);
      } else {
        steps = Object.values(parsed).map(String);
      }
    }
  } catch (err) {
    log.warn("json_parse_failed", { content: result.content, err: sanitizeError(err) });
  }

  // Direct template fallback if JSON parsing failed or array is empty
  if (steps.length === 0) {
    steps = [
      `Open the tool/document for: ${taskTitle}`,
      `Write down or execute the first line/action`,
      `Verify the output and close the window`
    ];
  }

  return {
    steps,
    provider: result.provider,
    model: result.model,
  };
}
