import { nourTools } from "@/lib/ai/tools";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  getBridgeToolPolicy,
  assertBridgeToolAllowed,
  CHATGPT_ACTIONS_V1_TOOLS,
  MCP_V1_TOOLS,
} from "./tool-policy";
import { scopeTools, BRIDGE_HARD_DENY, type BridgeScope } from "./scopes";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function camelToSnake(str: string) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function getBridgeSafeTools(protocol: "mcp" | "actions", scope?: BridgeScope) {
  const exposed: any[] = [];
  // MCP: if a scope is given, the surface is exactly that scope's allowlist;
  // with no scope it is the maximal union (MCP_V1_TOOLS) — used by the surface
  // pin, never by an authenticated request, which always carries a scope.
  const sourceList =
    protocol === "actions"
      ? CHATGPT_ACTIONS_V1_TOOLS
      : scope
        ? scopeTools(scope)
        : MCP_V1_TOOLS;

  for (const camelName of sourceList) {
    // No-scope MCP is the surface-pin VIEW (maximal reachable union), not a
    // request. Its sourceList — MCP_V1_TOOLS = allScopeTools() — already
    // excludes HARD_DENY, so the only gate left is handler presence; running
    // the scope assertion here (with an undefined scope) would deny everything
    // and pin an empty surface. A real request ALWAYS carries a scope and takes
    // the asserted branch below.
    if (protocol === "mcp" && !scope) {
      if (BRIDGE_HARD_DENY.has(camelName)) continue;
    } else {
      try {
        assertBridgeToolAllowed(camelName, protocol, scope);
      } catch (e) {
        continue;
      }
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

/**
 * Every catalog tool in bridge shape (snake external name + camelName + meta),
 * WITHOUT any policy filter. Used only to CLASSIFY a requested name for
 * auditing — so a HARD_DENY tool (never on the exposed surface) is still
 * recognised as a known tool and its refusal is audited as a denial rather
 * than a silent "unknown tool". Never used to expose or execute anything.
 */
export function bridgeCatalogIndex(): Array<{ name: string; camelName: string; meta: any }> {
  return TOOL_CATALOG.map((t) => ({
    name: camelToSnake(t.name),
    camelName: t.name,
    meta: getBridgeToolPolicy(t.name),
  }));
}
