/**
 * attribution-backfill.mts - the calibrated matcher over every call the engine never linked
 * (job 2026-10-25-attribution-self-learning, PR 3).
 *
 * DRY RUN (default, SELECT only): prints the measured hit rate per band with its count
 * (the same read the cron and the card use), the backfill universe per band for 90 days and
 * all time (calls, distinct invoices after collapsing repeat calls, invoice total), what the
 * current gate would auto-confirm, and the exact one-liner that writes. Never a name or phone.
 *
 * EXECUTE (`--execute`, only after Nour's go for that run): backs up revenue_attribution_decisions
 * to _bak_revenue_attribution_decisions_backfill_<yyyymmdd> (CREATE ... LIKE, INSERT ... SELECT,
 * counts compared), then runs ONE revenue reconciliation over all time (since 2026-05-01, the
 * oldest call, 14-day horizon). That run writes candidate rows for every call and, through the
 * same auto-confirm step the cron uses, one confirmed ruling per invoice for each band that is
 * open. Nothing else writes. The dry-run branch never imports the writer.
 *
 * Run from apps/nickstire (Railway-linked):
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attribution-backfill.mts
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attribution-backfill.mts --execute
 */
import mysql from "mysql2/promise";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { calibrationWords } from "../server/lib/attributionCalibration";
import { bandOf } from "../server/lib/attributionConfidenceBands";
import { collapseByInvoice } from "../server/lib/attributionDedupe";
import { loadCalibration } from "../server/services/attributionAutoConfirm";
import { buildCallInvoiceCandidates } from "../server/services/revenueAttribution";

const EXECUTE = process.argv.includes("--execute");
const SINCE = new Date("2026-05-01T00:00:00Z");
const MAX_DAYS = 14;
const DAY = 86_400_000;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set; refusing to guess a target.");
  process.exit(1);
}
const parsed = new URL(url);
console.log(`DB host : ${parsed.hostname}`);
console.log(`DB name : ${parsed.pathname.replace(/^\//, "")}`);
console.log(`mode    : ${EXECUTE ? "EXECUTE (backup, then one all-time reconciliation run)" : "DRY RUN (SELECT only, allowlisted)"}\n`);

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const dialect = new MySqlDialect();
const WRITE_VERB = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE)\b/i;

async function select<T>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*SELECT\b/i.test(text) || WRITE_VERB.test(text)) throw new Error(`refused: not a SELECT: ${text.slice(0, 60)}`);
  const [rows] = await conn.query(text, params);
  return rows as T[];
}
/** The loader takes a drizzle-shaped db; this one renders the template and allows SELECT only. */
const readOnlyDb = {
  execute: async (q: SQL) => {
    const { sql, params } = dialect.sqlToQuery(q);
    return select(sql, params);
  },
};

try {
  const cal = await loadCalibration(readOnlyDb);
  const words = calibrationWords(cal);
  console.log("MEASURED (the gate the cron and the card use)");
  for (const b of ["weak", "strong"] as const) {
    const x = cal.bands[b];
    console.log(`  ${b.padEnd(6)} right ${x.right} / ${x.n}${x.precision == null ? " (UNKNOWN, under 20)" : ` = ${(x.precision * 100).toFixed(1)}%`} · open: ${x.open} · human ${x.human.confirmed}/${x.human.rejected}/${x.human.ambiguous} (confirmed/rejected/ambiguous) · recorded links ${x.recordedLink.right}/${x.recordedLink.wrong} (right/wrong)`);
  }
  console.log(`  inputs: ${cal.inputs.humanRulings} human rulings, ${cal.inputs.recordedLinks} recorded links (${cal.inputs.linksScored} scored, ${cal.inputs.linksNoClaim} no single claim, ${cal.inputs.linksMissingCall} call missing); auto rulings refused ${cal.refusedAuto}`);
  console.log(`  ${words.weak}`);
  console.log(`  ${words.control}\n`);

  const calls = await select<{ callId: number; phoneNumber: string | null; leadId: number | null; serviceMention: string | null; occurredAt: Date }>(
    "SELECT id AS callId, phoneNumber, leadId, serviceMention, createdAt AS occurredAt FROM vapi_call_logs",
  );
  const paid = await select<{ invoiceId: number; customerPhone: string | null; customerId: number | null; serviceDescription: string | null; paidAt: Date; amountCents: number }>(
    "SELECT id AS invoiceId, customerPhone, customerId, serviceDescription, invoiceDate AS paidAt, totalAmount AS amountCents FROM invoices WHERE paymentStatus = 'paid'",
  );
  const leads = await select<{ leadId: number; invoiceId: number | null }>("SELECT id AS leadId, invoiceId FROM leads");
  const decided = new Set((await select<{ callId: number }>("SELECT call_id AS callId FROM revenue_attribution_decisions WHERE current_slot = 1")).map((r) => Number(r.callId)));
  const confirmedInvoices = new Set((await select<{ invoiceId: number }>("SELECT invoice_id AS invoiceId FROM revenue_attribution_decisions WHERE current_slot = 1 AND decision = 'confirmed' AND invoice_id IS NOT NULL")).map((r) => Number(r.invoiceId)));
  const paidById = new Map(paid.map((i) => [i.invoiceId, i]));
  const callById = new Map(calls.map((c) => [c.callId, c]));

  const all = buildCallInvoiceCandidates({ calls, paidInvoices: paid, leadLinks: leads, maxDays: MAX_DAYS });
  const open = all.filter((r) => !decided.has(r.callId) && (r.invoiceId == null || !confirmedInvoices.has(r.invoiceId)));

  const report = (label: string, rows: typeof all) => {
    console.log(`${label}: ${rows.length} calls with no current ruling`);
    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.resolution === "attributed" ? "recorded link" : r.resolution === "manual_review" ? (bandOf(r.confidence) === "strong" ? "phone+time+service" : "phone+time") : r.resolution;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
    }
    let wouldConfirmInvoices = 0;
    let wouldConfirmCents = 0;
    for (const [key, group] of [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const collapsed = collapseByInvoice(group.map((r, i) => ({ id: i, callId: r.callId, invoiceId: r.invoiceId, confidence: r.confidence, resolution: r.resolution, createdAt: callById.get(r.callId)?.occurredAt ?? new Date(0) })));
      const invoices = collapsed.primary.filter((p) => p.invoiceId != null);
      const cents = invoices.reduce((s, p) => s + (paidById.get(p.invoiceId!)?.amountCents ?? 0), 0);
      const band = key === "phone+time" ? "weak" : key === "phone+time+service" ? "strong" : null;
      const gateOpen = band ? cal.bands[band].open : false;
      if (gateOpen) { wouldConfirmInvoices += invoices.length; wouldConfirmCents += cents; }
      console.log(`  ${key.padEnd(20)} calls ${String(group.length).padStart(5)}  distinct invoices ${String(invoices.length).padStart(5)}  total $${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}${band ? (gateOpen ? "  <- gate OPEN: would auto-confirm" : "  <- gate closed: stays manual") : ""}`);
    }
    console.log(`  would auto-confirm now: ${wouldConfirmInvoices} invoices, $${(wouldConfirmCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}\n`);
  };
  report("ALL TIME", open);
  const since90 = Date.now() - 90 * DAY;
  report("LAST 90 DAYS", open.filter((r) => (callById.get(r.callId)?.occurredAt.getTime() ?? 0) >= since90));

  if (!EXECUTE) {
    console.log("DRY RUN ONLY. Nothing was written. The write, after Nour's go for this run:");
    console.log("  railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/attribution-backfill.mts --execute");
    await conn.end();
    process.exit(0);
  }

  // ---- EXECUTE: backup first, then one all-time reconciliation run through the production code path ----
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const bak = `_bak_revenue_attribution_decisions_backfill_${stamp}`;
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${bak}\` LIKE revenue_attribution_decisions`);
  await conn.query(`INSERT IGNORE INTO \`${bak}\` SELECT * FROM revenue_attribution_decisions`);
  const [[src]] = await conn.query("SELECT COUNT(*) AS n FROM revenue_attribution_decisions") as unknown as [[{ n: number }]];
  const [[dst]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${bak}\``) as unknown as [[{ n: number }]];
  console.log(`backup ${bak}: ${dst.n} rows (source ${src.n})`);
  if (Number(dst.n) < Number(src.n)) throw new Error("backup row count under the source count; aborting before any write");
  await conn.end();

  const { runRevenueReconciliation } = await import("../server/services/revenueReconciliation");
  const result = await runRevenueReconciliation({ since: SINCE, until: new Date(), maxDays: MAX_DAYS });
  console.log(`run ${result.runId}: ${result.callsScanned} calls scanned, ${result.verified} verified, ${result.inferred} review, ${result.ambiguous} ambiguous, ${result.unmatched} unmatched, ${result.decisionsPreserved} preserved`);
  console.log(`auto-confirm ${result.autoConfirm.status}: ${result.autoConfirm.confirmed} confirmed of ${result.autoConfirm.eligible} eligible, ${result.autoConfirm.skipped} skipped${result.autoConfirm.error ? ` (${result.autoConfirm.error})` : ""}`);
  console.log(`rollback (one statement, run by Nour): delete the auto rulings this run wrote: WHERE decided_by = 'auto:calibration-v1' AND JSON_UNQUOTE(JSON_EXTRACT(evidence_json, '$.queuedRunId')) = '${result.runId}'; the backup table holds the prior state.`);
  process.exit(0);
} catch (e) {
  console.error("failed:", e instanceof Error ? e.message : String(e));
  await conn.end().catch(() => undefined);
  process.exit(1);
}
