import "server-only";

/**
 * W6 intent surface · compose (docs/design/ui-v3/W6-INTENT-SURFACE.md §4A, alternative A).
 *
 * Nick picks the reads for what Nour asked, the server runs them, and the one card registry draws them.
 * The trust boundary is the tool set handed to the model: only tools that are read-only AND registered
 * (READ_ONLY_TOOLS ∩ TOOL_CONFIG), so a write tool cannot be called from here at all. A counting wrapper
 * runs at most INTENT_CARD_CAP calls and a repeated call once; a refused call never runs.
 * Prior art: Telegram /ask (app/api/telegram/webhook/route.ts) runs a gated nourTools subset the same way.
 */
import { stepCountIs } from "ai";
import { TOOL_CONFIG } from "@/components/chat/tool-result-registry";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/read-only-tools";

export const INTENT_CARD_CAP = 6;
export const INTENT_MAX_CHARS = 300;

export interface IntentPart {
  type: `tool-${string}`;
  state: "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
}

export interface ComposeResult {
  parts: IntentPart[];
  /** Calls past the cap or repeated: counted, never run. */
  refused: number;
  /** Reads that threw: drawn as failures. */
  failed: number;
}

type ExecutableTool = { execute?: (input: unknown, ...rest: unknown[]) => unknown };
type StepContent = { type: string; toolName?: string; output?: unknown; error?: unknown };
// Structural, so the route passes AI SDK generateText and tests pass a stand-in.
export type Generate = (opts: {
  system: string;
  prompt: string;
  tools: Record<string, ExecutableTool>;
  toolChoice: "required";
  stopWhen: ReturnType<typeof stepCountIs>;
}) => Promise<{ steps?: Array<{ content?: readonly StepContent[] }> }>;

export function surfaceToolNames(): string[] {
  return Object.keys(TOOL_CONFIG).filter((name) => READ_ONLY_TOOLS.has(name)).sort();
}

const REFUSED = Symbol("intent-refused");

const SYSTEM = [
  "You compose one screen for Nour from read-only cards.",
  "Call the read tools whose results answer what he asked, all in this one step.",
  `Call at most ${INTENT_CARD_CAP} tools, each once. Do not write any text.`,
].join(" ");

export async function composeIntent(args: {
  intent: string;
  tools: Record<string, ExecutableTool>;
  generate: Generate;
}): Promise<ComposeResult> {
  const intent = args.intent.trim();
  if (!intent) throw new Error("intent is empty");

  let calls = 0;
  let refused = 0;
  const seen = new Set<string>();
  const surface: Record<string, ExecutableTool> = {};
  for (const name of surfaceToolNames()) {
    const tool = args.tools[name];
    if (!tool?.execute) continue;
    const execute = tool.execute;
    surface[name] = {
      ...tool,
      execute: async (input: unknown, ...rest: unknown[]) => {
        const key = `${name}:${JSON.stringify(input ?? {})}`;
        if (seen.has(key) || calls >= INTENT_CARD_CAP) {
          refused++;
          return REFUSED;
        }
        seen.add(key);
        calls++;
        return execute(input, ...rest);
      },
    };
  }

  const result = await args.generate({
    system: SYSTEM,
    prompt: intent.slice(0, INTENT_MAX_CHARS),
    tools: surface,
    toolChoice: "required",
    stopWhen: stepCountIs(1),
  });

  const parts: IntentPart[] = [];
  let failed = 0;
  for (const c of result.steps?.[0]?.content ?? []) {
    if (!c.toolName || !(c.toolName in surface)) continue;
    if (c.type === "tool-result") {
      if (c.output === REFUSED) continue;
      parts.push({ type: `tool-${c.toolName}`, state: "output-available", output: c.output });
    } else if (c.type === "tool-error") {
      failed++;
      const errorText = c.error instanceof Error ? c.error.message : String(c.error ?? "read failed");
      parts.push({ type: `tool-${c.toolName}`, state: "output-error", errorText });
    }
  }
  return { parts, refused, failed };
}
