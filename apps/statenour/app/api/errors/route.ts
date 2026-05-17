/**
 * POST /api/errors — client-side error ingest.
 *
 * Receives unhandled errors, unhandled promise rejections, and
 * React error-boundary trips from the browser. Writes to ErrorLog
 * so the /system/errors page can surface them.
 *
 * Passive — telemetry-only. Zero side effects beyond the write.
 * Auth: owner-only (session). Rate-limited client-side via
 * ClientErrorTelemetry (dedupe + 10/min cap); server adds a
 * belt-and-suspenders sanity cap.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

interface ClientErrorPayload {
  kind: "error" | "unhandledrejection" | "boundary";
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  timestamp?: number;
  componentStack?: string;
  errorBoundary?: string;
}

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<ClientErrorPayload>(req).catch(() => null);
    if (!body || typeof body.message !== "string" || !body.message) {
      return { ok: false, reason: "invalid payload" };
    }

    // Cap sizes — nobody uploads novels.
    const message = body.message.slice(0, 1000);
    const stack = body.stack ? body.stack.slice(0, 4000) : null;
    const componentStack = body.componentStack ? body.componentStack.slice(0, 2000) : null;

    await prisma.errorLog
      .create({
        data: {
          level: body.kind === "boundary" ? "error" : body.kind === "unhandledrejection" ? "warn" : "error",
          message,
          stack: stack ?? undefined,
          context: {
            source: "client",
            kind: body.kind,
            url: body.url?.slice(0, 500),
            userAgent: body.userAgent?.slice(0, 300),
            timestamp: body.timestamp,
            componentStack: componentStack ?? undefined,
            errorBoundary: body.errorBoundary,
          },
        },
      })
      .catch(() => {
        // If the write itself fails, don't cascade — this endpoint is
        // best-effort. Failing a telemetry write to make the page
        // return 500 would be its own bug.
      });

    return { ok: true };
  },
  { auth: "owner" },
);
