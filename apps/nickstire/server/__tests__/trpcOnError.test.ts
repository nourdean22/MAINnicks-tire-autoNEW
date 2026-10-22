/**
 * The tRPC onError hook sent EVERY TRPCError to errorTelemetry, which files a non-AppError as code
 * UNKNOWN, status 500, non-operational, and forwards it to Sentry. A curl hitting an admin route
 * (UNAUTHORIZED) or a bad input (BAD_REQUEST) therefore counted as a server crash: Sentry
 * NICKSTIRE-2 (196 events), the admin error report and the ERROR STORM alarm. Client-caused codes
 * keep the request log line and stay out of telemetry; server faults are still recorded.
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ record: vi.fn(), logs: [] as string[] }));

vi.mock("../lib/error-telemetry", () => ({ errorTelemetry: { record: h.record } }));
vi.mock("../lib/logger", () => ({
  createLogger: () => {
    const rec = (msg: string) => { h.logs.push(msg); };
    return { debug: rec, info: rec, warn: rec, error: rec, fatal: rec };
  },
}));

import { onTrpcError } from "../_core/trpcOnError";

const call = (code: TRPCError["code"]) =>
  onTrpcError({ path: "admin.secret", error: new TRPCError({ code, message: `boom ${code}` }), ctx: { res: { locals: { requestId: "r1" } } } });

beforeEach(() => {
  h.record.mockClear();
  h.logs = [];
});

describe("onTrpcError", () => {
  it("client-caused codes (HTTP status under 500) are logged but kept out of error telemetry and Sentry", () => {
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "NOT_FOUND", "PRECONDITION_FAILED", "TOO_MANY_REQUESTS", "PARSE_ERROR", "CONFLICT"] as const) {
      call(code);
    }
    expect(h.record).not.toHaveBeenCalled();
    expect(h.logs).toHaveLength(8);
    expect(h.logs[0]).toBe("[tRPC] /api/trpc/admin.secret: boom UNAUTHORIZED");
  });

  it("server faults are still recorded with route and request id", () => {
    for (const code of ["INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE"] as const) call(code);
    expect(h.record).toHaveBeenCalledTimes(4);
    expect(h.record.mock.calls[0][1]).toEqual({ route: "/api/trpc/admin.secret", requestId: "r1" });
    expect(h.logs).toHaveLength(4);
  });
});
