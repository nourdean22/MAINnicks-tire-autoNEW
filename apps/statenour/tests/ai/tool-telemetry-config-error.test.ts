/**
 * tests/ai/tool-telemetry-config-error.test.ts
 *
 * Guards the config-error breaker gate added alongside this file.
 *
 * THE DEFECT: tools that refuse for want of an env var return a soft
 * `{ error: "FIRECRAWL_API_KEY not set" }` (lib/ai/tools/system.ts).
 * lib/services/chat/tool-telemetry-walk.ts scores any `error` key as a
 * failure, and 5 failures inside 10 minutes tripped the circuit breaker,
 * which lib/ai/chat-mode.ts consults BEFORE pruning. So calling an
 * unconfigured tool five times deleted it from the catalog for 30
 * minutes and it silently reappeared later -- the operator saw a
 * capability that "sometimes works".
 *
 * CANARY DISCIPLINE (root AGENTS.md, "Ship the canary, not just the
 * control"): it is not enough to prove config errors no longer trip.
 * A gate that simply disabled the breaker would also pass that half.
 * So the genuine-fault case is asserted to STILL trip, in the same
 * file, against the same threshold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));

import {
  isConfigurationError,
  recordToolInvocation,
  isToolBlocked,
  resetToolBreaker,
} from "@/lib/ai/tool-telemetry";

/** Mirrors FAIL_THRESHOLD in lib/ai/tool-telemetry.ts. */
const FAIL_THRESHOLD = 5;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isConfigurationError", () => {
  // Verbatim strings from the live catalog -- lib/ai/tools/system.ts.
  it.each([
    "Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY.",
    "FIRECRAWL_API_KEY not set",
    "Browserbase is unconfigured for this session",
    "missing API key",
    "Missing credentials",
    "requires E2B_API_KEY",
  ])("classifies %j as configuration", (msg) => {
    expect(isConfigurationError(msg)).toBe(true);
  });

  // THE CANARY HALF. If any of these were classified as configuration,
  // a genuinely broken tool would never be shed by the breaker.
  it.each([
    "Request timed out after 30s",
    "database connection lost",
    "TypeError: Cannot read properties of undefined",
    "upstream returned 500",
    "ECONNREFUSED",
    // Caught in self-review: the env-var branch is case-SENSITIVE, so
    // the English word alone must not read as a config refusal. Folded
    // into the /i phrase regex, "[A-Z]" matched lowercase and this
    // string was spared the breaker.
    "requires a valid destination",
    "this action requires confirmation",
  ])("does NOT classify %j as configuration", (msg) => {
    expect(isConfigurationError(msg)).toBe(false);
  });

  it("treats an absent message as a non-config failure", () => {
    expect(isConfigurationError(undefined)).toBe(false);
    expect(isConfigurationError(null)).toBe(false);
    expect(isConfigurationError("")).toBe(false);
  });
});

describe("circuit breaker -- config errors are withheld", () => {
  it("does not trip after repeated missing-key refusals", async () => {
    const tool = "cfgToolA";
    resetToolBreaker(tool);

    for (let i = 0; i < FAIL_THRESHOLD + 2; i++) {
      await recordToolInvocation({
        toolName: tool,
        success: false,
        durationMs: 5,
        errorMessage: "FIRECRAWL_API_KEY not set",
        configError: true,
      });
    }

    expect(isToolBlocked(tool)).toBe(false);
  });

  // CANARY: same call count, same shape, genuine fault -> MUST block.
  // This is the assertion that would fail if the gate were widened
  // into "never trip", which is the tempting wrong fix.
  it("still trips after the same number of genuine faults", async () => {
    const tool = "cfgToolB";
    resetToolBreaker(tool);

    for (let i = 0; i < FAIL_THRESHOLD; i++) {
      await recordToolInvocation({
        toolName: tool,
        success: false,
        durationMs: 5,
        errorMessage: "Request timed out after 30s",
        configError: false,
      });
    }

    expect(isToolBlocked(tool)).toBe(true);
    resetToolBreaker(tool);
  });

  it("records the config failure rather than swallowing it", async () => {
    const { prisma } = await import("@/lib/prisma");
    const tool = "cfgToolC";
    resetToolBreaker(tool);

    await recordToolInvocation({
      toolName: tool,
      success: false,
      durationMs: 5,
      errorMessage: "Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY.",
      configError: true,
    });

    // Visibility is the point: withheld from the breaker, NOT from the
    // telemetry row the operator reads on /system/chat-health.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(isToolBlocked(tool)).toBe(false);
  });
});
