/**
 * The worker must not report "listening" when the bind failed.
 *
 * Express 5 changed `app.listen(port, callback)`: the callback now also runs when the server
 * emits an `error` event (expressjs.com/en/guide/migrating-5.html, "app.listen"), with the error
 * as its first argument. Express 4 never called it on error. The worker's old callback took no
 * argument, so on Express 5 an EADDRINUSE would log "listening" and keep the scheduler running
 * with nothing bound to the port. `listenOrExit` (apps/worker/src/listen.ts) takes the error,
 * logs it and exits 1.
 *
 * The worker has no test runner of its own (apps/worker/AGENTS.md), so the test lives here, next
 * to worker-hygiene.test.ts. It drives the real module with a FAKE app whose `listen` plays back
 * what Express 5 does, so no port is bound, no worker boots and no dependency of the worker is
 * needed (listen.ts imports nothing).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listenOrExit } from "../../../worker/src/listen";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

type Cb = (error?: Error) => void;

/** Records every side effect in call order so an ordering mutant is visible too. */
function harness() {
  const events: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const io = {
    role: "worker",
    log: (line: string) => {
      logs.push(line);
      events.push(`log:${line}`);
    },
    error: (line: string) => {
      errors.push(line);
      events.push(`error:${line}`);
    },
    exit: (code: number) => {
      exits.push(code);
      events.push(`exit:${code}`);
    },
  };
  return { io, events, logs, errors, exits };
}

/** Express 5: `listen(port, cb)` runs `cb` once, with the error on a server `error` event. */
function fakeApp(outcome: Error | undefined) {
  const server = { fake: "http.Server" };
  return {
    server,
    listen(_port: number, callback: Cb) {
      callback(outcome);
      return server;
    },
  };
}

describe("listenOrExit", () => {
  it("a bind error logs the error, exits 1 and never says listening (EADDRINUSE)", () => {
    const h = harness();
    const err = Object.assign(new Error("listen EADDRINUSE: address already in use :::8080"), {
      code: "EADDRINUSE",
    });

    listenOrExit(fakeApp(err), 8080, h.io);

    expect(h.exits).toEqual([1]);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain("8080");
    expect(h.logs.filter((l) => /listening/i.test(l))).toEqual([]);
    expect(h.events.some((e) => /listening/i.test(e))).toBe(false);
  });

  it("logs the error before it exits", () => {
    const h = harness();
    listenOrExit(fakeApp(new Error("boom")), 8080, h.io);
    const iError = h.events.findIndex((e) => e.startsWith("error:"));
    const iExit = h.events.findIndex((e) => e.startsWith("exit:"));
    expect(iError).toBeGreaterThanOrEqual(0);
    expect(iExit).toBeGreaterThan(iError);
  });

  it("no error logs the listening line once and does not exit", () => {
    const h = harness();
    listenOrExit(fakeApp(undefined), 8080, h.io);

    expect(h.exits).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.logs).toEqual(["[worker] listening on :8080 · role=worker · scheduler started"]);
  });

  it("returns what app.listen returned, so the shutdown handler can close it", () => {
    const h = harness();
    const app = fakeApp(undefined);
    expect(listenOrExit(app, 8080, h.io)).toBe(app.server);
  });

  it("a failed bind still returns the server (the caller wires shutdown before exit lands)", () => {
    const h = harness();
    const app = fakeApp(new Error("boom"));
    expect(listenOrExit(app, 8080, h.io)).toBe(app.server);
  });
});

describe("index.ts reaches listenOrExit", () => {
  const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/index.ts"), "utf8")
    // a comment that quotes the call must not satisfy the pin
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports the module and calls it with the real process hooks", () => {
    expect(src).toMatch(/import \{ listenOrExit \} from "\.\/listen\.js";/);
    expect(src).toMatch(/listenOrExit\(app, port, \{[\s\S]*?exit: \(code\) => process\.exit\(code\)/);
  });

  it("does not call app.listen directly any more", () => {
    expect(src).not.toMatch(/\bapp\.listen\(/);
  });
});
