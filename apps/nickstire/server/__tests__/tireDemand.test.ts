/**
 * Phone tire demand (2026-09-23). An ordinary tire inquiry persisted nothing a
 * counter could read; these pin the record that now rides the tool_called
 * state row and the summary Today shows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeTireDemand, toolCallStateMetadata } from "../lib/tireDemand";
import { minutesSinceShopMidnight } from "../lib/timezoneAssert";

const tireDemandFromToolArgs = (raw: unknown) => toolCallStateMetadata("tireInquiry", "t", raw).demand;

describe("tireDemandFromToolArgs", () => {
  it("reads a JSON-string call and normalises the size", () => {
    expect(tireDemandFromToolArgs(JSON.stringify({ name: "Pat", phone: "2165550142", tireSize: "225 65 17", newOrUsed: "used" })))
      .toEqual({ size: "225/65R17", condition: "used" });
  });

  it("reads an already-parsed object (Vapi sends both shapes)", () => {
    expect(tireDemandFromToolArgs({ tireSize: "P215/60R16", newOrUsed: "new" })).toEqual({ size: "215/60R16", condition: "new" });
  });

  it("keeps size and condition only: never the caller's name or phone", () => {
    const d = tireDemandFromToolArgs({ name: "Pat Doe", phone: "2165550142", tireSize: "205/55R16" });
    expect(JSON.stringify(d)).not.toMatch(/Pat|555/);
  });

  it("is total: a missing, unparseable or garbage size is null, never a guess", () => {
    expect(tireDemandFromToolArgs({ newOrUsed: "either" })).toEqual({ size: null, condition: "either" });
    expect(tireDemandFromToolArgs({ tireSize: "the big ones", newOrUsed: "cheap" })).toEqual({ size: null, condition: null });
    expect(tireDemandFromToolArgs("{not json")).toEqual({ size: null, condition: null });
    expect(tireDemandFromToolArgs(undefined)).toEqual({ size: null, condition: null });
  });
});

describe("summarizeTireDemand", () => {
  const row = (size: string | null, condition: string | null = null, tool = "tireInquiry") => ({ tool, toolCallId: "t", demand: { size, condition } });

  it("POSITIVE CONTROL: counts sizes, most-asked first, with new/used split", () => {
    const s = summarizeTireDemand([
      row("205/55R16"), row("225/65R17", "used"), row("225/65R17", "used"), row("225/65R17", "new"), row(null),
    ]);
    expect(s.total).toBe(5);
    expect(s.sizeUnknown).toBe(1);
    expect(s.sizes).toEqual([
      { size: "225/65R17", count: 3, new: 1, used: 2 },
      { size: "205/55R16", count: 1, new: 0, used: 0 },
    ]);
  });

  it("skips other tools and rows written before the demand field existed", () => {
    const s = summarizeTireDemand([row("225/65R17", null, "bookSlot"), { tool: "tireInquiry", toolCallId: "old" }, null, "x"]);
    expect(s).toEqual({ total: 0, sizes: [], sizeUnknown: 0 });
  });
});

describe("minutesSinceShopMidnight", () => {
  it("counts from Eastern midnight in both daylight and standard time", () => {
    expect(minutesSinceShopMidnight(new Date("2026-09-23T13:30:00Z"))).toBe(9 * 60 + 30); // EDT, UTC-4
    expect(minutesSinceShopMidnight(new Date("2026-12-01T14:05:00Z"))).toBe(9 * 60 + 5); // EST, UTC-5
    expect(minutesSinceShopMidnight(new Date("2026-09-24T03:59:00Z"))).toBe(23 * 60 + 59); // late evening ET, next day UTC
  });
});

describe("toolCallStateMetadata", () => {
  it("only a tireInquiry carries demand; other tools keep the old shape", () => {
    expect(toolCallStateMetadata("bookSlot", "tc-9", { tireSize: "225/65R17" })).toEqual({ tool: "bookSlot", toolCallId: "tc-9" });
  });

  it("the webhook's tool-calls branch builds its state metadata with it", () => {
    const src = readFileSync(resolve(__dirname, "../routes/webhooks/vapi.ts"), "utf8");
    expect(src).toContain("metadata: toolCallStateMetadata(c.function?.name, c.id, c.function?.arguments)");
  });
});

