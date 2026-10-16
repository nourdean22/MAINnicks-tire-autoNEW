/**
 * v3 fixture lane (2026-10-15, UI v3 Wave 0b): deterministic DEMO data for Home
 * and Missions, served by intercepting the app's own data calls in the browser.
 *
 * WHY. The committed v2 baselines are EMPTY-database renders. The v3 six-feet
 * gate compares W2's Home and Missions against v2 as it looks with real data at
 * 390px, so both sides need the same realistic, repeatable data.
 *
 * WHAT IS STUBBED. Only reads the two pages (and the shared shell's pulse strip)
 * make, listed in TRPC_FIXTURES. Auth is never stubbed: /api/auth/** goes to the
 * real server and the real mock-auth path.
 *
 * WHAT IS NOT. Anything else is answered with an EXPLICIT error (a tRPC
 * NOT_FOUND entry, or a 404 for REST), never a success, so the page cannot
 * flash empty-database content between runs and a fixture cannot paper over a
 * read that the page really depends on. The unstubbed calls are returned in the
 * report so a spec can print them. Mutations are never stubbed.
 *
 * Pages that are server components reading Prisma directly could not be stubbed
 * this way. Home (HomeConsole) and Missions (MissionsPageInner) are both client
 * roots that read over tRPC, so nothing on either page bypasses these fixtures.
 *
 * Matching is by procedure name only, not input: every stubbed procedure is
 * read with at most one input shape on these two pages.
 */
import type { Page } from "@playwright/test";

import { HOME_BRIEF, HOME_REMEMBERS, HOME_WAITING } from "./home";
import { ALPHA_TITLE, MISSIONS, MISSIONS_DECK, MISSION_TASKS, NEXT_MOVE_TITLE } from "./missions";
import { SHELL_PULSE, SHELL_TICKER } from "./shell";
import { FIXED_TIME } from "./time";

export { FIXED_TIME, NOW_ISO, NOW_MS } from "./time";

/**
 * The pages' own error states, by the text they render. Both specs assert these
 * have count 0 after a fixture render: a page that fell into one is not a
 * fixture render, whatever its distance from v2. tests/repo/v3-gate.test.ts
 * checks each alternative still matches a string the app really renders.
 */
export const PAGE_ERRORS = {
  home: /couldn.t be built|refresh failed|unknown, read failed|partial read|pulse unavailable/i,
  missions: /deck unreadable|board unreadable|showing the last confirmed board|pulse unavailable/i,
} as const;

/**
 * Page-data procedures a fixture render may legitimately ask for and not get.
 * Any OTHER unstubbed `operator.*` or `task.*` read fails the v3 gate: a page
 * that grew a query the fixtures do not answer renders an error state, which is
 * "far" from v2 and would pass on distance alone. Shell reads outside those two
 * routers (system.*, brain.*, REST) are printed, not gated.
 */
export const UNSTUBBED_ALLOWLIST: ReadonlyArray<string | RegExp> = [
  "operator.briefChanges", // only requested once a last-visit cursor exists; a fresh browser has none
  "operator.commandCenterState", // Missions reads only the active command id and renders nothing without it
  /^systemAutomation\./, // the PWA badge; renders nothing
];

/** `GET operator.*` / `GET task.*` entries of a FixtureReport that the gate does not allow. */
export function disallowedUnstubbed(unstubbed: Iterable<string>): string[] {
  const out: string[] = [];
  for (const entry of unstubbed) {
    const m = /^GET ((?:operator|task)\.[A-Za-z0-9_.]+)$/.exec(entry);
    if (!m) continue;
    const procedure = m[1];
    const allowed = UNSTUBBED_ALLOWLIST.some((a) => (typeof a === "string" ? a === procedure : a.test(procedure)));
    if (!allowed) out.push(entry);
  }
  return out.sort();
}

/** Procedure path (as it appears in /api/trpc/<path>) to its wire payload. */
export const TRPC_FIXTURES: Record<string, unknown> = {
  "operator.brief": HOME_BRIEF,
  "operator.waitingSummary": HOME_WAITING,
  "operator.nickRemembersContext": HOME_REMEMBERS,
  "operator.personalPulse": SHELL_PULSE,
  "operator.ticker": SHELL_TICKER,
  "task.deck": MISSIONS_DECK,
  "task.list": MISSION_TASKS,
  "task.missions": MISSIONS,
};

/**
 * Text the smoke spec waits for. Each string exists ONLY in the fixtures (the
 * repo test greps the app source for them), so a page rendered from an empty
 * database, or from the wrong fixture, cannot satisfy the assertion.
 */
const HOME_APPROVAL = HOME_BRIEF.judgment.items.flatMap((i) => (i.kind === "approvals" ? i.pending : []))[0]?.title;
if (!HOME_APPROVAL) throw new Error("HOME_BRIEF must carry at least one pending approval: it is a smoke anchor");

export const DEMO = {
  homeSummary: HOME_BRIEF.state.summary,
  homeHeadline: HOME_BRIEF.lead.headline,
  homeApproval: HOME_APPROVAL,
  missionsNextMove: NEXT_MOVE_TITLE,
  missionTitle: ALPHA_TITLE,
} as const;

export interface FixtureReport {
  /** "METHOD procedure" or "METHOD /path" for every data call the fixtures refused. */
  unstubbed: Set<string>;
}

export type ApiAnswer =
  | { kind: "passthrough" }
  | { kind: "fulfill"; status: number; body: unknown };

/** What the fixtures say to one request. Pure, so tests/repo/v3-gate.test.ts can drive it with no browser. */
export function answerApi(method: string, url: URL, report: FixtureReport): ApiAnswer {
  const pathname = url.pathname;
  if (pathname.startsWith("/api/auth/")) return { kind: "passthrough" };

  const trpcPrefix = "/api/trpc/";
  if (pathname.startsWith(trpcPrefix)) {
    const procedures = decodeURIComponent(pathname.slice(trpcPrefix.length)).split(",");
    const results = procedures.map((procedure) => {
      if (method === "GET" && Object.hasOwn(TRPC_FIXTURES, procedure)) {
        return { result: { data: TRPC_FIXTURES[procedure] } };
      }
      report.unstubbed.add(`${method} ${procedure}`);
      return {
        error: {
          message: `not stubbed by the v3 fixtures: ${procedure}`,
          code: -32004,
          data: { code: "NOT_FOUND", httpStatus: 404, path: procedure },
        },
      };
    });
    // httpBatchLink always sends batch=1 and expects an array in request order.
    const batched = url.searchParams.get("batch") === "1";
    return { kind: "fulfill", status: 200, body: batched ? results : results[0] };
  }

  report.unstubbed.add(`${method} ${pathname}`);
  return { kind: "fulfill", status: 404, body: { error: "not stubbed by the v3 fixtures" } };
}

/**
 * Freeze the page's clock and answer its data calls from the fixtures. Call it
 * BEFORE page.goto. setFixedTime pins Date.now()/new Date() but leaves timers
 * running, so polling, debounces and the settle wait behave normally while
 * "2h ago" stays put.
 */
export async function installFixtures(page: Page): Promise<FixtureReport> {
  const report: FixtureReport = { unstubbed: new Set() };
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const answer = answerApi(request.method(), new URL(request.url()), report);
      if (answer.kind === "passthrough") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: answer.status,
        contentType: "application/json",
        body: JSON.stringify(answer.body),
      });
    },
  );
  return report;
}
