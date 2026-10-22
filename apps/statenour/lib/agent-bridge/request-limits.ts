/**
 * Request limits shared by both agent-bridge routes (/api/mcp and /api/actions/[tool]).
 *
 * GHSA-46jr-4wx8-v453: one request under a generous body limit could exhaust memory during
 * argument validation. The MCP SDK's maxToolInputElements exists only on McpServer, not the
 * low-level Server the MCP bridge uses, and the Actions route parses its own body, so both
 * enforce these limits themselves (tests/agent-bridge/mcp-request-limits.test.ts,
 * tests/agent-bridge/actions-request-limits.test.ts).
 */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/** Array elements plus object members, depth-first; stops counting once past `max` (mirrors the SDK). */
function toolInputElementCount(value: unknown, max: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) {
        if (++count > max) return count;
        if (child !== null && typeof child === "object") stack.push(child);
      }
      continue;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (++count > max) return count;
      const child = (node as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return count;
}

/** True when arguments carry more than MAX_TOOL_INPUT_ELEMENTS array elements and object members. */
export function exceedsToolInputElements(args: unknown): boolean {
  return toolInputElementCount(args, MAX_TOOL_INPUT_ELEMENTS) > MAX_TOOL_INPUT_ELEMENTS;
}
