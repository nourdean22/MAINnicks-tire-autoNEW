/**
 * Appendix E of the usage map (docs/research/2026-10-23-brain-usage-map-appendix-e.md) is the READER of
 * the three usage-telemetry writers. A reader whose SQL names a key the writer does not store returns
 * empty rows forever, and an empty result reads as "nobody used it" (empty-vs-error). So this test runs
 * each writer for real, captures what it asks the database to store, and checks every payload key, tag
 * key, eventType, metric and source in the appendix's SQL against that. It also holds the SQL to the one
 * time-zone rule that bit this repo before (docs/RECONCILIATION.md, the AT TIME ZONE trap). It does not
 * execute the SQL: that was done once against an in-memory PGlite when the appendix was written.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { auditCreate, metricCreateMany } = vi.hoisted(() => ({ auditCreate: vi.fn(), metricCreateMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: { create: auditCreate }, systemMetric: { createMany: metricCreateMany }, errorLog: { create: vi.fn() } },
}));

import { recordPageLeave, recordPageTabVisit } from "@/lib/services/brain-domain";
import { flushTrpcTelemetry, recordTrpcCall } from "@/lib/trpc/call-telemetry";

const APPENDIX = join(__dirname, "..", "..", "docs", "research", "2026-10-23-brain-usage-map-appendix-e.md");
const md = readFileSync(APPENDIX, "utf8");
const queries = [...md.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const all = (q: string, re: RegExp) => [...q.matchAll(re)].map((m) => m[1]);

/**
 * Both AuditEvent."createdAt" and system_metrics.created_at are plain `timestamp` columns holding UTC.
 * `col AT TIME ZONE 'America/New_York'` on a plain timestamp READS THE UTC VALUE AS NEW YORK TIME and
 * returns a timestamptz: backwards. The right form first declares the column UTC, then converts.
 * Returns how many uses of those columns with AT TIME ZONE are not that two-step form.
 */
function wrongTimeZoneUses(sql: string): number {
  const uses = sql.match(/("createdAt"|created_at)\s+AT\s+TIME\s+ZONE/gi) ?? [];
  const right = sql.match(/\(\s*("createdAt"|created_at)\s+AT\s+TIME\s+ZONE\s+'UTC'\s*\)\s+AT\s+TIME\s+ZONE\s+'[^']+'/gi) ?? [];
  return uses.length - right.length;
}

async function stored() {
  auditCreate.mockReset().mockResolvedValue({ id: "a" });
  metricCreateMany.mockReset().mockResolvedValue({ count: 1 });
  await recordPageLeave({ page: "/chat", dwellMs: 1000, reason: "route" });
  await recordPageTabVisit({ page: "/brain", tab: "memory" });
  recordTrpcCall({ procedure: "task.list", type: "query", ok: false, code: "UNAUTHORIZED", ms: 5 });
  await flushTrpcTelemetry();
  const [leave, tab] = auditCreate.mock.calls.map((c) => c[0].data as { eventType: string; detail: string; payload: Record<string, unknown> });
  const metric = metricCreateMany.mock.calls[0][0].data[0] as { metric: string; source: string; value: number; tags: Record<string, unknown> };
  return { leave, tab, metric };
}

describe("Appendix E queries read what the writers store", () => {
  it("positive control: the appendix has exactly three queries and the extractor finds their keys", () => {
    expect(queries).toHaveLength(3);
    expect(all(queries[0], /payload->>'(\w+)'/g).sort()).toEqual(["capped", "dwellMs", "dwellMs", "reason"].sort());
    expect(all(queries[1], /payload->>'(\w+)'/g)).toEqual(["tab", "tab"]);
    expect([...new Set(all(queries[2], /tags->>'(\w+)'/g))].sort()).toEqual(["count", "max_ms", "ok", "procedure"]);
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

  it("query 3 reads the aggregated trpc.call row: metric, source, every tag key, value as total ms", async () => {
    const { metric } = await stored();
    expect(all(queries[2], /metric = '([\w.]+)'/g)).toEqual([metric.metric]);
    expect(all(queries[2], /source = '(\w+)'/g)).toEqual([metric.source]);
    for (const k of new Set(all(queries[2], /tags->>'(\w+)'/g))) expect(Object.keys(metric.tags), `tag key ${k}`).toContain(k);
    expect(metric.tags.ok).toBe(false); // JSON false reads back as the text 'false' that query 3 compares with
    expect(queries[2]).toContain(`tags->>'ok' = 'false'`);
    // mean_ms divides the stored total by the stored count; the row stores exactly those two
    expect(metric.value).toBe(5);
    expect(metric.tags.count).toBe(1);
    expect(queries[2]).toMatch(/SUM\(value\)/);
    // a stored row is a per-minute BUCKET: calls are the SUM of stored counts, never a row count
    expect(queries[2]).toMatch(/SUM\(\(tags->>'count'\)::int\)\s+AS calls/);
    expect(queries[2]).not.toMatch(/COUNT\(\*\)/);
  });

  it("the appendix names no column the queries do not use (system_metrics created_at, AuditEvent createdAt)", () => {
    expect(queries[2]).toContain("created_at");
    expect(queries[0]).toContain(`"createdAt"`);
    expect(queries[1]).toContain(`"createdAt"`);
  });
});

describe("the time-zone rule", () => {
  it("positive control: the checker rejects a single AT TIME ZONE on the column and accepts the two-step form", () => {
    expect(wrongTimeZoneUses(`date_trunc('day', "createdAt" AT TIME ZONE 'America/New_York')`)).toBe(1);
    expect(wrongTimeZoneUses(`date_trunc('day', created_at AT TIME ZONE 'America/New_York')`)).toBe(1);
    expect(wrongTimeZoneUses(`date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')`)).toBe(0);
    expect(wrongTimeZoneUses(`WHERE "createdAt" >= now() - interval '14 days'`)).toBe(0);
    // a UTC declaration alone, without the conversion, is still a lone AT TIME ZONE on the column
    expect(wrongTimeZoneUses(`"createdAt" AT TIME ZONE 'UTC'`)).toBe(1);
  });

  it("no appendix query applies a single AT TIME ZONE to a plain timestamp column", () => {
    for (const [i, q] of queries.entries()) expect(wrongTimeZoneUses(q), `query ${i + 1}`).toBe(0);
  });

  it("positive control: query 2 does convert to New York time (the rule is checking something)", () => {
    expect(queries[1]).toMatch(/AT\s+TIME\s+ZONE\s+'America\/New_York'/);
  });
});
