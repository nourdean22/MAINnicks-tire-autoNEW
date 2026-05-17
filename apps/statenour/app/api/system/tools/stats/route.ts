/**
 * GET /api/system/tools/stats — tool registry + family rollup.
 *
 * Joins the static TOOL_FAMILIES metadata with live tool availability
 * from nourTools. Future: wire in per-tool success/failure rate from
 * AiGeneration + ActionLog when we start persisting per-tool calls
 * (currently feature=chat is per-request, not per-tool).
 */

import { NextResponse } from "next/server";
import { nourTools } from "@/lib/ai/tools";
import {
  TOOL_FAMILIES,
  FAMILY_DISPLAY,
  assertToolFamiliesInSync,
  type ToolFamily,
} from "@/lib/ai/tool-families";
import { getToolStats } from "@/lib/ai/tool-telemetry";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";

interface ToolRow {
  name: string;
  description: string;
  family: ToolFamily;
  familyLabel: string;
  mutates: boolean;
  cost: "cheap" | "medium" | "expensive";
  tags: string[];
  registered: boolean; // in TOOL_FAMILIES registry
  liveInToolset: boolean; // exported by nourTools
  /** Live telemetry — populated from BrainMemory(category="tool_telemetry"). */
  telemetry?: {
    totalCalls: number;
    successRate: number; // 0-1
    avgDurationMs: number;
    failCount: number;
    lastCallAt?: number;
  };
}

interface FamilyRollup {
  family: ToolFamily;
  label: string;
  color: string;
  toolCount: number;
  mutatingCount: number;
  expensiveCount: number;
}

export async function GET(req: Request) {
  await requireSession(req);
  try {
    const liveTools = new Set(Object.keys(nourTools));
    const regTools = new Set(Object.keys(TOOL_FAMILIES));

    // Pull live telemetry in parallel with static metadata walk.
    // tool-telemetry is BrainMemory-backed; empty on fresh installs.
    const telemetryRows = await getToolStats(200).catch(() => []);
    const telemetryByName = new Map(
      telemetryRows.map((t) => [
        t.toolName,
        {
          totalCalls: t.totalCalls,
          successRate: t.successRate,
          avgDurationMs: t.avgDurationMs,
          failCount: t.failCount,
          lastCallAt: t.lastCallAt,
        },
      ]),
    );

    const allNames = new Set<string>([...liveTools, ...regTools]);
    const rows: ToolRow[] = [];

    for (const name of allNames) {
      const meta = TOOL_FAMILIES[name];
      const live = liveTools.has(name);
      const registered = regTools.has(name);
      const telemetry = telemetryByName.get(name);
      rows.push({
        name,
        description: meta?.description ?? "(no registry entry)",
        family: meta?.family ?? ("meta" as ToolFamily),
        familyLabel: FAMILY_DISPLAY[meta?.family ?? ("meta" as ToolFamily)]
          .label,
        mutates: meta?.mutates ?? false,
        cost: meta?.cost ?? "medium",
        tags: meta?.tags ?? [],
        registered,
        liveInToolset: live,
        telemetry,
      });
    }

    rows.sort((a, b) => {
      // Tools WITH call telemetry surface first, sorted by call volume.
      const at = a.telemetry?.totalCalls ?? -1;
      const bt = b.telemetry?.totalCalls ?? -1;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    });

    // Family rollups — order by display priority
    const familyRollup: FamilyRollup[] = (
      Object.keys(FAMILY_DISPLAY) as ToolFamily[]
    )
      .map((fam) => {
        const inFam = rows.filter((r) => r.family === fam);
        return {
          family: fam,
          label: FAMILY_DISPLAY[fam].label,
          color: FAMILY_DISPLAY[fam].color,
          toolCount: inFam.length,
          mutatingCount: inFam.filter((r) => r.mutates).length,
          expensiveCount: inFam.filter((r) => r.cost === "expensive").length,
        };
      })
      .sort((a, b) => FAMILY_DISPLAY[a.family].priority - FAMILY_DISPLAY[b.family].priority);

    const sync = assertToolFamiliesInSync();

    return NextResponse.json({
      data: {
        totalTools: liveTools.size,
        totalRegistered: regTools.size,
        drift: {
          inToolsetMissingFromRegistry: sync.missingFromRegistry,
          inRegistryMissingFromToolset: sync.missingFromTools,
        },
        tools: rows,
        families: familyRollup,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 },
    );
  }
}
