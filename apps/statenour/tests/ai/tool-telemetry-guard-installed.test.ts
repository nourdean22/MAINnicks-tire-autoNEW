/**
 * The guard must be INSTALLED, not merely available.
 *
 * WHY THIS FILE IS SEPARATE. `tool-telemetry-name-guard.test.ts` exercises
 * `isRecordableToolName` — the predicate. Review caught that this proves
 * nothing about the boundary: delete the `if (!isRecordableToolName(...))`
 * check inside `recordToolInvocation` and every one of those tests stays green
 * while malformed payloads resume reaching the SQL upsert.
 *
 * That is the repo's own rule — "assert BEHAVIOUR, never presence" — and the
 * third time in one session I wrote a test that could not fail: the CRLF canary
 * that re-implemented its subject inline, the parts canary that promised a
 * failure it could not produce, and this. A predicate test is a unit test; a
 * guard needs the call site exercised.
 *
 * So this mocks Prisma and asserts the WRITE, which is the only thing that
 * actually matters: a rejected name performs no upsert, a valid one does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn().mockResolvedValue(1),
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $executeRaw: (...a: unknown[]) => mocks.executeRaw(...a) },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => mocks.logError(...a) }));

import { recordToolInvocation } from "@/lib/ai/tool-telemetry";
import { INSTRUMENT_SCOPE_PREFIX } from "@/lib/observability/instrument-scope";

/** Byte-for-byte the value measured in production on 2026-09-17. */
const THE_ROW = [
  "searchColdMemory({",
  '  query: "nicks tire instagram post",',
  '  scope: "ingest",',
  "  limit: 5",
  "})</arg_value>",
].join("\n");

beforeEach(() => {
  mocks.executeRaw.mockClear();
  mocks.logError.mockClear();
});

describe("recordToolInvocation · the guard is wired to the write", () => {
  it("POSITIVE CONTROL: a valid name DOES reach the upsert", async () => {
    // Without this, a guard that rejected everything — or a broken mock that
    // never called through — would satisfy the canary below while silently
    // ending all telemetry.
    await recordToolInvocation({ toolName: "getTasks", success: true, durationMs: 12 });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("CANARY: the malformed production payload performs NO write", async () => {
    // Deleting the check inside recordToolInvocation makes this fail. The
    // predicate tests cannot.
    await recordToolInvocation({ toolName: THE_ROW, success: true, durationMs: 12 });
    expect(
      mocks.executeRaw,
      "a tool-call payload reached the SQL upsert — the guard is not installed",
    ).not.toHaveBeenCalled();
  });

  it("the refusal is LOGGED, not silent", async () => {
    // A guard that drops the row quietly trades a corrupt row for a missing
    // one, which this module's own header calls the worse trade.
    await recordToolInvocation({ toolName: THE_ROW, success: true, durationMs: 12 });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const [, err] = mocks.logError.mock.calls[0];
    expect(String((err as Error).message)).toMatch(/refused a non-identifier tool name/);
  });

  it("CANARY: a refusal must NOT be logged as an instrument FAILURE", () => {
    // `buildInstrumentFailures()` defines every `instrument.*` row as an
    // instrument that failed to WRITE. This path returns before the write, so
    // scoping it there would render a guard working correctly as a broken
    // telemetry writer on /system, and inflate totalFailures.
    //
    // The first cut did exactly that, for the worst reason: the name was
    // already in KNOWN_INSTRUMENTS. Availability is not a licence to overload
    // a channel that already means something.
    return recordToolInvocation({ toolName: THE_ROW, success: true, durationMs: 12 }).then(() => {
      const [scope] = mocks.logError.mock.calls[0];
      expect(
        String(scope).startsWith(`${INSTRUMENT_SCOPE_PREFIX}.`),
        `refusal logged under "${scope}" — /system will read it as a failed write`,
      ).toBe(false);
      expect(scope).toBe("ai.tool-telemetry");
    });
  });

  it("POSITIVE CONTROL: a genuine WRITE failure still uses the instrument scope", async () => {
    // Without this, moving every log off the instrument channel would satisfy
    // the canary above while blinding /system to real outages. The upsert
    // throwing is the real failure, and it must stay nameable.
    mocks.executeRaw.mockRejectedValueOnce(new Error("connection lost"));
    await recordToolInvocation({ toolName: "getTasks", success: true, durationMs: 3 });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const [scope] = mocks.logError.mock.calls[0];
    expect(scope).toBe("ai.tool-telemetry");
  });

  it("the refusal log carries NO fragment of the payload", async () => {
    // The whole point of describeRejectedToolName — logError persists its
    // message verbatim and console-logs it, and redaction covers only `extra`.
    await recordToolInvocation({
      toolName: THE_ROW,
      success: true,
      durationMs: 12,
      conversationId: "c-1",
    });
    const blob = JSON.stringify(mocks.logError.mock.calls[0].map(String));
    for (const secret of ["nicks tire", "instagram", "searchColdMemory", "arg_value"]) {
      expect(blob, `the refusal log leaked "${secret}"`).not.toContain(secret);
    }
  });

  it.each([["", "empty"], ["7tools", "leading digit"], ["a b", "space"]])(
    "refuses %s (%s) without writing",
    async (name) => {
      await recordToolInvocation({ toolName: name, success: true, durationMs: 1 });
      expect(mocks.executeRaw).not.toHaveBeenCalled();
    },
  );

  it("a historical dotted key still writes", async () => {
    // arsenal.webSearch / person.update / memory.remember are real keys in the
    // table from an older namespacing scheme — the guard must not orphan them.
    await recordToolInvocation({ toolName: "arsenal.webSearch", success: true, durationMs: 4 });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });
});
