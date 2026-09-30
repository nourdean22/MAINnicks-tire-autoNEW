/**
 * StateNour MCP bridge.
 *
 * The official MCP v2 HTTP handler owns JSON-RPC framing, protocol-era
 * negotiation, server/discover, standard headers, and modern result metadata.
 * StateNour owns only its durable authorities: authentication identity,
 * scoped tool exposure, execution validation, policy enforcement, and audit.
 */
import {
  ProtocolError,
  ProtocolErrorCode,
  Server,
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { getToolRiskClass } from "@/lib/ai/tools/catalog";
import { env } from "@/lib/env";
import { auditBridgeCall } from "./audit";
import type { BridgeIdentity } from "./auth";
import { BRIDGE_SCOPES, type BridgeScope } from "./scopes";
import { assertBridgeToolAllowed } from "./tool-policy";
import { bridgeCatalogIndex, executeBridgeTool, getBridgeSafeTools } from "./tool-adapter";

export const MCP_SERVER_INFO = {
  name: "statenour-command",
  title: "StateNour Command",
  version: "2.0.0",
} as const;
const CACHE_HINT = {
  ttlMs: 60_000,
  cacheScope: "private" as const,
};

export function bridgeIdentityToMcpAuthInfo(identity: BridgeIdentity): AuthInfo {
  return {
    // The bridge already validated the real bearer token. Never copy that
    // secret into SDK context, logs, errors, or audit rows.
    token: "validated-by-agent-bridge",
    clientId: identity.clientId,
    scopes: [identity.scope],
  };
}

function identityFromMcpAuthInfo(authInfo: AuthInfo | undefined): BridgeIdentity {
  const scope = authInfo?.scopes.find(
    (candidate): candidate is BridgeScope =>
      (BRIDGE_SCOPES as readonly string[]).includes(candidate),
  );
  if (!authInfo?.clientId || !scope) {
    throw new Error("Validated MCP auth context is missing bridge identity.");
  }
  return { clientId: authInfo.clientId, scope };
}

function bridgeTools(identity: BridgeIdentity) {
  return getBridgeSafeTools("mcp", identity.scope)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.meta?.sideEffecting !== true,
        destructiveHint: tool.meta?.sideEffecting === true,
        openWorldHint: tool.meta?.needsBridge === true,
      },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function wrapStructured(result: unknown): Record<string, unknown> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result: result ?? null };
}

function invalidParams(message: string): never {
  throw ProtocolError.fromError(ProtocolErrorCode.InvalidParams, message);
}

async function auditDeniedTool(
  identity: BridgeIdentity,
  known: ReturnType<typeof bridgeCatalogIndex>[number],
  externalName: string,
  args: Record<string, unknown>,
  reason: string,
) {
  await auditBridgeCall({
    requestId: crypto.randomUUID(),
    protocol: "mcp",
    toolName: known.camelName,
    externalName,
    status: "denied",
    latencyMs: 0,
    inputRaw: JSON.stringify(args),
    errorCode: reason,
    riskClass: getToolRiskClass(known.camelName, known.meta),
    clientId: identity.clientId,
    scope: identity.scope,
  });
}

async function handleBridgeToolCall(
  params: { name: string; arguments?: Record<string, unknown> },
  identity: BridgeIdentity,
) {
  const name = params.name;
  const args = params.arguments ?? {};
  const inScope = getBridgeSafeTools("mcp", identity.scope).find(
    (tool) => tool.name === name,
  );

  if (!inScope) {
    const known = bridgeCatalogIndex().find((tool) => tool.name === name);
    if (!known) invalidParams(`Unknown tool: ${name || "(missing name)"}`);

    let reason = "denied by scope";
    try {
      assertBridgeToolAllowed(known.camelName, "mcp", identity.scope);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    await auditDeniedTool(identity, known, name, args, reason);
    invalidParams(`Tool ${name} is not permitted for your scope.`);
  }

  const requestId = crypto.randomUUID();
  const started = Date.now();
  let status: "success" | "error" = "success";
  let errorCode: string | undefined;
  let rawResult: unknown;

  try {
    rawResult = await executeBridgeTool(inScope, args);
    if (
      rawResult &&
      typeof rawResult === "object" &&
      "error" in rawResult &&
      (rawResult as { error?: boolean }).error === true
    ) {
      throw new Error(
        String((rawResult as { message?: unknown }).message ?? "Tool execution failed"),
      );
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(rawResult ?? null, null, 2) }],
      structuredContent: wrapStructured(rawResult),
      isError: false,
    };
  } catch (error) {
    status = "error";
    const message = error instanceof Error ? error.message : String(error);
    errorCode = message;
    return {
      content: [{ type: "text" as const, text: `Tool ${name} failed: ${message}` }],
      isError: true,
    };
  } finally {
    await auditBridgeCall({
      requestId,
      protocol: "mcp",
      toolName: inScope.camelName,
      externalName: name,
      status,
      latencyMs: Date.now() - started,
      inputRaw: JSON.stringify(args),
      errorCode,
      resultSize: JSON.stringify(rawResult ?? "").length,
      riskClass: getToolRiskClass(inScope.camelName, inScope.meta),
      clientId: identity.clientId,
      scope: identity.scope,
    });
  }
}

export function buildBridgeMcpServer(identity: BridgeIdentity): Server {
  const server = new Server(MCP_SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    cacheHints: {
      "server/discover": CACHE_HINT,
      "tools/list": CACHE_HINT,
    },
  });

  server.setRequestHandler("tools/list", async () => ({
    tools: bridgeTools(identity),
  }));

  server.setRequestHandler("tools/call", async (request) =>
    handleBridgeToolCall(
      {
        name: request.params.name,
        arguments: request.params.arguments as Record<string, unknown> | undefined,
      },
      identity,
    ),
  );

  return server;
}

export const mcpHttpHandler: McpHttpHandler = createMcpHandler(
  ({ authInfo }) => buildBridgeMcpServer(identityFromMcpAuthInfo(authInfo)),
  { legacy: "stateless" },
);

/**
 * Hostnames a browser `Origin` may carry on POST /api/mcp: this app's own
 * public host plus the localhost class (a local MCP Inspector).
 *
 * Streamable HTTP 2026-07-28 "Security & Endpoint" 1: servers MUST validate
 * `Origin` on every request and answer 403 when it is present and invalid.
 * `createMcpHandler` is deliberately validation-free (its own docs say to put
 * the check in front of it), so the route owns this. A request with no
 * `Origin` passes: server-side MCP clients do not send one, and the check
 * exists to stop a web page from driving the bridge from a victim's browser.
 */
export function mcpAllowedOriginHostnames(): string[] {
  const hosts = new Set(localhostAllowedOrigins());
  try {
    hosts.add(new URL(env.NEXT_PUBLIC_APP_URL).hostname);
  } catch {
    // An unparseable app URL adds nothing; the localhost class still applies.
  }
  return [...hosts];
}

/** The spec's 403 for a present-and-invalid `Origin`, or undefined to proceed. */
export function mcpOriginRejection(request: Request): Response | undefined {
  return originValidationResponse(request, mcpAllowedOriginHostnames());
}

export function handleAuthenticatedMcpRequest(
  request: Request,
  identity: BridgeIdentity,
): Promise<Response> {
  return mcpHttpHandler.fetch(request, {
    authInfo: bridgeIdentityToMcpAuthInfo(identity),
  });
}
