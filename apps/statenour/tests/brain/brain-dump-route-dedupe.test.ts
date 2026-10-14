/**
 * POST /api/brain/dump retries (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: the row key carried Math.random(), so a client retry of the same body inserted a
 * second brain_dump row. The key is now a hash of what was captured, or of the client's
 * Idempotency-Key header when one is sent. The unique (category, key) index turns a repeat into
 * a P2002, and the route returns the row already stored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const store = vi.hoisted(() => ({
  rows: new Map<string, { id: string; category: string; key: string }>(),
  seq: 0,
}));
const uniq = (category: string, key: string) => `${category}\u0000${key}`;

vi.mock("@/lib/auth/extension-token", () => ({ validateToken: async () => ({ label: "ext-test" }) }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      // Mimics @@unique([category, key]): a repeat insert fails with P2002.
      create: async ({ data }: { data: { category: string; key: string } }) => {
        const k = uniq(data.category, data.key);
        if (store.rows.has(k)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: `bm_${++store.seq}`, category: data.category, key: data.key };
        store.rows.set(k, row);
        return { id: row.id, key: row.key };
      },
      findUnique: async ({ where }: { where: { category_key: { category: string; key: string } } }) => {
        const r = store.rows.get(uniq(where.category_key.category, where.category_key.key));
        return r ? { id: r.id, key: r.key } : null;
      },
    },
  },
}));

import { POST } from "@/app/api/brain/dump/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://bdnick.info/api/brain/dump", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  store.rows.clear();
  store.seq = 0;
});

describe("POST /api/brain/dump retries", () => {
  it("the same body posted twice stores one row and returns the same id", async () => {
    const first = await (await post({ content: "Call Bob about the tires" })).json();
    const second = await (await post({ content: "Call Bob about the tires" })).json();
    expect(store.rows.size).toBe(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("control: different bodies still store separate rows", async () => {
    await post({ content: "Call Bob about the tires" });
    await post({ content: "Call Ann about the brakes" });
    expect(store.rows.size).toBe(2);
  });

  it("an Idempotency-Key retry dedupes even when the body differs", async () => {
    const first = await (await post({ content: "Call Bob" }, { "idempotency-key": "k-1" })).json();
    const second = await (
      await post({ content: "Call Bob", selection: "Bob" }, { "idempotency-key": "k-1" })
    ).json();
    expect(store.rows.size).toBe(1);
    expect(second.id).toBe(first.id);
  });
});
