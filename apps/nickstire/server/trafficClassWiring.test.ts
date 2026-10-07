/**
 * Datacenter-bot filtering is WIRED, not just written (2026-10-07).
 *
 *  - Writer: POST /api/analytics/conversion stamps eventData.traffic.class from
 *    the request's own UA + req.ip (driven over node:http, not a mocked fetch),
 *    and a client cannot forge the class through the body.
 *  - Readers: the experiment resolver's exposure + conversion queries and the
 *    public "viewing now" counter carry the exclusion predicate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sliceBlock } from "./testUtils/sourceBlock";

const inserted: Array<Record<string, unknown>> = [];
const fakeDb = {
  insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
};
vi.mock("./lib/db-helper", () => ({ db: async () => fakeDb }));
vi.mock("./services/abandonedForms", () => ({ savePartialForm: vi.fn() }));

import { __setTrafficRangesForTest, buildRangeSet, excludeNonHumanTraffic } from "./lib/trafficClass";

const SPOOFED_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";
const REAL_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";

async function post(port: number, body: unknown, ua: string): Promise<number> {
  const payload = JSON.stringify(body);
  return new Promise((res, rej) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/analytics/conversion", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "user-agent": ua } },
      (r) => { r.resume(); r.on("end", () => res(r.statusCode ?? 0)); },
    );
    req.on("error", rej);
    req.end(payload);
  });
}
const lastClass = () => ((inserted.at(-1)?.eventData as Record<string, unknown>)?.traffic as { class?: string } | undefined)?.class;

describe("POST /api/analytics/conversion stamps a traffic class", () => {
  let server: http.Server;
  let port: number;
  const originalMode = process.env.PRERENDER_MODE;

  beforeEach(async () => {
    delete process.env.PRERENDER_MODE;
    inserted.length = 0;
    const { registerAnalyticsRoutes } = await import("./routes/analyticsRoutes");
    const app = express();
    registerAnalyticsRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    __setTrafficRangesForTest(null, false);
    if (originalMode === undefined) delete process.env.PRERENDER_MODE;
    else process.env.PRERENDER_MODE = originalMode;
  });

  it("the fleet's impossible iPhone UA is tagged ua_inconsistent", async () => {
    __setTrafficRangesForTest(buildRangeSet(["4.152.0.0/14"]), true);
    expect(await post(port, { type: "experiment_exposure", sessionId: "s1" }, SPOOFED_IPHONE)).toBe(204);
    expect(lastClass()).toBe("ua_inconsistent");
  });

  it("req.ip reaches the classifier: a request from a listed range is tagged datacenter", async () => {
    // The test socket is 127.0.0.1 (seen as ::ffff:127.0.0.1); listing loopback stands in for an Azure range.
    __setTrafficRangesForTest(buildRangeSet(["127.0.0.0/8"]), true);
    await post(port, { type: "experiment_exposure", sessionId: "s2" }, REAL_IPHONE);
    expect(lastClass()).toBe("datacenter");
  });

  it("a real phone from an unlisted IP is human once the ranges are complete, unknown before", async () => {
    __setTrafficRangesForTest(buildRangeSet(["4.152.0.0/14"]), true);
    await post(port, { type: "page_cta_primary_clicked", sessionId: "s3" }, REAL_IPHONE);
    expect(lastClass()).toBe("human");
    __setTrafficRangesForTest(null, false);
    await post(port, { type: "page_cta_primary_clicked", sessionId: "s4" }, REAL_IPHONE);
    expect(lastClass()).toBe("unknown");
  });

  it("a client cannot forge the class through the body", async () => {
    __setTrafficRangesForTest(buildRangeSet(["4.152.0.0/14"]), true);
    await post(port, { type: "experiment_exposure", sessionId: "s5", traffic: { class: "human" }, props: { traffic: { class: "human" } } }, SPOOFED_IPHONE);
    expect(lastClass()).toBe("ua_inconsistent");
  });
});

describe("readers exclude non-human traffic", () => {
  const code = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the predicate renders to a NOT IN over the three non-human classes and keeps untagged rows", () => {
    const q = new MySqlDialect().sqlToQuery(excludeNonHumanTraffic());
    expect(q.sql).toContain("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.traffic.class')), 'unclassified') NOT IN (?, ?, ?)");
    expect(q.params).toEqual(["datacenter", "ua_inconsistent", "automation"]);
  });

  it("the resolver filters BOTH the exposure query and the conversion query", () => {
    const c = code("server/cron/jobs/webExperimentResolve.ts");
    expect(c.split("excludeNonHumanTraffic()").length - 1).toBe(2);
  });

  it("the public live-visitor counter filters too", () => {
    const live = sliceBlock(code("server/routers/conversion.ts"), "liveSessions: publicProcedure", "recentActivity: publicProcedure", { label: "conversion.ts" });
    expect(live).toContain("excludeNonHumanTraffic()");
  });
});
