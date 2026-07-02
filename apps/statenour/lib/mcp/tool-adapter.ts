/**
 * lib/mcp/tool-adapter.ts
 *
 * Thin adapter that resolves the hard-coded MCP allowlist against the
 * EXISTING tool registry (nourTools) + catalog and produces
 * MCP-compatible descriptors. This is the key architectural move from
 * docs/MCP-PLAN.md: MCP consumes the canonical catalog — it never
 * re-implements schemas or business logic.
 *
 * Defense in depth: the allowlist test asserts catalog invariants at
 * CI time, and getMcpTools() re-checks them at runtime (battle-safe,
 * not side-effecting, actually present). A tool that stops satisfying
 * the contract silently drops out of the exposed set instead of
 * shipping a mutation path.
 */
import { z } from "zod";
import { nourTools } from "@/lib/ai/tools";
import { getToolMeta } from "@/lib/ai/tools/catalog";
import {
  MCP_TOOL_ALLOWLIST,
  type McpAllowlistEntry,
} from "@/lib/mcp/tool-allowlist";
import { auditMcp } from "@/lib/mcp/audit";

/** Permissive fallback when a zod schema can't be converted. */
const FALLBACK_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: true,
};

export interface McpExposedTool {
  /** External snake_case name. */
  name: string;
  title: string;
  description: string;
  ring: McpAllowlistEntry["ring"];
  /** JSON Schema (draft 2020-12) for tools/list. */
  inputSchema: Record<string, unknown>;
  /** Validate args and run the underlying nourTools handler. */
  invoke: (args: unknown) => Promise<unknown>;
}

interface ToolLike {
  description?: string;
  inputSchema?: unknown;
  execute?: (input: unknown, options?: unknown) => Promise<unknown>;
}

function isZodSchema(v: unknown): v is z.ZodType {
  return !!v && typeof (v as z.ZodType).safeParse === "function";
}

function toJsonSchema(inputSchema: unknown, toolName: string): Record<string, unknown> {
  if (!isZodSchema(inputSchema)) return FALLBACK_INPUT_SCHEMA;
  try {
    const json = z.toJSONSchema(inputSchema, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    // MCP clients expect a top-level object schema; the $schema key is
    // noise inside tools/list.
    delete json.$schema;
    return json;
  } catch (err) {
    auditMcp({
      event: "schema_conversion_failed",
      tool: toolName,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK_INPUT_SCHEMA;
  }
}

/** Thrown when tools/call args fail the tool's own zod contract. */
export class McpInvalidParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInvalidParamsError";
  }
}

function buildExposedTool(entry: McpAllowlistEntry, handler: ToolLike): McpExposedTool {
  const schema = handler.inputSchema;
  return {
    name: entry.mcpName,
    title: entry.mcpName,
    description: `[${entry.ring} ring · read-only] ${entry.summary}${handler.description ? ` — ${handler.description}` : ""}`,
    ring: entry.ring,
    inputSchema: toJsonSchema(schema, entry.mcpName),
    invoke: async (args: unknown) => {
      let parsed: unknown = args ?? {};
      if (isZodSchema(schema)) {
        const result = schema.safeParse(args ?? {});
        if (!result.success) {
          throw new McpInvalidParamsError(
            `Invalid arguments for ${entry.mcpName}: ${result.error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ")}`,
          );
        }
        parsed = result.data;
      }
      if (typeof handler.execute !== "function") {
        throw new Error(`Tool ${entry.mcpName} has no execute handler`);
      }
      // AI SDK v6 execute(input, options) — our handlers only read the
      // input; a minimal options bag keeps any that destructure happy.
      return handler.execute(parsed, { toolCallId: `mcp_${Date.now()}`, messages: [] });
    },
  };
}

/**
 * Resolve the allowlist into the exposed MCP tool set, re-verifying
 * catalog invariants at runtime. Order follows the allowlist.
 */
export function getMcpTools(): McpExposedTool[] {
  const exposed: McpExposedTool[] = [];
  for (const entry of MCP_TOOL_ALLOWLIST) {
    const meta = getToolMeta(entry.toolName);
    const handler = (nourTools as Record<string, ToolLike>)[entry.toolName];
    if (!meta || !handler) {
      auditMcp({ event: "allowlist_entry_unresolved", tool: entry.mcpName, ok: false });
      continue;
    }
    // Runtime re-check of the read-only contract (tests enforce the
    // same at CI). battle !== true or sideEffecting → never exposed.
    if (meta.battle !== true || meta.sideEffecting === true) {
      auditMcp({ event: "allowlist_entry_rejected", tool: entry.mcpName, ok: false });
      continue;
    }
    exposed.push(buildExposedTool(entry, handler));
  }
  return exposed;
}

/** Lookup a single exposed tool by external MCP name. */
export function findMcpTool(mcpName: string): McpExposedTool | undefined {
  return getMcpTools().find((t) => t.name === mcpName);
}
