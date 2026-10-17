/**
 * Telegram job, lane 2 fix round (#3097 review P2-2) - phone notes for the
 * coding sessions are CaptureInboxItem rows, and three readers did not filter
 * by status or kind: the two mastery backfills (they send title + summary to a
 * model for XP) and the system-health capture freshness. A bridge note must
 * never reach any of them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = { id: string; kind: string; status: string; title: string; summary: string; createdAt: Date };

const h = vi.hoisted(() => {
  const captures: Capture[] = [];
  const reads: unknown[] = [];
  const keep = (r: Capture, where: Record<string, unknown> | undefined) => {
    if (!where) return true;
    const kind = where.kind as { not?: string } | string | undefined;
    if (typeof kind === "object" && kind?.not !== undefined && r.kind === kind.not) return false;
    if (typeof kind === "string" && r.kind !== kind) return false;
    if (typeof where.status === "string" && r.status !== where.status) return false;
    return true;
  };
  const captureInboxItem = {
    findMany: vi.fn(async (a: { where?: Record<string, unknown>; take?: number } = {}) => {
      reads.push(a.where);
      return captures.filter((r) => keep(r, a.where)).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()).slice(0, a.take ?? 1000);
    }),
    findFirst: vi.fn(async (a: { where?: Record<string, unknown> } = {}) => {
      reads.push(a.where);
      return captures.filter((r) => keep(r, a.where)).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] ?? null;
    }),
  };
  const inert = (method: string) => async () => (method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null);
  const handlers: Record<string, Record<string, unknown>> = { captureInboxItem };
  const prisma = new Proxy({}, { get: (_t, model: string) => model.startsWith("$") ? async () => [] : new Proxy({}, { get: (_m, method: string) => handlers[model]?.[method] ?? inert(method) }) });
  return { captures, reads, prisma, attributeText: vi.fn(async (..._a: unknown[]) => []) };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/mastery/attribution", () => ({ attributeText: h.attributeText, attributeTextBatch: vi.fn(async () => []) }));

import { PHONE_NOTE_KIND } from "@/lib/agent-bridge/phone-notes";
import { backfillStatXp } from "@/lib/mastery/backfill";
import { measureBackfill } from "@/lib/mastery/comprehensive-backfill";

beforeEach(() => {
  vi.clearAllMocks();
  h.reads.length = 0;
  h.captures.length = 0;
  h.captures.push(
    { id: "c1", kind: "note", status: "active", title: "Shop capture", summary: "order more 225/65R17", createdAt: new Date("2026-10-15T12:00:00Z") },
    { id: "n1", kind: PHONE_NOTE_KIND, status: "bridge_unread", title: "Bridge note", summary: "private phone note for a coding session", createdAt: new Date("2026-10-16T12:00:00Z") },
  );
});

describe("a phone note for the coding sessions never reaches a capture reader", () => {
  it("the stat-XP backfill never sends a bridge note to the model", async () => {
    await backfillStatXp(25);
    const texts = h.attributeText.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(texts).not.toContain("private phone note");
    expect(texts).toContain("order more 225/65R17"); // control: the instrument saw the capture source
  });

  it("the comprehensive backfill does not count a bridge note as a capture", async () => {
    const res = await measureBackfill();
    expect(res.bySource.captures?.total).toBe(1);
  });

  it("system-health capture freshness never reads a bridge note", async () => {
    const { buildHealthReport } = await import("@/lib/services/system-health");
    await buildHealthReport({ range: "24h" }).catch(() => undefined);
    expect(h.reads.length).toBeGreaterThan(0); // the instrument saw the read
    for (const where of h.reads) {
      const r = h.captures.find((c) => c.kind === PHONE_NOTE_KIND)!;
      const kind = (where as { kind?: { not?: string } } | undefined)?.kind;
      const status = (where as { status?: string } | undefined)?.status;
      expect(kind?.not === PHONE_NOTE_KIND || (status !== undefined && status !== r.status)).toBe(true);
    }
  });
});
