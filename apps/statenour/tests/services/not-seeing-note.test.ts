/**
 * "What you're not seeing" weekly section (2026-10-22). A failed read must say
 * so, never render as "no gaps" or "$0"; gaps show one per topic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), queryNick: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { contradiction: { findMany: h.findMany } } }));
vi.mock("@/lib/nickstire/query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nickstire/query")>();
  return { ...actual, queryNick: h.queryNick };
});

import { buildNotSeeingSlice, salesLine } from "@/lib/services/not-seeing-note";

const TODAY = "2026-10-26"; // a Monday

beforeEach(() => {
  h.findMany.mockReset();
  h.queryNick.mockReset();
});

describe("salesLine", () => {
  const ok = (totalDollars: number, invoiceCount = 10) => ({ status: "ok" as const, data: { totalDollars, invoiceCount } });
  const unknown = { status: "unknown" as const, reason: "No DB" };

  it("says how sales moved week over week", () => {
    expect(salesLine(ok(11000, 40), ok(10000))).toBe(
      "Sales, last 7 days: $11,000 on 40 invoices, up 10% vs the week before ($10,000)",
    );
    expect(salesLine(ok(8000, 30), ok(10000))).toContain("down 20%");
  });

  it("a failed read is unknown, never $0", () => {
    expect(salesLine(unknown, ok(10000))).toBe("Sales: couldn't load the last 7 days (unknown, not zero)");
    expect(salesLine(ok(9000), unknown)).toContain("the week before couldn't load");
  });

  it("leaves the invoice count out when the bridge omits it", () => {
    const noCount = { status: "ok" as const, data: { totalDollars: 5000 } as never };
    expect(salesLine(noCount, ok(5000))).toBe("Sales, last 7 days: $5,000, flat vs the week before ($5,000)");
  });

  it("does not divide by an empty week", () => {
    expect(salesLine(ok(5000), ok(0))).toContain("the week before had no sales recorded");
  });
});

describe("buildNotSeeingSlice", () => {
  it("shows one gap per topic, newest first, and the two complete weeks", async () => {
    h.findMany.mockResolvedValue([
      { category: "business", gap: "Said next-day estimate follow-up; nine are a week old" },
      { category: "business", gap: "an older business gap" },
      { category: "habit", gap: "Said a 6 a.m. start; logged starts average 8:40" },
    ]);
    h.queryNick.mockResolvedValue({ data: { totalDollars: 10000, invoiceCount: 40 } });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines[0]).toBe("<b>What you're not seeing</b>");
    expect(slice.lines.filter((l) => l.startsWith("· business"))).toHaveLength(1);
    expect(slice.lines.join("\n")).toContain("nine are a week old");
    expect(slice.lines.join("\n")).not.toContain("an older business gap");
    expect(h.queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-19", to: "2026-10-25" });
    expect(h.queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-12", to: "2026-10-18" });
    expect(slice.payload.gapRowsRead).toBe(3);
    expect(slice.payload.gapsShown).toBe(2);
  });

  it("one gap per topic even when one topic dominates the newest rows", async () => {
    // The mock honours `take`, so a cap applied before the per-topic pick would hide "business".
    const rows = [
      ...Array.from({ length: 45 }, (_, i) => ({ category: "habit", gap: `habit gap ${i}` })),
      { category: "business", gap: "the older business gap" },
    ];
    h.findMany.mockImplementation(async (args: { take?: number }) => rows.slice(0, args.take ?? rows.length));
    h.queryNick.mockResolvedValue({ data: { totalDollars: 1, invoiceCount: 1 } });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines.join("\n")).toContain("the older business gap");
    expect(slice.lines.filter((l) => l.startsWith("· habit"))).toHaveLength(1);
  });

  it("a failed gap read says unknown instead of 'no gaps'", async () => {
    h.findMany.mockRejectedValue(new Error("neon down"));
    h.queryNick.mockResolvedValue({ data: { totalDollars: 1, invoiceCount: 1 } });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines.join("\n")).toContain("couldn't load (unknown, not empty)");
    expect(slice.lines.join("\n")).not.toContain("No open gaps");
    expect(slice.payload.gapRowsRead).toBeNull();
    expect(slice.payload.gapsShown).toBeNull();
  });

  it("CONTROL: a measured empty gap list says so plainly", async () => {
    h.findMany.mockResolvedValue([]);
    h.queryNick.mockResolvedValue({ data: { totalDollars: 1, invoiceCount: 1 } });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines.join("\n")).toContain("No open gaps");
  });

  it("a bridge transport error renders the sales line as unknown", async () => {
    h.findMany.mockResolvedValue([]);
    h.queryNick.mockResolvedValue({ error: "HTTP 502" });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines.join("\n")).toContain("unknown, not zero");
  });

  it("escapes the model-written gap text for the HTML brief", async () => {
    h.findMany.mockResolvedValue([{ category: "business", gap: "a <b>bold</b> & claim" }]);
    h.queryNick.mockResolvedValue({ data: { totalDollars: 1, invoiceCount: 1 } });

    const slice = await buildNotSeeingSlice(TODAY);

    expect(slice.lines.join("\n")).toContain("a &lt;b&gt;bold&lt;/b&gt; &amp; claim");
  });
});
