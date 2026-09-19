/**
 * scripts/always-on-audit.ts — which always-on tools earn their slot? (2026-09-18)
 *
 * WHY THIS IS A SCRIPT AND NOT A NUMBER IN A DOC. The same analysis was run by
 * hand on 2026-08-25 and demoted three tools out of CORE_TOOLS. The result was
 * written into a comment, and by tonight that comment is a cache with no
 * invalidation — it describes a measurement nobody can reproduce without
 * rebuilding the query. Re-running this is the whole point; the numbers below
 * are examples of the OUTPUT, never a claim about today.
 *
 * WHAT IT MEASURES. Tiers 1 (CORE_TOOLS) and 2 (ACTION_CORE) are attached to
 * every standard/deep turn on purpose, so each costs a tool slot ~100% of the
 * time whether or not the model ever reaches for it. This prints, per tool,
 * how often it was SURFACED inside the window beside when it was last actually
 * CALLED.
 *
 * ⚠⚠ THE TWO COLUMNS DO NOT SHARE A WINDOW, AND MUST NEVER BE DIVIDED.
 * `toolGateDecision` rows are windowed here. `tool_telemetry.totalCalls` is
 * CUMULATIVE since the table was created. A ratio of the two is exactly the
 * defect `lib/observability/tool-usage-census.ts:23-32` records being repaired
 * on 2026-09-17 — a lifetime numerator over a windowed denominator, wrong in
 * both directions. So `lastCallAt` is printed as the discriminator and the
 * ratio is never computed. See docs/agent-audit/DEFECT-SHAPE-STALE-DENOMINATOR.md.
 *
 * ⚠ IT PROPOSES NOTHING. Demoting an always-on tool changes EVERY turn and can
 * make a capability unreachable on the turn it is needed. The 2026-08-25
 * demotions each kept a keyword family, semantic rank, exact-name mention and
 * the searchTools/invokeTool recovery lane as fallbacks. Two-stage selection
 * (2026-09-18) makes demotion safer still, because the semantic tier now
 * competes rather than being skipped on the turns that truncate — but that is
 * an argument for re-running this AFTER two-stage is proven, not before.
 *
 * Read-only: count + groupBy + findMany.
 *
 * Usage (from apps/statenour):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/always-on-audit.ts
 *   railway run -s statenour-web -- pnpm exec tsx scripts/always-on-audit.ts --days=14
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

/** Tiers attached unconditionally: 1 CORE_TOOLS, 2 ACTION_CORE. */
const ALWAYS_ON_TIERS: ReadonlySet<number> = new Set([1, 2]);

/**
 * Below this many turns the audit reports and REFUSES to call anything unused.
 * "Never chosen" over a handful of turns is indistinguishable from "barely
 * observed", and a demotion argued from that would be worse than none.
 */
const MIN_TURNS = 100;

/** A tool not called within this many days has not earned its slot recently. */
const COLD_DAYS = 14;

export interface AlwaysOnRow {
  tool: string;
  tier: number;
  surfaced: number;
  lifetimeCalls: number;
  lastCallDays: number;
}

/**
 * Split rows into those called inside the window and those not. Pure, so the
 * rule is testable without a database.
 *
 * `windowDays` is the SURFACING window; a tool whose last call predates it was
 * surfaced N times and chosen zero times WITHIN the measured period, which is
 * the only claim this script makes.
 */
export function splitByRecency(
  rows: readonly AlwaysOnRow[],
  windowDays: number,
): { earning: AlwaysOnRow[]; coldInWindow: AlwaysOnRow[] } {
  const earning: AlwaysOnRow[] = [];
  const coldInWindow: AlwaysOnRow[] = [];
  for (const r of rows) {
    if (r.lastCallDays > windowDays) coldInWindow.push(r);
    else earning.push(r);
  }
  return { earning, coldInWindow };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required — run under `railway run -s statenour-web --`");
    process.exit(1);
  }
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const windowDays = daysArg ? Number(daysArg.slice(7)) : 30;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    console.error("--days must be a positive number");
    process.exit(1);
  }

  const { prisma } = await import("../lib/prisma");
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [turns, surfaced, tel] = await Promise.all([
    prisma.toolSelectionTurn.count({ where: { createdAt: { gte: since } } }),
    prisma.toolGateDecision.groupBy({
      by: ["toolName", "tier"],
      where: { verdict: "ALLOWED", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.toolTelemetry.findMany({ select: { toolName: true, totalCalls: true, lastCallAt: true } }),
  ]);

  console.log(`always-on audit · window ${windowDays}d · ${turns} turns recorded\n`);

  if (turns === 0) {
    console.log("NO TURNS IN WINDOW. This is UNMEASURED, not 'nothing was surfaced'.");
    await prisma.$disconnect();
    return;
  }

  const calls = new Map(tel.map((t) => [t.toolName, t]));
  const now = Date.now();
  const rows: AlwaysOnRow[] = surfaced
    .filter((r) => r.tier !== null && ALWAYS_ON_TIERS.has(r.tier))
    .map((r) => {
      const t = calls.get(r.toolName);
      return {
        tool: r.toolName,
        tier: r.tier as number,
        surfaced: r._count._all,
        lifetimeCalls: t?.totalCalls ?? 0,
        lastCallDays:
          t?.lastCallAt == null
            ? Number.POSITIVE_INFINITY
            : Math.floor((now - t.lastCallAt.getTime()) / 86_400_000),
      };
    })
    .sort((a, b) => a.lastCallDays - b.lastCallDays);

  console.log("tool                       tier  surfaced   lifetime_calls  last_call");
  console.log("-".repeat(76));
  for (const r of rows) {
    const age = r.lastCallDays === Number.POSITIVE_INFINITY ? "never" : `${r.lastCallDays}d`;
    const mark =
      r.lastCallDays > windowDays
        ? "  <- chosen ZERO times inside the window"
        : r.lastCallDays > COLD_DAYS
          ? "  <- cold"
          : "";
    console.log(
      `${r.tool.padEnd(26)} t${r.tier}  ${String(r.surfaced).padStart(6)}   ${String(r.lifetimeCalls).padStart(12)}   ${age.padStart(7)}${mark}`,
    );
  }

  const { coldInWindow } = splitByRecency(rows, windowDays);
  console.log("");
  console.log(
    "⚠ `lifetime_calls` is CUMULATIVE and shares NO window with `surfaced`. It is printed" +
      "\n  BESIDE, never divided into, the surfaced count — `last_call` is the discriminator.",
  );

  if (turns < MIN_TURNS) {
    console.log(
      `\nVERDICT: WITHHELD. ${turns} turns is below the ${MIN_TURNS}-turn floor. "Never chosen"` +
        " over a thin window is indistinguishable from barely observed.",
    );
  } else if (coldInWindow.length === 0) {
    console.log(`\nVERDICT: every always-on tool was chosen at least once inside ${windowDays}d.`);
  } else {
    const wasted = coldInWindow.reduce((n, r) => n + r.surfaced, 0);
    console.log(
      `\nVERDICT: ${coldInWindow.length} of ${rows.length} always-on tools were chosen ZERO times` +
        ` inside the window — ${wasted} impressions that earned nothing:` +
        `\n  ${coldInWindow.map((r) => r.tool).join(", ")}`,
    );
    console.log(
      "\n  This is a MEASUREMENT, not a proposal. Demoting an always-on tool changes every turn." +
        "\n  Precedent 2026-08-25: three were demoted, each keeping a keyword family, semantic" +
        "\n  rank, exact-name mention and the recovery lane as fallbacks.",
    );
  }

  await prisma.$disconnect();
}

/**
 * Only run when invoked directly. Without this, importing the file to unit-test
 * `splitByRecency` would execute `main()` — which needs DATABASE_URL, would
 * call `process.exit(1)` without it, and would take the whole vitest worker
 * down. The sibling census scripts call `main()` unconditionally and are
 * therefore un-importable; that is why none of their pure helpers has a test.
 */
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("scripts/always-on-audit.ts")) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
