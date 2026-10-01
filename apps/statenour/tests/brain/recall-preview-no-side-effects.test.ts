/**
 * RECALL PREVIEW MUST NOT CHANGE WHAT NICK RECALLS -- 2026-10-01.
 *
 * The /brain "Recall preview" panel (components/brain/recall-preview-panel.tsx)
 * promises to "inspect the memories Nick would consider for a prompt without
 * sending a chat message". It called GET /api/brain/recall, which ran the
 * same recallMemoriesForQuery the chat turn runs -- and that function has two
 * writes on every hit:
 *
 *   1. brainMemory.updateMany({ lastSeen: now }) -- and recall scoring gives
 *      +0.2 to memories seen in the last 14 days, so one preview boosted
 *      exactly those memories in REAL chat recall for two weeks;
 *   2. systemMetric.create({ metric: "brain.recall.avg_distance" }) -- so
 *      owner previews polluted the recall-quality series /system plots.
 *
 * The fix is an explicit `sideEffects: false` option, passed only when the
 * request carries `preview=1`. Both client views send it, because both build
 * their URL with lib/brain/recall-preview-url.ts: the panel, and (since a
 * follow-up the same day) the chat memory inspector, which re-ran recall on
 * every user turn while open. Every other caller (the chat turn via
 * brain-context.ts, brain-provenance.ts, the POST route, a GET without
 * `preview`) keeps the default.
 *
 * Asserted at the CONSUMER end: the URL the panel actually builds is sent
 * through the real route into the real recall function, and the two Prisma
 * writes are observed (or not). The CONTROL cases prove the spies fire, so a
 * green "not called" is not a silent instrument.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

function row(memory_id: string) {
  return {
    memory_id,
    category: "preferences",
    key: `k:${memory_id}`,
    content: `content ${memory_id}`,
    confidence: 0.8,
    seen_count: 1,
    last_seen: new Date(),
    created_at: new Date(),
    distance: 0.2,
    source: "manual",
    created_by: "user",
  };
}

const queryRawUnsafe = vi.fn(() => Promise.resolve([row("m1"), row("m2")]));
const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
const metricCreate = vi.fn(() => Promise.resolve({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...(a as [])),
    $executeRawUnsafe: async () => 0,
    $transaction: (fn: (tx: unknown) => unknown) =>
      Promise.resolve(fn({ $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...(a as [])), $executeRawUnsafe: async () => 0 })),
    brainMemory: { updateMany: (...a: unknown[]) => updateMany(...(a as [])), findMany: async () => [] },
    systemMetric: { create: (...a: unknown[]) => metricCreate(...(a as [])) },
  },
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: async () => EMBEDDING }));
// The route's envelope/auth/telemetry wrapper is not under test; unwrap it so
// the handler's own return value is what the test reads.
vi.mock("@/lib/utils/http", () => ({
  apiHandler: (fn: (req: Request, ctx: unknown) => unknown) => (req: Request) => fn(req, {}),
}));

import { recallMemoriesForQuery } from "@/lib/brain/memory-recall";
import { GET } from "@/app/api/brain/recall/route";
import { recallPreviewUrl } from "@/lib/brain/recall-preview-url";

type Report = { hits: unknown[]; provenance?: string };

async function getRoute(path: string): Promise<Report> {
  return (await GET(new Request(`http://x${path}`), {} as never)) as unknown as Report;
}

beforeEach(() => {
  queryRawUnsafe.mockClear();
  updateMany.mockClear();
  metricCreate.mockClear();
});

describe("default path is unchanged -- every existing caller still writes", () => {
  it("CONTROL - recallMemoriesForQuery with no options bumps lastSeen and writes the metric", async () => {
    const report = await recallMemoriesForQuery("taper plan", { embedding: EMBEDDING });
    expect(report.hits.length).toBeGreaterThan(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(metricCreate).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - a GET without the preview param still writes", async () => {
    const report = await getRoute("/api/brain/recall?q=taper%20plan&limit=8");
    expect(report.hits.length).toBeGreaterThan(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(metricCreate).toHaveBeenCalledTimes(1);
  });
});

describe("the preview path is read-only", () => {
  it("GET with preview=1 returns real hits and performs NEITHER write", async () => {
    const report = await getRoute("/api/brain/recall?q=taper%20plan&limit=8&includePrompt=0&preview=1");
    // The recall itself ran -- this is not a vacuous "nothing happened".
    expect(report.hits.length).toBeGreaterThan(0);
    expect(report.provenance).toBe("OK");
    expect(updateMany).not.toHaveBeenCalled();
    expect(metricCreate).not.toHaveBeenCalled();
  });

  it("the URL both client views send reaches the read-only path", async () => {
    // undefined is the chat inspector's call shape; false/true are the panel's.
    for (const includePrompt of [undefined, false, true]) {
      updateMany.mockClear();
      metricCreate.mockClear();
      const url = recallPreviewUrl("taper plan", includePrompt);
      expect(new URL(url, "http://x").searchParams.get("preview")).toBe("1");
      const report = await getRoute(url);
      expect(report.hits.length).toBeGreaterThan(0);
      expect(updateMany).not.toHaveBeenCalled();
      expect(metricCreate).not.toHaveBeenCalled();
    }
  });

  it("sideEffects:false is the switch -- the direct call skips both writes", async () => {
    const report = await recallMemoriesForQuery("taper plan", { embedding: EMBEDDING, sideEffects: false });
    expect(report.hits.length).toBeGreaterThan(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(metricCreate).not.toHaveBeenCalled();
  });
});

/**
 * The read-only URL protects only the callers that use it. The chat memory
 * inspector built its own URL without `preview=1` until the follow-up, so
 * this reads every client tree for a hand-built recall URL. Comments are
 * stripped first, so prose that names the route is not a hit, and a URL in a
 * string ("https://...") is not mistaken for a comment.
 */
describe("client code builds recall URLs only through the read-only helper", () => {
  const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const CLIENT_TREES = ["components", "features", "hooks", "app"];

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  function clientFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === "node_modules" || name === "api") continue; // app/api is the server side
          walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          out.push(relative(APP_ROOT, full));
        }
      }
    };
    for (const tree of CLIENT_TREES) walk(join(APP_ROOT, tree));
    return out;
  }

  function handBuiltRecallUrls(src: string): number {
    // Not followed by a word character or hyphen: /api/brain/recall-inbox is another route.
    return (stripComments(src).match(/\/api\/brain\/recall(?![\w-])/g) ?? []).length;
  }

  it("PLANTED POSITIVE - the scan catches a hand-built URL and skips comments", () => {
    expect(handBuiltRecallUrls("await fetch(`/api/brain/recall?q=${q}&limit=8`);")).toBe(1);
    expect(handBuiltRecallUrls('const u = "https://bdnick.info/api/brain/recall?q=x";')).toBe(1);
    expect(handBuiltRecallUrls("// GET /api/brain/recall\n/* /api/brain/recall */\n{/* /api/brain/recall */}")).toBe(0);
    expect(handBuiltRecallUrls('await apiFetch("/api/brain/recall-inbox");')).toBe(0);
  });

  it("the scan reads the client trees, including both views", () => {
    const files = clientFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("features/chat-v2/components/chat-island.tsx");
    expect(files).toContain("features/chat-v2/lib/inspector-recall.ts");
    expect(files).toContain("components/brain/recall-preview-panel.tsx");
  });

  it("no client file builds a /api/brain/recall URL by hand", () => {
    const offenders = clientFiles().filter((f) => handBuiltRecallUrls(readFileSync(join(APP_ROOT, f), "utf8")) > 0);
    expect(offenders).toEqual([]);
  });

  it("both views fetch through recallPreviewUrl", () => {
    // The chat inspector reaches it through its loader, which
    // tests/components/chat-inspector-recall-envelope.test.ts drives end to end.
    const callers: Array<[string, RegExp]> = [
      ["components/brain/recall-preview-panel.tsx", /recallPreviewUrl\(/],
      ["features/chat-v2/lib/inspector-recall.ts", /recallPreviewUrl\(/],
      ["features/chat-v2/components/chat-island.tsx", /fetchInspectorRecall\(/],
    ];
    for (const [f, call] of callers) {
      const code = stripComments(readFileSync(join(APP_ROOT, f), "utf8"));
      expect(code, f).toMatch(call);
    }
  });
});
