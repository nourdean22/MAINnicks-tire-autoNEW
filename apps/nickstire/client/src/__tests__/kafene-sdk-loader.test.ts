/**
 * loadKafeneSdk: loads https://sdk.kafene.com/plugin/js/kafene.js on demand,
 * once, and resolves only when the global `kafene.init` exists. It must
 * never hang: a failed script or a missing global rejects (10 s timeout).
 * No network: jsdom does not fetch the script; tests drive load/error/events.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const SRC = "https://sdk.kafene.com/plugin/js/kafene.js";
const scripts = () => document.querySelectorAll(`script[src="${SRC}"]`);

async function freshLoader() {
  vi.resetModules();
  return import("@/lib/kafeneSdk");
}

afterEach(() => {
  delete (window as { kafene?: unknown }).kafene;
  document.querySelectorAll('script[src^="https://sdk.kafene.com/"], link[href^="https://sdk.kafene.com/"]').forEach((n) => n.remove());
  vi.useRealTimers();
});

describe("loadKafeneSdk", () => {
  it("resolves at once when window.kafene is already there, inserting nothing", async () => {
    const sdk = { init: vi.fn() };
    (window as any).kafene = sdk;
    const { loadKafeneSdk } = await freshLoader();
    await expect(loadKafeneSdk()).resolves.toBe(sdk);
    expect(scripts()).toHaveLength(0);
  });

  it("inserts the script and stylesheet once for concurrent calls and resolves on kafenejs-init", async () => {
    const { loadKafeneSdk } = await freshLoader();
    const a = loadKafeneSdk();
    const b = loadKafeneSdk();
    expect(scripts()).toHaveLength(1);
    expect(document.querySelectorAll('link[href="https://sdk.kafene.com/plugin/css/kafene.css"]')).toHaveLength(1);
    const sdk = { init: vi.fn() };
    (window as any).kafene = sdk;
    document.dispatchEvent(new Event("kafenejs-init"));
    await expect(a).resolves.toBe(sdk);
    await expect(b).resolves.toBe(sdk);
  });

  it("resolves on the script's load event once the global exists", async () => {
    const { loadKafeneSdk } = await freshLoader();
    const p = loadKafeneSdk();
    const sdk = { init: vi.fn() };
    (window as any).kafene = sdk;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(p).resolves.toBe(sdk);
  });

  it("reuses a script tag already on the page instead of adding a second one", async () => {
    const existing = document.createElement("script");
    existing.src = SRC;
    document.head.appendChild(existing);
    const { loadKafeneSdk } = await freshLoader();
    const p = loadKafeneSdk();
    expect(scripts()).toHaveLength(1);
    const sdk = { init: vi.fn() };
    (window as any).kafene = sdk;
    document.dispatchEvent(new Event("kafenejs-init"));
    await expect(p).resolves.toBe(sdk);
  });

  it("rejects when the script fails to load, and a retry inserts a fresh script", async () => {
    const { loadKafeneSdk } = await freshLoader();
    const p = loadKafeneSdk();
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow();
    expect(scripts()).toHaveLength(0);
    void loadKafeneSdk().catch(() => {});
    expect(scripts()).toHaveLength(1);
  });

  it("rejects after 10 s when the SDK never shows up", async () => {
    vi.useFakeTimers();
    const { loadKafeneSdk } = await freshLoader();
    const p = loadKafeneSdk();
    const settled = vi.fn();
    p.then(settled, settled);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow(/timed out/i);
  });
});
