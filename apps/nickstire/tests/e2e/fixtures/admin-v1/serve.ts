/**
 * Serves the admin SPA to a Playwright page with no server process at all.
 *
 * The page talks to a fake origin (`.test` is reserved and never resolves), and one
 * `page.route` handler answers everything:
 *   - /api/trpc/**        -> the fixture router (answer.ts), unknown procedures recorded
 *   - /api/admin/events   -> an idle SSE stream (AdminSSEContext's EventSource)
 *   - /api/health         -> a stub; never the live health route
 *   - any other /api/**   -> 404 and recorded as unrouted, so the spec can fail on it
 *   - other same-origin   -> files from the local `vite build` output (dist/public),
 *                            index.html for SPA routes
 *   - any other origin    -> aborted (Google Fonts, the Meta pixel, analytics) and recorded
 *
 * Why route instead of `vite preview` or a static server: nothing to start, no port
 * to bind, no process to leak on a runner, and nothing that COULD reach nickstire.org
 * or a database. The build is the same static output either way.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { answerAdminApi, DEMO_CLOCK } from "./answer";

export const FIXTURE_ORIGIN = "http://nickstire-admin.fixture.test";

/** dist/public from `vite build`; ADMIN_V1_DIST overrides for a build elsewhere. */
export const DIST_DIR = path.resolve(process.env.ADMIN_V1_DIST ?? "dist/public");

export const PAGES = [
  { key: "overview", url: "/admin?tab=overview" },
  { key: "lot", url: "/admin?tab=lot" },
  { key: "approvals", url: "/admin?tab=approvals" },
] as const;

export interface FixtureLog {
  /** tRPC procedures the page asked for that have no fixture. */
  missing: Set<string>;
  /** Non-tRPC /api/ paths the page asked for that nothing answers. */
  unrouted: Set<string>;
  /** Hosts the page tried to reach and was refused. */
  blockedHosts: Set<string>;
}

export async function serveAdminFixtures(page: Page): Promise<FixtureLog> {
  if (!existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(`No SPA build at ${DIST_DIR}. Run \`node node_modules/vite/bin/vite.js build\` in apps/nickstire first.`);
  }
  const log: FixtureLog = { missing: new Set(), unrouted: new Set(), blockedHosts: new Set() };

  // "Today" math is pinned; timers keep running so react-query still settles.
  await page.clock.setFixedTime(DEMO_CLOCK);

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== FIXTURE_ORIGIN) {
      log.blockedHosts.add(url.host);
      return route.abort("blockedbyclient");
    }
    const p = url.pathname;
    if (p.startsWith("/api/trpc/")) {
      if (route.request().method() !== "GET") {
        // A write on page load would be a defect worth seeing; nothing is persisted either way.
        log.missing.add(`${route.request().method()} ${p.slice("/api/trpc/".length)}`);
        return route.fulfill({ status: 405, contentType: "application/json", body: "[]" });
      }
      const answer = answerAdminApi(url.toString(), DEMO_CLOCK);
      for (const m of answer.missing) log.missing.add(m);
      return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
    }
    if (p === "/api/admin/events") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": admin v1 fixture, no events\n\n" });
    }
    if (p === "/api/health") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", fixture: true }) });
    }
    if (p.startsWith("/api/")) {
      log.unrouted.add(p);
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "no admin v1 fixture" }) });
    }
    const file = path.join(DIST_DIR, decodeURIComponent(p));
    const isFile = file.startsWith(DIST_DIR) && existsSync(file) && statSync(file).isFile();
    if (isFile) return route.fulfill({ path: file });
    if (path.extname(p)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ path: path.join(DIST_DIR, "index.html") });
  });
  return log;
}
