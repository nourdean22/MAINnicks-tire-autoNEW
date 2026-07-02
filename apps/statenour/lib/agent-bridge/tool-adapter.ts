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
  let rawResult;
  if (typeof tool.handler.execute === "function") {
    rawResult = await tool.handler.execute(args, {});
  } else if (typeof tool.handler === "function") {
    rawResult = await tool.handler(args);
  } else {
    throw new Error(`Tool ${tool.name} is not executable.`);
  }
  
  // Normalize output (sanitizes errors/returns structured JSON)
  if (rawResult instanceof Error) {
    return { error: true, message: rawResult.message };
  }
  
  return typeof rawResult === 'string' ? { content: rawResult } : rawResult;
}
