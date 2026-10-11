/**
 * Unknown is not zero: bridge consumers (audit 2026-10-10, 08-F6 + section 3 table).
 *
 * Each consumer is driven with the three failure shapes readBridge maps (transport
 * error, 400 unknown-query, 200 with data.error) and must say "unknown", never a
 * confident zero / "healthy" / "NO LEADS TODAY". A genuinely empty successful read
 * keeps its empty copy (the control in each block).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryNick: vi.fn(),
  queryNickBatch: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: h.queryNick,
  queryNickBatch: h.queryNickBatch,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: h.remember } }));
vi.mock("@/lib/brain/relational-graph", () => ({ connect: vi.fn() }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { fetchShopSnapshot } from "@/lib/services/bridge";
import { prefetchIntents, formatPrefetchContext } from "@/lib/ai/predictive-prefetch";
import { processShopEvent } from "@/lib/brain/pipeline-controller";
import { fetchShopPulse } from "@/lib/services/ultron-ticker";
import { formatContext } from "@/lib/brain/reflection-engine";

const FAILURES = {
  transport: { error: "fetch failed" },
  unknownQuery: { error: 'HTTP 400: {"error":"Unknown query: x"}', statusCode: 400 },
  softError: { query: "x", timestamp: "t", data: { error: "No DB" } },
} as const;

const allBatch = (names: string[], value: unknown) => Object.fromEntries(names.map((n) => [n, value]));

beforeEach(() => {
  h.queryNick.mockReset();
  h.queryNickBatch.mockReset();
  h.remember.mockReset().mockResolvedValue(undefined);
  for (const k of ["NICKSTIRE_URL", "NICKS_ADMIN_URL", "NICKSTIRE_BRIDGE_URL"]) delete process.env[k];
});
afterEach(() => vi.useRealTimers());

describe("fetchShopSnapshot live-query fallback", () => {
  const Q = ["revenue_today", "leads_urgent", "bookings_today", "callbacks_pending"];

  for (const [name, shape] of Object.entries(FAILURES)) {
    it(`every read failed (${name}) -> no snapshot, never a healthy zero`, async () => {
      h.queryNickBatch.mockResolvedValue(allBatch(Q, shape));
      expect(await fetchShopSnapshot()).toBeNull();
    });
  }

  it("a partly failed read is degraded, its counts unknown (null), not 0", async () => {
    h.queryNickBatch.mockResolvedValue({
      revenue_today: { data: { totalDollars: 120, invoiceCount: 1 } },
      leads_urgent: FAILURES.softError,
      bookings_today: FAILURES.unknownQuery,
      callbacks_pending: FAILURES.transport,
    });
    const snap = await fetchShopSnapshot();
    expect(snap?.syncHealth.overall).toBe("degraded");
    expect(snap?.leads.urgentCount).toBeNull();
    expect(snap?.callbacks.pendingCount).toBeNull();
    expect(snap?.bookings.todayCount).toBeNull();
    expect(JSON.stringify(snap?.syncHealth.services)).toContain("unknown");
    expect(snap?.revenue.todayEstimate).toBe(120);
  });

  it("CONTROL: four successful empty reads are a measured zero, healthy", async () => {
    h.queryNickBatch.mockResolvedValue({
      revenue_today: { data: { totalDollars: 0, invoiceCount: 0 } },
      leads_urgent: { data: { urgentLeads: [], count: 0 } },
      bookings_today: { data: { bookings: [], count: 0 } },
      callbacks_pending: { data: { pending: [], count: 0 } },
    });
    const snap = await fetchShopSnapshot();
    expect(snap?.syncHealth.overall).toBe("healthy");
    expect(snap?.leads.urgentCount).toBe(0);
    expect(snap?.callbacks.pendingCount).toBe(0);
  });
});

describe("predictive prefetch (quote + lead queries)", () => {
  for (const [name, shape] of Object.entries(FAILURES)) {
    it(`a failed read (${name}) is unknown in the prompt block, not count 0`, async () => {
      h.queryNickBatch.mockImplementation(async (qs: Array<{ query: string }>) => allBatch(qs.map((q) => q.query), shape));
      const block = formatPrefetchContext(await prefetchIntents("how is the pipeline"));
      expect(block).toContain("unknown");
      expect(block).not.toMatch(/"count": 0|"openCount": 0|"overdue": 0|"totalValue": 0/);
    });
  }

  it("CONTROL: a successful empty read stays a real zero", async () => {
    h.queryNickBatch.mockImplementation(async (qs: Array<{ query: string }>) =>
      Object.fromEntries(qs.map((q) => [q.query,
        q.query === "leads_overdue_count" ? { data: { count: 0 } }
        // quotes_pending answers counts (nickstire handler since 2026-10-10), never rows.
        : q.query === "quotes_pending" ? { data: { sinceHours: 168, count: 0, bookedCount: 0, bookedCountIsLowerBound: true } }
        : { data: [] }])),
    );
    const block = formatPrefetchContext(await prefetchIntents("how is the pipeline"));
    expect(block).toContain('"openCount": 0');
    expect(block).not.toContain("unknown");
  });
});

describe("pipeline-controller lead trend (leads_today_count / leads_week_count unregistered)", () => {
  type Entry = { type: string; data: Record<string, unknown> };
  const events = (
    JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "config", "nickstire-bridge-events.json"), "utf8"),
    ) as { events: Entry[] }
  ).events;
  const lead = events.find((e) => e.type === "nickstire:lead")!.data;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T20:00:00Z")); // 16:00 ET, past the 2pm gate
    h.queryNick.mockResolvedValue({ data: { customers: [] } });
  });

  for (const [name, shape] of Object.entries(FAILURES)) {
    it(`a failed count read (${name}) never stores "NO LEADS TODAY"`, async () => {
      h.queryNickBatch.mockResolvedValue({ leads_today_count: shape, leads_week_count: shape });
      const res = await processShopEvent({ type: "lead", data: lead });
      expect(h.remember.mock.calls.map((c) => String(c[2])).join("\n")).not.toContain("NO LEADS TODAY");
      expect(res.actions).not.toContain("alert.lead_drought");
    });
  }

  it("CONTROL: a measured zero still raises the drought alert", async () => {
    h.queryNickBatch.mockResolvedValue({ leads_today_count: { data: { count: 0 } }, leads_week_count: { data: { count: 0 } } });
    const res = await processShopEvent({ type: "lead", data: lead });
    expect(res.actions).toContain("alert.lead_drought");
  });
});

describe("ultron ticker shop pulse", () => {
  it("reads attention_needed's `message` (the handler never sent `msg`)", async () => {
    h.queryNickBatch.mockResolvedValue({
      revenue_today: { data: { totalDollars: 10, invoiceCount: 1 } },
      leads_urgent: { data: { count: 0 } },
      callbacks_pending: { data: { count: 0 } },
      attention_needed: { data: { alerts: [{ level: "critical", message: "3 leads untouched >24h", count: 3 }] } },
    });
    const items = await fetchShopPulse();
    expect(items.map((i) => i.label)).toContain("3 leads untouched >24h");
  });

  it("a failed read shows as an unknown shop item, not as silence", async () => {
    h.queryNickBatch.mockResolvedValue({
      revenue_today: FAILURES.softError,
      leads_urgent: FAILURES.transport,
      callbacks_pending: { data: { count: 0 } },
      attention_needed: { data: { alerts: [] } },
    });
    const labels = (await fetchShopPulse()).map((i) => i.label).join(" | ");
    expect(labels).toMatch(/unknown/i);
    expect(labels).toContain("revenue");
    expect(labels).toContain("leads");
  });

  it("CONTROL: all reads fine and empty -> no unknown item", async () => {
    h.queryNickBatch.mockResolvedValue({
      revenue_today: { data: { totalDollars: 0, invoiceCount: 0 } },
      leads_urgent: { data: { count: 0 } },
      callbacks_pending: { data: { count: 0 } },
      attention_needed: { data: { alerts: [] } },
    });
    const labels = (await fetchShopPulse()).map((i) => i.label).join(" | ");
    expect(labels).not.toMatch(/unknown/i);
  });
});

describe("reflection engine live shop block (08-F6a)", () => {
  const ctx = (liveShopData: Record<string, unknown> | null) =>
    formatContext({
      scores: [], memories: [], facts: [], dumps: [], commitments: [], alerts: [], loops: [],
      patterns: [], habits: [], quoteStats: [], recentReflections: [], liveShopData,
    } as never);
  const fine = {
    leads_pipeline: { data: { pipeline: { new: 1 } } },
    attention_needed: { data: { alerts: [{ level: "critical", message: "3 leads untouched >24h", count: 3 }] } },
    bookings_status: { data: { statusBreakdown: { confirmed: 2 } } },
  };

  for (const [name, shape] of Object.entries(FAILURES)) {
    it(`a failed revenue read (${name}) is unknown in the prompt, never $0`, () => {
      const out = ctx({ ...fine, revenue_today: shape });
      expect(out).toContain("Revenue today: unknown (bridge read failed)");
      expect(out).not.toContain("$0");
    });
  }

  it("drops the always-zero Local DB line and reads attention_needed's `message`", () => {
    const out = ctx({ ...fine, revenue_today: { data: { totalDollars: 120, invoiceCount: 1 } } });
    expect(out).not.toContain("Local DB");
    expect(out).toContain("3 leads untouched >24h");
    expect(out).not.toContain("undefined");
  });

  it("a failed side read says unknown instead of going silent", () => {
    const out = ctx({ ...fine, revenue_today: { data: { totalDollars: 5, invoiceCount: 1 } }, attention_needed: FAILURES.transport });
    expect(out).toMatch(/Attention alerts: unknown/);
  });

  it("CONTROL: a measured zero revenue still renders $0", () => {
    const out = ctx({ ...fine, revenue_today: { data: { totalDollars: 0, invoiceCount: 0 } } });
    expect(out).toContain("Revenue today: $0 (0 jobs)");
    expect(out).not.toMatch(/unknown/);
  });
});
