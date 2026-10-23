/**
 * Appendix E of the usage map (docs/research/2026-10-23-brain-usage-map-appendix-e.md) is the READER of
 * the three usage-telemetry writers. A reader whose SQL names a key the writer does not store returns
 * empty rows forever, and an empty result reads as "nobody used it" (empty-vs-error). So this test runs
 * each writer for real, captures what it asks the database to store, and checks every payload key, tag
 * key, eventType, metric and source in the appendix's SQL against that.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { auditCreate, metricCreate } = vi.hoisted(() => ({ auditCreate: vi.fn(), metricCreate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: { create: auditCreate }, systemMetric: { create: metricCreate } },
}));

import { recordPageLeave, recordPageTabVisit } from "@/lib/services/brain-domain";
import { recordTrpcCall } from "@/lib/trpc/call-telemetry";

const APPENDIX = join(__dirname, "..", "..", "docs", "research", "2026-10-23-brain-usage-map-appendix-e.md");
const md = readFileSync(APPENDIX, "utf8");
const queries = [...md.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const all = (q: string, re: RegExp) => [...q.matchAll(re)].map((m) => m[1]);

async function stored() {
  auditCreate.mockReset().mockResolvedValue({ id: "a" });
  metricCreate.mockReset().mockResolvedValue({ id: "m" });
  await recordPageLeave({ page: "/chat", dwellMs: 1000, reason: "route" });
  await recordPageTabVisit({ page: "/brain", tab: "memory" });
  recordTrpcCall({ procedure: "task.list", type: "query", ok: false, code: "UNAUTHORIZED", ms: 5, batch: 1 });
  await new Promise((r) => setImmediate(r));
  const [leave, tab] = auditCreate.mock.calls.map((c) => c[0].data as { eventType: string; detail: string; payload: Record<string, unknown> });
  const metric = metricCreate.mock.calls[0][0].data as { metric: string; source: string; tags: Record<string, unknown> };
  return { leave, tab, metric };
}

describe("Appendix E queries read what the writers store", () => {
  it("positive control: the appendix has exactly three queries and the extractor finds their keys", () => {
    expect(queries).toHaveLength(3);
    expect(all(queries[0], /payload->>'(\w+)'/g).sort()).toEqual(["capped", "dwellMs", "dwellMs", "reason"].sort());
    expect(all(queries[1], /payload->>'(\w+)'/g)).toEqual(["tab", "tab"]);
    expect(all(queries[2], /tags->>'(\w+)'/g).sort()).toEqual(["ok", "procedure", "procedure"]);
  });

  it("query 1 reads the page_leave row: eventType, detail, and every payload key it names", async () => {
    const { leave } = await stored();
    expect(all(queries[0], /"eventType" = '(\w+)'/g)).toEqual([leave.eventType]);
    expect(leave.detail).toBe("/chat");
    for (const k of new Set(all(queries[0], /payload->>'(\w+)'/g))) expect(Object.keys(leave.payload), `payload key ${k}`).toContain(k);
    expect(leave.payload.reason).toBe("route"); // the value query 1 compares against exists in LEAVE_REASONS
    expect(queries[0]).toContain(`'hidden'`);
  });

  it("query 2 reads the page_tab_visit row: eventType, detail, payload.tab", async () => {
    const { tab } = await stored();
    expect(all(queries[1], /"eventType" = '(\w+)'/g)).toEqual([tab.eventType]);
    expect(tab.detail).toBe("/brain");
    for (const k of new Set(all(queries[1], /payload->>'(\w+)'/g))) expect(Object.keys(tab.payload), `payload key ${k}`).toContain(k);
  });

  it("query 3 reads the trpc.call row: metric, source, every tag key, and the value ok:false is stored as", async () => {
    const { metric } = await stored();
    expect(all(queries[2], /metric = '([\w.]+)'/g)).toEqual([metric.metric]);
    expect(all(queries[2], /source = '(\w+)'/g)).toEqual([metric.source]);
    for (const k of new Set(all(queries[2], /tags->>'(\w+)'/g))) expect(Object.keys(metric.tags), `tag key ${k}`).toContain(k);
    expect(metric.tags.ok).toBe(false); // JSON false reads back as the text 'false' that query 3 compares with
    expect(queries[2]).toContain(`tags->>'ok' = 'false'`);
  });

  it("the appendix names no table or column the queries do not use (system_metrics created_at, AuditEvent createdAt)", () => {
    expect(queries[2]).toContain("created_at");
    expect(queries[0]).toContain(`"createdAt"`);
    expect(queries[1]).toContain(`"createdAt"`);
  });
});
