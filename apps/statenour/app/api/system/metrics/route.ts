import { apiHandler } from "@/lib/utils/http";
import { recordMetric, queryMetrics, getMetricSummary } from "@/lib/services/metrics";
import { parseDateRange } from "@/lib/db/query-helpers";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const metric = url.searchParams.get("metric");
  const summary = url.searchParams.get("summary") === "true";
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const { from, to } = parseDateRange(req);

  if (!metric) {
    // Return available metric names
    const names = await (await import("@/lib/prisma")).prisma.systemMetric.findMany({
      select: { metric: true },
      distinct: ["metric"],
    });
    return { metrics: names.map((n) => n.metric) };
  }

  if (summary) {
    return getMetricSummary(metric, { from, to });
  }

  return queryMetrics(metric, { from, to, limit });
}, { auth: "owner" }); // v10.0.183 · was unauthenticated; metrics expose
// system performance data (latencies, error counts, integration health).

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const { metric, value, unit, tags, source } = body;

  if (!metric || value === undefined) {
    const { ServiceError } = await import("@/lib/utils/service-error");
    throw new ServiceError("metric and value are required", 400);
  }

  await recordMetric(metric, value, { unit, tags, source });
  return { recorded: true };
}, { auth: "sync" });
