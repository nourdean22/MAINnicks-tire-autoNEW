/**
 * lib/ai/reasoning/error-sanitizer.ts · Phase H.7 (2026-05-18 PM)
 *
 * Per the /find-bugs audit · pre-fix, the catch-all 500 in every
 * reasoning endpoint returned `err.message` verbatim. Prisma errors
 * leak table names + columns + connection strings; LLM provider
 * errors leak API endpoints + sometimes truncated prompts. None of
 * that should be in a response body.
 *
 * This helper:
 *   · logs the full error with stack to the central logger (for ops)
 *   · returns a generic, operator-readable message (for the response)
 *
 * The single-operator OS reduces the blast radius (no anon attacker
 * fishing for stack traces) but stack-leak is still a bad pattern
 * worth closing — telemetry-via-error-body is hard to audit and
 * makes log/observability noisier than it needs to be.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/error-sanitizer");

/** Tags an error and returns a safe public-facing message + the
 *  internal error id that ops can grep in logs to find the root
 *  cause without exposing it to the wire. */
export function sanitizeError(
  err: unknown,
  context: { route: string; op?: string },
): { publicMessage: string; errorId: string } {
  const errorId = `err_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const rawMsg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Log the FULL error internally · ops greps `errorId` to find it
  log.error("sanitized_error", {
    errorId,
    route: context.route,
    op: context.op,
    rawMsg: rawMsg.slice(0, 800),
    stack: stack?.slice(0, 1500),
  });

  // Classify into a small set of operator-friendly buckets · the
  // public message reveals KIND of error but not contents.
  const classified = classifyForOperator(rawMsg);

  return {
    publicMessage: `${classified}. Reference: ${errorId}`,
    errorId,
  };
}

function classifyForOperator(rawMsg: string): string {
  const m = rawMsg.toLowerCase();
  if (/prisma|p2\d+|database|connection|ecconrefused|timeout.*db/i.test(m)) {
    return "Database hiccup · the engine couldn't reach state. Try again in a moment.";
  }
  if (/abort|timeout|aborted/i.test(m)) {
    return "Operation timed out. Try a lower tier or re-ask.";
  }
  if (/auth|unauthorized|forbidden|401|403/i.test(m)) {
    return "Authentication issue. Reload the page and re-sign-in.";
  }
  if (/rate.?limit|429|quota/i.test(m)) {
    return "Provider rate limit hit. Wait ~60s and re-try.";
  }
  if (/openai|anthropic|venice|ollama|provider/i.test(m)) {
    return "AI provider error. The engine will route through the fallback chain on retry.";
  }
  if (/parse|json|schema|validation|zod/i.test(m)) {
    return "Engine returned a malformed response. Re-try (the engine cached nothing).";
  }
  return "Internal engine error. The team has been notified.";
}
