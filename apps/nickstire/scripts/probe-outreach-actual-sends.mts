const { db } = await import("../server/lib/db-helper");
const d = await db(); if (!d) { console.log("db unavailable"); process.exit(1); }
const { sql } = await import("drizzle-orm");
const q = async (x: any) => { const r: any = await d.execute(x); return (Array.isArray(r) ? r[0] : r?.rows ?? r) as any[]; };

console.log("\n=== OUTBOUND SMS actually sent, last 30d ===");
console.table(await q(sql`
  SELECT status, COUNT(*) AS n, MAX(createdAt) AS latest
  FROM sms_messages
  WHERE direction='outbound' AND createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
  GROUP BY status ORDER BY n DESC
`));

console.log("=== outbound SMS per week, last 8 weeks ===");
console.table(await q(sql`
  SELECT YEARWEEK(createdAt,3) AS wk, COUNT(*) AS outbound
  FROM sms_messages WHERE direction='outbound' AND createdAt > DATE_SUB(NOW(), INTERVAL 56 DAY)
  GROUP BY wk ORDER BY wk DESC
`));

console.log("=== ELIGIBLE winback candidates (no invoice in 180d) ===");
console.table(await q(sql`
  SELECT COUNT(*) AS dormant_with_phone FROM (
    SELECT RIGHT(REGEXP_REPLACE(customerPhone,'[^0-9]',''),10) AS ph, MAX(createdAt) AS last_seen
    FROM invoices WHERE customerPhone IS NOT NULL AND customerPhone <> ''
      AND LENGTH(REGEXP_REPLACE(customerPhone,'[^0-9]','')) >= 10
    GROUP BY ph) t
  WHERE last_seen < DATE_SUB(NOW(), INTERVAL 180 DAY)
`));

console.log("=== invoices last 30d (review-request candidates) ===");
console.table(await q(sql`
  SELECT COUNT(*) AS invoices_30d,
         SUM(CASE WHEN customerPhone IS NOT NULL AND customerPhone <> '' THEN 1 ELSE 0 END) AS with_phone
  FROM invoices WHERE createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
`));
process.exit(0);
