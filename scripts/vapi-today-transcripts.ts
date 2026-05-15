import "dotenv/config";

/**
 * One-off: pull every VAPI call since midnight ET today and print the
 * full transcript for each. Used to manually QA Nick's behavior on a
 * given day (e.g. when bookings/callbacks lag inbound volume).
 *
 * Run: pnpm tsx scripts/vapi-today-transcripts.ts
 */

async function main() {
  const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY not set"); process.exit(1); }

  // Today midnight ET → UTC ISO. America/New_York is EDT (UTC-4) right now.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const todayET = fmt.format(new Date());
  const cutoff = new Date(`${todayET}T04:00:00.000Z`).toISOString();

  console.log(`Pulling all calls since midnight ET (${cutoff})\n`);

  const r = await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&limit=100&createdAtGt=${cutoff}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const calls = await r.json() as Array<Record<string, unknown>>;

  calls.sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime());

  console.log(`Found ${calls.length} calls today\n${"=".repeat(80)}`);

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const start = c.startedAt as string | undefined;
    const end = c.endedAt as string | undefined;
    const dur = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000) : 0;
    const time = new Date(c.createdAt as string).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
    const caller = ((c.customer as Record<string, unknown> | undefined)?.number) || "unknown";
    const reason = c.endedReason || "unknown";
    const cost = ((c.cost as number) || 0).toFixed(3);
    const summary = ((c.analysis as Record<string, unknown> | undefined)?.summary as string) || "";
    const transcript = (c.transcript as string) || "(no transcript)";

    console.log(`\n[${i+1}/${calls.length}]  ${time}  ·  ${dur}s  ·  ${caller}  ·  ${reason}  ·  $${cost}`);
    if (summary) console.log(`SUMMARY: ${summary}`);
    console.log("-".repeat(80));
    console.log(transcript);
    console.log("=".repeat(80));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
