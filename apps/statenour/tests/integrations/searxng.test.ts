/**
 * askSearxng · direct SearXNG /search provider
 *
 * The failure this provider exists to make loud: a SearXNG instance whose
 * engines are all blocked answers **HTTP 200 with an empty result set**, and
 * buries the reason in `unresponsive_engines`. That shape served zero web
 * results for six weeks while every status-code health check passed, so the
 * empty-with-200 case is tested first and by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const realFetch = global.fetch;

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("askSearxng", () => {
  beforeEach(() => {
    vi.stubEnv("SEARXNG_API_URL", "http://searxng.internal:8080");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("THROWS on 200-with-no-results and carries unresponsive_engines into the message", async () => {
    global.fetch = vi.fn(async () =>
      ok({
        results: [],
        unresponsive_engines: [
          ["duckduckgo", "CAPTCHA"],
          ["brave", "too many requests"],
        ],
      }),
    ) as unknown as typeof fetch;

    const { askSearxng } = await import("@/lib/integrations/searxng");
    await expect(askSearxng("brake job cleveland")).rejects.toThrow(/duckduckgo:CAPTCHA/);
    // The reason must survive — a bare "no results" is what hid the outage.
    await expect(askSearxng("brake job cleveland")).rejects.toThrow(/brave:too many requests/);
  });

  it("normalizes results into numbered sources plus citations", async () => {
    let seenUrl = "";
    global.fetch = vi.fn(async (u: string | URL) => {
      seenUrl = String(u);
      return ok({
        results: [
          { url: "https://a.example/1", title: "Brake costs", content: "Between $300 and $700 per axle." },
          { url: "https://b.example/2", title: "Rotor guide", content: "Rotors add $150." },
        ],
      });
    }) as unknown as typeof fetch;

    const { askSearxng } = await import("@/lib/integrations/searxng");
    const r = await askSearxng("brake job cleveland");

    expect(seenUrl).toContain("/search?q=brake%20job%20cleveland");
    expect(seenUrl).toContain("format=json");
    expect(r.model).toBe("searxng");
    expect(r.citations).toEqual([
      { url: "https://a.example/1", title: "Brake costs" },
      { url: "https://b.example/2", title: "Rotor guide" },
    ]);
    expect(r.content).toContain("[1] Brake costs");
    expect(r.content).toContain("[2] Rotor guide");
    expect(r.content).toContain("Between $300 and $700 per axle.");
  });

  it("drops results with no url and caps the source list at 10", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      url: `https://e.example/${i}`,
      title: `t${i}`,
      content: "x",
    }));
    global.fetch = vi.fn(async () =>
      ok({ results: [{ title: "no url here", content: "y" }, ...many] }),
    ) as unknown as typeof fetch;

    const { askSearxng } = await import("@/lib/integrations/searxng");
    const r = await askSearxng("q");

    expect(r.citations).toHaveLength(10);
    expect(r.citations.every((c) => c.url.startsWith("https://e.example/"))).toBe(true);
    expect(r.content).not.toContain("no url here");
  });

  it("truncates long snippets so one verbose source cannot dominate the tool result", async () => {
    global.fetch = vi.fn(async () =>
      ok({ results: [{ url: "https://a.example/1", title: "t", content: "z".repeat(5000) }] }),
    ) as unknown as typeof fetch;

    const { askSearxng } = await import("@/lib/integrations/searxng");
    const r = await askSearxng("q");

    expect(r.content).toContain("z".repeat(400));
    expect(r.content).not.toContain("z".repeat(401));
  });

  it("throws on a non-2xx so the caller falls through to the Perplexica rung", async () => {
    global.fetch = vi.fn(async () => new Response("upstream boom", { status: 502 })) as unknown as typeof fetch;

    const { askSearxng } = await import("@/lib/integrations/searxng");
    await expect(askSearxng("q")).rejects.toThrow(/SearXNG 502/);
  });
});

describe("hasSearxng · reachability gate", () => {
  const saved = process.env.RAILWAY_ENVIRONMENT;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (saved === undefined) delete process.env.RAILWAY_ENVIRONMENT;
    else process.env.RAILWAY_ENVIRONMENT = saved;
    vi.resetModules();
  });

  it("is FALSE off-Railway with no explicit url — no doomed fetch at a private DNS name", async () => {
    vi.stubEnv("SEARXNG_API_URL", "");
    delete process.env.RAILWAY_ENVIRONMENT;
    vi.resetModules();
    const { hasSearxng } = await import("@/lib/integrations/searxng");
    expect(hasSearxng()).toBe(false);
  });

  it("is TRUE inside Railway, where the private default resolves", async () => {
    vi.stubEnv("SEARXNG_API_URL", "");
    process.env.RAILWAY_ENVIRONMENT = "production";
    vi.resetModules();
    const { hasSearxng } = await import("@/lib/integrations/searxng");
    expect(hasSearxng()).toBe(true);
  });

  it("is TRUE anywhere an explicit url is configured", async () => {
    vi.stubEnv("SEARXNG_API_URL", "http://searxng.internal:8080");
    delete process.env.RAILWAY_ENVIRONMENT;
    vi.resetModules();
    const { hasSearxng } = await import("@/lib/integrations/searxng");
    expect(hasSearxng()).toBe(true);
  });
});
