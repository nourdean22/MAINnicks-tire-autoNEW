import { prisma } from "@/lib/prisma";
import { cached, invalidate } from "@/lib/utils/cache";
import type { CeoBusinessContextV1 } from "@/lib/nickstire/ceo-context";

// 2026-08-06 · This block fires on every /chat turn (864 of 864 sampled
// turns over 30d) while the nickstire bridge only writes a new
// ceo_business_context AuditEvent every ~4h — so the round-trip was pure
// time-to-first-token cost (/chat p50 TTFT 10.4s, p95 60.3s).
//
// Cache the ROW, never the rendered block: `ageMins` is still computed
// from the cached createdAt on every render, so the "sync Nm ago" header
// keeps counting up inside the TTL instead of freezing at the value it
// had when the row was fetched.
const CACHE_KEY = "physical_business_context";
const CACHE_TTL_S = 300; // 5 min · matches violation-context / system-prompt

export async function buildPhysicalBusinessContextBlock(): Promise<string> {
  // The .catch() sits OUTSIDE cached() deliberately. Inside, a hard DB
  // throw resolves to `null` and gets STORED — one transient Neon error
  // would blank the whole [PHYSICAL_TRUTH] block for the full 300s TTL.
  // Outside, the rejection propagates past cached() before it writes
  // either tier, so a failure costs exactly one turn and the next turn
  // retries. The caller wraps this in withTimeout(..., 3000, "") anyway
  // (lib/services/chat/brain-context.ts), so a slow DB still degrades to
  // an empty block without stalling time-to-first-token.
  const event = await cached(CACHE_KEY, CACHE_TTL_S, () =>
    prisma.auditEvent.findFirst({
      where: { eventType: "ceo_business_context" },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    }),
  ).catch(() => null);

  if (!event || !event.payload) return "";

  const ctx = event.payload as unknown as CeoBusinessContextV1;
  // The `new Date(...)` wrapper is load-bearing, not redundant: on an L2
  // (Redis) cache hit createdAt comes back as a JSON string, not a Date.
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

/**
 * Drop the cached ceo_business_context row so the next chat turn reads
 * the fresh one instead of waiting out the 5-minute TTL.
 *
 * Wired into the ONE writer of that row: POST /api/sync/business
 * (app/api/sync/business/route.ts), the nickstire bridge endpoint. If
 * another writer of `eventType: "ceo_business_context"` ever appears it
 * must call this too, or its row stays invisible to /chat for 300s.
 *
 * Multi-replica caveat: this clears THIS instance's L1 plus the shared
 * L2 (Redis) key. Sibling replicas keep their own L1 copy until the TTL
 * expires — the TTL is still the backstop, this just collapses the
 * common single-replica case from 300s to 0.
 */
export function invalidatePhysicalBusinessCache(): void {
  invalidate(CACHE_KEY);
}
