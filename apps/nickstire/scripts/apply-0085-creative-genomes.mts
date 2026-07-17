/**
 * Hand-apply drizzle/0085_creative_genomes.sql to the database DATABASE_URL
 * points at. The db-migrate runner can mark migrations tracked without
 * executing them (0083/0084 both hit that trap), so genome persistence ships
 * with its own idempotent apply script. Run from apps/nickstire:
 *
 *   pnpm exec tsx scripts/apply-0085-creative-genomes.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const t: any = await db.execute(sql`SHOW TABLES LIKE 'creative_genomes'`);
if ((t[0] as any[]).length > 0) {
  console.log("table creative_genomes: already present, skipping");
} else {
  await db.execute(sql`CREATE TABLE creative_genomes (
    id varchar(64) NOT NULL,
    objective varchar(32) NOT NULL,
    territory varchar(64) NOT NULL,
    campaign_ask text NOT NULL,
    fingerprint varchar(512) NOT NULL,
    genome_json text NOT NULL,
    source varchar(32) NOT NULL DEFAULT 'direct',
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT creative_genomes_id PRIMARY KEY(id)
  )`);
  console.log("table creative_genomes: CREATED");
}

const idx: any = await db.execute(sql`SHOW INDEX FROM creative_genomes WHERE Key_name = 'idx_creative_genomes_created'`);
if ((idx[0] as any[]).length > 0) {
  console.log("index: already present, skipping");
} else {
  await db.execute(sql`CREATE INDEX idx_creative_genomes_created ON creative_genomes (created_at)`);
  console.log("index: CREATED");
}
console.log("done - genome persistence is live");
process.exit(0);
