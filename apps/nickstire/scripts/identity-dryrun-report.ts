/**
 * Identity dry-run report (Autopilot Wave 4, mission P2 mandate:
 * "Backfill using a dry-run report first. Do not execute production merges
 * automatically.")
 *
 * READ-ONLY BY CONSTRUCTION: SELECTs only — no INSERT/UPDATE/DELETE/DDL
 * anywhere in this file. Scans distinct customer phones and classifies each
 * with the same rule the runtime uses (classifyIdentity), then prints the
 * verdict distribution + masked examples of ambiguous/conflicted phones.
 * This is the evidence that decides whether a STORED link graph (v2) is
 * worth building, and at what collision scale.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/identity-dryrun-report.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";
import { classifyIdentity, firstNameToken } from "../server/services/identityResolution";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

function mask(p: string): string {
  return `***-${p.slice(-4)}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!url.startsWith("mysql://")) throw new Error("mysql:// DATABASE_URL required (nickstire TiDB) — refusing.");
  const c = await mysql.createConnection(url);
  try {
    // Every normalized last-10 phone appearing on a customer row.
    const [custRows] = await c.query<mysql.RowDataPacket[]>(`
      SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) AS p,
             COUNT(*) AS n,
             GROUP_CONCAT(DISTINCT CONCAT_WS(' ', firstName, lastName) SEPARATOR '|') AS names,
             MAX(smsOptOut) AS anyOptOut
      FROM customers
      WHERE phone IS NOT NULL AND phone != ''
      GROUP BY p
      HAVING LENGTH(p) = 10
    `);

    // Recent non-customer names per phone (leads + bookings, 180d).
    const [signalRows] = await c.query<mysql.RowDataPacket[]>(`
      SELECT p, GROUP_CONCAT(DISTINCT name SEPARATOR '|') AS names FROM (
        SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) AS p, name
        FROM leads
        WHERE phone IS NOT NULL AND createdAt >= DATE_SUB(NOW(), INTERVAL 180 DAY) AND source != 'careers'
        UNION ALL
        SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), 10) AS p, name
        FROM bookings
        WHERE phone IS NOT NULL AND createdAt >= DATE_SUB(NOW(), INTERVAL 180 DAY)
      ) u
      GROUP BY p
      HAVING LENGTH(p) = 10
    `);
    const signalsByPhone = new Map<string, string[]>();
    for (const r of signalRows) {
      signalsByPhone.set(String(r.p), String(r.names ?? "").split("|").filter(Boolean));
    }

    const dist = { resolved: 0, ambiguous: 0, conflicted: 0 };
    const ambiguousExamples: string[] = [];
    const conflictedExamples: string[] = [];

    for (const r of custRows) {
      const phone = String(r.p);
      const names = String(r.names ?? "").split("|").filter(Boolean);
      const matches = Array.from({ length: Number(r.n) }, (_, i) => ({
        id: i + 1, // ids irrelevant for classification counts
        name: names[Math.min(i, names.length - 1)] ?? null,
        optOut: Number(r.anyOptOut) === 1,
      }));
      const verdict = classifyIdentity({
        customerMatches: matches,
        recentNonCustomerNames: signalsByPhone.get(phone) ?? [],
      }).verdict;
      if (verdict === "resolved") dist.resolved++;
      else if (verdict === "ambiguous") {
        dist.ambiguous++;
        if (ambiguousExamples.length < 10) {
          ambiguousExamples.push(`${mask(phone)} · ${Number(r.n)} customers · names: ${names.map(firstNameToken).join(", ")}`);
        }
      } else if (verdict === "conflicted") {
        dist.conflicted++;
        if (conflictedExamples.length < 10) {
          const sig = (signalsByPhone.get(phone) ?? []).map(firstNameToken).join(", ");
          conflictedExamples.push(`${mask(phone)} · customer: ${firstNameToken(names[0])} vs recent: ${sig}`);
        }
      }
    }

    // Phones with leads/bookings but NO customer row = unresolved pool.
    let unresolved = 0;
    const custPhones = new Set(custRows.map((r) => String(r.p)));
    for (const p of signalsByPhone.keys()) if (!custPhones.has(p)) unresolved++;

    const total = custRows.length;
    const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "n/a");
    console.log(`# Identity dry-run report · ${new Date().toISOString().slice(0, 10)}`);
    console.log(`\nCustomer-phone universe: ${total} distinct phones`);
    console.log(`- resolved:   ${dist.resolved} (${pct(dist.resolved)})`);
    console.log(`- ambiguous:  ${dist.ambiguous} (${pct(dist.ambiguous)}) — 2+ customer rows share the phone`);
    console.log(`- conflicted: ${dist.conflicted} (${pct(dist.conflicted)}) — recent lead/booking name disagrees`);
    console.log(`- unresolved pool (lead/booking phones with NO customer row, 180d): ${unresolved}`);
    if (ambiguousExamples.length) {
      console.log(`\nAmbiguous examples (masked):`);
      for (const e of ambiguousExamples) console.log(`  - ${e}`);
    }
    if (conflictedExamples.length) {
      console.log(`\nConflicted examples (masked):`);
      for (const e of conflictedExamples) console.log(`  - ${e}`);
    }
    console.log(`\nNo writes were performed. v2 (stored link graph w/ manual merge/undo) is justified only if ambiguous+conflicted is material at this scale.`);
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error("identity-dryrun-report FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
