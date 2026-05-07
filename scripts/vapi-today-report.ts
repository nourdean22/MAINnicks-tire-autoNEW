/**
 * Pulls today's VAPI call activity + cross-references nickstire DB
 * outputs (callback_requests + bookings created via VAPI).
 *
 * Usage: pnpm tsx scripts/vapi-today-report.ts
 *
 * Output: a console summary of:
 *   - total VAPI calls today (from VAPI API)
 *   - inbound vs outbound split
 *   - duration stats (avg, total)
 *   - end reasons breakdown
 *   - tool calls invoked (escalate / bookSlot / quoteRange / etc.)
 *   - DB cross-ref: callbacks + bookings created today
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { callbackRequests, bookings } from "../drizzle/schema";
import { gte, sql } from "drizzle-orm";

const VAPI_KEY = process.env.VAPI_API_KEY;
if (!VAPI_KEY) {
  console.error("VAPI_API_KEY not set in env. Aborting.");
  process.exit(1);
}

async function fetchVapiCalls() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const iso = startOfToday.toISOString();

  const url = `https://api.vapi.ai/call?createdAtGe=${encodeURIComponent(iso)}&limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${VAPI_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VAPI API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<Array<Record<string, unknown>>>;
}

function fmtDuration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`\n═══ VAPI Report for ${today.toDateString()} ═══\n`);

  // ─── VAPI side ────────────────────────────────────────
  console.log("Fetching from VAPI API...");
  let vapiCalls: Array<Record<string, unknown>> = [];
  try {
    vapiCalls = await fetchVapiCalls();
  } catch (err) {
    console.log(`  ✗ VAPI API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`\n┌── VAPI side (today: ${today.toDateString()}) ──`);
  console.log(`│  Total calls:        ${vapiCalls.length}`);

  if (vapiCalls.length > 0) {
    const inbound = vapiCalls.filter((c) => c.type === "inboundPhoneCall").length;
    const outbound = vapiCalls.filter((c) => c.type === "outboundPhoneCall").length;
    const webCalls = vapiCalls.filter((c) => c.type === "webCall").length;
    console.log(`│  Inbound (phone):    ${inbound}`);
    console.log(`│  Outbound (phone):   ${outbound}`);
    if (webCalls > 0) console.log(`│  Web calls:          ${webCalls}`);

    const durations = vapiCalls
      .map((c) => {
        const start = c.startedAt ? new Date(c.startedAt as string).getTime() : 0;
        const end = c.endedAt ? new Date(c.endedAt as string).getTime() : 0;
        return start && end ? (end - start) / 1000 : 0;
      })
      .filter((d) => d > 0);
    if (durations.length > 0) {
      const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
      const total = durations.reduce((s, d) => s + d, 0);
      console.log(`│  Avg duration:       ${fmtDuration(avg)}`);
      console.log(`│  Total talk time:    ${fmtDuration(total)}`);
    }

    const endReasons: Record<string, number> = {};
    for (const c of vapiCalls) {
      const r = (c.endedReason as string) || "unknown";
      endReasons[r] = (endReasons[r] || 0) + 1;
    }
    console.log(`│  End reasons:`);
    for (const [reason, count] of Object.entries(endReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`│    ${reason.padEnd(30)} ${count}`);
    }

    // Show last 5 calls with brief summary
    console.log(`│`);
    console.log(`│  Recent calls (last 5):`);
    const sorted = [...vapiCalls].sort((a, b) =>
      new Date((b.createdAt as string) || 0).getTime() -
      new Date((a.createdAt as string) || 0).getTime(),
    );
    for (const c of sorted.slice(0, 5)) {
      const time = new Date(c.createdAt as string).toLocaleTimeString();
      const dur = c.startedAt && c.endedAt
        ? fmtDuration((new Date(c.endedAt as string).getTime() - new Date(c.startedAt as string).getTime()) / 1000)
        : "—";
      const reason = (c.endedReason as string) || "?";
      const phone = ((c.customer as Record<string, unknown>)?.number as string) || "?";
      console.log(`│    ${time}  ${dur.padStart(7)}  ${reason.padEnd(20)} ${phone}`);
    }
  }
  console.log(`└──`);

  // ─── DB-side cross-reference ──────────────────────────
  const db = await getDb();
  if (!db) {
    console.log("\n┌── DB cross-reference ──");
    console.log("│  ✗ DB not available — skipping callback + booking lookup");
    console.log("└──");
    process.exit(0);
  }

  const callbacksToday = await db
    .select({ count: sql<number>`count(*)` })
    .from(callbackRequests)
    .where(gte(callbackRequests.createdAt, today));
  const bookingsToday = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(gte(bookings.createdAt, today));

  console.log(`\n┌── DB cross-reference (today: ${today.toDateString()}) ──`);
  console.log(`│  Callbacks created:  ${callbacksToday[0]?.count ?? 0}`);
  console.log(`│  Bookings created:   ${bookingsToday[0]?.count ?? 0}`);
  console.log(`│  (subset of these may have come from VAPI escalate/bookSlot tools)`);
  console.log(`└──\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Report crashed:", err);
  process.exit(1);
});
