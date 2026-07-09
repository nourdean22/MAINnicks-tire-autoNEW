/**
 * DEDUP STEP 3 — verify merge + add (b) the normalized-phone UNIQUE key.
 * The key is the DB-level lock-in: complements the (c) app guard so a
 * "+1216…" can never coexist with a "216…" again. Attempts a STORED generated
 * column; if TiDB rejects the expression, reports + the (c) guard remains the guarantee.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-merge-3-finalize.ts
 */
import mysql from "mysql2/promise";

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  const show = async (label: string, sql: string, params: any[] = []) => {
    const [r] = await conn.query(sql, params);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r, null, 2));
  };
  try {
    await show("VERIFY — total customers", "SELECT COUNT(*) AS total FROM customers");
    await show(
      "VERIFY — phone10 dupes (expect 0)",
      `SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) p10, COUNT(*) c
       FROM customers WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
       GROUP BY p10 HAVING c > 1`,
    );
    await show(
      "VERIFY — sample survivors now single-row (Aaron George / Tina Williams / Mynesha Young)",
      `SELECT id, CONCAT_WS(' ',firstName,lastName) name, phone, phone2,
              NULLIF(CONCAT_WS('-',vehicleYear,vehicleMake,vehicleModel),'--') vehicle
       FROM customers WHERE id IN (381, 497, 318)`,
    );

    // (b) full-column normalized collision check (incl. short/junk rows) BEFORE the key.
    const [coll] = (await conn.query(
      `SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) p10, COUNT(*) c
       FROM customers GROUP BY p10 HAVING c > 1`,
    )) as any;
    if ((coll as any[]).length > 0) {
      console.log("\n=== (b) SKIPPED — normalized collisions exist (would violate the key) ===");
      console.log(JSON.stringify(coll, null, 2));
      return;
    }
    console.log("\n=== (b) no normalized collisions — adding phone_normalized + UNIQUE key ===");
    try {
      // already added? (idempotent)
      const [cols] = (await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_name='customers' AND column_name='phone_normalized'`,
      )) as any;
      if ((cols as any[]).length === 0) {
        await conn.query(
          `ALTER TABLE customers ADD COLUMN phone_normalized VARCHAR(15)
             AS (RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) STORED`,
        );
        console.log("phone_normalized column added.");
      } else {
        console.log("phone_normalized already exists.");
      }
      const [keys] = (await conn.query(
        `SELECT INDEX_NAME FROM information_schema.statistics WHERE table_name='customers' AND index_name='uniq_phone_norm'`,
      )) as any;
      if ((keys as any[]).length === 0) {
        await conn.query(`ALTER TABLE customers ADD UNIQUE KEY uniq_phone_norm (phone_normalized)`);
        console.log("uniq_phone_norm UNIQUE key added. (b) DONE — DB-level dupe prevention locked in.");
      } else {
        console.log("uniq_phone_norm already exists. (b) DONE.");
      }
    } catch (e) {
      console.log("\n=== (b) generated-column/unique-key NOT applied (TiDB rejected the expression) ===");
      console.log(String(e instanceof Error ? e.message : e));
      console.log(">>> Fallback: the (c) import guard normalizes to 10-digit on write + the existing uniq_customer_phone(raw) now effectively enforces 10-digit uniqueness (all phones normalized). New same-person/diff-format dupes are app-prevented. A DB generated-key can be revisited.");
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
