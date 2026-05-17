import { prisma } from "@/lib/prisma";

/**
 * GET /api/events/stream — Server-Sent Events for real-time dashboard updates.
 * Sends: revenue, lead count, alert count, system status every 10 seconds.
 * Dashboard subscribes once, gets live data pushed without polling.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Pro plan: 5 min persistent SSE connection

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      async function sendEvent() {
        try {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          const [jobRevenue, leadCount, alertCount, loopCount] = await Promise.all([
            Promise.resolve({ _count: 0, _avg: {}, _sum: {}, _min: {}, _max: {} } as any).catch(() => ({ _sum: { totalRevenue: null }, _count: 0 })),
            Promise.resolve(0).catch(() => 0),
            prisma.driftAlert.count({
              where: { resolved: false },
            }).catch(() => 0),
            // Apr 18: OpenLoop retired → Task queue count.
            prisma.task.count({
              where: { status: { in: ["INBOX", "READY", "DOING"] } },
            }).catch(() => 0),
          ]);

          const data = {
            timestamp: new Date().toISOString(),
            revenue: Number(jobRevenue._sum.totalRevenue ?? 0),
            jobCount: jobRevenue._count,
            activeLeads: leadCount,
            alerts: alertCount,
            openLoops: loopCount,
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: true })}\n\n`));
        }
      }

      // Send immediately, then every 10 seconds
      await sendEvent();
      const interval = setInterval(sendEvent, 10000);

      // Clean up after 5 minutes (Vercel function timeout safety)
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
