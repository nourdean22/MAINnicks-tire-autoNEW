/**
 * scripts/export-otel-traces.ts — WP-20 export lane CLI (2026-08-03).
 *
 * Reads AgentTrace rows and writes portable OTel-GenAI / OpenInference
 * spans as NDJSON, for ingestion by an OTel collector, Phoenix, or a
 * Braintrust dataset import.
 *
 * READ-ONLY BY CONSTRUCTION: the only Prisma call in this file is
 * `findMany`. There is no create/update/delete/executeRaw anywhere, and
 * that is asserted by a source-scan test — this repo has an incident on
 * record where a "verification" script deleted 870 production rows, so
 * a script that points at a prod DATABASE_URL earns its guard.
 *
 * Usage (from apps/statenour):
 *   pnpm export:traces                        # last 24h -> stdout
 *   pnpm export:traces --since 7d --out t.ndjson
 *   pnpm export:traces --since 2026-08-01T00:00:00Z --source chat
 *
 * Flags:
 *   --since <30m|24h|7d|ISO>  lookback window       (default 24h)
 *   --limit <n>               max spans             (default 5000)
 *   --source <s>              filter AgentTrace.source
 *   --out <path>              write to file         (default stdout)
 *
 * The run summary goes to STDERR so `--out -`-style piping of clean
 * NDJSON on stdout stays possible.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { REDACTION_VERSION } from "../lib/observability/otel-genai-map";
import {
  AGENT_TRACE_EXPORT_SELECT,
  ExportPolicyError,
  parseSince,
  toExportLine,
} from "../lib/observability/otel-export";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const sinceSpec = flag("since") ?? "24h";
  const limit = Number(flag("limit") ?? 5000);
  const source = flag("source");
  const out = flag("out");

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ExportPolicyError(`--limit must be a positive integer, got "${flag("limit")}"`);
  }

  const since = parseSince(sinceSpec, new Date());

  if (!process.env.DATABASE_URL) {
    throw new ExportPolicyError("DATABASE_URL is not set — refusing to run against an unknown DB.");
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await prisma.agentTrace.findMany({
      where: { createdAt: { gte: since }, ...(source ? { source } : {}) },
      select: AGENT_TRACE_EXPORT_SELECT,
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Map before writing anything: enforceAllowlist throws on a
    // disallowed key, and a partially-written export file that looks
    // complete is worse than no file at all.
    const lines = rows.map(toExportLine);

    if (out) {
      writeFileSync(out, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
    } else {
      process.stdout.write(lines.length ? `${lines.join("\n")}\n` : "");
    }

    process.stderr.write(
      [
        "otel trace export",
        `  window     : ${since.toISOString()} -> now (${sinceSpec})`,
        `  source     : ${source ?? "(all)"}`,
        `  spans      : ${lines.length}${lines.length === limit ? ` (HIT --limit ${limit} — window truncated, raise it)` : ""}`,
        `  redaction  : ${REDACTION_VERSION}`,
        `  output     : ${out ?? "stdout"}`,
        "",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`otel trace export FAILED\n  ${msg}\n`);
  process.exit(1);
});
