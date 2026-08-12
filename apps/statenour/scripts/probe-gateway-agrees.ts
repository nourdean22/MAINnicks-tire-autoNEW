/**
 * Read-only probe: memory-commit-gateway shadow-receipt agreement rates.
 *
 * The spine-2 gateway has been recording SHADOW verdicts beside every
 * remember() call (category "memory_gateway_shadow", 7-day TTL). The
 * graduation precondition (AGENTS backlog #2) is reviewing these rates
 * before routing any writer through the gateway for real.
 *
 * SELECT-only. Run with the real env:
 *   railway run --service statenour-web -- pnpm exec tsx scripts/probe-gateway-agrees.ts
 */
import { prisma } from "@/lib/prisma";

async function main(): Promise<void> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: "memory_gateway_shadow" },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  console.log(`shadow receipts (7d TTL window): ${rows.length}`);
  if (rows.length === 0) {
    console.log("no receipts — either no memory writes in the window or the shadow path is dark.");
    return;
  }
  const byDecision = new Map<string, { n: number; agrees: number }>();
  let parseFailures = 0;
  for (const r of rows) {
    try {
      const j = JSON.parse(r.content) as { decision?: string; agrees?: boolean };
      const key = j.decision ?? "unparsed";
      const slot = byDecision.get(key) ?? { n: 0, agrees: 0 };
      slot.n++;
      if (j.agrees) slot.agrees++;
      byDecision.set(key, slot);
    } catch {
      parseFailures++;
    }
  }
  for (const [decision, { n, agrees }] of [...byDecision.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `${decision.padEnd(16)} n=${String(n).padStart(4)} · legacy-agrees=${agrees} (${Math.round((agrees / n) * 100)}%)`,
    );
  }
  if (parseFailures) console.log(`unparseable receipts: ${parseFailures}`);
  console.log(
    `oldest in window: ${rows[rows.length - 1]?.createdAt.toISOString()} · newest: ${rows[0]?.createdAt.toISOString()}`,
  );
}

void main().finally(() => prisma.$disconnect());
