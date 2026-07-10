import { prisma } from "@/lib/prisma";

export async function recordSpecialistRouteMetric(route: string, confidence: number, reason: string): Promise<void> {
  try {
    await prisma.systemMetric.create({
      data: {
        metric: "specialist.route",
        value: confidence,
        unit: "confidence",
        source: "chat",
        tags: { route, reason: reason.slice(0, 120), shadow: true } as any,
      },
    });
  } catch (err) {
    // Fire-and-forget: ignore DB errors in metrics logging
  }
}
