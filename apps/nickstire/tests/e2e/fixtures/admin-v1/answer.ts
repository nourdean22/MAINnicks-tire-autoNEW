/**
 * Admin v1 fixture router (W0b). A pure function from a tRPC request URL to the
 * response the shop's server would have sent on a DEMO Tuesday, so the admin can
 * be rendered and measured with no live site, no session and no database.
 *
 * - Keyed by procedure name; every answer is built from ./data.ts at the pinned clock.
 * - Batched paths (`a.b,c.d?batch=1&input=...`) are split on the comma and
 *   answered item by item, in order, in tRPC's batch envelope.
 * - Anything without a handler is answered as a tRPC NOT_FOUND error AND listed
 *   in `missing`, so the spec fails on the first unstubbed procedure by name
 *   instead of rendering an admin that is quietly empty (empty-vs-error).
 * - Wire format is the client's: superjson (client/src/main.tsx `transformer`).
 *
 * Nothing here reads the environment, a database or the network.
 */
import superjson from "superjson";
import { HANDLERS } from "./data";

export const NOT_FOUND = Symbol("NOT_FOUND");

/** The DEMO Tuesday: 2:30 pm in Cleveland. */
export const DEMO_CLOCK = new Date("2026-10-13T14:30:00-04:00");

export function answerProcedure(name: string, input: unknown, clock: Date): { data: unknown } | typeof NOT_FOUND {
  const handler = (HANDLERS as Record<string, ((input: unknown, clock: Date) => unknown) | undefined>)[name];
  if (!handler) return NOT_FOUND;
  return { data: handler(input, clock) };
}

export interface ApiAnswer {
  status: number;
  body: unknown;
  /** Procedures in this request that have no fixture. Non-empty means the render is not trustworthy. */
  missing: string[];
}

function notFoundItem(path: string) {
  return {
    error: superjson.serialize({
      message: `No admin v1 fixture for procedure "${path}"`,
      code: -32004,
      data: { code: "NOT_FOUND", httpStatus: 404, path },
    }),
  };
}

/** Answer one `/api/trpc/...` URL (GET query or batched GET). */
export function answerAdminApi(url: string, clock: Date): ApiAnswer {
  const u = new URL(url, "http://fixture.invalid");
  const prefix = "/api/trpc/";
  const at = u.pathname.indexOf(prefix);
  const names = at === -1 ? [] : decodeURIComponent(u.pathname.slice(at + prefix.length)).split(",").filter(Boolean);
  const batched = u.searchParams.get("batch") === "1";
  const rawInput = u.searchParams.get("input");
  const parsed: unknown = rawInput ? JSON.parse(rawInput) : undefined;

  const inputFor = (i: number): unknown => {
    const wire = batched ? (parsed as Record<string, unknown> | undefined)?.[String(i)] : parsed;
    if (!wire || typeof wire !== "object" || !("json" in wire)) return undefined;
    return superjson.deserialize(wire as Parameters<typeof superjson.deserialize>[0]);
  };

  const missing: string[] = [];
  const items = names.map((name, i) => {
    const answer = answerProcedure(name, inputFor(i), clock);
    if (answer === NOT_FOUND) {
      missing.push(name);
      return notFoundItem(name);
    }
    return { result: { data: superjson.serialize(answer.data) } };
  });

  if (names.length === 0) return { status: 404, body: notFoundItem(u.pathname), missing: [u.pathname] };
  if (!batched) return { status: missing.length ? 404 : 200, body: items[0], missing };
  return { status: missing.length ? 207 : 200, body: items, missing };
}
