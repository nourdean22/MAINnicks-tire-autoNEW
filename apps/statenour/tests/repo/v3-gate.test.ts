/**
 * tests/repo/v3-gate.test.ts · 2026-10-15 · UI v3 Wave 0b
 *
 * Controls for the v3 six-feet gate (tests/e2e/visible-transformation-v3.spec.ts),
 * runnable with no browser. The gate is the inverse of a snapshot test: it
 * FAILS when a page still looks like the frozen v2 render, so a verdict
 * function that says "ok" too easily lets an untouched page through. This
 * file pins (1) the verdict arithmetic and its thresholds and measureAndJudge
 * with stub instruments, (2) the instrument on REAL committed renders (the
 * existing visual-distance-metric test draws synthetic rectangles; it never
 * touches a committed PNG), (3) the fixture router and wiring, the fixture
 * data's hygiene and age arithmetic, (4) that the smoke cannot pass on an
 * empty page, (5) that the v3 spec judges only through measureAndJudge,
 * (6) the workflow's capture path, and (7) that tsconfig.e2e.json really
 * compiles the fixtures against their contracts (two tsc spawns, ~1 min).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  DEMO,
  FIXED_TIME,
  NOW_ISO,
  NOW_MS,
  PAGE_ERRORS,
  TRPC_FIXTURES,
  UNSTUBBED_ALLOWLIST,
  answerApi,
  disallowedUnstubbed,
  installFixtures,
  type FixtureReport,
} from "../e2e/fixtures";
import { MISSION_TASKS } from "../e2e/fixtures/missions";
import { MIN_DISTANCE, MIN_INK, baselineSkipReason, captureVerdict, measureAndJudge, v3GateVerdict, type MeasureDeps } from "../e2e/v3-gate";
import { V3_PAGES, V3_VIEWPORTS } from "../e2e/vt-render";
import { visualDistance } from "../e2e/visual-distance";
import { capabilityBadge } from "@/features/chat-v2/lib/capability-label";
import { formatToolReceipts, summarizeToolReceipts } from "@/lib/ai/receipts/tool-receipt-summary";

const APP_DIR = path.join(__dirname, "..", "..");
const E2E_DIR = path.join(__dirname, "..", "e2e");
const V2_SPEC = path.join(E2E_DIR, "visible-transformation.spec.ts");
const V2_SNAPSHOTS = path.join(E2E_DIR, "visible-transformation.spec.ts-snapshots");
const V3_SPEC = path.join(E2E_DIR, "visible-transformation-v3.spec.ts");
const SMOKE_SPEC = path.join(E2E_DIR, "fixtures-render.spec.ts");
const WORKFLOW = path.join(APP_DIR, "..", "..", ".github", "workflows", "e2e-statenour.yml");
const read = (file: string) => fs.readFileSync(file, "utf8");

describe("v3 gate verdict", () => {
  const good = { baselineExists: true, ink: 0.03, distance: 0.5 };

  it("passes a distant, inked render that has a baseline", () => {
    expect(v3GateVerdict(good)).toMatchObject({ ok: true });
  });

  it("FAILS a missing baseline, even when everything else looks perfect", () => {
    const v = v3GateVerdict({ ...good, baselineExists: false });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/missing baseline/i);
  });

  it("FAILS a render with too little ink, even when its distance is huge", () => {
    // A void screen is "far" from every baseline: distance alone would pass it.
    const v = v3GateVerdict({ ...good, ink: MIN_INK / 2, distance: 1 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/ink/i);
  });

  it("ink must be STRICTLY above MIN_INK (v2 uses toBeGreaterThan)", () => {
    expect(v3GateVerdict({ ...good, ink: MIN_INK }).ok).toBe(false);
    expect(v3GateVerdict({ ...good, ink: MIN_INK + 1e-6 }).ok).toBe(true);
  });

  it("FAILS distance 0.34 and PASSES 0.35 and 0.50", () => {
    const low = v3GateVerdict({ ...good, distance: 0.34 });
    expect(low.ok).toBe(false);
    expect(low.reason).toMatch(/still looks like/i);
    expect(v3GateVerdict({ ...good, distance: 0.35 }).ok).toBe(true);
    expect(v3GateVerdict({ ...good, distance: 0.5 }).ok).toBe(true);
  });

  it("an unmeasurable render (NaN) never passes", () => {
    expect(v3GateVerdict({ ...good, distance: Number.NaN }).ok).toBe(false);
    expect(v3GateVerdict({ ...good, ink: Number.NaN }).ok).toBe(false);
  });

  it("a distance of exactly 0 (identical render) fails", () => {
    expect(v3GateVerdict({ ...good, distance: 0 }).ok).toBe(false);
  });

  it("capture refuses a void render, so a blank page can never become a baseline", () => {
    expect(captureVerdict({ ink: 0 }).ok).toBe(false);
    expect(captureVerdict({ ink: MIN_INK }).ok).toBe(false);
    expect(captureVerdict({ ink: 0.03 }).ok).toBe(true);
  });
});

describe("v3 gate thresholds vs the v2 spec", () => {
  const v2 = fs.readFileSync(V2_SPEC, "utf8");

  it("MIN_DISTANCE is the v2 value", () => {
    const m = /const MIN_DISTANCE = ([0-9.]+);/.exec(v2);
    expect(m, "v2 spec no longer declares MIN_DISTANCE the way this test reads it").not.toBeNull();
    expect(MIN_DISTANCE).toBe(Number(m![1]));
  });

  it("MIN_INK is the v2 value", () => {
    const m = /const MIN_INK = ([0-9.]+);/.exec(v2);
    expect(m, "v2 spec no longer declares MIN_INK the way this test reads it").not.toBeNull();
    expect(MIN_INK).toBe(Number(m![1]));
  });
});

// ── measureAndJudge: the spec's only path, with stub instruments ────────────

describe("measureAndJudge (stub deps)", () => {
  const VP = { width: 390, height: 844 };
  const A = Buffer.from("baseline");
  const B = Buffer.from("current");
  const deps = (ink: number, distance: number): MeasureDeps & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      inkCoverage: async (png, vp) => {
        calls.push(`ink:${png.toString()}:${vp.width}`);
        return ink;
      },
      visualDistance: async (a, b, vp) => {
        calls.push(`dist:${a.toString()}>${b.toString()}:${vp.width}`);
        return { ratio: distance };
      },
    };
  };

  it("measures the CURRENT render's ink and the baseline->current distance, in that order", async () => {
    const d = deps(0.03, 0.5);
    const r = await measureAndJudge({ baseline: A, current: B, viewport: VP }, d);
    expect(d.calls).toEqual(["ink:current:390", "dist:baseline>current:390"]);
    expect(r).toEqual({ ink: 0.03, distance: 0.5, verdict: { ok: true, reason: "distance 50.0%" } });
  });

  it("missing baseline: FAILS, never calls the distance, reports NaN not a stand-in number", async () => {
    const d = deps(0.03, 0.5);
    const r = await measureAndJudge({ baseline: null, current: B, viewport: VP }, d);
    expect(r.verdict.ok).toBe(false);
    expect(r.verdict.reason).toMatch(/missing baseline/i);
    expect(Number.isNaN(r.distance)).toBe(true);
    expect(d.calls).toEqual(["ink:current:390"]);
  });

  it("NaN from the instrument never passes", async () => {
    expect((await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(Number.NaN, 0.5))).verdict.ok).toBe(false);
    expect((await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(0.03, Number.NaN))).verdict.ok).toBe(false);
  });

  it("ink exactly MIN_INK fails, a hair above passes the ink check", async () => {
    const atFloor = await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(MIN_INK, 0.5));
    expect(atFloor.verdict).toMatchObject({ ok: false });
    expect(atFloor.verdict.reason).toMatch(/ink/i);
    expect((await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(MIN_INK + 1e-6, 0.5))).verdict.ok).toBe(true);
  });

  it("distance 0.3499 fails, 0.35 passes", async () => {
    const low = await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(0.03, 0.3499));
    expect(low.verdict.ok).toBe(false);
    expect(low.verdict.reason).toMatch(/still looks like/i);
    expect((await measureAndJudge({ baseline: A, current: B, viewport: VP }, deps(0.03, 0.35))).verdict.ok).toBe(true);
  });

  it("with the real instruments, a committed render against itself fails as identical", async () => {
    const png = fs.readFileSync(path.join(V2_SNAPSHOTS, "home-phone.png"));
    const r = await measureAndJudge({ baseline: png, current: Buffer.from(png), viewport: VP });
    expect(r.ink).toBeGreaterThan(MIN_INK);
    expect(r.distance).toBe(0);
    expect(r.verdict.ok).toBe(false);
  });
});

// ── The instrument on REAL committed renders ────────────────────────────────

interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number }>;
  extract(r: { left: number; top: number; width: number; height: number }): SharpImage;
  extend(o: { top: number; left: number; background: string }): SharpImage;
  png(): { toBuffer(): Promise<Buffer> };
  toBuffer(): Promise<Buffer>;
}
interface SharpFn {
  (input: Buffer): SharpImage;
  (opts: { create: { width: number; height: number; channels: 3; background: string } }): SharpImage;
}

function loadSharp(): SharpFn {
  const requireFromNext = createRequire(require.resolve("next/package.json"));
  const mod = requireFromNext("sharp") as SharpFn | { default: SharpFn };
  return ("default" in mod ? mod.default : mod) as SharpFn;
}

/** Slide a render right/down by (dx, dy), black-filling the uncovered edge: what a shell rail does to a page. */
async function shifted(png: Buffer, dx: number, dy: number, size: { width: number; height: number }): Promise<Buffer> {
  const sharp = loadSharp();
  const cropped = await sharp(png)
    .extract({ left: 0, top: 0, width: size.width - dx, height: size.height - dy })
    .png()
    .toBuffer();
  return sharp(cropped).extend({ top: dy, left: dx, background: "#000000" }).png().toBuffer();
}

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
const PAGES = ["home", "missions", "brain", "people", "system"] as const;
/**
 * Diagonal slides per viewport. Desktop takes 16 and 64px; the phone takes the
 * v2 calibration pair 16 and 40px (visual-distance.ts header). MEASURED
 * 2026-10-15: a 64px diagonal slide of home-phone.png scores 0.395, i.e. it
 * would PASS the 0.35 gate. A slide that size pushes 16% of a 390px page off
 * the edge, and edge loss is real change to the instrument, not translation.
 * Nothing slides a phone page 64px today (the spine rail is >=1280px only);
 * it is a limit to know, not a case this test can hold.
 */
const SLIDES = { desktop: [16, 64], phone: [16, 40] } as const;

describe("visual-distance on committed v2 renders", () => {
  for (const page of PAGES) {
    for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
      const file = path.join(V2_SNAPSHOTS, `${page}-${vpKey}.png`);

      it(`${page}/${vpKey}: the committed PNG has the viewport's dimensions`, async () => {
        const meta = await loadSharp()(fs.readFileSync(file)).metadata();
        expect({ width: meta.width, height: meta.height }).toEqual(vp);
      });

      it(`${page}/${vpKey}: an identical re-render scores 0.000`, async () => {
        const a = fs.readFileSync(file);
        const d = await visualDistance(a, Buffer.from(a), vp);
        expect(d.ratio.toFixed(3)).toBe("0.000");
      });

      it(`${page}/${vpKey}: the same render slid ${SLIDES[vpKey as keyof typeof SLIDES].join("px and ")}px stays under the gate`, async () => {
        const a = fs.readFileSync(file);
        for (const px of SLIDES[vpKey as keyof typeof SLIDES]) {
          const slid = await shifted(a, px, px, vp);
          const d = await visualDistance(a, slid, vp);
          expect(d.ratio, `${page}/${vpKey} slid ${px}px scored ${d.ratio.toFixed(3)}`).toBeLessThan(MIN_DISTANCE);
        }
      });
    }
  }

  it("positive control: a render with its content wiped scores above the gate", async () => {
    // The controls above would also pass an instrument stuck at 0. This one
    // fails such an instrument: a void page where Home was must read as a change.
    const a = fs.readFileSync(path.join(V2_SNAPSHOTS, "home-desktop.png"));
    const vp = VIEWPORTS.desktop;
    const blank = await loadSharp()({ create: { ...vp, channels: 3, background: "#000000" } })
      .png()
      .toBuffer();
    const d = await visualDistance(a, blank, vp);
    expect(d.ratio).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });
});

// ── The fixture router: what the browser is told, driven with no browser ────

interface FakeRoute {
  fulfilled: { status: number; contentType: string; body: string } | null;
  fellBack: boolean;
  request(): { method(): string; url(): string };
  fulfill(o: { status: number; contentType: string; body: string }): Promise<void>;
  fallback(): Promise<void>;
}

function fakeRoute(method: string, url: string): FakeRoute {
  const r: FakeRoute = {
    fulfilled: null,
    fellBack: false,
    request: () => ({ method: () => method, url: () => url }),
    fulfill: async (o) => {
      r.fulfilled = o;
    },
    fallback: async () => {
      r.fellBack = true;
    },
  };
  return r;
}

/** A Page with only what installFixtures touches, recording the ORDER of the two calls. */
function fakePage() {
  const log: string[] = [];
  const seen: { fixedTime?: Date; predicate?: (u: URL) => boolean; handler?: (r: FakeRoute) => Promise<void> } = {};
  const page = {
    clock: {
      setFixedTime: async (d: Date) => {
        log.push("clock");
        seen.fixedTime = d;
      },
    },
    route: async (predicate: (u: URL) => boolean, handler: (r: FakeRoute) => Promise<void>) => {
      log.push("route");
      seen.predicate = predicate;
      seen.handler = handler;
    },
  };
  return { page: page as unknown as Page, log, seen };
}

const BASE = "http://localhost:3001";
const newReport = (): FixtureReport => ({ unstubbed: new Set() });
const trpcUrl = (procs: string, query = "?batch=1&input=%7B%7D") => new URL(`${BASE}/api/trpc/${procs}${query}`);

describe("fixture router (answerApi)", () => {
  it("answers a stubbed procedure with the tRPC success envelope, in a batch array", () => {
    const a = answerApi("GET", trpcUrl("operator.brief"), newReport());
    expect(a).toEqual({ kind: "fulfill", status: 200, body: [{ result: { data: TRPC_FIXTURES["operator.brief"] } }] });
  });

  it("keeps request order in a mixed batch, and answers an unknown procedure with an ERROR entry, never data", () => {
    const report = newReport();
    const a = answerApi("GET", trpcUrl("task.deck,operator.commandCenterState,operator.brief"), report);
    if (a.kind !== "fulfill") throw new Error("expected a fulfilled answer");
    const body = a.body as { result?: { data: unknown }; error?: { code: number; data: { code: string; path: string } } }[];
    expect(body).toHaveLength(3);
    expect(body[0].result?.data).toBe(TRPC_FIXTURES["task.deck"]);
    expect(body[1].result).toBeUndefined();
    expect(body[1].error).toMatchObject({ code: -32004, data: { code: "NOT_FOUND", path: "operator.commandCenterState" } });
    expect(body[2].result?.data).toBe(TRPC_FIXTURES["operator.brief"]);
    expect([...report.unstubbed]).toEqual(["GET operator.commandCenterState"]);
  });

  it("decodes an encoded comma in the batch path", () => {
    const a = answerApi("GET", trpcUrl("task.deck%2Ctask.list"), newReport());
    if (a.kind !== "fulfill") throw new Error("expected a fulfilled answer");
    expect((a.body as unknown[]).length).toBe(2);
  });

  it("an unbatched call gets a single envelope, not an array", () => {
    const a = answerApi("GET", trpcUrl("operator.brief", ""), newReport());
    expect(a).toMatchObject({ kind: "fulfill", body: { result: { data: TRPC_FIXTURES["operator.brief"] } } });
  });

  it("never stubs a mutation, even for a procedure name that has a read fixture", () => {
    const report = newReport();
    const a = answerApi("POST", trpcUrl("operator.brief", "?batch=1"), report);
    if (a.kind !== "fulfill") throw new Error("expected a fulfilled answer");
    expect((a.body as { error?: unknown }[])[0].error).toBeDefined();
    expect([...report.unstubbed]).toEqual(["POST operator.brief"]);
  });

  it("sends auth to the real server and refuses every other REST call with an explicit 404", () => {
    const report = newReport();
    expect(answerApi("GET", new URL(`${BASE}/api/auth/session`), report)).toEqual({ kind: "passthrough" });
    expect(answerApi("GET", new URL(`${BASE}/api/coach/events?surface=tasks&limit=3`), report)).toMatchObject({
      kind: "fulfill",
      status: 404,
    });
    expect([...report.unstubbed]).toEqual(["GET /api/coach/events"]);
  });

  it("answers Chat's mount-time stream-resume probe with the server's own empty 204, and nothing near it", () => {
    // useChat({ resume: true }) GETs /api/ai/chat/none/stream on every /chat load; the real route answers
    // `new Response(null, { status: 204 })` for "none". A 404 here made onError flip the header pill to "chat degraded".
    const report = newReport();
    expect(answerApi("GET", new URL(`${BASE}/api/ai/chat/none/stream`), report)).toEqual({ kind: "fulfill", status: 204, body: undefined });
    expect([...report.unstubbed]).toEqual([]);
    // positive control: a real conversation id, another method and a sibling path stay refused
    for (const [method, p] of [["GET", "/api/ai/chat/demo-conv-1/stream"], ["POST", "/api/ai/chat/none/stream"], ["GET", "/api/ai/chat/none"]] as const) {
      expect(answerApi(method, new URL(`${BASE}${p}`), report), `${method} ${p}`).toMatchObject({ kind: "fulfill", status: 404 });
    }
    expect([...report.unstubbed].sort()).toEqual(["GET /api/ai/chat/demo-conv-1/stream", "GET /api/ai/chat/none", "POST /api/ai/chat/none/stream"]);
  });

  it("the live stream route really answers 204 for 'none' (the fixture copies the server, it does not invent)", () => {
    const route = read(path.join(APP_DIR, "app", "api", "ai", "chat", "[conversationId]", "stream", "route.ts"));
    expect(route).toMatch(/conversationId === "none"\) \{\s*return new Response\(null, \{ status: 204 \}\);/);
  });

  /** Paths whose value JSON would drop or rewrite: undefined, Date, function, symbol, bigint, NaN/Infinity. */
  function nonWireValues(value: unknown, at = "$"): string[] {
    if (value === undefined) return [`${at}: undefined`];
    if (value instanceof Date) return [`${at}: Date`];
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return [`${at}: ${typeof value}`];
    if (typeof value === "number" && !Number.isFinite(value)) return [`${at}: ${value}`];
    if (Array.isArray(value)) return value.flatMap((v, i) => nonWireValues(v, `${at}[${i}]`));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => nonWireValues(v, `${at}.${k}`));
    return [];
  }

  it("positive control: the wire walk flags an undefined property, a Date and a function", () => {
    expect(nonWireValues({ a: 1, b: undefined })).toEqual(["$.b: undefined"]);
    expect(nonWireValues({ a: [new Date(0)] })).toEqual(["$.a[0]: Date"]);
    expect(nonWireValues({ f: () => 1 })).toEqual(["$.f: function"]);
    // The naive JSON round-trip the first draft used is blind to the first case.
    expect(JSON.parse(JSON.stringify({ a: 1, b: undefined }))).toEqual({ a: 1, b: undefined });
  });

  it("every fixture reaches the wire whole: no undefined, Date, function or non-finite number anywhere", () => {
    for (const [procedure, data] of Object.entries(TRPC_FIXTURES)) {
      expect(nonWireValues(data), procedure).toEqual([]);
    }
  });
});

describe("installFixtures (the wiring, against a recording Page)", () => {
  it("pins the clock BEFORE routing, to the fixed instant", async () => {
    const { page, log, seen } = fakePage();
    await installFixtures(page);
    expect(log).toEqual(["clock", "route"]);
    expect(seen.fixedTime?.toISOString()).toBe(new Date(FIXED_TIME).toISOString());
    expect(seen.fixedTime?.toISOString()).toBe("2026-10-15T18:00:00.000Z");
  });

  it("intercepts /api/** only", async () => {
    const { page, seen } = fakePage();
    await installFixtures(page);
    const hit = (p: string) => seen.predicate!(new URL(`${BASE}${p}`));
    expect(hit("/api/trpc/operator.brief")).toBe(true);
    expect(hit("/api/anything")).toBe(true);
    expect(hit("/missions")).toBe(false);
    expect(hit("/_next/static/chunks/app.js")).toBe(false);
    expect(hit("/apiary")).toBe(false);
  });

  it("fulfils a stubbed read as JSON, falls back for auth, and reports what it refused", async () => {
    const { page, seen } = fakePage();
    const report = await installFixtures(page);

    const ok = fakeRoute("GET", `${BASE}/api/trpc/operator.brief?batch=1&input=%7B%7D`);
    await seen.handler!(ok);
    expect(ok.fulfilled?.contentType).toBe("application/json");
    expect(JSON.parse(ok.fulfilled!.body)[0].result.data.state.summary).toBe(DEMO.homeSummary);

    const auth = fakeRoute("GET", `${BASE}/api/auth/session`);
    await seen.handler!(auth);
    expect(auth.fellBack).toBe(true);
    expect(auth.fulfilled).toBeNull();

    await seen.handler!(fakeRoute("GET", `${BASE}/api/brain/wisdom`));
    expect([...report.unstubbed]).toEqual(["GET /api/brain/wisdom"]);

    // A 204 carries no body and no content type: the browser's fetch would reject a 204 with a payload.
    const empty = fakeRoute("GET", `${BASE}/api/ai/chat/none/stream`);
    await seen.handler!(empty);
    expect(empty.fulfilled).toEqual({ status: 204 });
    expect([...report.unstubbed]).toEqual(["GET /api/brain/wisdom"]);
  });
});

// ── The fixtures: fictional, deterministic, and unable to hide a failed read ─

/** Lines that would make a fixture depend on the machine or the moment. */
// `new Date(<literal>)` is deterministic (time.ts derives NOW_ISO that way); a bare `new Date()` reads the clock.
const NONDETERMINISTIC = /Date\.now|new Date\(\s*\)|Math\.random|performance\.now|toLocale|Intl\.|randomUUID|process\.env/;

describe("fixture data", () => {
  const dataFiles = ["time.ts", "home.ts", "missions.ts", "shell.ts", "chat.ts"].map((f) => path.join(E2E_DIR, "fixtures", f));

  it("positive control: the determinism scan flags a clock read, a random and a locale call", () => {
    for (const bad of ["Date.now()", "new Date()", "Math.random()", "x.toLocaleString()", "new Intl.DateTimeFormat()"]) {
      expect(NONDETERMINISTIC.test(bad), bad).toBe(true);
    }
  });

  it("no data file reads the clock, a random source, the locale or the environment", () => {
    for (const file of dataFiles) {
      const hit = NONDETERMINISTIC.exec(read(file));
      expect(hit, `${path.basename(file)} contains ${hit?.[0]}`).toBeNull();
    }
  });

  it("every human-readable string in the fixtures says Demo (no real vendor, person or customer)", () => {
    const TEXT_KEYS = new Set(["title", "subject", "label", "text", "summary", "headline", "body", "description", "why", "who", "waitingOn", "missionTitle", "nowExcerpt", "beforeExcerpt", "resumeNote", "evidence", "detail", "consequence", "nextAction", "nextPhysicalAction", "rankExplanation"]);
    // Names the product itself uses for its own agent and shell-owned labels, not fixture people.
    const OWN = new Set(["Nick", "MIT"]);
    const missing: string[] = [];
    const walk = (value: unknown, key: string | null) => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => walk(v, k));
      else if (typeof value === "string" && key && TEXT_KEYS.has(key) && !OWN.has(value) && !/\bDemo\b/i.test(value)) {
        missing.push(`${key}: ${value}`);
      }
    };
    walk(TRPC_FIXTURES, null);
    expect(missing).toEqual([]);
  });

  it("no string has the shape of a person's name (two capitalised words in a row) unless it is 'Demo <role>'", () => {
    // "Demo" appearing once in a string must not excuse a real name later in it.
    const NAME_SHAPE = /\b(?!Demo\b)[A-Z][a-z]+\s+(?!Demo\b)[A-Z][a-z]+\b/;
    const flagged: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
      else if (typeof value === "string" && NAME_SHAPE.test(value)) flagged.push(value);
    };
    walk(TRPC_FIXTURES);
    expect(flagged).toEqual([]);
    // Positive control: the shape does catch a name, and spares the Demo forms.
    expect(NAME_SHAPE.test("Demo: call Maria Lopez back")).toBe(true);
    expect(NAME_SHAPE.test("Demo task: call Demo Supplier A back")).toBe(false);
    expect(NAME_SHAPE.test("Nudge Demo Contractor A")).toBe(false);
  });

  it("carries no phone number or email address", () => {
    const wire = JSON.stringify(TRPC_FIXTURES);
    expect(wire).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(wire).not.toMatch(/\b\d{3}[-.\s)]\s?\d{3}[-.\s]\d{4}\b/);
  });

  it("NOW_ISO is derived from FIXED_TIME, not a second literal", () => {
    expect(NOW_ISO).toBe(new Date(FIXED_TIME).toISOString());
    expect(NOW_ISO).toBe("2026-10-15T18:00:00.000Z");
    expect(NOW_MS).toBe(Date.parse(FIXED_TIME));
    expect(read(path.join(E2E_DIR, "fixtures", "time.ts"))).toContain("export const NOW_ISO = new Date(FIXED_TIME).toISOString();");
  });

  /** Age arithmetic the builders use: waiting-summary.ts:167 (round, minutes) and deck.ts daysBetween (floor, days). */
  const ageMinOf = (sinceIso: string) => Math.max(0, Math.round((NOW_MS - Date.parse(sinceIso)) / 60_000));
  const ageDaysOf = (iso: string) => Math.max(0, Math.floor((NOW_MS - Date.parse(iso)) / 86_400_000));

  function ageProblems(fixtures: Record<string, unknown>): string[] {
    const problems: string[] = [];
    const brief = fixtures["operator.brief"] as { generatedAt: string };
    const waiting = fixtures["operator.waitingSummary"] as { measuredAt: string; others: { items: { key: string; since: string | null; ageMin: number | null }[] }; system: { items: { key: string; since: string | null; ageMin: number | null }[] } };
    const deck = fixtures["task.deck"] as { generatedAt: string; waiting: { id: string; ageDays: number }[] };
    const pulse = fixtures["operator.personalPulse"] as { generatedAt: string };
    const ticker = fixtures["operator.ticker"] as { generatedAt: string };
    for (const [name, stamp] of [["brief.generatedAt", brief.generatedAt], ["waiting.measuredAt", waiting.measuredAt], ["deck.generatedAt", deck.generatedAt], ["pulse.generatedAt", pulse.generatedAt], ["ticker.generatedAt", ticker.generatedAt]]) {
      if (stamp !== NOW_ISO) problems.push(`${name} is ${stamp}, not NOW_ISO`);
    }
    for (const i of [...waiting.others.items, ...waiting.system.items]) {
      const want = i.since ? ageMinOf(i.since) : null;
      if (i.ageMin !== want) problems.push(`${i.key}: ageMin ${i.ageMin}, since ${i.since} says ${want}`);
    }
    for (const w of deck.waiting) {
      const t = MISSION_TASKS.find((x) => x.id === w.id);
      if (!t) {
        problems.push(`${w.id}: deck.waiting row has no task in MISSION_TASKS`);
        continue;
      }
      if (w.ageDays !== ageDaysOf(t.updatedAt)) problems.push(`${w.id}: ageDays ${w.ageDays}, updatedAt ${t.updatedAt} says ${ageDaysOf(t.updatedAt)}`);
    }
    return problems;
  }

  it("every age in the fixtures is what the builders would compute from NOW_ISO", () => {
    expect(ageProblems(TRPC_FIXTURES)).toEqual([]);
  });

  it("positive control: the age check catches the drifted values the first draft shipped", () => {
    const drifted = structuredClone(TRPC_FIXTURES) as Record<string, unknown>;
    const w = drifted["operator.waitingSummary"] as { others: { items: { ageMin: number | null }[] } };
    w.others.items[0].ageMin = 2640;
    const d = drifted["task.deck"] as { waiting: { ageDays: number }[]; generatedAt: string };
    d.waiting[0].ageDays = 3;
    d.generatedAt = "2026-10-15T17:00:00.000Z";
    expect(ageProblems(drifted)).toHaveLength(3);
  });

  it("the fixture world is a healthy one: no field in it already reports a failed read", () => {
    const brief = TRPC_FIXTURES["operator.brief"] as { judgment: { failedSources: string[] }; horizon: { measured: boolean }; state: { queues: { measured: boolean }; health: { state: string } } };
    const waiting = TRPC_FIXTURES["operator.waitingSummary"] as { failedSources: string[]; others: { count: number | null }; system: { count: number | null } };
    const deck = TRPC_FIXTURES["task.deck"] as { unmeasured: string[]; readiness: { state: string } };
    expect(brief.judgment.failedSources).toEqual([]);
    expect(brief.horizon.measured && brief.state.queues.measured).toBe(true);
    expect(brief.state.health.state).toBe("healthy");
    expect(waiting.failedSources).toEqual([]);
    expect(waiting.others.count).not.toBeNull();
    expect(waiting.system.count).not.toBeNull();
    expect(deck.unmeasured).toEqual([]);
    expect(deck.readiness.state).not.toBe("unknown");
  });
});

describe("the smoke spec cannot pass on an empty-state page", () => {
  /** App source the DEMO strings must never appear in: a hit would let an empty page satisfy the smoke. */
  function appSource(): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    for (const dir of ["app", "components", "lib", "hooks", "features"]) {
      const root = path.join(APP_DIR, dir);
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(tsx?|json|md)$/.test(entry.name)) continue;
        const file = path.join(entry.parentPath, entry.name);
        out.push({ file, text: fs.readFileSync(file, "utf8") });
      }
    }
    return out;
  }

  it("each DEMO string exists nowhere in the app source", () => {
    const sources = appSource();
    expect(sources.length, "the scan saw no app source: it proves nothing").toBeGreaterThan(300);
    for (const [name, needle] of Object.entries(DEMO)) {
      const hits = sources.filter((s) => s.text.includes(needle)).map((s) => path.relative(APP_DIR, s.file));
      expect(hits, `DEMO.${name} also appears in app source`).toEqual([]);
    }
  });

  it("positive control: the scan finds a string that IS in the app source", () => {
    const sources = appSource();
    expect(sources.some((s) => s.text.includes("Done for today."))).toBe(true);
  });

  it("positive control: the scan reaches features/, where the chat copy lives", () => {
    expect(appSource().some((s) => /features[\\/]chat-v2/.test(s.file) && s.text.includes("What are we solving?"))).toBe(true);
  });

  /** Literal `getByText(/.../)` regexes in a spec that no app source under components/ or lib/ satisfies. */
  function unsourcedTextRegexes(spec: string, sources: string[]): string[] {
    const joined = sources.join("\n").replace(/&apos;/g, "'");
    const out: string[] = [];
    for (const m of spec.matchAll(/getByText\(\/((?:\\\/|[^/])+)\/([a-z]*)\)/g)) {
      if (!new RegExp(m[1], m[2].replace("g", "")).test(joined)) out.push(`/${m[1]}/${m[2]}`);
    }
    return out;
  }

  it("every literal copy regex the fixtures-render spec waits for is rendered by live source (review round 1: a deleted component's copy stayed pinned)", () => {
    const sources = appSource().filter((s) => /[\\/](components|lib)[\\/]/.test(s.file)).map((s) => s.text);
    expect(sources.length).toBeGreaterThan(100);
    expect(unsourcedTextRegexes(read(SMOKE_SPEC), sources)).toEqual([]);
    // positive control: the old pin is reported against today's source, a live one is not
    const planted = 'await expect(page.getByText(/deferred actions await your verdict/i).first()).toBeVisible();\nawait expect(page.getByText(/Done for today\\./).first()).toBeVisible();';
    expect(unsourcedTextRegexes(planted, sources)).toEqual(["/deferred actions await your verdict/i"]);
  });

  it("the DEMO strings are the fixtures' own, and the smoke spec reads every one of them", () => {
    const smoke = read(SMOKE_SPEC);
    for (const key of Object.keys(DEMO)) expect(smoke, `smoke spec never reads DEMO.${key}`).toContain(`DEMO.${key}`);
    const deck = TRPC_FIXTURES["task.deck"] as { nextMove: { task: { title: string } } };
    expect(deck.nextMove.task.title).toBe(DEMO.missionsNextMove);
  });

  it("the smoke's error guards still match strings the app really renders", () => {
    const smoke = read(SMOKE_SPEC);
    const sources = [
      "components/home/home-console.tsx",
      "components/home/brief-rows.tsx",
      "components/home/waiting-line.tsx",
      "components/ultron/bottom-pulse-ticker.tsx",
      "app/(mastery)/missions/page.tsx",
      // Chat (W3a): the header pill's words and the list's empty and loading states.
      "features/chat-v2/lib/capability-label.ts",
      "features/chat-v2/components/chat-message-list.tsx",
    ].map((f) => read(path.join(APP_DIR, f)).replace(/&apos;/g, "'"));
    for (const [name, re] of Object.entries(PAGE_ERRORS)) {
      for (const alt of re.source.split("|")) {
        const one = new RegExp(alt, "i");
        // An absent-text assertion that can never match is a silent instrument.
        expect(
          sources.some((s) => one.test(s)),
          `PAGE_ERRORS.${name} alternative /${alt}/ matches no error string in the app: retarget it`,
        ).toBe(true);
      }
    }
    expect(smoke).toContain('import { DEMO, PAGE_ERRORS, disallowedUnstubbed, installFixtures, type FixtureReport } from "./fixtures";');
  });

  it("the smoke's absent-error and no-page-error assertions are the exact lines this test expects", () => {
    const smoke = read(SMOKE_SPEC);
    for (const line of [
      "await expect(page.getByText(PAGE_ERRORS.home)).toHaveCount(0);",
      "await expect(page.getByText(PAGE_ERRORS.missions)).toHaveCount(0);",
      "await expect(page.getByText(PAGE_ERRORS.chat)).toHaveCount(0);",
      'expect(pageErrors, "Home threw during render").toEqual([]);',
      'expect(pageErrors, "Missions threw during render").toEqual([]);',
      'expect(pageErrors, "Chat threw during render").toEqual([]);',
      'expect(disallowedUnstubbed(report.unstubbed), "Home read page data the fixtures do not answer").toEqual([]);',
      'expect(disallowedUnstubbed(report.unstubbed), "Missions read page data the fixtures do not answer").toEqual([]);',
      'expect(disallowedUnstubbed(report.unstubbed), "Chat read page data the fixtures do not answer").toEqual([]);',
      "await openChatHistory(page, DEMO.chatTitle);",
      "await settleChat(page);",
      "if (!IGNORED_PAGE_ERRORS.test(err.message)) pageErrors.push(err.message);",
      "const report = await installFixtures(page);",
      "return { pageErrors, report };",
    ]) {
      expect(smoke, `smoke spec lost: ${line}`).toContain(line);
    }
  });

  it("every query Home and Missions render is stubbed, or listed here with the reason it is not", () => {
    const NOT_STUBBED: Record<string, string> = {
      "operator.briefChanges": "only requested once a last-visit cursor exists; a fresh browser has none",
      "operator.commandCenterState": "the page reads only the active command id and renders nothing without it",
      "systemAutomation.getPendingApprovals": "the PWA badge (app-badge.tsx); renders nothing, and the Badge API is absent in CI chromium",
      "systemAutomation.approvals": "the PWA badge (app-badge.tsx); same",
    };
    // The two page roots, every sibling they import for data, and the shell
    // components the (mastery) layout mounts that query over tRPC.
    const files = [
      "components/home/home-console.tsx",
      "components/home/brief-state-line.tsx",
      "components/home/brief-rows.tsx",
      "components/home/waiting-line.tsx",
      "components/home/change-line.tsx",
      "components/home/horizon-line.tsx",
      "components/home/nick-command-line.tsx",
      "app/(mastery)/missions/page.tsx",
      "app/(mastery)/missions/hooks/use-missions-data.ts",
      "components/ultron/bottom-pulse-ticker.tsx",
      "components/hud/app-badge.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) {
      for (const m of read(path.join(APP_DIR, f)).matchAll(/trpc\.([a-zA-Z]+)\.([a-zA-Z]+)\.use(?:Suspense)?Query\b/g)) used.add(`${m[1]}.${m[2]}`);
    }
    expect(used.size, "the query scan found nothing").toBeGreaterThanOrEqual(9);
    const uncovered = [...used].filter((p) => !(p in TRPC_FIXTURES) && !(p in NOT_STUBBED));
    expect(uncovered, "a page query is neither stubbed nor explained").toEqual([]);
    // ...and the v3 gate's allowlist agrees with this list, no wider and no narrower.
    for (const p of Object.keys(NOT_STUBBED)) expect(disallowedUnstubbed([`GET ${p}`]), p).toEqual([]);
    expect(UNSTUBBED_ALLOWLIST).toHaveLength(3);
  });
});

describe("disallowedUnstubbed (the v3 gate's unstubbed-read rule)", () => {
  it("fails an unknown operator.* or task.* read, allows the listed ones, ignores the rest", () => {
    expect(
      disallowedUnstubbed([
        "GET operator.brief", // stubbed reads never appear in a report, but a stale allowlist must not hide one either
        "GET operator.briefChanges",
        "GET operator.commandCenterState",
        "GET systemAutomation.getPendingApprovals",
        "GET task.somethingNew",
        "GET operator.somethingNew",
        "POST operator.recordHomeSignal",
        "GET system.sessionExpiry",
        "GET /api/coach/events",
      ]),
    ).toEqual(["GET operator.brief", "GET operator.somethingNew", "GET task.somethingNew"]);
  });
});

// ── chat-states.spec.ts waits only for copy the live source renders (W3a) ────

describe("chat-states.spec.ts: every literal it waits for exists in live source", () => {
  const CHAT_STATES_SPEC = path.join(E2E_DIR, "chat-states.spec.ts");

  /** The string literals a spec waits on: getByText("..."), openPanel(page, "button", "proof"), a heading's name. */
  function waitedLiterals(spec: string): string[] {
    const q = String.raw`"((?:[^"\\]|\\.)*)"`;
    const out: string[] = [];
    for (const m of spec.matchAll(new RegExp(String.raw`getByText\(\s*${q}\s*,?\s*\)`, "g"))) out.push(m[1]);
    for (const m of spec.matchAll(new RegExp(String.raw`openPanel\(page,\s*${q},\s*${q}\s*\)`, "g"))) out.push(m[1], m[2]);
    for (const m of spec.matchAll(new RegExp(String.raw`getByRole\("heading",\s*\{\s*name:\s*${q}`, "g"))) out.push(m[1]);
    return out;
  }

  /** Literals no rendered source contains. JSX entities are decoded the way the DOM shows them. */
  function unsourced(literals: string[], sources: string[]): string[] {
    const joined = sources.join("\n").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    return literals.filter((l) => !joined.includes(l));
  }

  const sources = ["app/(mastery)/system/chat-states/page.tsx", "components/chat/memory-inspector-sidebar.tsx"].map((f) => read(path.join(APP_DIR, f)));

  it("the spec's own waits are all found in the page and the evidence panel it renders", () => {
    const literals = waitedLiterals(read(CHAT_STATES_SPEC));
    expect(literals.length, "the extractor saw too few waits: it proves nothing").toBeGreaterThanOrEqual(6);
    expect(unsourced(literals, sources)).toEqual([]);
  });

  it("positive control: the em-dash forms W1a reworded are reported, the colon forms are not", () => {
    const stale = [
      'await expect(page.getByText("Completion message — receipts sample")).toBeVisible();',
      'await openPanel(page, "Open — fresh recall", "Context & Evidence");',
      'await expect(\n        page.getByText("not yet fetched — open state, not evidence"),\n      ).toBeVisible();',
    ].join("\n");
    expect(unsourced(waitedLiterals(stale), sources)).toEqual(["Completion message — receipts sample", "not yet fetched — open state, not evidence", "Open — fresh recall"]);
    const live = stale.replaceAll(" — ", ": ");
    expect(unsourced(waitedLiterals(live), sources)).toEqual([]);
  });
});

// ── Chat fixtures (UI v3 W3a): the instrument for the Chat six-feet gate ─────

describe("chat fixtures (W3a)", () => {
  type Part = { type: string; text?: string; state?: string; output?: unknown };
  type Conversation = { id: string; title: string | null; messageCount: number; messages: { id: string; role: string; content: string; parts: Part[] }[] };
  type List = { conversations: { id: string; title: string | null; _count: { messages: number } }[]; hasMore: boolean; nextCursor: string | null };
  const chatDemo = DEMO as Record<string, string | undefined>;
  const conversation = TRPC_FIXTURES["chat.conversation"] as Conversation | undefined;
  const list = TRPC_FIXTURES["chat.list"] as List | undefined;
  const assistantTurn = conversation?.messages.find((m) => m.role === "assistant");

  it("the chat anchors exist and are the fixtures' own sentences", () => {
    expect(typeof chatDemo.chatReply).toBe("string");
    expect(typeof chatDemo.chatTitle).toBe("string");
    expect(chatDemo.chatReply!.length).toBeGreaterThan(20);
    expect(chatDemo.chatReply).toMatch(/\bDemo\b/);
    expect(chatDemo.chatTitle).toMatch(/\bDemo\b/);
  });

  it("the assistant turn carries DEMO.chatReply as its text part, and the title is the list row's", () => {
    expect(assistantTurn, "chat.conversation has no assistant turn").toBeDefined();
    expect(assistantTurn!.parts.some((p) => p.type === "text" && p.text === chatDemo.chatReply)).toBe(true);
    expect(list?.conversations).toHaveLength(1);
    expect(list!.conversations[0].title).toBe(chatDemo.chatTitle);
    expect(conversation!.title).toBe(chatDemo.chatTitle);
  });

  it("the list and the conversation agree: one id, one message count, no next page", () => {
    expect(list!.conversations[0].id).toBe(conversation!.id);
    expect(list!.conversations[0]._count.messages).toBe(conversation!.messages.length);
    expect(conversation!.messageCount).toBe(conversation!.messages.length);
    expect(list!.hasMore).toBe(false);
    expect(list!.nextCursor).toBeNull();
  });

  it("renders a user turn then an assistant turn, and the assistant turn has a receipt line", () => {
    expect(conversation!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const toolParts = assistantTurn!.parts.filter((p) => p.type.startsWith("tool-"));
    expect(toolParts.length).toBeGreaterThan(0);
    // ToolReceiptSummary returns null without tool parts (chat-message-list.tsx): this is the line it prints.
    expect(formatToolReceipts(summarizeToolReceipts(toolParts))).toBe("Tool calls: 1 returned data");
  });

  it("the header pill reads MEASURED: 'ready', neither checking nor unknown", () => {
    const providers = TRPC_FIXTURES["system.providerHealth"] as { overallTone: "green" | "amber" | "red" } | undefined;
    const tools = TRPC_FIXTURES["system.toolsHealth"] as { summary: { totalTools: number; degraded: number; down: number } } | undefined;
    expect(providers, "system.providerHealth is not stubbed").toBeDefined();
    expect(tools, "system.toolsHealth is not stubbed").toBeDefined();
    const badge = capabilityBadge({ connection: "unknown", providerTone: providers!.overallTone, providerErrored: false, toolSummary: tools!.summary, toolsErrored: false });
    expect(badge).toEqual({ label: "ready", cautious: false, unknown: false, checking: false });
    // positive control: with the tools read missing the same call says it is still checking
    expect(capabilityBadge({ connection: "unknown", providerTone: "green", providerErrored: false }).label).toBe("checking capabilities");
  });

  it("every read /chat makes on load is stubbed, or listed here with the reason it is not", () => {
    const NOT_STUBBED: Record<string, string> = {
      "system.diagnoseChat": "only the /diagnose command fetches it (chat-composer.tsx)",
      "chat.resolveMention": "fetched imperatively right before a send that names @yesterday, @week or @cold (use-mention-suggestions.ts)",
      "brain.mediaMoments": "media-saved-moments.tsx renders only inside the focus panel, which renders null unless the operator opts in",
      "systemAutomation.getPendingApprovals": "the PWA badge (app-badge.tsx); renders nothing, and the Badge API is absent in CI chromium",
      "systemAutomation.approvals": "the PWA badge (app-badge.tsx); same",
    };
    const files = [
      "features/chat-v2/components/chat-capability-indicator.tsx",
      "features/chat-v2/components/chat-composer.tsx",
      "features/chat-v2/components/chat-island.tsx",
      "features/chat-v2/components/chat-message-list.tsx",
      "features/chat-v2/components/media-saved-moments.tsx",
      "hooks/use-conversations.ts",
      // Read through the composer's hooks, not in a chat component: the first draft of this list missed it and
      // the render found it (GET operator.mit, the @mit mention). Hooks the chat components import belong here.
      "hooks/use-mention-suggestions.ts",
      "components/ultron/bottom-pulse-ticker.tsx",
      "components/hud/app-badge.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) {
      const src = read(path.join(APP_DIR, f));
      for (const m of src.matchAll(/trpc\.([a-zA-Z]+)\.([a-zA-Z]+)\.use(?:Suspense)?Query\b/g)) used.add(`${m[1]}.${m[2]}`);
      for (const m of src.matchAll(/utils\.([a-zA-Z]+)\.([a-zA-Z]+)\.fetch\(/g)) used.add(`${m[1]}.${m[2]}`);
    }
    // positive control: the scan sees the four reads this wave stubs
    for (const p of ["chat.list", "chat.conversation", "system.providerHealth", "system.toolsHealth"]) expect(used.has(p), `the scan never saw ${p}`).toBe(true);
    const uncovered = [...used].filter((p) => !(p in TRPC_FIXTURES) && !(p in NOT_STUBBED));
    expect(uncovered, "a /chat read is neither stubbed nor explained").toEqual([]);
    for (const p of ["chat.list", "chat.conversation", "system.providerHealth", "system.toolsHealth", "operator.mit"]) expect(p in TRPC_FIXTURES, `${p} is not stubbed`).toBe(true);
    expect(used.has("operator.mit"), "the scan never saw operator.mit (the composer's @mit hook)").toBe(true);
  });

  it("the unstubbed gate now covers the chat reads, and still ignores the rest of the shell", () => {
    expect(disallowedUnstubbed(["GET chat.list", "GET chat.conversation", "GET system.providerHealth", "GET system.toolsHealth", "GET system.sessionExpiry", "POST chat.deleteMessage"])).toEqual([
      "GET chat.conversation",
      "GET chat.list",
      "GET system.providerHealth",
      "GET system.toolsHealth",
    ]);
  });
});

// ── Pending baselines (W3a): a missing PNG skips only a page declared pending ─

describe("pending baselines: a missing PNG skips, a present one is always judged", () => {
  const SNAPSHOTS = path.join(E2E_DIR, "visible-transformation-v3.spec.ts-snapshots");
  const VP = { width: 390, height: 844 };
  /** The spec's own baseline read (SPEC_LINES.baseline), applied to a planted directory. */
  const readBaseline = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
  const planted = <T>(run: (dir: string) => Promise<T> | T): Promise<T> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3a-baseline-"));
    return Promise.resolve(run(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  };

  it("a planted MISSING png on a pending page skips, with a reason that names the page and the way out", () =>
    planted((dir) => {
      const baseline = readBaseline(path.join(dir, "chat-phone.png"));
      expect(baseline).toBeNull();
      const reason = baselineSkipReason({ label: "chat/phone", baselineExists: baseline !== null, pending: true });
      expect(reason).toMatch(/^chat\/phone: baseline not captured yet/);
      expect(reason).toMatch(/capture_v3_baselines/);
      expect(reason!.split("\n")).toHaveLength(1);
    }));

  it("the same missing png on a page that is NOT pending does not skip, and the verdict fails it", () =>
    planted(async (dir) => {
      const baseline = readBaseline(path.join(dir, "home-phone.png"));
      expect(baselineSkipReason({ label: "home/phone", baselineExists: baseline !== null, pending: false })).toBeNull();
      const png = fs.readFileSync(path.join(SNAPSHOTS, "home-phone.png"));
      const r = await measureAndJudge({ baseline, current: png, viewport: VP });
      expect(r.verdict.ok).toBe(false);
      expect(r.verdict.reason).toMatch(/missing baseline/i);
    }));

  it("a planted png that MATCHES the render never skips, pending or not, and fails as looking like v2", () =>
    planted(async (dir) => {
      const file = path.join(dir, "chat-phone.png");
      fs.copyFileSync(path.join(SNAPSHOTS, "home-phone.png"), file);
      const baseline = readBaseline(file);
      expect(baselineSkipReason({ label: "chat/phone", baselineExists: baseline !== null, pending: true })).toBeNull();
      const r = await measureAndJudge({ baseline, current: fs.readFileSync(file), viewport: VP });
      expect(r.distance).toBe(0);
      expect(r.verdict.ok).toBe(false);
      expect(r.verdict.reason).toMatch(/still looks like/i);
    }));

  it("positive control: a planted png the render has moved away from passes the same path", () =>
    planted(async (dir) => {
      const file = path.join(dir, "chat-phone.png");
      fs.copyFileSync(path.join(SNAPSHOTS, "home-phone.png"), file);
      // A render that kept some ink but none of the baseline's layout (the same wipe the instrument controls use, inked).
      const current = await loadSharp()({ create: { ...VP, channels: 3, background: "#808080" } }).png().toBuffer();
      const r = await measureAndJudge({ baseline: readBaseline(file), current, viewport: VP });
      expect(r.verdict, `distance ${r.distance}, ink ${r.ink}`).toMatchObject({ ok: true });
    }));

  it("a skip needs BOTH facts: nothing to compare to, and the page declared pending", () => {
    expect(baselineSkipReason({ label: "x", baselineExists: true, pending: true })).toBeNull();
    expect(baselineSkipReason({ label: "x", baselineExists: true, pending: false })).toBeNull();
    expect(baselineSkipReason({ label: "x", baselineExists: false, pending: false })).toBeNull();
    expect(baselineSkipReason({ label: "x", baselineExists: false, pending: true })).not.toBeNull();
  });

  it("no page is pending today (chat's baselines were captured from main 7dc82474c, run 38908095706); a pending page must not have its PNGs", () => {
    expect(V3_PAGES.filter((p) => p.baselinePending).map((p) => p.key)).toEqual([]);
    for (const p of V3_PAGES.filter((x) => x.baselinePending)) {
      for (const v of V3_VIEWPORTS) {
        const png = `${p.key}-${v.key}.png`;
        expect(fs.existsSync(path.join(SNAPSHOTS, png)), `${png} exists: remove baselinePending for ${p.key} in the same commit`).toBe(false);
      }
    }
  });

  it("every page that is NOT pending has both of its baselines committed (deleting one must not turn into a quiet skip)", () => {
    for (const p of V3_PAGES.filter((x) => !x.baselinePending)) {
      for (const v of V3_VIEWPORTS) {
        const png = `${p.key}-${v.key}.png`;
        expect(fs.existsSync(path.join(SNAPSHOTS, png)), `${png} is missing`).toBe(true);
      }
    }
  });
});

// ── The v3 spec really asks the verdict function ────────────────────────────

/** The exact lines the spec must contain: measurement and decision happen only inside measureAndJudge. */
const SPEC_LINES = {
  import: 'import { baselineSkipReason, captureVerdict, measureAndJudge } from "./v3-gate";',
  baseline: "const baseline = fs.existsSync(file) ? fs.readFileSync(file) : null;",
  skipReason: "const skipReason = baselineSkipReason({ label: `${p.key}/${vp.key}`, baselineExists: baseline !== null, pending: p.baselinePending === true });",
  skipCall: 'test.skip(skipReason !== null, skipReason ?? "");',
  measure: "const result = await measureAndJudge({ baseline, current, viewport: vp });",
  assert: "expect(result.verdict.ok, `${p.key}/${vp.key}: ${result.verdict.reason}`).toBe(true);",
  anchorMap: "const ANCHOR: Record<string, RenderAnchor> = {",
  homeAnchor: "home: { anchorText: DEMO.homeSummary, errorPattern: PAGE_ERRORS.home },",
  missionsAnchor: "missions: { anchorText: DEMO.missionsNextMove, errorPattern: PAGE_ERRORS.missions },",
  chatAnchor: "chat: { anchorText: DEMO.chatReply, errorPattern: PAGE_ERRORS.chat, open: (page) => openChatHistory(page, DEMO.chatTitle), settle: settleChat },",
  render: "const current = await renderPage(page, p.path, p.landmark, ANCHOR[p.key]);",
  unstubbed: "expect(disallowedUnstubbed(unstubbed), `${p.key}/${vp.key} read page data the fixtures do not answer`).toEqual([]);",
  capture: "const capture = captureVerdict({ ink: await inkCoverage(current, vp) });",
  captureAssert: "expect(capture.ok, `${p.key}/${vp.key}: ${capture.reason}`).toBe(true);",
  optIn: 'const ENABLED = process.env.VT_V3 === "1";',
  skip: "test.skip(!ENABLED, ",
} as const;

/** What must be true of the spec's source for the unit tests above to guard its decision. */
function specProblems(src: string): string[] {
  const problems: string[] = [];
  for (const [name, line] of Object.entries(SPEC_LINES)) {
    const n = src.split(line).length - 1;
    if (n !== 1) problems.push(`${name}: expected exactly one occurrence of the pinned line, found ${n}`);
  }
  // No measurement outside measureAndJudge: inkCoverage appears only in the
  // capture line above, visualDistance not at all, and nothing else reads
  // `.ink`/`.distance` to decide.
  if (src.split("inkCoverage(").length - 1 !== 1) problems.push("inkCoverage is called outside the capture branch");
  if (src.includes("visualDistance(")) problems.push("the spec measures distance itself");
  if (src.includes("v3GateVerdict(")) problems.push("the spec calls the verdict directly, bypassing measureAndJudge");
  // Exactly one baseline write, inside the capture branch, before the compare path.
  const writes = [...src.matchAll(/fs\.writeFileSync\(file,/g)].map((m) => m.index!);
  const captureAt = src.indexOf("if (CAPTURE) {");
  const compareAt = src.indexOf(SPEC_LINES.baseline);
  if (writes.length !== 1 || captureAt < 0 || !(captureAt < writes[0] && writes[0] < compareAt)) problems.push("writes a baseline outside the capture branch");
  // The render (which waits for the anchor inside renderPage) precedes the unstubbed gate, capture and judgment.
  const renderAt = src.indexOf(SPEC_LINES.render);
  const unstubbedAt = src.indexOf(SPEC_LINES.unstubbed);
  if (!(renderAt > 0 && renderAt < unstubbedAt && unstubbedAt < captureAt)) problems.push("the render, the unstubbed gate, capture and judgment are out of order");
  // The pending skip sits between the baseline read and the judgment: it needs the read, and it must come
  // before measureAndJudge or a pending page would fail on its missing PNG.
  const skipReasonAt = src.indexOf(SPEC_LINES.skipReason);
  const skipCallAt = src.indexOf(SPEC_LINES.skipCall);
  const measureAt = src.indexOf(SPEC_LINES.measure);
  if (!(compareAt < skipReasonAt && skipReasonAt < skipCallAt && skipCallAt < measureAt)) problems.push("the pending skip is not between the baseline read and the judgment");
  return problems;
}

/** The exact lines vt-render.ts must contain, in this order: the anchor wait happens before the settle wait and the screenshot. */
const RENDER_LINES = {
  baseUrl: 'export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";',
  goto: 'const res = await page.goto(route, { waitUntil: "domcontentloaded" });',
  anchor: "await expect(page.getByText(anchor.anchorText).first(), `${route}: fixture anchor text never appeared`).toBeVisible({ timeout: 60_000 });",
  noErrors: "await expect(page.getByText(anchor.errorPattern), `${route}: rendered one of its error states`).toHaveCount(0);",
  settle: "const settled = await page",
  screenshot: 'return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });',
  warmContext: "const ctx = await browser.newContext({ viewport, baseURL: E2E_BASE_URL, ...VT_CONTEXT });",
  warmGoto: 'const res = await page.goto(p, { waitUntil: "domcontentloaded", timeout: 180_000 });',
  warmStatus: "expect(res?.status(), `warm-up: ${p} must respond 200`).toBe(200);",
} as const;

function renderProblems(src: string): string[] {
  const problems: string[] = [];
  const at: Record<string, number> = {};
  for (const [name, line] of Object.entries(RENDER_LINES)) {
    const n = src.split(line).length - 1;
    if (n !== 1) problems.push(`${name}: expected exactly one occurrence, found ${n}`);
    at[name] = src.indexOf(line);
  }
  if (problems.length) return problems;
  if (!(at.goto < at.anchor && at.anchor < at.noErrors && at.noErrors < at.settle && at.settle < at.screenshot)) {
    problems.push("the anchor and error-state waits do not sit between the goto and the settle wait / screenshot");
  }
  // The warm goto must not swallow its failure.
  const afterWarmGoto = src.slice(at.warmGoto, at.warmGoto + RENDER_LINES.warmGoto.length + 40);
  if (/\.catch\(/.test(afterWarmGoto)) problems.push("the warm-up goto swallows its failure");
  if (!(at.warmGoto < at.warmStatus)) problems.push("the warm-up does not assert 200 after each goto");
  return problems;
}

describe("vt-render.ts renders the fixture page before it settles, and really warms", () => {
  const src = read(path.join(E2E_DIR, "vt-render.ts"));

  it("the real helper has no problems", () => {
    expect(renderProblems(src)).toEqual([]);
  });

  it("MUTANTS: each of these edits is noticed", () => {
    const mutants: Record<string, string> = {
      "anchor wait moved after the screenshot": src.replace(RENDER_LINES.anchor, "").replace(RENDER_LINES.screenshot, `${RENDER_LINES.anchor}\n  ${RENDER_LINES.screenshot}`),
      "anchor wait moved after the settle wait": src.replace(RENDER_LINES.anchor, "").replace("  await page.waitForTimeout(1500);", `  ${RENDER_LINES.anchor}\n  await page.waitForTimeout(1500);`),
      "anchor wait removed": src.replace(RENDER_LINES.anchor, ""),
      "error-state wait removed": src.replace(RENDER_LINES.noErrors, ""),
      "baseURL dropped from the warm context": src.replace(RENDER_LINES.warmContext, "const ctx = await browser.newContext({ viewport, ...VT_CONTEXT });"),
      "warm goto swallowed again": src.replace(RENDER_LINES.warmGoto, 'const res = await page.goto(p, { waitUntil: "domcontentloaded", timeout: 180_000 }).catch(() => null);'),
      "warm 200 assertion removed": src.replace(RENDER_LINES.warmStatus, "void res;"),
      "base URL hardcoded (env ignored)": src.replace(RENDER_LINES.baseUrl, 'export const E2E_BASE_URL = "http://localhost:3001";'),
    };
    for (const [name, mutated] of Object.entries(mutants)) {
      expect(mutated, `${name}: the mutation did not apply`).not.toBe(src);
      expect(renderProblems(mutated), name).not.toEqual([]);
    }
  });
});

describe("visible-transformation-v3.spec.ts consumes measureAndJudge", () => {
  const spec = read(V3_SPEC);

  it("the real spec has no problems", () => {
    expect(specProblems(spec)).toEqual([]);
  });

  it("MUTANTS: each of these edits to the spec is noticed", () => {
    const mutants: Record<string, string> = {
      // The four from review round 1 (two of them in their post-refactor form: the spec no longer holds an ink or a distance line).
      "toBe(true) -> toBeDefined()": spec.replace("${result.verdict.reason}`).toBe(true);", "${result.verdict.reason}`).toBeDefined();"),
      "toBe(true) -> toBe(false)": spec.replace("${result.verdict.reason}`).toBe(true);", "${result.verdict.reason}`).toBe(false);"),
      "ink assumed (measurement replaced)": spec.replace(SPEC_LINES.measure, 'const result = { ink: 1, distance: 1, verdict: { ok: true, reason: "" } };'),
      "distance forged (baseline forced)": spec.replace(SPEC_LINES.baseline, "const baseline = current;"),
      // The earlier set.
      "measureAndJudge call removed": spec.replace(SPEC_LINES.measure, "const result = await measureAndJudge({ baseline, current, viewport: vp }).then(() => ({ ink: 1, distance: 1, verdict: { ok: true, reason: '' } }));"),
      "assertion removed": spec.replace(SPEC_LINES.assert, "void result.verdict.ok;"),
      "direct verdict call": spec.replace(SPEC_LINES.measure, "const result = { ink: 1, distance: 1, verdict: v3GateVerdict({ baselineExists: true, ink: 1, distance: 1 }) };"),
      "own distance measurement": spec.replace(SPEC_LINES.measure, "const result = { ink: 1, distance: (await visualDistance(current, current, vp)).ratio, verdict: { ok: true, reason: '' } };"),
      "not opt-in": spec.replace("test.skip(!ENABLED, ", "test.skip(false, "),
      "opt-in by any value": spec.replace('process.env.VT_V3 === "1"', "process.env.VT_V3"),
      "capture refusal removed": spec.replace(SPEC_LINES.capture, 'const capture = { ok: true, reason: "" };'),
      "silent baseline write on compare": spec.replace(SPEC_LINES.baseline, `fs.writeFileSync(file, current);\n        ${SPEC_LINES.baseline}`),
      "anchor dropped from the render call": spec.replace(SPEC_LINES.render, "const current = await renderPage(page, p.path, p.landmark);"),
      "home anchor points at a string the empty page shows": spec.replace(SPEC_LINES.homeAnchor, 'home: { anchorText: "Now", errorPattern: PAGE_ERRORS.home },'),
      "chat anchor points at a string the empty page shows": spec.replace(SPEC_LINES.chatAnchor, 'chat: { anchorText: "What are we solving?", errorPattern: PAGE_ERRORS.chat, open: (page) => openChatHistory(page, DEMO.chatTitle), settle: settleChat },'),
      "chat anchor loses the conversation pick": spec.replace(SPEC_LINES.chatAnchor, "chat: { anchorText: DEMO.chatReply, errorPattern: PAGE_ERRORS.chat, settle: settleChat },"),
      "every page may skip on a missing baseline": spec.replace(SPEC_LINES.skipReason, "const skipReason = baselineSkipReason({ label: `${p.key}/${vp.key}`, baselineExists: baseline !== null, pending: true });"),
      "the skip is decided without the baseline read": spec.replace(SPEC_LINES.skipReason, "const skipReason = baselineSkipReason({ label: `${p.key}/${vp.key}`, baselineExists: false, pending: p.baselinePending === true });"),
      "the skip call removed": spec.replace(SPEC_LINES.skipCall, ""),
      "the skip moved after the judgment": spec.replace(SPEC_LINES.skipCall, "").replace(SPEC_LINES.assert, `${SPEC_LINES.assert}\n        ${SPEC_LINES.skipCall}`),
      "unstubbed gate removed": spec.replace(SPEC_LINES.unstubbed, ""),
      "unstubbed gate moved after the judgment": spec.replace(SPEC_LINES.unstubbed, "").replace(SPEC_LINES.assert, `${SPEC_LINES.assert}\n        ${SPEC_LINES.unstubbed}`),
    };
    for (const [name, mutated] of Object.entries(mutants)) {
      expect(mutated, `${name}: the mutation did not apply`).not.toBe(spec);
      expect(specProblems(mutated), name).not.toEqual([]);
    }
  });
});

// ── The workflow: the capture path is real, exclusive, and cannot cancel a push run ──

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  "working-directory"?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: {
    workflow_dispatch?: { inputs?: Record<string, { type?: string; default?: unknown }> };
    pull_request?: { paths?: string[] };
    push?: { branches?: string[]; paths?: string[] };
  };
  concurrency: { group: string; "cancel-in-progress": string | boolean };
  jobs: { e2e: { steps: Step[] } };
}

const RUN_GUARD = "${{ !(github.event_name == 'workflow_dispatch' && inputs.capture_v3_baselines) }}";
const CAPTURE_GUARD = "${{ github.event_name == 'workflow_dispatch' && inputs.capture_v3_baselines }}";
const SMOKE_RUN = "pnpm exec playwright test --timeout=120000";
const CAPTURE_RUN = "pnpm exec playwright test visible-transformation-v3 --timeout=120000";
const SNAPSHOT_ARTIFACT_PATH = "apps/statenour/tests/e2e/visible-transformation-v3.spec.ts-snapshots/";

type Ctx = { event: string; ref: string; sha: string; capture?: boolean };

/** Evaluate a `${{ ... }}` template the way these workflow expressions need: && || ! == and two contexts. */
function evalTemplate(template: string, ctx: Ctx): unknown {
  const github = { event_name: ctx.event, ref: ctx.ref, sha: ctx.sha };
  const inputs = ctx.event === "workflow_dispatch" ? { capture_v3_baselines: ctx.capture ?? false } : {};
  const run = (expr: string) => new Function("github", "inputs", `return (${expr});`)(github, inputs) as unknown;
  const whole = /^\$\{\{(.*)\}\}$/s.exec(template.trim());
  if (whole) return run(whole[1]);
  return template.replace(/\$\{\{(.*?)\}\}/g, (_m, expr: string) => String(run(expr)));
}

function workflowProblems(wf: Workflow): string[] {
  const problems: string[] = [];
  const steps = wf.jobs.e2e.steps;
  const idx = (name: string) => steps.findIndex((s) => s.name?.startsWith(name));
  const smokeAt = idx("Run authenticated E2E smoke");
  const captureAt = idx("Capture v3 baselines");
  const checkAt = idx("Check v3 baselines are complete");
  const uploadAt = idx("Upload v3 baselines");
  const tracesAt = idx("Upload Playwright traces on failure");
  if ([smokeAt, captureAt, checkAt, uploadAt, tracesAt].includes(-1)) {
    return [`missing step: smoke=${smokeAt} capture=${captureAt} check=${checkAt} upload=${uploadAt} traces=${tracesAt}`];
  }
  const smoke = steps[smokeAt];
  const capture = steps[captureAt];
  const check = steps[checkAt];
  const upload = steps[uploadAt];

  // The completeness check: same guard, in the app dir, names all four files, fails on a missing one.
  if (check.if !== CAPTURE_GUARD) problems.push("completeness check is not guarded by the capture condition");
  if (check["working-directory"] !== "apps/statenour") problems.push("completeness check does not run in apps/statenour");
  const checkRun = check.run ?? "";
  // The names are V3_PAGES x V3_VIEWPORTS, derived here so a page added to the spec cannot be captured
  // without the check noticing it (W3a: chat made it six), and the check names exactly those, no more.
  const wantNames = V3_PAGES.flatMap((p) => V3_VIEWPORTS.map((v) => `${p.key}-${v.key}`));
  for (const name of wantNames) {
    if (!new RegExp(`\\b${name}\\b`).test(checkRun)) problems.push(`completeness check does not name ${name}`);
  }
  const loop = /for f in ([^;]+); do/.exec(checkRun);
  if (!loop) problems.push("completeness check has no `for f in ...; do` loop over the baseline names");
  else if ([...new Set(loop[1].trim().split(/\s+/))].sort().join(" ") !== [...wantNames].sort().join(" ")) problems.push(`completeness check names ${loop[1].trim()}, not exactly ${wantNames.join(" ")}`);
  if (!checkRun.includes("test -f")) problems.push("completeness check does not test for the files");
  if (!checkRun.includes("exit 1")) problems.push("completeness check cannot fail");
  if (!checkRun.includes("tests/e2e/visible-transformation-v3.spec.ts-snapshots")) problems.push("completeness check looks in the wrong directory");
  if (!(captureAt < checkAt && checkAt < uploadAt)) problems.push("completeness check is not between capture and upload");

  const input = wf.on.workflow_dispatch?.inputs?.capture_v3_baselines;
  if (!input || input.type !== "boolean" || input.default !== false) problems.push("workflow_dispatch input capture_v3_baselines is not a boolean defaulting to false");
  if (!wf.on.pull_request?.paths?.includes("apps/statenour/**")) problems.push("pull_request path filter lost apps/statenour/**");
  if (!wf.on.push?.paths?.includes("apps/statenour/**")) problems.push("push path filter lost apps/statenour/**");
  if (JSON.stringify(wf.on.push?.branches) !== '["main"]') problems.push("push is no longer limited to main");

  if (smoke.if !== RUN_GUARD) problems.push("smoke step guard changed");
  if (smoke.run !== SMOKE_RUN) problems.push("smoke step command changed");
  // W2 (2026-10-16): the v3 gate runs in every statenour e2e run. The spec's opt-in reads exactly
  // process.env.VT_V3 === "1" (RENDER_LINES.optIn above), so this is the line the consumer reads.
  if (smoke.env?.VT_V3 !== "1") problems.push("smoke step does not set VT_V3=1, so the v3 gate is skipped in the default run");
  if (smoke.env?.VT_V3_CAPTURE !== undefined) problems.push("smoke step sets VT_V3_CAPTURE, which would overwrite the frozen baselines on every run");
  if (capture.if !== CAPTURE_GUARD) problems.push("capture step guard is not the inverse of the smoke guard");
  if (capture.run !== CAPTURE_RUN) problems.push(`capture step command is not exactly the v3-only run: ${JSON.stringify(capture.run)}`);
  if (capture.env?.VT_V3 !== "1" || capture.env?.VT_V3_CAPTURE !== "1") problems.push("capture step does not set VT_V3=1 and VT_V3_CAPTURE=1");
  if (!(smokeAt < captureAt && captureAt < uploadAt)) problems.push("steps are out of order (smoke, capture, upload)");

  if (upload.if !== CAPTURE_GUARD) problems.push("upload step is not guarded by the capture condition");
  if (upload.uses !== steps[tracesAt].uses) problems.push("upload step is not pinned to the same upload-artifact commit as the traces step");
  if (upload.with?.name !== "v3-baselines") problems.push("artifact is not named v3-baselines");
  if (upload.with?.["retention-days"] !== 14) problems.push("artifact retention is not 14 days");
  if (upload.with?.path !== SNAPSHOT_ARTIFACT_PATH) problems.push(`artifact path is not exactly the spec's snapshot directory: ${JSON.stringify(upload.with?.path)}`);
  if (upload.with?.["if-no-files-found"] !== "error") problems.push("an empty capture would upload nothing and still pass");

  // Mutual exclusion, by evaluating both guards for the events that matter.
  const cases: Ctx[] = [
    { event: "pull_request", ref: "refs/pull/7/merge", sha: "a" },
    { event: "push", ref: "refs/heads/main", sha: "b" },
    { event: "workflow_dispatch", ref: "refs/heads/main", sha: "c", capture: true },
    { event: "workflow_dispatch", ref: "refs/heads/main", sha: "c", capture: false },
  ];
  for (const c of cases) {
    const runs = Boolean(evalTemplate(smoke.if ?? "", c));
    const captures = Boolean(evalTemplate(capture.if ?? "", c));
    const wantCapture = c.event === "workflow_dispatch" && c.capture === true;
    if (runs === captures) problems.push(`${c.event}${c.capture ? "+capture" : ""}: smoke and capture are not exclusive`);
    if (captures !== wantCapture) problems.push(`${c.event}${c.capture ? "+capture" : ""}: capture ran=${captures}, expected ${wantCapture}`);
  }

  // Concurrency: push runs are keyed on the sha; a dispatch run neither shares a push group nor cancels anything.
  const group = (c: Ctx) => String(evalTemplate(wf.concurrency.group, c));
  const cancel = (c: Ctx) => {
    const v = wf.concurrency["cancel-in-progress"];
    return typeof v === "boolean" ? v : Boolean(evalTemplate(v, c));
  };
  const [pr, push, dispatch] = cases;
  if (!group(push).includes(push.sha)) problems.push("push group is not keyed on the sha");
  if (!group(pr).includes(pr.ref)) problems.push("PR group is not keyed per ref");
  if (group(dispatch) === group(push)) problems.push("a dispatch run shares a group with a push run");
  if (cancel(dispatch) || cancel(push)) problems.push("a dispatch or push run can be cancelled");
  if (!cancel(pr)) problems.push("a superseded PR run is no longer cancelled");
  return problems;
}

describe(".github/workflows/e2e-statenour.yml capture path", () => {
  const text = read(WORKFLOW);
  const wf = load(text) as Workflow;

  it("the real workflow has no problems", () => {
    expect(workflowProblems(wf)).toEqual([]);
  });

  it("the YAML keeps its triggers as a mapping (`on` was not parsed as a boolean)", () => {
    expect(typeof wf.on).toBe("object");
  });

  it("MUTANTS: each of these edits to the workflow is noticed", () => {
    const steps = (w: Workflow) => w.jobs.e2e.steps;
    const named = (w: Workflow, name: string) => steps(w).find((s) => s.name?.startsWith(name))!;
    const mutants: Record<string, (w: Workflow) => void> = {
      "the two if: conditions swapped": (w) => {
        const a = named(w, "Run authenticated E2E smoke");
        const b = named(w, "Capture v3 baselines");
        [a.if, b.if] = [b.if, a.if];
      },
      "the dispatch trigger removed": (w) => {
        delete w.on.workflow_dispatch;
      },
      "the capture step unguarded": (w) => {
        delete named(w, "Capture v3 baselines").if;
      },
      "the capture step runs the whole suite": (w) => {
        named(w, "Capture v3 baselines").run = SMOKE_RUN;
      },
      "the completeness check misses one name": (w) => {
        named(w, "Check v3 baselines are complete").run = named(w, "Check v3 baselines are complete").run!.replace(" missions-phone", "");
      },
      "the completeness check misses the chat pair": (w) => {
        named(w, "Check v3 baselines are complete").run = named(w, "Check v3 baselines are complete").run!.replace(" chat-desktop chat-phone", "");
      },
      "the completeness check names a file the spec never captures": (w) => {
        named(w, "Check v3 baselines are complete").run = named(w, "Check v3 baselines are complete").run!.replace("chat-phone;", "chat-phone brain-phone;");
      },
      "the completeness check removed": (w) => {
        w.jobs.e2e.steps = steps(w).filter((s) => !s.name?.startsWith("Check v3 baselines are complete"));
      },
      "the completeness check unguarded": (w) => {
        delete named(w, "Check v3 baselines are complete").if;
      },
      "the completeness check after the upload": (w) => {
        const all = steps(w);
        const i = all.findIndex((s) => s.name?.startsWith("Check v3 baselines are complete"));
        const [step] = all.splice(i, 1);
        const u = all.findIndex((s) => s.name?.startsWith("Upload v3 baselines"));
        all.splice(u + 1, 0, step);
      },
      "the capture step cannot fail (|| true)": (w) => {
        named(w, "Capture v3 baselines").run = `${CAPTURE_RUN} || true`;
      },
      "the artifact path drops /e2e": (w) => {
        named(w, "Upload v3 baselines").with!.path = SNAPSHOT_ARTIFACT_PATH.replace("/e2e", "");
      },
      "the upload step removed": (w) => {
        w.jobs.e2e.steps = steps(w).filter((s) => !s.name?.startsWith("Upload v3 baselines"));
      },
      "the upload step pinned to a tag": (w) => {
        named(w, "Upload v3 baselines").uses = "actions/upload-artifact@v4";
      },
      "retention changed": (w) => {
        named(w, "Upload v3 baselines").with!["retention-days"] = 90;
      },
      "an empty capture tolerated": (w) => {
        delete named(w, "Upload v3 baselines").with!["if-no-files-found"];
      },
      "the capture env dropped": (w) => {
        delete named(w, "Capture v3 baselines").env!.VT_V3_CAPTURE;
      },
      "push group no longer keyed on the sha": (w) => {
        w.concurrency.group = "e2e-statenour-${{ github.ref }}";
      },
      "every run cancels the last": (w) => {
        w.concurrency["cancel-in-progress"] = true;
      },
      "the smoke step loses its guard": (w) => {
        delete named(w, "Run authenticated E2E smoke").if;
      },
      "the smoke step no longer switches the v3 gate on": (w) => {
        delete named(w, "Run authenticated E2E smoke").env!.VT_V3;
      },
      "the smoke step switches the gate on by any value": (w) => {
        named(w, "Run authenticated E2E smoke").env!.VT_V3 = "true";
      },
      "the smoke step captures instead of comparing": (w) => {
        named(w, "Run authenticated E2E smoke").env!.VT_V3_CAPTURE = "1";
      },
    };
    for (const [name, mutate] of Object.entries(mutants)) {
      const copy = structuredClone(wf);
      mutate(copy);
      expect(workflowProblems(copy), name).not.toEqual([]);
    }
  });
});

// ── tsconfig.e2e.json: the fixtures really are typechecked against the contracts ──

const TSC = path.join(APP_DIR, "node_modules", "typescript", "bin", "tsc");

/**
 * Spawn tsc on a config; resolve with exit code and combined output (never
 * rejects). Async on purpose: a synchronous spawn blocks the vitest worker's
 * event loop for the whole compile and its RPC heartbeat times out
 * ("Timeout calling onTaskUpdate"), which vitest counts as an unhandled error.
 */
function runTsc(configPath: string, extraArgs: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TSC, "-p", configPath, ...extraArgs],
      { cwd: APP_DIR, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string | null }) | null;
        const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
        resolve({ code, out: `${stdout}${stderr}${err && typeof err.code !== "number" ? err.message : ""}` });
      },
    );
  });
}

describe("tsconfig.e2e.json typechecks the fixture lane", () => {
  const E2E_TSCONFIG = path.join(APP_DIR, "tsconfig.e2e.json");

  it("exists, extends the app config, and includes tests/e2e", () => {
    const cfg = read(E2E_TSCONFIG);
    expect(cfg).toContain('"extends": "./tsconfig.json"');
    expect(cfg).toContain('"tests/e2e/**/*.ts"');
    expect(cfg).toContain('"tests/repo/v3-gate.test.ts"');
  });

  it(
    "tsc -p tsconfig.e2e.json exits 0 and its program contains the fixtures",
    async () => {
      const r = await runTsc(E2E_TSCONFIG, ["--listFiles"]);
      expect(r.code, r.out.slice(0, 4000)).toBe(0);
      const listed = r.out.split(/\r?\n/).map((l) => l.replace(/\\/g, "/"));
      for (const f of [
        "tests/e2e/fixtures/home.ts",
        "tests/e2e/fixtures/missions.ts",
        "tests/e2e/fixtures/chat.ts",
        "tests/e2e/fixtures/index.ts",
        "tests/e2e/v3-gate.ts",
        "tests/e2e/visible-transformation-v3.spec.ts",
        "tests/e2e/fixtures-render.spec.ts",
      ]) {
        expect(listed.some((l) => l.endsWith(`apps/statenour/${f}`)), `${f} is not in the tsc program`).toBe(true);
      }
    },
    150_000,
  );

  it(
    "positive control: a fixture with a bogus field fails the same typecheck",
    async () => {
      // A scratch program outside the tree: the app's tsconfig by absolute path,
      // its @types, and one file that spreads HOME_BRIEF into OperatorBrief with
      // an extra property. The expected failure is TS2353 on that property.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w0b-tsc-"));
      try {
        const abs = (p: string) => path.join(APP_DIR, p).replace(/\\/g, "/");
        fs.writeFileSync(
          path.join(dir, "bogus.ts"),
          [
            'import type { OperatorBrief } from "@/lib/home/operator-brief";',
            `import { HOME_BRIEF } from "${abs("tests/e2e/fixtures/home")}";`,
            "export const bogus: OperatorBrief = { ...HOME_BRIEF, bogusField: 1 };",
            "",
          ].join("\n"),
        );
        fs.writeFileSync(
          path.join(dir, "tsconfig.json"),
          JSON.stringify(
            {
              extends: abs("tsconfig.json"),
              compilerOptions: { incremental: false, noEmit: true, typeRoots: [abs("node_modules/@types")] },
              include: [abs("next-env.d.ts"), path.join(dir, "bogus.ts").replace(/\\/g, "/")],
            },
            null,
            2,
          ),
        );
        const r = await runTsc(path.join(dir, "tsconfig.json"));
        expect(r.code, "the bogus fixture compiled").not.toBe(0);
        expect(r.out).toMatch(/bogusField/);
        expect(r.out).toMatch(/TS2353/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    150_000,
  );
});
