/**
 * POST /api/brain/dump retries (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: the row key carried Math.random(), so a client retry of the same body inserted a
 * second brain_dump row. The key is now a hash of what was captured. An Idempotency-Key is hashed
 * together with the content, so a retry of the same body dedupes, while a reused key with a
 * different body stores that new capture. A repeat that hits a soft-deleted row is refused, never
 * reported as ok, because nothing new was stored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const store = vi.hoisted(() => ({
  rows: new Map<string, { id: string; category: string; key: string; content: string; deletedAt: Date | null }>(),
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
      // Mimics @@unique([category, key]): a repeat insert fails with P2002, soft-deleted rows included.
      create: async ({ data }: { data: { category: string; key: string; content: string } }) => {
        const k = uniq(data.category, data.key);
        if (store.rows.has(k)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: `bm_${++store.seq}`, category: data.category, key: data.key, content: data.content, deletedAt: null };
        store.rows.set(k, row);
        return { id: row.id, key: row.key };
      },
      findUnique: async ({ where }: { where: { category_key: { category: string; key: string } } }) => {
        const r = store.rows.get(uniq(where.category_key.category, where.category_key.key));
        return r ? { id: r.id, key: r.key, deletedAt: r.deletedAt } : null;
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

  it("an Idempotency-Key retry of the same body returns the same row", async () => {
    const first = await (await post({ content: "Call Bob" }, { "idempotency-key": "k-1" })).json();
    const second = await (await post({ content: "Call Bob" }, { "idempotency-key": "k-1" })).json();
    expect(store.rows.size).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it("an Idempotency-Key reused with a different body stores the new capture, not the other row", async () => {
    const first = await (await post({ content: "Call Bob" }, { "idempotency-key": "k-1" })).json();
    const res = await post({ content: "Call Bob", selection: "Bob" }, { "idempotency-key": "k-1" });
    const second = await res.json();
    expect(res.status).toBe(200);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBeUndefined();
    expect(second.id).not.toBe(first.id);
    expect(store.rows.size).toBe(2);
    expect([...store.rows.values()].map((r) => r.content).sort()).toEqual(["Call Bob", "Call Bob"]);
  });

  it("re-posting the body of a soft-deleted capture is refused, never ok with the deleted row", async () => {
    const first = await (await post({ content: "Call Bob about the tires" })).json();
    store.rows.get(uniq("brain_dump", first.key))!.deletedAt = new Date();
    const res = await post({ content: "Call Bob about the tires" });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.ok).toBeUndefined();
    expect(store.rows.size).toBe(1);
  });
});
