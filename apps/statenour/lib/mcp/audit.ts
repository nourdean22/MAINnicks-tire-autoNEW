/**
 * lib/mcp/audit.ts
 *
 * Audit trail for the MCP facade (docs/MCP-PLAN.md §4).
 *
 * v1 (read-only tier) logs through the structured logger surface
 * `mcp` — request-level events, per-tool-call outcomes, and auth
 * failures all land in the same log stream the rest of the app uses
 * (errors additionally reach ErrorLog / the Telegram alert pipeline
 * via the logger's error path).
 *
 * When Tier 2 safe-writes land, this module grows a DB-backed audit
 * entry per mutation — the call sites in server.ts already pass
 * everything needed (tool, args presence, outcome, latency).
 */
import { logger } from "@/lib/logger";

const log = logger.withSurface("mcp");

export interface McpAuditEvent {
  /** e.g. "request", "tools/list", "tools/call", "auth_failed" */
  event: string;
  /** External MCP tool name when the event is a tool call. */
  tool?: string;
  ok: boolean;
  /** Wall time of the handled unit, ms. */
  ms?: number;
  /** JSON-RPC method for request-level events. */
  method?: string;
  /** Short, stack-free error summary (never leaked to the client). */
  error?: string;
}

export function auditMcp(entry: McpAuditEvent): void {
  const meta = {
    actor: "mcp:external",
    tool: entry.tool,
    method: entry.method,
    ok: entry.ok,
    ms: entry.ms,
    error: entry.error,
  };
  if (entry.ok) {
    log.info(`mcp_${entry.event}`, meta);
  } else {
    log.warn(`mcp_${entry.event}`, meta);
  }
}
