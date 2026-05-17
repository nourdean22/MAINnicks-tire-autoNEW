/**
 * Find any unusually long calls today — looking for the 10-min runaway
 * the operator mentioned. Probably a self-transfer loop.
 */
import "dotenv/config";

const VAPI_BASE = "https://api.vapi.ai";
const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";

interface VapiCall {
  id: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  costBreakdown?: { total?: number };
  customer?: { number?: string };
  transcript?: string;
  type?: string;
  phoneNumber?: { number?: string };
  destination?: { number?: string; type?: string };
}

function durationSec(c: VapiCall): number {
  if (!c.startedAt || !c.endedAt) return 0;
  return Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000);
}

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY missing"); process.exit(1); }

  const url = `${VAPI_BASE}/call?assistantId=${ASSISTANT_ID}&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const calls = await res.json() as VapiCall[];

  console.log(`Pulled ${calls.length} recent calls\n`);

  // Filter to calls that actually started (have non-zero duration), sort desc
  const successful = calls.filter(c => durationSec(c) > 0);
  const long = successful.slice().sort((a, b) => durationSec(b) - durationSec(a)).slice(0, 8);

  console.log(`─── Top 5 longest calls (looking for runaways) ───\n`);
  for (const c of long) {
    const dur = durationSec(c);
    const cost = c.cost || c.costBreakdown?.total || 0;
    const caller = c.customer?.number || "(unknown)";
    const phone = c.phoneNumber?.number || "(unknown)";
    const dest = c.destination?.number || "(none)";
    const time = c.startedAt ? new Date(c.startedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "?";
    console.log(`  ${time}`);
    console.log(`    duration: ${Math.floor(dur / 60)}m ${dur % 60}s · cost: $${cost.toFixed(2)} · ${c.type || "?"}`);
    console.log(`    caller=${caller} · phone=${phone} · destination=${dest}`);
    console.log(`    endedReason: ${c.endedReason}`);
    console.log(`    callId: ${c.id}`);
    console.log();
  }

  // Specifically check the call that hit max-duration
  const runaways = calls.filter(c =>
    c.endedReason === "exceeded-max-duration" ||
    c.endedReason === "phone-call-provider-bypass-enabled" ||
    durationSec(c) > 5 * 60
  );
  if (runaways.length > 0) {
    console.log(`\n─── ${runaways.length} likely runaway(s) ───\n`);
    for (const c of runaways) {
      console.log(`Pulling full detail for ${c.id}...`);
      const dRes = await fetch(`${VAPI_BASE}/call/${c.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!dRes.ok) continue;
      const detail = await dRes.json();
      console.log(`\n  ${c.id} — ${Math.floor(durationSec(c) / 60)}m ${durationSec(c) % 60}s`);
      console.log(`  type:        ${detail.type}`);
      console.log(`  caller:      ${detail.customer?.number}`);
      console.log(`  phone line:  ${detail.phoneNumber?.number}`);
      console.log(`  destination: ${detail.destination?.number} (${detail.destination?.type})`);
      console.log(`  endedReason: ${detail.endedReason}`);
      console.log(`  cost: $${(detail.cost || 0).toFixed(2)}`);
      console.log(`  transcript first 800 chars:`);
      const t = (detail.transcript || "").slice(0, 800).replace(/\s+/g, " ");
      console.log(`    ${t}`);
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
