/**
 * Langfuse Cloud stops serving GET /traces and GET /observations on 2026-11-16.
 * probe-langfuse-errors.mjs must read through GET /api/public/v2/observations
 * (cursor pagination, `fields` groups) and must still ABORT on a non-2xx.
 *
 * Pure builders are tested directly; the script is also spawned against a local
 * stub server so the wiring (not only the helpers) is the thing asserted.
 */
import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  buildObservationsPath,
  collectPages,
  groupByTrace,
} from "../../scripts/lib/langfuse-v2.mjs";

const SINCE = "2026-10-10T00:00:00.000Z";
const UNTIL = "2026-10-17T00:00:00.000Z";

describe("buildObservationsPath", () => {
  const p = buildObservationsPath({
    since: SINCE,
    until: UNTIL,
    fields: ["core", "basic", "trace_context"],
    limit: 100,
    environment: "production",
  });
  it("targets the v2 route with bounded window, limit, fields", () => {
    expect(p.startsWith("/v2/observations?")).toBe(true);
    const q = new URLSearchParams(p.split("?")[1]);
    expect(q.get("fromStartTime")).toBe(SINCE);
    expect(q.get("toStartTime")).toBe(UNTIL);
    expect(q.get("limit")).toBe("100");
    expect(q.get("fields")).toBe("core,basic,trace_context");
    expect(q.get("environment")).toBe("production");
  });
  it("never uses the removed legacy route or page pagination", () => {
    expect(p).not.toContain("/traces");
    expect(p).not.toContain("page=");
    expect(p).not.toMatch(/^\/observations/);
  });
  it("adds level and cursor only when given", () => {
    expect(p).not.toContain("level=");
    expect(p).not.toContain("cursor=");
    const q = new URLSearchParams(
      buildObservationsPath({ since: SINCE, until: UNTIL, level: "ERROR", cursor: "abc=", limit: 5 }).split("?")[1],
    );
    expect(q.get("level")).toBe("ERROR");
    expect(q.get("cursor")).toBe("abc=");
  });
});

describe("collectPages", () => {
  const page = (data: unknown[], cursor?: string | null) => ({
    ok: true as const,
    json: { data, meta: cursor === undefined ? {} : { cursor } },
  });

  it("follows meta.cursor and stops when it is absent", async () => {
    const seen: Array<string | undefined> = [];
    const pages = [page([{ id: 1 }, { id: 2 }], "c1"), page([{ id: 3 }])];
    const r = await collectPages(async (cursor) => {
      seen.push(cursor);
      return pages.shift()!;
    }, { maxPages: 6 });
    expect(seen).toEqual([undefined, "c1"]);
    expect(r.rows.map((x: { id: number }) => x.id)).toEqual([1, 2, 3]);
    expect(r.complete).toBe(true);
    expect(r.failure).toBeNull();
  });

  it("treats a null cursor as the end", async () => {
    const r = await collectPages(async () => page([{ id: 1 }], null), { maxPages: 6 });
    expect(r.complete).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it("a page cap with a cursor still pending is NOT complete", async () => {
    const r = await collectPages(async () => page([{ id: 1 }], "more"), { maxPages: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.complete).toBe(false);
  });

  it("a non-2xx surfaces as failure, never as an empty complete result", async () => {
    const r = await collectPages(async () => ({ ok: false as const, status: 410, body: "gone" }), { maxPages: 6 });
    expect(r.failure).toEqual({ status: 410, body: "gone" });
    expect(r.complete).toBe(false);
    expect(r.rows).toHaveLength(0);
  });

  it("a failure on a later page keeps earlier rows but is not complete", async () => {
    const pages = [page([{ id: 1 }], "c1"), { ok: false as const, status: 500, body: "x" }];
    const r = await collectPages(async () => pages.shift()!, { maxPages: 6 });
    expect(r.rows).toHaveLength(1);
    expect(r.failure?.status).toBe(500);
    expect(r.complete).toBe(false);
  });
});

describe("groupByTrace", () => {
  it("yields one entry per trace, carrying name, metadata and tags", () => {
    const g = groupByTrace([
      { traceId: "t1", traceName: "", tags: [], metadata: {} },
      { traceId: "t1", traceName: "chat", tags: ["a"], metadata: { source: "chat" } },
      { traceId: "t2", traceName: "", tags: ["b"] },
      { traceId: "t1" },
      { id: "no-trace-id" },
    ]);
    expect(g).toHaveLength(2);
    const t1 = g.find((t: { traceId: string }) => t.traceId === "t1");
    expect(t1.name).toBe("chat");
    expect(t1.tags).toEqual(["a"]);
    expect(t1.metadata.source).toBe("chat");
    expect(g.find((t: { traceId: string }) => t.traceId === "t2").tags).toEqual(["b"]);
  });
});

// ── the script itself, against a local stub (no production Langfuse) ──────────
type Stub = { server: Server; port: number; urls: string[] };
function stub(handler: (url: URL) => { status: number; body: unknown }): Promise<Stub> {
  const urls: string[] = [];
  const server = createServer((req, res) => {
    urls.push(req.url ?? "");
    const r = handler(new URL(req.url ?? "", "http://x"));
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => ok({ server, port: (server.address() as { port: number }).port, urls })),
  );
}
function runProbe(port: number): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const env = { ...process.env } as Record<string, string | undefined>;
    for (const k of Object.keys(env)) if (k.startsWith("LANGFUSE_")) delete env[k];
    Object.assign(env, {
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
      LANGFUSE_BASE_URL: `http://127.0.0.1:${port}`,
      LANGFUSE_QUERY_ENVIRONMENT: "production",
    });
    const c = spawn(process.execPath, [resolve(__dirname, "../../scripts/probe-langfuse-errors.mjs")], { env: env as NodeJS.ProcessEnv });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => done({ code, out }));
  });
}

describe("probe-langfuse-errors.mjs", () => {
  it("reads only v2/observations, follows the cursor, groups traces", async () => {
    const s = await stub((u) => {
      const level = u.searchParams.get("level");
      if (level) return { status: 200, body: { data: [], meta: {} } };
      return u.searchParams.get("cursor")
        ? { status: 200, body: { data: [{ traceId: "t2", traceName: "" }], meta: {} } }
        : { status: 200, body: { data: [{ traceId: "t1", traceName: "chat" }, { traceId: "t1" }], meta: { cursor: "c1" } } };
    });
    try {
      const r = await runProbe(s.port);
      expect(r.code).toBe(0);
      expect(r.out).toContain("control: 2 trace(s)");
      expect(s.urls.length).toBeGreaterThanOrEqual(4); // 2 trace pages + ERROR + WARNING
      for (const u of s.urls) {
        expect(u.startsWith("/api/public/v2/observations?")).toBe(true);
        expect(u).not.toContain("page=");
        expect(u).toContain("toStartTime=");
      }
      expect(s.urls.some((u) => u.includes("cursor=c1"))).toBe(true);
    } finally {
      s.server.close();
    }
  }, 30_000);

  it("ABORTS (exit 2) on a non-2xx instead of printing an empty all-clear", async () => {
    const s = await stub(() => ({ status: 410, body: { error: "gone" } }));
    try {
      const r = await runProbe(s.port);
      expect(r.code).toBe(2);
      expect(r.out).toContain("ABORT");
      expect(r.out).toContain("410");
    } finally {
      s.server.close();
    }
  }, 30_000);
});
