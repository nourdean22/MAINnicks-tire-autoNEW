import "dotenv/config";
import { getDb } from "../../server/db";
import { vapiCallLogs, bookings, callbackRequests, leads } from "../../drizzle/schema";
import { gte, and, sql, desc, like } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";

function fmtDuration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("DB connection not available");
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sinceStr = cutoff.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log(`Querying vapi_call_logs since ${sinceStr}...`);

  const calls = await db
    .select()
    .from(vapiCallLogs)
    .where(gte(vapiCallLogs.createdAt, cutoff))
    .orderBy(desc(vapiCallLogs.createdAt));

  console.log(`Fetched ${calls.length} calls.`);

  // Cross-reference VAPI-attributed DB writes in the same 90 day window
  const [vapiBookings, vapiCallbacks, vapiTireInquiries, vapiRackChecks] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(gte(bookings.createdAt, cutoff), like(bookings.message, "[VOICE-AGENT]%"))),
    db.select({ count: sql<number>`count(*)` })
      .from(callbackRequests)
      .where(and(gte(callbackRequests.createdAt, cutoff), like(callbackRequests.context, "[VOICE-AGENT%"))),
    db.select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(and(gte(leads.createdAt, cutoff), like(leads.problem, "[VOICE-AGENT TIRE INQUIRY]%"))),
    db.select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(and(gte(leads.createdAt, cutoff), like(leads.problem, "[VOICE-AGENT RACK CHECK]%"))),
  ]);

  const bCount = vapiBookings[0]?.count ?? 0;
  const cbCount = vapiCallbacks[0]?.count ?? 0;
  const tiCount = vapiTireInquiries[0]?.count ?? 0;
  const rcCount = vapiRackChecks[0]?.count ?? 0;
  const dbWritesTotal = bCount + cbCount + tiCount + rcCount;

  // Aggregate metrics
  const totalCalls = calls.length;
  let durationSum = 0;
  let durationCount = 0;
  const endedReasons: Record<string, number> = {};
  const evalOutcomes: Record<string, number> = {};
  const serviceMentions: Record<string, number> = {};
  const phoneNumbers: Record<string, number> = {};
  let scoredCount = 0;
  let scoreSum = 0;
  
  // Weekly call volume
  const weeklyVolume: Record<string, number> = {};

  for (const call of calls) {
    const dur = call.durationSeconds;
    if (dur && dur > 0) {
      durationSum += dur;
      durationCount++;
    }
    const reason = call.endedReason || "unknown";
    endedReasons[reason] = (endedReasons[reason] || 0) + 1;

    const outcome = call.evalOutcome || "unknown/unevaluated";
    evalOutcomes[outcome] = (evalOutcomes[outcome] || 0) + 1;

    if (call.evalScore !== null && call.evalScore !== undefined) {
      scoreSum += call.evalScore;
      scoredCount++;
    }

    if (call.serviceMention) {
      const mention = call.serviceMention.toLowerCase().trim();
      serviceMentions[mention] = (serviceMentions[mention] || 0) + 1;
    }

    if (call.phoneNumber) {
      phoneNumbers[call.phoneNumber] = (phoneNumbers[call.phoneNumber] || 0) + 1;
    }

    // Week bucket
    if (call.createdAt) {
      const date = new Date(call.createdAt);
      const day = date.getDay();
      const diff = date.getDate() - day;
      const sunday = new Date(date.setDate(diff));
      const weekKey = sunday.toISOString().slice(0, 10);
      weeklyVolume[weekKey] = (weeklyVolume[weekKey] || 0) + 1;
    }
  }

  const avgDuration = durationCount > 0 ? durationSum / durationCount : 0;
  const avgScore = scoredCount > 0 ? scoreSum / scoredCount : 0;

  // Build Markdown Report
  let md = `# Vapi 90-Day Voice Receptionist Performance Report\n\n`;
  md += `**Date Range:** ${sinceStr} to ${todayStr} (Last 90 Days)\n`;
  md += `**Generated At:** ${new Date().toLocaleString()}\n\n`;

  md += `## 1. Executive Summary\n\n`;
  md += `Over the last 90 days, the AI Voice Receptionist processed a total of **${totalCalls}** calls. `;
  md += `The system successfully converted **${dbWritesTotal}** calls into actionable database events (bookings, callbacks, tire inquiries, or rack checks).\n\n`;

  md += `### Core Metrics Table\n\n`;
  md += `| Metric | Value | Description |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| **Total Calls** | ${totalCalls} | Total voice calls logged locally |\n`;
  md += `| **Total Duration** | ${fmtDuration(durationSum)} | Total active line time |\n`;
  md += `| **Average Call Duration** | ${fmtDuration(avgDuration)} | Average time per call |\n`;
  md += `| **Average Evaluation Score** | ${scoredCount > 0 ? avgScore.toFixed(1) + '/100' : 'N/A'} | Based on ${scoredCount} evaluated calls |\n`;
  md += `| **Total DB Conversions** | ${dbWritesTotal} | Leads/bookings written directly by AI |\n`;
  md += `| **Conversion Rate** | ${totalCalls > 0 ? ((dbWritesTotal / totalCalls) * 100).toFixed(1) + '%' : '0%'} | Percentage of calls leading to a DB write |\n\n`;

  md += `## 2. Weekly Call Volume Trends\n\n`;
  md += `Below is the weekly volume of calls handled by the Voice Receptionist:\n\n`;
  md += `| Week Starting (Sunday) | Call Count | Progress Bar |\n`;
  md += `| :--- | :--- | :--- |\n`;
  
  const sortedWeeks = Object.keys(weeklyVolume).sort();
  const maxWeekly = Math.max(...Object.values(weeklyVolume), 1);
  for (const wk of sortedWeeks) {
    const count = weeklyVolume[wk];
    const barLength = Math.round((count / maxWeekly) * 15);
    const bar = "█".repeat(barLength) + "░".repeat(15 - barLength);
    md += `| ${wk} | ${count} | \`${bar}\` |\n`;
  }
  md += `\n`;

  md += `## 3. Call Outcomes & Quality Evaluations\n\n`;
  md += `### Evaluation Outcome Breakdown\n\n`;
  md += `Calls are automatically evaluated by the daily cron and categorized by quality outcome:\n\n`;
  md += `| Quality Category | Count | Percentage |\n`;
  md += `| :--- | :--- | :--- |\n`;
  for (const [outcome, count] of Object.entries(evalOutcomes).sort((a, b) => b[1] - a[1])) {
    const pct = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(1) + '%' : '0%';
    md += `| **${outcome}** | ${count} | ${pct} |\n`;
  }
  md += `\n`;

  md += `### Call End Reason Distribution\n\n`;
  md += `Why calls were disconnected:\n\n`;
  md += `| End Reason | Count | Percentage |\n`;
  md += `| :--- | :--- | :--- |\n`;
  for (const [reason, count] of Object.entries(endedReasons).sort((a, b) => b[1] - a[1])) {
    const pct = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(1) + '%' : '0%';
    md += `| \`${reason}\` | ${count} | ${pct} |\n`;
  }
  md += `\n`;

  md += `## 4. Service Mentions & Intent Classification\n\n`;
  md += `The AI extracts mentions of specific services during conversations to classify customer intent:\n\n`;
  md += `| Service Mentioned | Count | Percentage of Mentions |\n`;
  md += `| :--- | :--- | :--- |\n`;
  const totalMentions = Object.values(serviceMentions).reduce((a, b) => a + b, 0);
  for (const [mention, count] of Object.entries(serviceMentions).sort((a, b) => b[1] - a[1])) {
    const pct = totalMentions > 0 ? ((count / totalMentions) * 100).toFixed(1) + '%' : '0%';
    md += `| **${mention}** | ${count} | ${pct} |\n`;
  }
  if (totalMentions === 0) {
    md += `| *No service mentions recorded* | 0 | 0% |\n`;
  }
  md += `\n`;

  md += `## 5. VAPI-Attributed Database Conversions\n\n`;
  md += `Actions taken by the Voice Receptionist that resulted in database updates:\n\n`;
  md += `*   **Bookings Created (` + "`bookSlot`" + `):** ${bCount}\n`;
  md += `*   **Tire Inquiries (` + "`tireInquiry`" + `):** ${tiCount}\n`;
  md += `*   **Rack Checks (` + "`checkTireStock`" + `):** ${rcCount}\n`;
  md += `*   **Callback Requests (` + "`escalate/cb`" + `):** ${cbCount} (legacy)\n`;
  md += `*   **Total Conversions:** **${dbWritesTotal}**\n\n`;

  md += `## 6. Top Callers (Phone Numbers)\n\n`;
  md += `Customers with the highest frequency of interactions:\n\n`;
  md += `| Phone Number | Call Count |\n`;
  md += `| :--- | :--- |\n`;
  const sortedPhoneNumbers = Object.entries(phoneNumbers).sort((a, b) => b[1] - a[1]);
  for (const [phone, count] of sortedPhoneNumbers.slice(0, 10)) {
    md += `| ${phone} | ${count} |\n`;
  }
  md += `\n`;

  md += `## 7. Exemplary Call Highlights (Top 5 Evaluated Calls)\n\n`;
  md += `These calls received the highest evaluation scores from the AI:\n\n`;
  md += `| Date | Customer | Score | Outcome | AI Summary |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  const exemplaryCalls = [...calls]
    .filter((c) => c.evalScore !== null)
    .sort((a, b) => (b.evalScore ?? 0) - (a.evalScore ?? 0));
  for (const c of exemplaryCalls.slice(0, 5)) {
    const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—';
    md += `| ${dateStr} | ${c.customerName || 'Unknown'} | **${c.evalScore}** | ${c.evalOutcome || '—'} | ${c.aiSummary || 'No summary'} |\n`;
  }
  if (exemplaryCalls.length === 0) {
    md += `| *No evaluated calls found* | | | | |\n`;
  }

  // Print report to console
  console.log("\n" + md);

  // Write to Artifact Directory
  const artifactPath = "C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\c0498d16-ad29-4d16-8279-8ecd26b65ef1\\vapi_90d_report.md";
  try {
    const dir = dirname(artifactPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(artifactPath, md, "utf8");
    console.log(`\n✓ Saved report artifact to: ${artifactPath}`);
  } catch (err) {
    console.error("Failed to write report artifact:", err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
