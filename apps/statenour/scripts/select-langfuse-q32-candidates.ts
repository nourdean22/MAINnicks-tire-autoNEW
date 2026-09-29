/**
 * Q-32 · deterministic Langfuse review-queue selector.
 *
 * READ-ONLY DB, LOCAL OUTPUT, NO SEND.
 *
 * Selects assistant turns from the last 30 days when one or more of the
 * architecture-approved signals fired:
 *   - operator thumbs-down
 *   - L2/action-receipt verifier banner
 *   - evidence-gate shadow block
 *   - context block actually dropped by the upstream threshold
 *
 * The output contains NO message text. It carries trace id, message id,
 * content hash, model/provider and reason tags so an operator can seed the one
 * Langfuse annotation queue without creating a second raw-transcript export.
 *
 * Usage from apps/statenour:
 *   pnpm exec tsx scripts/select-langfuse-q32-candidates.ts
 *   pnpm exec tsx scripts/select-langfuse-q32-candidates.ts --days 14
 */

import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

loadEnvConfig(process.cwd());

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to read an unknown database.");
  }

  const daysRaw = Number(arg("days") ?? "30");
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 30;
  const out = arg("out") ?? "eval-datasets/q32-langfuse-candidates.json";

  // Keep sensitive harvest artifacts under the already-gitignored eval-datasets
  // directory. Resolve + prefix guard blocks "../" escapes.
  const root = resolve(process.cwd(), "eval-datasets");
  const target = resolve(process.cwd(), out);
  if (target !== root && !target.startsWith(root + "/") && !target.startsWith(root + "\\")) {
    throw new Error("--out must stay inside apps/statenour/eval-datasets/");
  }

  const [{ prisma }, q32] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/evals/q32-regression"),
  ]);

  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.chatMessage.findMany({
    where: {
      role: "assistant",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      createdAt: true,
      feedbackScore: true,
      content: true,
      model: true,
      provider: true,
      tokenUsage: true,
    },
  });

  const candidates = rows
    .map((row) => q32.selectQ32Turn(row))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const signalCounts = Object.fromEntries(
    q32.Q32_SIGNALS.map((signal) => [
      signal,
      candidates.filter((x) => x.signals.includes(signal)).length,
    ]),
  );

  const payload = {
    selectedAt: new Date().toISOString(),
    since: since.toISOString(),
    days,
    scanned: rows.length,
    selected: candidates.length,
    withTraceId: candidates.filter((x) => x.traceId).length,
    withoutTraceId: candidates.filter((x) => !x.traceId).length,
    queueKey: q32.Q32_ANNOTATION_QUEUE_KEY,
    datasetVersion: q32.Q32_DATASET_VERSION,
    rawConversationTextIncluded: false,
    signalCounts,
    candidates,
  };

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");

  process.stdout.write(
    [
      "Q-32 Langfuse candidate selector",
      `  scanned       : ${rows.length}`,
      `  selected      : ${candidates.length}`,
      `  trace-backed  : ${payload.withTraceId}`,
      `  missing trace : ${payload.withoutTraceId}`,
      `  output        : ${target}`,
      "  raw text      : NO",
    ].join("\n") + "\n",
  );

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Q-32 selector FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
