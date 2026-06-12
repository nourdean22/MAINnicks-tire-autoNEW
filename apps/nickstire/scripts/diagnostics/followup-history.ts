/**
 * Pull VAPI outbound call history. Uses createdAtLt pagination to walk
 * BACKWARDS in time until we run out of outbound calls. Surfaces the
 * full operator-triggered follow-up call ledger.
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) { console.error("VAPI_API_KEY missing"); process.exit(1); }

interface VapiCall {
  id: string;
  type?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  endedReason?: string;
  customer?: { number?: string; name?: string };
  assistantId?: string;
}

(async () => {
  const allOutbound: VapiCall[] = [];
  let before: string | undefined = undefined;
  let pages = 0;
  const maxPages = 20; // 20 * 100 = up to 2000 calls

  while (pages < maxPages) {
    const url = before
      ? `https://api.vapi.ai/call?limit=100&createdAtLt=${encodeURIComponent(before)}`
      : `https://api.vapi.ai/call?limit=100`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) { console.error("Status", r.status, await r.text()); process.exit(1); }
    const batch = await r.json() as VapiCall[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    pages++;
    const outbound = batch.filter((c) => c.type === "outboundPhoneCall");
    allOutbound.push(...outbound);
    console.log(`page ${pages}: ${batch.length} calls (${outbound.length} outbound) · range ${batch[batch.length - 1].createdAt} → ${batch[0].createdAt}`);

    // Page back from the oldest call in this batch
    const oldest = batch[batch.length - 1].createdAt;
    if (!oldest || batch.length < 100) break; // last page
    before = oldest;
  }

  console.log(`\n═══ TOTAL OUTBOUND FOUND: ${allOutbound.length} across ${pages} pages ═══\n`);

  if (allOutbound.length === 0) {
    console.log("(no outbound calls in account history)");
    return;
  }

  const byDay: Record<string, VapiCall[]> = {};
  for (const c of allOutbound) {
    const day = String(c.startedAt || c.createdAt || "").slice(0, 10) || "unknown";
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(c);
  }

  const days = Object.keys(byDay).sort().reverse();
  console.log("OUTBOUND CALLS BY DAY (newest first):\n");
  for (const day of days) {
    const calls = byDay[day];
    console.log(`${day} :: ${calls.length} calls`);
    for (const c of calls) {
      const dur = c.startedAt && c.endedAt
        ? `${((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000).toFixed(0)}s`
        : "?";
      const cust = c.customer?.number || "?";
      const time = String(c.startedAt || "").slice(11, 19);
      console.log(`  ${time} UTC | ${cust} | ${dur} | ${c.endedReason || "?"} | asst=${String(c.assistantId).slice(0, 8)}`);
    }
    console.log("");
  }
})().catch((err) => { console.error("FAILED:", err); process.exit(1); });
