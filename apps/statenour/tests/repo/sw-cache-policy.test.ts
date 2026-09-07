/**
 * tests/repo/sw-cache-policy.test.ts · 2026-09-07
 *
 * public/sw.js promises to cache ONLY immutable, content-hashed static
 * assets. Until v11 its predicate also accepted any URL whose path ended in
 * an asset extension — any origin, hashed or not — so unversioned root icons
 * and same-origin images were pinned cache-first until the next CACHE_NAME
 * bump, and a future dotted page route would have qualified too.
 *
 * This test boots the REAL service-worker file inside a vm sandbox with a
 * fake `self`/`caches`/`fetch`, dispatches fake fetch events at the listener
 * it registered, and asserts what it stores. No regex is re-implemented
 * here: if the predicate drifts, this file sees the real behaviour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SW_SOURCE = readFileSync(resolve(APP_ROOT, "public/sw.js"), "utf8");
const ORIGIN = "https://bdnick.info";

type Listener = (event: unknown) => void;

function bootServiceWorker() {
  const listeners: Record<string, Listener[]> = {};
  const stored: string[] = [];
  const cache = { put: async (req: { url: string }) => void stored.push(req.url) };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: Listener) => void (listeners[type] ??= []).push(fn),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined, matchAll: async () => [], openWindow: async () => undefined },
    registration: { showNotification: async () => undefined },
  };
  const caches = {
    match: async () => undefined,
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  };
  const fetchImpl = async (req: { url: string }) => ({
    ok: true,
    url: req.url,
    clone() {
      return this;
    },
  });
  const context = vm.createContext({ self, caches, fetch: fetchImpl, clients: self.clients, URL, Response, console });
  vm.runInContext(SW_SOURCE, context, { filename: "sw.js" });
  return { listeners, stored };
}

async function dispatchFetch(url: string, mode: "no-cors" | "navigate" = "no-cors") {
  const sw = bootServiceWorker();
  expect(sw.listeners.fetch?.length, "sw.js must register a fetch listener").toBeGreaterThan(0);
  let handled: Promise<unknown> | null = null;
  const event = {
    request: { url, method: "GET", mode },
    respondWith: (p: Promise<unknown>) => void (handled = p),
    waitUntil: () => undefined,
  };
  for (const fn of sw.listeners.fetch) fn(event);
  if (handled) await handled;
  // cache.put runs on a detached promise chain after fetch resolves.
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  return { intercepted: handled !== null, stored: sw.stored };
}

describe("service worker cache policy: same-origin /_next/static/ only", () => {
  it("caches a content-hashed framework asset (positive control)", async () => {
    const r = await dispatchFetch(`${ORIGIN}/_next/static/chunks/3uui8jb82-ezq.js`);
    expect(r.intercepted).toBe(true);
    expect(r.stored).toEqual([`${ORIGIN}/_next/static/chunks/3uui8jb82-ezq.js`]);
  });

  it("caches a hashed font under /_next/static/media/", async () => {
    const r = await dispatchFetch(`${ORIGIN}/_next/static/media/GeistMono_Variable.p.42jdkyb02hb3d.woff2`);
    expect(r.stored).toHaveLength(1);
  });

  it.each([
    ["unversioned root icon", `${ORIGIN}/icon-192.png`],
    ["apple touch icon", `${ORIGIN}/apple-touch-icon.png`],
    ["dotted page route", `${ORIGIN}/decisions/1.png`],
    ["cross-origin script", "https://cdn.example.com/_next/static/chunks/x.js"],
    ["cross-origin image", "https://images.example.com/photo.jpg"],
    ["generated image API", `${ORIGIN}/api/images/abc123`],
    ["public manifest", `${ORIGIN}/manifest.webmanifest`],
  ])("never stores %s", async (_label, url) => {
    const r = await dispatchFetch(url);
    expect(r.stored, `${url} must not enter Cache Storage`).toEqual([]);
  });

  it("navigations are handled network-first and never stored", async () => {
    const r = await dispatchFetch(`${ORIGIN}/journal`, "navigate");
    expect(r.intercepted).toBe(true); // offline fallback path exists
    expect(r.stored).toEqual([]);
  });

  it("canary: a predicate that accepts any asset extension would be caught here", async () => {
    // Re-run the icon case against a mutated copy of the file carrying the
    // v10 predicate. If this ever passes, the harness stopped observing puts.
    const mutated = SW_SOURCE.replace(
      "url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')",
      "url.pathname.startsWith('/_next/static/') || /\\.(?:png|js)$/.test(url.pathname)",
    );
    expect(mutated).not.toBe(SW_SOURCE);
    const listeners: Record<string, Listener[]> = {};
    const stored: string[] = [];
    const context = vm.createContext({
      self: {
        location: new URL(ORIGIN),
        addEventListener: (t: string, fn: Listener) => void (listeners[t] ??= []).push(fn),
        skipWaiting: () => undefined,
        clients: { claim: () => undefined },
        registration: {},
      },
      caches: { match: async () => undefined, open: async () => ({ put: async (req: { url: string }) => void stored.push(req.url) }), keys: async () => [], delete: async () => true },
      fetch: async (req: { url: string }) => ({ ok: true, url: req.url, clone() { return this; } }),
      URL,
      Response,
      console,
    });
    vm.runInContext(mutated, context);
    let handled: Promise<unknown> | null = null;
    for (const fn of listeners.fetch) fn({ request: { url: `${ORIGIN}/icon-192.png`, method: "GET", mode: "no-cors" }, respondWith: (p: Promise<unknown>) => void (handled = p), waitUntil: () => undefined });
    if (handled) await handled;
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    expect(stored).toEqual([`${ORIGIN}/icon-192.png`]);
  });
});
