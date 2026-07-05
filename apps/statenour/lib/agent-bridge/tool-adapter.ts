import { nourTools } from "@/lib/ai/tools";
import { zodToJsonSchema } from "zod-to-json-schema";
import { 
  getBridgeToolPolicy, 
  assertBridgeToolAllowed, 
  CHATGPT_ACTIONS_V1_TOOLS,
  MCP_V1_TOOLS
} from "./tool-policy";

function camelToSnake(str: string) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function getBridgeSafeTools(protocol: "mcp" | "actions") {
  const exposed: any[] = [];
  const sourceList = protocol === "mcp" ? MCP_V1_TOOLS : CHATGPT_ACTIONS_V1_TOOLS;
  
  for (const camelName of sourceList) {
    try {
      assertBridgeToolAllowed(camelName, protocol);
    } catch (e) {
      continue;
    }
    
    const meta = getBridgeToolPolicy(camelName);
    const handlerTool = (nourTools as any)[camelName];
    
    if (!meta || !handlerTool) {
      continue;
    }
    
    let jsonSchema = { type: "object", properties: {} };
    if (handlerTool.parameters) {
      const parsed = zodToJsonSchema(handlerTool.parameters);
      jsonSchema = (parsed as any) || jsonSchema;
    }

    exposed.push({
      name: camelToSnake(camelName),
      camelName,
      description: handlerTool.description || meta.name,
      inputSchema: jsonSchema,
      meta,
      handler: handlerTool
    });
  }
  
  return exposed;
}

export async function executeBridgeTool(tool: any, args: any) {
  // 2026-07-05 (audit P2) · validate incoming args against the tool's zod
  // schema BEFORE execute. Both external bridges (the Actions route and
  // the MCP server) POST raw JSON that flows through here; pre-fix it
  // reached handler.execute UNPARSED, so zod defaults (e.g.
  // daysBack: z.number().default(7)) never applied and a missing required
  // field hit the handler as undefined → unbounded reads / DB errors. This
  // is the single choke point both bridges share. On failure, return the
  // same { error, message } shape callers already handle (never throw an
  // unvalidated call through). Tools without a zod `parameters` schema
  // skip validation unchanged (back-compat).
  let input = args;
  const schema = tool?.handler?.parameters;
  if (schema && typeof schema.safeParse === "function") {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i: any) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return { error: true, message: `Invalid input for ${tool.name}: ${detail}` };
    }
    input = parsed.data; // applies zod defaults + coercions
  }

  let rawResult;
  if (typeof tool.handler.execute === "function") {
    rawResult = await tool.handler.execute(input, {});
  } else if (typeof tool.handler === "function") {
    rawResult = await tool.handler(input);
  } else {
    throw new Error(`Tool ${tool.name} is not executable.`);
  }
  
  // Normalize output (sanitizes errors/returns structured JSON)
  if (rawResult instanceof Error) {
    return { error: true, message: rawResult.message };
  }
  
  return typeof rawResult === 'string' ? { content: rawResult } : rawResult;
}
