/**
 * Pulls the last 14 days of Vapi calls for the Nick AI assistant,
 * including transcripts + structured analysis + tool-call sequences,
 * and writes them to tmp/vapi-call-audit.json for offline analysis.
 *
 * Used by the call-audit workflow: this script captures the raw data,
 * a separate agent reads the JSON and recommends prompt/tool changes.
 *
 * Run: npx tsx scripts/vapi-pull-call-audit.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";
const DAYS_BACK = 14;
const PER_PAGE = 100;
const HARD_CAP = 500;

interface VapiCall {
  id: string;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  cost?: number;
  customer?: { number?: string };
  transcript?: string;
  analysis?: {
    summary?: string;
    structuredData?: Record<string, unknown>;
    successEvaluation?: string;
  };
  messages?: Array<{ role: string; message?: string; toolCalls?: Array<{ name: string; arguments?: unknown }> }>;
}

async function main(): Promise<void> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error("VAPI_API_KEY not set");
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);
  console.log(`Pulling Vapi calls since ${cutoff.toISOString().slice(0, 10)} for assistant ${ASSISTANT_ID}`);

  let all: VapiCall[] = [];
  let createdAtLt: string | null = null;
  while (all.length < HARD_CAP) {
    const params = new URLSearchParams({
      assistantId: ASSISTANT_ID,
      limit: String(PER_PAGE),
    });
    if (createdAtLt) params.set("createdAtLt", createdAtLt);
    const res = await fetch(`${VAPI_BASE}/call?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`Fetch failed: ${res.status} ${await res.text()}`);
      break;
    }
    const page = (await res.json()) as VapiCall[];
    if (page.length === 0) break;

    // Keep only calls within the window
    const within = page.filter((c) => c.createdAt && new Date(c.createdAt) >= cutoff);
    all.push(...within);

    // If the oldest call in this page is BEFORE the cutoff, we're done
    const oldest = page[page.length - 1];
    if (!oldest.createdAt || new Date(oldest.createdAt) < cutoff) break;
    createdAtLt = oldest.createdAt;

    if (page.length < PER_PAGE) break; // last page
  }

  console.log(`Total calls in window: ${all.length}`);

  // Strip noisy / huge fields. Keep only what's useful for analysis.
  const slim = all.map((c) => {
    const start = c.startedAt ? new Date(c.startedAt).getTime() : 0;
    const end = c.endedAt ? new Date(c.endedAt).getTime() : 0;
    const durationSeconds = end && start ? Math.round((end - start) / 1000) : 0;
    return {
      id: c.id,
      createdAt: c.createdAt,
      endedReason: c.endedReason,
      cost: c.cost,
      durationSeconds,
      caller: c.customer?.number || null,
      transcript: c.transcript || null,
      analysis: c.analysis || null,
      // Tool-call sequence — extract names + args for pattern analysis
      toolCalls: (c.messages || [])
        .flatMap((m) => m.toolCalls || [])
        .map((t) => ({ name: t.name, args: t.arguments })),
    };
  });

  // Aggregate stats
  const totalDuration = slim.reduce((s, c) => s + (c.durationSeconds || 0), 0);
  const avgDuration = slim.length > 0 ? Math.round(totalDuration / slim.length) : 0;
  const totalCost = slim.reduce((s, c) => s + (c.cost || 0), 0);
  const endReasons: Record<string, number> = {};
  slim.forEach((c) => {
    const r = c.endedReason || "unknown";
    endReasons[r] = (endReasons[r] || 0) + 1;
  });
  const outcomes: Record<string, number> = {};
  const callTypes: Record<string, number> = {};
  const sentiments: Record<string, number> = {};
  slim.forEach((c) => {
    const sd = c.analysis?.structuredData as Record<string, unknown> | undefined;
    if (sd) {
      const o = String(sd.outcome || "unknown");
      const t = String(sd.callType || "unknown");
      const s = String(sd.sentiment || "unknown");
      outcomes[o] = (outcomes[o] || 0) + 1;
      callTypes[t] = (callTypes[t] || 0) + 1;
      sentiments[s] = (sentiments[s] || 0) + 1;
    }
  });
  const toolHits: Record<string, number> = {};
  slim.forEach((c) => c.toolCalls.forEach((t) => { toolHits[t.name || "unknown"] = (toolHits[t.name || "unknown"] || 0) + 1; }));

  const aggregates = {
    windowDays: DAYS_BACK,
    totalCalls: slim.length,
    avgDurationSeconds: avgDuration,
    totalCostCents: Math.round(totalCost * 100),
    endReasons,
    outcomes,
    callTypes,
    sentiments,
    toolHits,
  };

  const outDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "vapi-call-audit.json");
  fs.writeFileSync(outPath, JSON.stringify({ aggregates, calls: slim }, null, 2));
  console.log(`Wrote ${slim.length} calls to ${outPath}`);

  // Print quick summary to stdout
  console.log("\n=== AGGREGATES ===");
  console.log(JSON.stringify(aggregates, null, 2));
}

main().catch((e: Error) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
