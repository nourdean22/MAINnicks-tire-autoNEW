/**
 * Tool-gap readout over the EXISTING ToolSelectionTurn/ToolGateDecision truth.
 *
 * No duplicate event table: searchToolsFired is already the model's strongest
 * "the attached toolset missed me" signal, and invokeToolFired tells us when
 * the recovery lane found an existing capability.
 */
import { prisma } from "@/lib/prisma";

export type ToolGapClass =
  | "DISCOVERABILITY_GAP"
  | "ROUTING_GAP"
  | "EXTERNAL_SERVICE_GAP"
  | "UNRESOLVED_GAP";

export interface ToolGapGroup {
  classification: ToolGapClass;
  toolName: string | null;
  count: number;
  gateVerdicts: Record<string, number>;
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 10;
}

function classifyGap(
  invokeToolFired: boolean,
  invokedToolName: string | null,
  verdict?: string,
): ToolGapClass {
  if (!invokeToolFired || !invokedToolName) return "UNRESOLVED_GAP";
  if (verdict === "BUDGETED_OUT") return "ROUTING_GAP";
  if (verdict === "BLOCKED_BREAKER") return "EXTERNAL_SERVICE_GAP";
  // NOT_FOUND or no gate row means the capability existed but the initial
  // selection did not expose it. This cannot distinguish wording vs ranking.
  return "DISCOVERABILITY_GAP";
}

export async function buildToolGapReport(windowDays = 30) {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  try {
    const rows = await prisma.toolSelectionTurn.findMany({
      where: { createdAt: { gte: since } },
      select: {
        turnId: true,
        budgetTruncated: true,
        semanticTierAttempted: true,
        embeddingCacheWarm: true,
        searchToolsFired: true,
        invokeToolFired: true,
        invokedToolName: true,
      },
    });

    const missRows = rows.filter((row) => row.searchToolsFired);
    const turnIds = missRows.map((row) => row.turnId);
    const gateRows = turnIds.length
      ? await prisma.toolGateDecision.findMany({
          where: { turnId: { in: turnIds } },
          select: { turnId: true, toolName: true, verdict: true },
        })
      : [];

    const gateByTurnTool = new Map<string, string>();
    for (const gate of gateRows) {
      gateByTurnTool.set(gate.turnId + "::" + gate.toolName, gate.verdict);
    }

    const groups = new Map<string, ToolGapGroup>();
    for (const row of missRows) {
      const invoked = row.invokedToolName ?? null;
      const verdict = invoked
        ? gateByTurnTool.get(row.turnId + "::" + invoked)
        : undefined;
      const classification = classifyGap(row.invokeToolFired, invoked, verdict);
      const key = classification + "::" + (invoked ?? "(unresolved)");
      const current = groups.get(key) ?? {
        classification,
        toolName: invoked,
        count: 0,
        gateVerdicts: {},
      };
      current.count += 1;
      if (verdict) {
        current.gateVerdicts[verdict] =
          (current.gateVerdicts[verdict] ?? 0) + 1;
      }
      groups.set(key, current);
    }

    const semanticAttempted = rows.filter(
      (row) => row.semanticTierAttempted === true,
    );
    const semanticSkipped = rows.filter(
      (row) => row.semanticTierAttempted === false,
    ).length;
    const cold = semanticAttempted.filter(
      (row) => !row.embeddingCacheWarm,
    ).length;
    const recovered = missRows.filter(
      (row) => row.invokeToolFired && row.invokedToolName,
    ).length;

    return {
      available: true,
      windowDays,
      totalTurns: rows.length,
      recoverySearches: missRows.length,
      recoveredExistingTools: recovered,
      unresolvedSearches: missRows.length - recovered,
      budgetTruncatedRatePct: pct(
        rows.filter((row) => row.budgetTruncated).length,
        rows.length,
      ),
      semanticSkippedRatePct: pct(semanticSkipped, rows.length),
      coldCacheRatePct: pct(cold, semanticAttempted.length),
      topGaps: [...groups.values()]
        .sort((a, b) =>
          b.count - a.count ||
          (a.toolName ?? "").localeCompare(b.toolName ?? ""),
        )
        .slice(0, 20),
      generatedAt: new Date().toISOString(),
      caveat:
        "searchToolsFired is a strong pruner-miss signal, not proof that a new permanent tool is needed. Recovered tools usually mean selection, metadata, or routing should be fixed first.",
    };

  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") {
      return {
        available: false,
        windowDays,
        totalTurns: 0,
        recoverySearches: 0,
        recoveredExistingTools: 0,
        unresolvedSearches: 0,
        budgetTruncatedRatePct: null,
        semanticSkippedRatePct: null,
        coldCacheRatePct: null,
        topGaps: [] as ToolGapGroup[],
        generatedAt: new Date().toISOString(),
        caveat:
          "Tool-selection telemetry tables are unavailable; zeros are not evidence of no gaps.",
      };
    }
    throw err;
  }
}
