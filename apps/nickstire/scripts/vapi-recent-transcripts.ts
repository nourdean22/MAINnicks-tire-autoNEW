import "dotenv/config";

/**
 * Pull all VAPI calls from the last N days (default 3) and print full
 * transcripts. Cousin of vapi-today-transcripts.ts but with a window.
 *
 * Run from the repo root so dotenv picks up the root .env:
 *   DOTENV_CONFIG_PATH=.env VAPI_DAYS=3 node \
 *     node_modules/.pnpm/tsx@4.22.1/node_modules/tsx/dist/cli.mjs \
 *     apps/nickstire/scripts/vapi-recent-transcripts.ts
 */

async function main() {
  const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY not set"); process.exit(1); }

  const days = parseInt(process.env.VAPI_DAYS || "3", 10);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Pulling calls from the last ${days} days (since ${cutoff})\n`);

  // VAPI's /call endpoint returns 100 per page max. Paginate via createdAtLt.
  const all: Array<Record<string, unknown>> = [];
  let createdAtLt: string | null = null;
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      assistantId: ASSISTANT_ID,
      limit: "100",
      createdAtGt: cutoff,
    });
    if (createdAtLt) params.set("createdAtLt", createdAtLt);
    const r = await fetch(`https://api.vapi.ai/call?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const page = await r.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 100) break;
    createdAtLt = (page[page.length - 1] as { createdAt: string }).createdAt;
  }

  all.sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime());

  console.log(`Found ${all.length} calls in window\n${"=".repeat(80)}`);

  // ─── BUCKET BY DAY ───
  const byDay = new Map<string, Array<Record<string, unknown>>>();
  for (const c of all) {
    const day = new Date(c.createdAt as string).toLocaleDateString("en-US", {
      timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
    });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(c);
  }

  for (const [day, calls] of byDay) {
    console.log(`\n\n████████████████████████████████ ${day} · ${calls.length} calls ████████████████████████████████\n`);
    calls.forEach((c, i) => {
      const start = c.startedAt as string | undefined;
      const end = c.endedAt as string | undefined;
      const dur = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000) : 0;
      const time = new Date(c.createdAt as string).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
      const caller = ((c.customer as Record<string, unknown> | undefined)?.number) || "unknown";
      const reason = c.endedReason || "unknown";
      const cost = ((c.cost as number) || 0).toFixed(3);
      const summary = ((c.analysis as Record<string, unknown> | undefined)?.summary as string) || "";
      const transcript = (c.transcript as string) || "(no transcript)";

      // Tool-call extraction — what tools did Nick actually fire?
      const msgs = (c.messages as Array<Record<string, unknown>> | undefined) || [];
      const toolCalls: string[] = [];
      for (const m of msgs) {
        const tcs = m.toolCalls as Array<{ function?: { name?: string } }> | undefined;
        if (Array.isArray(tcs)) {
          tcs.forEach((t) => { if (t.function?.name) toolCalls.push(t.function.name); });
        }
      }
      const toolStr = toolCalls.length > 0 ? toolCalls.join(", ") : "NONE";

      console.log(`\n[${i+1}/${calls.length}]  ${time}  ·  ${dur}s  ·  ${caller}  ·  ${reason}  ·  $${cost}`);
      console.log(`TOOLS: ${toolStr}`);
      if (summary) console.log(`SUMMARY: ${summary}`);
      console.log("-".repeat(80));
      console.log(transcript);
      console.log("=".repeat(80));
    });
  }

  // ─── TOOL-FIRING SUMMARY ───
  console.log("\n\n████████ TOOL-FIRING SUMMARY (all calls in window) ████████\n");
  const toolCounts: Record<string, number> = {};
  let callsWithAnyTool = 0;
  for (const c of all) {
    const msgs = (c.messages as Array<Record<string, unknown>> | undefined) || [];
    let any = false;
    for (const m of msgs) {
      const tcs = m.toolCalls as Array<{ function?: { name?: string } }> | undefined;
      if (Array.isArray(tcs)) {
        tcs.forEach((t) => {
          if (t.function?.name) { toolCounts[t.function.name] = (toolCounts[t.function.name] || 0) + 1; any = true; }
        });
      }
    }
    if (any) callsWithAnyTool++;
  }
  console.log(`Calls that fired ≥1 tool: ${callsWithAnyTool} / ${all.length} (${Math.round(callsWithAnyTool/all.length*100)}%)`);
  console.log(`Tool counts:`);
  Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t.padEnd(25)} ${n}`));
}

main().catch(err => { console.error(err); process.exit(1); });
