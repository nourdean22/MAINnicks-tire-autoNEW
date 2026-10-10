/**
 * 03-F5: every Inngest event the app SENDS has a function that LISTENS.
 *
 * `stripe/checkout.completed` was sent from the Stripe webhook (and logged as
 * "dispatched") with no trigger anywhere: Inngest accepted it and nothing ran.
 * An event with no listener is a log line that claims downstream work exists.
 *
 * Static: scans app/ + lib/ for `.send({ name: "<event>"` and
 * lib/inngest/functions for `event: "<event>"` triggers (a trigger may name a
 * module constant, e.g. URGENT_SIGNAL_EVENT, resolved from the same file).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SEND = /\.send\(\s*\{\s*name:\s*["'`]([^"'`]+)["'`]/g;
const TRIGGER = /\bevent:\s*(?:["'`]([^"'`]+)["'`]|([A-Z][A-Z0-9_]+))/g;

function sentEvents(files: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const src of Object.values(files)) for (const m of src.matchAll(SEND)) out.add(m[1]);
  return out;
}

function handledEvents(files: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const src of Object.values(files)) {
    for (const m of src.matchAll(TRIGGER)) {
      if (m[1]) out.add(m[1]);
      else {
        const constant = src.match(new RegExp(`\\b${m[2]}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
        if (constant) out.add(constant[1]);
      }
    }
  }
  return out;
}

function read(files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [path.relative(ROOT, f), fs.readFileSync(f, "utf-8")]));
}

const senders = read([...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))]);
const listeners = read(walk(path.join(ROOT, "lib/inngest/functions")));

describe("Inngest events: sent implies handled", () => {
  it("positive control: a planted unhandled send is caught, a constant-named trigger resolves", () => {
    const sent = sentEvents({ "a.ts": `await getInngest().send({\n  name: "planted/orphan",\n  data: {} });` });
    const handled = handledEvents({ "f.ts": `export const EV = "planted/handled";\ntriggers: [{ event: EV }]` });
    expect([...sent]).toEqual(["planted/orphan"]);
    expect(handled.has("planted/handled")).toBe(true);
    expect(handled.has("planted/orphan")).toBe(false);
  });

  it("the scan actually sees the real senders and listeners (an empty scan is a silent green)", () => {
    const sent = sentEvents(senders);
    const handled = handledEvents(listeners);
    expect(sent.size).toBeGreaterThanOrEqual(8);
    expect(sent.has("social/publish")).toBe(true);
    expect(handled.has("social/publish")).toBe(true);
    expect(handled.has("nick/urgent.signal")).toBe(true); // via URGENT_SIGNAL_EVENT
  });

  it("every sent event name has a listener", () => {
    const handled = handledEvents(listeners);
    const orphans = [...sentEvents(senders)].filter((name) => !handled.has(name));
    expect(orphans).toEqual([]);
  });
});
