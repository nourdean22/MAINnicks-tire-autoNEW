/**
 * Delete junk/spam bookings from the database.
 *
 * Criteria for "junk":
 * - Name matches keyboard-mash pattern (e.g., "ghghghghgh", "ddddd", "asdf")
 * - Name is all one character repeated
 * - Name has no vowels and < 4 chars of distinct letters
 * - Name length > 20 and looks like garbage
 *
 * Dry run by default — pass --commit to actually delete.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");

function isJunkName(name: string): boolean {
  if (!name) return true;
  const clean = name.trim().toLowerCase();

  // Too short after trimming
  if (clean.length < 3) return true;

  // All same character
  if (new Set(clean).size === 1) return true;

  // Keyboard mash: only 1-3 distinct letters repeating
  const distinctLetters = new Set(clean.replace(/[^a-z]/g, ""));
  if (distinctLetters.size <= 3 && clean.length >= 4) {
    return true;
  }

  // No vowels at all
  if (!/[aeiouy]/.test(clean)) return true;

  // Repeating 2-letter patterns
  if (clean.length >= 6 && /^(..)\1{2,}$/.test(clean)) return true;

  // Single-word greetings masquerading as names
  if (["hello", "hi", "hey", "test", "asdf", "qwerty"].includes(clean)) return true;

  // Contains "test" as a word (e.g., "Test Apr2", "Test Order Nick AI")
  if (/\btest\b/i.test(clean)) return true;

  return false;
}

function isJunkPhone(phone: string | null): boolean {
  if (!phone) return false; // missing phone isn't junk by itself
  const digits = phone.replace(/\D/g, "");
  // All same digit (e.g., 1111111111111)
  if (digits.length > 0 && new Set(digits).size === 1) return true;
  // Repeating pattern (555-555-5555 etc)
  if (digits.length >= 10 && /^(\d{3})\1+$/.test(digits.slice(0, 9))) return true;
  return false;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  console.log("Connected to TiDB");
  console.log(COMMIT ? "\n🔥 COMMIT MODE — will actually delete\n" : "\n👀 DRY RUN — no changes\n");

  // Fetch all recent bookings with names
  const [rows] = await conn.query<any[]>(`
    SELECT id, name, phone, email, service, createdAt
    FROM bookings
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 60 DAY)
    ORDER BY createdAt DESC
  `);

  console.log(`Scanned ${(rows as any[]).length} bookings from last 60 days`);

  const junk: any[] = [];
  const kept: any[] = [];

  for (const r of rows as any[]) {
    if (isJunkName(r.name) || isJunkPhone(r.phone)) {
      junk.push(r);
    } else {
      kept.push(r);
    }
  }

  console.log(`\n=== JUNK (${junk.length}) ===`);
  for (const j of junk) {
    console.log(`  id=${j.id} name="${j.name}" phone=${j.phone || "-"} svc=${j.service || "-"}`);
  }

  console.log(`\n=== KEPT (first 10 of ${kept.length}) ===`);
  for (const k of kept.slice(0, 10)) {
    console.log(`  id=${k.id} name="${k.name}" phone=${k.phone || "-"}`);
  }

  if (COMMIT && junk.length > 0) {
    const ids = junk.map(j => j.id);
    const [result] = await conn.query(
      `DELETE FROM bookings WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    console.log(`\n✓ Deleted ${(result as any).affectedRows} junk bookings`);
  } else if (junk.length > 0) {
    console.log(`\nRun with --commit to delete ${junk.length} junk bookings`);
  } else {
    console.log("\nNo junk bookings found — DB is clean");
  }

  await conn.end();
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
