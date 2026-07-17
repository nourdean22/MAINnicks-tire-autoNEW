/**
 * Hand-apply drizzle/0083_admin_security.sql to the database DATABASE_URL
 * points at.
 *
 * WHY THIS EXISTS: the migration journal lists 0083 as applied, but the DDL
 * never ran against prod (verified 2026-07-17: none of the four columns exist
 * on `users`, and every adminSecurity.* call 500s on
 * "SELECT adminRole ... FROM users"). The db-migrate runner can mark a
 * migration tracked without executing it — same trap 0084 hit.
 *
 * Idempotent: each column / the backfill / the index is checked before it is
 * touched, so re-running is safe. Run it from apps/nickstire:
 *
 *   pnpm exec tsx scripts/apply-0083-admin-security.mts
 *
 * DATABASE_URL in apps/nickstire/.env points at PROD — this script is meant
 * to be run deliberately, by the operator.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.error("no database connection (DATABASE_URL unset?)");
  process.exit(1);
}

async function hasColumn(name: string): Promise<boolean> {
  const r: any = await db!.execute(sql`SHOW COLUMNS FROM users WHERE Field = ${name}`);
  return (r[0] as any[]).length > 0;
}

const columns: Array<[string, ReturnType<typeof sql>]> = [
  ["adminRole", sql`ALTER TABLE users ADD COLUMN adminRole enum('owner','manager','front_desk','tech','accountant','viewer') NULL AFTER role`],
  ["mfaEnabled", sql`ALTER TABLE users ADD COLUMN mfaEnabled boolean NOT NULL DEFAULT false AFTER adminRole`],
  ["mfaSecretEncrypted", sql`ALTER TABLE users ADD COLUMN mfaSecretEncrypted text NULL AFTER mfaEnabled`],
  ["mfaVerifiedAt", sql`ALTER TABLE users ADD COLUMN mfaVerifiedAt timestamp NULL AFTER mfaSecretEncrypted`],
];

for (const [name, ddl] of columns) {
  if (await hasColumn(name)) {
    console.log(`column ${name}: already present, skipping`);
  } else {
    await db.execute(ddl);
    console.log(`column ${name}: ADDED`);
  }
}

const upd: any = await db.execute(sql`UPDATE users SET adminRole = 'owner' WHERE role = 'admin' AND adminRole IS NULL`);
console.log(`backfill owner role: ${upd?.[0]?.affectedRows ?? 0} row(s)`);

const idx: any = await db.execute(sql`SHOW INDEX FROM users WHERE Key_name = 'idx_users_admin_role'`);
if ((idx[0] as any[]).length > 0) {
  console.log("index idx_users_admin_role: already present, skipping");
} else {
  await db.execute(sql`CREATE INDEX idx_users_admin_role ON users (adminRole)`);
  console.log("index idx_users_admin_role: CREATED");
}

const verify: any = await db.execute(sql`SHOW COLUMNS FROM users WHERE Field IN ('adminRole','mfaEnabled','mfaSecretEncrypted','mfaVerifiedAt')`);
console.log("verify columns:", (verify[0] as any[]).map((c: any) => c.Field).join(", "));
console.log("done — adminSecurity.status should return 200 on the next admin load");
process.exit(0);
