const { db } = await import("../server/lib/db-helper");
const d = await db(); if (!d) { console.log("db unavailable"); process.exit(1); }
const { sql } = await import("drizzle-orm");
const q = async (x: any) => { const r: any = await d.execute(x); return (Array.isArray(r) ? r[0] : r?.rows ?? r) as any[]; };
console.log("\n=== winback_sends: has this engine EVER sent? ===");
console.table(await q(sql`SELECT COUNT(*) AS sends, MIN(createdAt) AS first_ever, MAX(createdAt) AS last_ever FROM winback_sends`));
console.log("=== winback_campaigns by status ===");
console.table(await q(sql`SELECT status, COUNT(*) AS n, MAX(createdAt) AS latest FROM winback_campaigns GROUP BY status`));
process.exit(0);
