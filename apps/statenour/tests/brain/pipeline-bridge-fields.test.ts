/**
 * processShopEvent reads the fields the nickstire bridge actually sends
 * (config/nickstire-bridge-events.json). Before: repeat-customer detection searched
 * `name` / `customerName` while lead and booking events carry `customer`, so it never ran on
 * a bridge event, and review insights read `text` while reviews carry `reviewText`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { remember, queryNick, queryNickBatch, connect } = vi.hoisted(() => ({
  remember: vi.fn(),
  queryNick: vi.fn(),
  queryNickBatch: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember } }));
vi.mock("@/lib/brain/relational-graph", () => ({ connect }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick, queryNickBatch }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { processShopEvent } from "@/lib/brain/pipeline-controller";

type Entry = { type: string; data: Record<string, unknown> };
const events = (
  JSON.parse(readFileSync(join(process.cwd(), "..", "..", "config", "nickstire-bridge-events.json"), "utf8")) as { events: Entry[] }
).events;
const fixtureData = (type: string) => events.find(e => e.type === type)!.data;

beforeEach(() => {
  remember.mockReset().mockResolvedValue(undefined);
  connect.mockReset().mockResolvedValue(undefined);
  queryNick.mockReset().mockResolvedValue({ data: { customers: [{ totalVisits: 3, totalSpent: 1200, segment: "loyal" }] } });
  queryNickBatch.mockReset().mockResolvedValue({});
});

describe("processShopEvent on real bridge payloads", () => {
  it.each(["nickstire:lead", "nickstire:booking"])("%s: repeat-customer lookup searches the bridge's `customer`", async type => {
    const res = await processShopEvent({ type: type === "nickstire:lead" ? "lead" : "booking", data: fixtureData(type) });
    expect(queryNick).toHaveBeenCalledWith("customer_search", { term: "Test Customer" });
    expect(res.actions).toContain("insight.repeat_customer");
  });

  it("lead: the bridge's leadId links the memory to its source pattern", async () => {
    await processShopEvent({ type: "lead", data: fixtureData("nickstire:lead") });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("review: the stored insight carries the bridge's `reviewText`", async () => {
    await processShopEvent({ type: "review", data: fixtureData("nickstire:review") });
    const contents = remember.mock.calls.map(c => String(c[2]));
    expect(contents.some(c => c.startsWith("Low review (2/5): Waited too long for a simple job"))).toBe(true);
  });
});
