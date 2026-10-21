/**
 * 2026-10-21 · RULE 3 (missing_arrival_record) must accept a texted arrival.
 *
 * A bookSlot call for "coming now" or a tow now texts the shop and files NO
 * expected_arrivals row; its trace is the cron_alerts_fired claim keyed
 * voice-arrival:<vapiCallId>. Without reading that, every such call would be
 * flagged as an "alert" for a promise that was kept. DB and VAPI are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  claimKeys: new Set<string>(),
  arrivalRows: [] as Array<{ id: number }>,
  updates: [] as Array<Record<string, unknown>>,
}));

function render(q: { queryChunks?: unknown[] }): { text: string; params: unknown[] } {
  let text = "";
  const params: unknown[] = [];
  for (const c of q.queryChunks ?? []) {
    const v = (c as { value?: unknown })?.value;
    if (Array.isArray(v)) text += v.join("");
    else { text += "?"; params.push(c); }
  }
  return { text, params };
}

vi.mock("../../db", async (orig) => {
  const schema = await import("../../../drizzle/schema");
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ["where", "orderBy"]) c[k] = () => c;
    c.limit = async () => rows();
    return c;
  };
  return {
    ...(await orig<typeof import("../../db")>()),
    getDb: async () => ({
      select: () => ({
        from: (table: unknown) => {
          if (table === schema.vapiCallLogs) {
            return chain(() => [{ id: 1, vapiCallId: "call-tow-1", phoneNumber: "+12165550123", durationSeconds: 90, metadata: null }]);
          }
          if (table === schema.expectedArrivals) return chain(() => h.arrivalRows);
          return chain(() => []);
        },
      }),
      execute: async (q: { queryChunks?: unknown[] }) => {
        const { text, params } = render(q);
        if (/cron_alerts_fired/.test(text)) {
          const hit = params.some((p) => typeof p === "string" && h.claimKeys.has(p));
          return [[{ hit: hit ? 1 : 0 }]];
        }
        return [[]];
      },
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { h.updates.push(v); } }) }),
    }),
  };
});
vi.mock("../../services/telegram", () => ({ sendTelegram: vi.fn(async () => ({ status: "delivered" })) }));

import { processAgenticAuditor } from "./agenticAuditor";

const savedKey = process.env.VAPI_API_KEY;
const savedFetch = globalThis.fetch;

beforeEach(() => {
  h.claimKeys.clear();
  h.arrivalRows = [];
  h.updates = [];
  process.env.VAPI_API_KEY = "test-key";
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      id: "call-tow-1",
      artifact: {
        messages: [
          { role: "assistant", toolCalls: [{ id: "tc1", function: { name: "bookSlot", arguments: JSON.stringify({ name: "Ray", service: "tow incoming — won't start" }) } }] },
          { role: "tool", toolCallId: "tc1", result: JSON.stringify({ success: true, status: "shop_texted" }) },
        ],
      },
    }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.VAPI_API_KEY;
  else process.env.VAPI_API_KEY = savedKey;
  globalThis.fetch = savedFetch;
});

/** The findings array inside the JSON_SET(... '$.agenticAudit', CAST(? AS JSON)) the auditor writes. */
const findingsWritten = () =>
  h.updates.flatMap((u) =>
    render(u.metadata as { queryChunks?: unknown[] }).params
      .filter((p): p is string => typeof p === "string" && p.startsWith("{"))
      .flatMap((p) => (JSON.parse(p) as { findings?: Array<{ type: string }> }).findings ?? []),
  );

describe("RULE 3 · bookSlot persisted", () => {
  it("a texted arrival (voice-arrival claim, no arrival row) raises no missing_arrival_record", async () => {
    h.claimKeys.add("voice-arrival:call-tow-1");
    await processAgenticAuditor();
    expect(h.updates.length).toBeGreaterThan(0); // the call was audited at all
    expect(findingsWritten().map((f) => f.type)).not.toContain("missing_arrival_record");
  });

  it("control: neither a row nor a claim → missing_arrival_record is still raised", async () => {
    await processAgenticAuditor();
    expect(findingsWritten().map((f) => f.type)).toContain("missing_arrival_record");
  });

  it("an expected_arrivals row still satisfies it (today's check)", async () => {
    h.arrivalRows = [{ id: 5 }];
    await processAgenticAuditor();
    expect(findingsWritten().map((f) => f.type)).not.toContain("missing_arrival_record");
  });
});
