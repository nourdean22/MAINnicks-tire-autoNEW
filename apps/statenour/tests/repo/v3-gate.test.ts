/**
 * tests/repo/v3-gate.test.ts · 2026-10-15 · UI v3 Wave 0b
 *
 * Controls for the v3 six-feet gate (tests/e2e/visible-transformation-v3.spec.ts),
 * runnable with no browser. The gate is the inverse of a snapshot test: it
 * FAILS when a page still looks like the frozen v2 render, so a verdict
 * function that says "ok" too easily lets an untouched page through. This
 * file pins (1) the verdict arithmetic and its thresholds, (2) the instrument
 * on REAL committed renders (the existing visual-distance-metric test draws
 * synthetic rectangles; it never touches a committed PNG), and (3) later
 * sections: the fixture router, the spec's use of the verdict, the workflow.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { DEMO, FIXED_TIME, TRPC_FIXTURES, answerApi, installFixtures, type FixtureReport } from "../e2e/fixtures";
import { MIN_DISTANCE, MIN_INK, captureVerdict, v3GateVerdict } from "../e2e/v3-gate";
import { visualDistance } from "../e2e/visual-distance";

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

  it("every fixture survives JSON unchanged (no Date, undefined or function reaches the wire)", () => {
    for (const [procedure, data] of Object.entries(TRPC_FIXTURES)) {
      expect(JSON.parse(JSON.stringify(data)), procedure).toEqual(data);
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
  });
});

// ── The fixtures: fictional, deterministic, and unable to hide a failed read ─

/** Lines that would make a fixture depend on the machine or the moment. */
const NONDETERMINISTIC = /Date\.now|new Date\(|Math\.random|performance\.now|toLocale|Intl\.|randomUUID|process\.env/;

describe("fixture data", () => {
  const dataFiles = ["time.ts", "home.ts", "missions.ts", "shell.ts"].map((f) => path.join(E2E_DIR, "fixtures", f));

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
    expect(sources.some((s) => s.text.includes("Needs your judgment"))).toBe(true);
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
      "components/home/judgment-queue.tsx",
      "components/home/waiting-line.tsx",
      "components/ultron/bottom-pulse-ticker.tsx",
      "app/(mastery)/missions/page.tsx",
    ].map((f) => read(path.join(APP_DIR, f)).replace(/&apos;/g, "'"));
    for (const name of ["HOME_ERRORS", "MISSIONS_ERRORS"]) {
      const m = new RegExp(`const ${name} = /(.+)/i;`).exec(smoke);
      expect(m, `${name} not found in the smoke spec`).not.toBeNull();
      for (const alt of m![1].split("|")) {
        const re = new RegExp(alt, "i");
        // An absent-text assertion that can never match is a silent instrument.
        expect(
          sources.some((s) => re.test(s)),
          `${name} alternative /${alt}/ matches no error string in the app: retarget it`,
        ).toBe(true);
      }
    }
  });

  it("every query Home and Missions render is stubbed, or listed here with the reason it is not", () => {
    const NOT_STUBBED: Record<string, string> = {
      "operator.briefChanges": "only requested once a last-visit cursor exists; a fresh browser has none",
      "operator.commandCenterState": "the page reads only the active command id and renders nothing without it",
    };
    const files = [
      "components/home/home-console.tsx",
      "components/home/waiting-line.tsx",
      "components/home/change-line.tsx",
      "components/home/judgment-queue.tsx",
      "components/home/nick-command-line.tsx",
      "app/(mastery)/missions/hooks/use-missions-data.ts",
    ];
    const used = new Set<string>();
    for (const f of files) {
      for (const m of read(path.join(APP_DIR, f)).matchAll(/trpc\.([a-zA-Z]+)\.([a-zA-Z]+)\.useQuery/g)) used.add(`${m[1]}.${m[2]}`);
    }
    expect(used.size, "the query scan found nothing").toBeGreaterThanOrEqual(7);
    const uncovered = [...used].filter((p) => !(p in TRPC_FIXTURES) && !(p in NOT_STUBBED));
    expect(uncovered, "a page query is neither stubbed nor explained").toEqual([]);
  });
});

// ── The v3 spec really asks the verdict function ────────────────────────────

/** What must be true of the spec's source for the unit tests above to guard its decision. */
function specProblems(src: string): string[] {
  const problems: string[] = [];
  if (!/import \{[^}]*\bv3GateVerdict\b[^}]*\} from "\.\/v3-gate"/.test(src)) problems.push("does not import v3GateVerdict from ./v3-gate");
  if (!/const verdict = v3GateVerdict\(\{ baselineExists, ink, distance \}\);/.test(src)) problems.push("does not call v3GateVerdict with the measured numbers");
  if (!/expect\(verdict\.ok, /.test(src)) problems.push("does not assert verdict.ok");
  if (!/test\.skip\(!ENABLED, /.test(src)) problems.push("is not opt-in (no test.skip(!ENABLED))");
  if (!/const ENABLED = process\.env\.VT_V3 === "1";/.test(src)) problems.push("ENABLED is not VT_V3 === 1");
  const writes = [...src.matchAll(/fs\.writeFileSync\(file,/g)].map((m) => m.index!);
  const captureAt = src.indexOf("if (CAPTURE) {");
  const compareAt = src.indexOf("const baselineExists");
  if (writes.length !== 1 || captureAt < 0 || !(captureAt < writes[0] && writes[0] < compareAt)) problems.push("writes a baseline outside the capture branch");
  if (!/captureVerdict\(\{ ink \}\)/.test(src)) problems.push("capture does not refuse a void render");
  return problems;
}

describe("visible-transformation-v3.spec.ts consumes the verdict", () => {
  const spec = read(V3_SPEC);

  it("the real spec has no problems", () => {
    expect(specProblems(spec)).toEqual([]);
  });

  it("MUTANTS: each of these edits to the spec is noticed", () => {
    const mutants: Record<string, string> = {
      "verdict call removed": spec.replace("const verdict = v3GateVerdict({ baselineExists, ink, distance });", "const verdict = { ok: true, reason: '' };"),
      "assertion removed": spec.replace("expect(verdict.ok, ", "void (verdict.ok, "),
      "not opt-in": spec.replace("test.skip(!ENABLED, ", "test.skip(false, "),
      "opt-in by any value": spec.replace('process.env.VT_V3 === "1"', "process.env.VT_V3"),
      "capture refusal removed": spec.replace("captureVerdict({ ink })", "{ ok: true, reason: '' }"),
      "silent baseline write on compare": spec.replace("const baselineExists", "fs.writeFileSync(file, current);\n        const baselineExists"),
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
  const uploadAt = idx("Upload v3 baselines");
  const tracesAt = idx("Upload Playwright traces on failure");
  if ([smokeAt, captureAt, uploadAt, tracesAt].includes(-1)) {
    return [`missing step: smoke=${smokeAt} capture=${captureAt} upload=${uploadAt} traces=${tracesAt}`];
  }
  const smoke = steps[smokeAt];
  const capture = steps[captureAt];
  const upload = steps[uploadAt];

  const input = wf.on.workflow_dispatch?.inputs?.capture_v3_baselines;
  if (!input || input.type !== "boolean" || input.default !== false) problems.push("workflow_dispatch input capture_v3_baselines is not a boolean defaulting to false");
  if (!wf.on.pull_request?.paths?.includes("apps/statenour/**")) problems.push("pull_request path filter lost apps/statenour/**");
  if (!wf.on.push?.paths?.includes("apps/statenour/**")) problems.push("push path filter lost apps/statenour/**");
  if (JSON.stringify(wf.on.push?.branches) !== '["main"]') problems.push("push is no longer limited to main");

  if (smoke.if !== RUN_GUARD) problems.push("smoke step guard changed");
  if (smoke.run !== SMOKE_RUN) problems.push("smoke step command changed");
  if (capture.if !== CAPTURE_GUARD) problems.push("capture step guard is not the inverse of the smoke guard");
  if (!capture.run?.includes("visible-transformation-v3") || capture.run === SMOKE_RUN) problems.push("capture step does not run only the v3 spec");
  if (capture.env?.VT_V3 !== "1" || capture.env?.VT_V3_CAPTURE !== "1") problems.push("capture step does not set VT_V3=1 and VT_V3_CAPTURE=1");
  if (!(smokeAt < captureAt && captureAt < uploadAt)) problems.push("steps are out of order (smoke, capture, upload)");

  if (upload.if !== CAPTURE_GUARD) problems.push("upload step is not guarded by the capture condition");
  if (upload.uses !== steps[tracesAt].uses) problems.push("upload step is not pinned to the same upload-artifact commit as the traces step");
  if (upload.with?.name !== "v3-baselines") problems.push("artifact is not named v3-baselines");
  if (upload.with?.["retention-days"] !== 14) problems.push("artifact retention is not 14 days");
  if (!String(upload.with?.path).includes("visible-transformation-v3.spec.ts-snapshots")) problems.push("artifact path is not the spec's snapshot directory");
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
    };
    for (const [name, mutate] of Object.entries(mutants)) {
      const copy = structuredClone(wf);
      mutate(copy);
      expect(workflowProblems(copy), name).not.toEqual([]);
    }
  });
});
