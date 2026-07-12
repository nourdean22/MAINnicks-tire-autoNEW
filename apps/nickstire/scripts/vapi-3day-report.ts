import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { getDb } from "../server/db";
import { callbackRequests, bookings, leads } from "../drizzle/schema";
import { gte, and, like, sql } from "drizzle-orm";

// Load from apps/nickstire/.env and also monorepo root .env
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const VAPI_KEY = process.env.VAPI_API_KEY;
if (!VAPI_KEY) {
  console.error("VAPI_API_KEY not set in env. Aborting.");
  process.exit(1);
}

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";
const PER_PAGE = 100;

interface VapiCall {
  id: string;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  cost?: number;
  type?: string;
  customer?: { number?: string };
  transcript?: string;
  analysis?: {
    summary?: string;
    structuredData?: Record<string, unknown>;
    successEvaluation?: string;
  };
  messages?: Array<{ role: string; message?: string; toolCalls?: Array<{ name: string; arguments?: unknown }> }>;
}

function fmtDuration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getLocalDateString(dateStr: string | Date) {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

function getLocalTimeString(dateStr: string | Date) {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function main() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  cutoff.setHours(0, 0, 0, 0); // Start of local day 3 days ago
  const isoGe = cutoff.toISOString();

  console.log(`\n=== Pulling VAPI Calls since ${getLocalDateString(cutoff)} (America/New_York) ===`);

  // Fetch VAPI Calls since cutoff
  let allCalls: VapiCall[] = [];
  let createdAtLt: string | null = null;
  while (allCalls.length < 500) {
    const params = new URLSearchParams({
      assistantId: ASSISTANT_ID,
      limit: String(PER_PAGE),
      createdAtGe: isoGe,
    });
    if (createdAtLt) params.set("createdAtLt", createdAtLt);

    const res = await fetch(`${VAPI_BASE}/call?${params.toString()}`, {
      headers: { Authorization: `Bearer ${VAPI_KEY}` },
    });
    if (!res.ok) {
      console.error(`Fetch failed: ${res.status} ${await res.text()}`);
      break;
    }
    const page = (await res.json()) as VapiCall[];
    if (page.length === 0) break;

    allCalls.push(...page);

    const oldest = page[page.length - 1];
    if (!oldest.createdAt) break;
    createdAtLt = oldest.createdAt;

    if (page.length < PER_PAGE) break;
  }

  console.log(`Fetched ${allCalls.length} calls from VAPI API.`);

  // DB cross-reference
  let dbBookingsList: any[] = [];
  let dbLeadsList: any[] = [];
  let dbCallbacksList: any[] = [];
  const db = await getDb();
  if (db) {
    console.log("Querying database for VAPI-attributed entries...");
    dbBookingsList = await db.select()
      .from(bookings)
      .where(and(gte(bookings.createdAt, cutoff), like(bookings.message, "[VOICE-AGENT]%")));
    
    dbLeadsList = await db.select()
      .from(leads)
      .where(and(gte(leads.createdAt, cutoff), like(leads.problem, "[VOICE-AGENT]%")));

    dbCallbacksList = await db.select()
      .from(callbackRequests)
      .where(and(gte(callbackRequests.createdAt, cutoff), like(callbackRequests.context, "[VOICE-AGENT%")));
  } else {
    console.warn("DB not available, skipping cross-reference query.");
  }

  // Process and Aggregate VAPI Calls
  const callsByDay: Record<string, VapiCall[]> = {};
  // Initialize last 3 days + today in map to ensure we have keys even if empty
  const datesToShow: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d);
    datesToShow.push(dateStr);
    callsByDay[dateStr] = [];
  }

  for (const c of allCalls) {
    if (!c.createdAt) continue;
    const dateStr = getLocalDateString(c.createdAt);
    if (!callsByDay[dateStr]) {
      callsByDay[dateStr] = [];
    }
    callsByDay[dateStr].push(c);
  }

  // Process DB actions by day
  const bookingsByDay: Record<string, typeof dbBookingsList> = {};
  const leadsByDay: Record<string, typeof dbLeadsList> = {};
  const callbacksByDay: Record<string, typeof dbCallbacksList> = {};
  
  datesToShow.forEach(dateStr => {
    bookingsByDay[dateStr] = [];
    leadsByDay[dateStr] = [];
    callbacksByDay[dateStr] = [];
  });

  dbBookingsList.forEach(b => {
    const dateStr = getLocalDateString(b.createdAt);
    if (bookingsByDay[dateStr]) bookingsByDay[dateStr].push(b);
  });
  dbLeadsList.forEach(l => {
    const dateStr = getLocalDateString(l.createdAt);
    if (leadsByDay[dateStr]) leadsByDay[dateStr].push(l);
  });
  dbCallbacksList.forEach(c => {
    const dateStr = getLocalDateString(c.createdAt);
    if (callbacksByDay[dateStr]) callbacksByDay[dateStr].push(c);
  });

  // Global aggregate metrics
  const totalCalls = allCalls.length;
  const inboundCount = allCalls.filter(c => c.type === "inboundPhoneCall").length;
  const outboundCount = allCalls.filter(c => c.type === "outboundPhoneCall").length;
  const webCallsCount = allCalls.filter(c => c.type === "webCall").length;

  const durations = allCalls
    .map(c => {
      const start = c.startedAt ? new Date(c.startedAt).getTime() : 0;
      const end = c.endedAt ? new Date(c.endedAt).getTime() : 0;
      return start && end ? (end - start) / 1000 : 0;
    })
    .filter(d => d > 0);
  const avgDuration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const totalDuration = durations.reduce((s, d) => s + d, 0);
  const totalCost = allCalls.reduce((s, c) => s + (c.cost || 0), 0);

  const endReasons: Record<string, number> = {};
  for (const c of allCalls) {
    const r = c.endedReason || "unknown";
    endReasons[r] = (endReasons[r] || 0) + 1;
  }

  const toolHits: Record<string, number> = {};
  for (const c of allCalls) {
    const tcList = (c.messages || []).flatMap(m => m.toolCalls || []);
    for (const tc of tcList) {
      const name = tc.function?.name || tc.name || "unknown";
      toolHits[name] = (toolHits[name] || 0) + 1;
    }
  }

  // Generate Markdown
  let md = `# VAPI Calls & Leads 3-Day Report
- **Period:** ${getLocalDateString(cutoff)} to ${getLocalDateString(new Date())} (Last 3 days + today)
- **Assistant ID:** \`${ASSISTANT_ID}\`

## Summary Metrics (All Calls)
- **Total Calls:** ${totalCalls}
- **Inbound Calls:** ${inboundCount}
- **Outbound Calls:** ${outboundCount}
- **Web Calls:** ${webCallsCount}
- **Average Duration:** ${fmtDuration(avgDuration)}
- **Total Talk Time:** ${fmtDuration(totalDuration)}
- **Total Cost:** $${totalCost.toFixed(2)}

## Daily Activity Breakdown
| Date | Total Calls | Inbound | Outbound | Bookings | Tire Inquiries | Rack Checks | Callbacks |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${datesToShow.map(dateStr => {
  const dayCalls = callsByDay[dateStr] || [];
  const dayInbound = dayCalls.filter(c => c.type === "inboundPhoneCall").length;
  const dayOutbound = dayCalls.filter(c => c.type === "outboundPhoneCall").length;
  const dayB = bookingsByDay[dateStr]?.length || 0;
  const dayL = leadsByDay[dateStr] || [];
  const dayInquiries = dayL.filter(l => l.problem?.includes("TIRE INQUIRY")).length;
  const dayRack = dayL.filter(l => l.problem?.includes("RACK CHECK")).length;
  const dayC = callbacksByDay[dateStr]?.length || 0;
  return `| ${dateStr} | ${dayCalls.length} | ${dayInbound} | ${dayOutbound} | ${dayB} | ${dayInquiries} | ${dayRack} | ${dayC} |`;
}).join("\n")}

## Call End Reasons
| Reason | Count | Percentage |
| :--- | :---: | :---: |
${Object.entries(endReasons)
  .sort((a, b) => b[1] - a[1])
  .map(([reason, count]) => `| ${reason} | ${count} | ${((count / (totalCalls || 1)) * 100).toFixed(1)}% |`)
  .join("\n")}

## Tool Invocations
| Tool Name | Times Invoked |
| :--- | :---: |
${Object.entries(toolHits)
  .sort((a, b) => b[1] - a[1])
  .map(([tool, count]) => `| \`${tool}\` | ${count} |`)
  .join("\n")}

## Recent Calls Detail (Last 15 Calls)
| Time (ET) | Duration | Caller | Reason | Summary | Tool Calls |
| :--- | :---: | :---: | :---: | :--- | :--- |
${allCalls.slice(0, 15).map(c => {
  const timeStr = c.createdAt ? `${getLocalDateString(c.createdAt)} ${getLocalTimeString(c.createdAt)}` : "—";
  const dur = c.startedAt && c.endedAt ? fmtDuration((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000) : "—";
  const phone = c.customer?.number || "—";
  const reason = c.endedReason || "—";
  const summary = c.analysis?.summary?.replace(/\r?\n/g, " ") || "—";
  const tools = (c.messages || []).flatMap(m => m.toolCalls || []).map(t => t.function?.name || t.name).join(", ") || "—";
  return `| ${timeStr} | ${dur} | ${phone} | ${reason} | ${summary} | ${tools} |`;
}).join("\n")}

## DB Attributed Captures Detail (Last 3 Days)
### Bookings Created via Voice Agent
| Date/Time (ET) | Customer Name | Phone | Service | Vehicle | Message |
| :--- | :--- | :---: | :--- | :--- | :--- |
${dbBookingsList.length === 0 ? "| — | — | — | — | — | — |" : dbBookingsList.map(b => {
  const timeStr = `${getLocalDateString(b.createdAt)} ${getLocalTimeString(b.createdAt)}`;
  return `| ${timeStr} | ${b.name} | ${b.phone} | ${b.service} | ${b.vehicle || "—"} | ${b.message?.replace(/\r?\n/g, " ") || "—"} |`;
}).join("\n")}

### Tire Inquiries & Rack Checks
| Date/Time (ET) | Customer Name | Phone | Inquiry Type | Vehicle | Details |
| :--- | :--- | :---: | :--- | :--- | :--- |
${dbLeadsList.length === 0 ? "| — | — | — | — | — | — |" : dbLeadsList.map(l => {
  const timeStr = `${getLocalDateString(l.createdAt)} ${getLocalTimeString(l.createdAt)}`;
  const type = l.problem?.includes("RACK CHECK") ? "Rack Check" : "Tire Inquiry";
  return `| ${timeStr} | ${l.name} | ${l.phone} | ${type} | ${l.vehicle || "—"} | ${l.problem?.replace(/\r?\n/g, " ") || "—"} |`;
}).join("\n")}

### Callbacks Requested
| Date/Time (ET) | Customer Name | Phone | Context |
| :--- | :--- | :---: | :--- |
${dbCallbacksList.length === 0 ? "| — | — | — | — |" : dbCallbacksList.map(cb => {
  const timeStr = `${getLocalDateString(cb.createdAt)} ${getLocalTimeString(cb.createdAt)}`;
  return `| ${timeStr} | ${cb.name} | ${cb.phone} | ${cb.context?.replace(/\r?\n/g, " ") || "—"} |`;
}).join("\n")}

---
*Report generated on ${new Date().toLocaleString()}*
`;

  const reportPath = resolve(process.cwd(), "vapi-3day-report.md");
  await fs.promises.writeFile(reportPath, md, "utf8");
  console.log(`Markdown report written to: ${reportPath}`);

  // For validation, let's query all DB writes in last 3 days
  if (db) {
    const [allBookingsCount, allLeadsCount, allCallbacksCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, cutoff)),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, cutoff)),
      db.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(gte(callbackRequests.createdAt, cutoff)),
    ]);
    console.log(`[Validation] Total DB writes in window (all sources): Bookings(${allBookingsCount[0]?.count ?? 0}) Leads(${allLeadsCount[0]?.count ?? 0}) Callbacks(${allCallbacksCount[0]?.count ?? 0})`);
  }

  // Also log summary to console
  console.log("\n=== VAPI 3-Day Report Summary ===");
  console.log(`Total Calls: ${totalCalls}`);
  console.log(`Inbound: ${inboundCount}  ·  Outbound: ${outboundCount}  ·  Web: ${webCallsCount}`);
  console.log(`Avg Duration: ${fmtDuration(avgDuration)}  ·  Total Cost: $${totalCost.toFixed(2)}`);
  console.log(`DB Captures: Bookings(${dbBookingsList.length}) Leads(${dbLeadsList.length}) Callbacks(${dbCallbacksList.length})`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Report crashed:", err);
  process.exit(1);
});
