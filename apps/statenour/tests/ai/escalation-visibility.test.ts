/**
 * tests/ai/escalation-visibility.test.ts — the headers must be READ
 * (2026-08-28).
 *
 * WHY THIS FILE EXISTS. #1983 set `X-Escalation-*` / `X-Lane-*` on the
 * chat response and its own commit message claimed "depth asked for and
 * REFUSED is now legible". Nothing on the client read them. A blocked
 * escalation therefore looked *exactly* like never having asked — the
 * precise silent-gate failure the escalation lane was built to end,
 * reintroduced by the change that claimed to end it.
 *
 * That is the third instance of one pattern in this wave: a writer with
 * no reader, shipped green because every unit test asserted the write.
 * The others were `modelOverride` (never reached the serving path) and
 * the daily cap (never matched a stored row). All three were found by
 * grepping for the CONSUMER, never by the tests.
 *
 * So these assert the consumer end of each contract. They are
 * deliberately source-level: the defect is structural (a wire that does
 * not exist), and a behavioural test of a React hook would not have
 * caught it either — the hook was correct, it simply was not called.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("every escalation header the server sets has a reader", () => {
  const transport = read("hooks/chat/use-chat-transport.ts");
  const responseShape = read("lib/services/chat/response-shape.ts");

  it("the server actually sets them (positive control for the greps below)", () => {
    expect(responseShape).toContain('headers.set("X-Escalation-Tier"');
    expect(responseShape).toContain('headers.set("X-Escalation-Blocked"');
    expect(responseShape).toContain('headers.set("X-Lane-Model"');
  });

  it.each([
    "X-Escalation-Tier",
    "X-Escalation-Applied",
    "X-Escalation-Blocked",
    "X-Escalation-Reason",
    "X-Lane-Model",
  ])("client reads %s", (header) => {
    expect(transport).toContain(`res.headers.get("${header}")`);
  });

  it("the reader forwards to a callback rather than dropping the value", () => {
    // A `headers.get()` whose result goes nowhere is still a dead
    // control; the read must reach a consumer.
    expect(transport).toContain("onEscalation?.(");
  });
});

describe("the callback reaches a surface the operator can actually see", () => {
  const stream = read("features/chat-v2/hooks/use-chat-stream.ts");

  it("chat wires onEscalation into the transport", () => {
    expect(stream).toContain("onEscalation:");
  });

  it("a BLOCKED escalation raises an error toast — the case that was invisible", () => {
    expect(stream).toContain("toast.error");
    expect(stream).toContain("not applied");
  });

  it("the blocked toast surfaces the server's reason, which names the remedy", () => {
    // `reason` carries the exact env var / count from resolveEscalation,
    // so the operator is told what to DO, not merely that it failed.
    expect(stream).toContain("info.reason");
  });

  it("an APPLIED escalation confirms which lane answered", () => {
    expect(stream).toContain("toast.success");
    expect(stream).toContain("info.laneModel");
  });
});
