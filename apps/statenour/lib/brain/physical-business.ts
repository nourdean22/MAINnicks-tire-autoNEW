import { prisma } from "@/lib/prisma";
import type { CeoBusinessContextV1 } from "@/lib/nickstire/ceo-context";

export async function buildPhysicalBusinessContextBlock(): Promise<string> {
  const event = await prisma.auditEvent.findFirst({
    where: { eventType: "ceo_business_context" },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  }).catch(() => null);

  if (!event || !event.payload) return "";

  const ctx = event.payload as unknown as CeoBusinessContextV1;
  const ageMins = Math.floor((Date.now() - new Date(event.createdAt).getTime()) / 60000);
  
  const lines: string[] = [`## [PHYSICAL_TRUTH] Nick's Tire Shop Floor (sync ${ageMins}m ago)`];

  if (ctx.prioritizedActions && ctx.prioritizedActions.length > 0) {
    lines.push(`### Actionable Bottlenecks:`);
    for (const a of ctx.prioritizedActions) {
      lines.push(`- [${a.priority.toUpperCase()}] ${a.title}: ${a.detail}`);
    }
  }

  const wo = ctx.workOrders as Record<string, unknown> | undefined;
  const leads = ctx.leads as Record<string, unknown> | undefined;
  const rev = ctx.revenue as Record<string, unknown> | undefined;

  const ops: string[] = [];
  if (wo) {
    ops.push(`Active Work Orders: ${wo.active ?? 0} (${wo.blocked ?? 0} blocked)`);
  }
  if (leads) {
    ops.push(`Active Leads: ${leads.active ?? 0} (${leads.urgent ?? 0} urgent)`);
  }
  if (rev && rev.today !== undefined) {
    ops.push(`Today's Revenue: $${rev.today}`);
  }

  if (ops.length > 0) {
    lines.push(`### Current State:`);
    lines.push(...ops.map((o) => `- ${o}`));
  }

  return lines.join("\n");
}
