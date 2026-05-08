import "dotenv/config";

async function main() {
  const r = await fetch("https://api.vapi.ai/call?assistantId=150fe622-0b9f-4b03-b8c7-3063812717ae&limit=50", {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  });
  const calls = await r.json() as Array<Record<string, unknown>>;
  console.log(`Got ${calls.length} calls\n`);
  for (const c of calls.slice(0, 50)) {
    const start = c.startedAt as string | undefined;
    const end = c.endedAt as string | undefined;
    const duration = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000) : 0;
    const cost = c.cost || 0;
    const created = c.createdAt as string | undefined;
    const localTime = created ? new Date(created).toLocaleString("en-US", { timeZone: "America/New_York" }) : "?";
    console.log(JSON.stringify({
      time: localTime,
      durSec: duration,
      cost,
      reason: c.endedReason,
      caller: (c.customer as Record<string, unknown> | undefined)?.number,
    }));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
