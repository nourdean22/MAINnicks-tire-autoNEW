/**
 * Reel-job failure taxonomy — READ-ONLY (pure SELECT). The baseline measured
 * a 94% job failure rate (59/63); this classifies WHY so fixes target the
 * dominant classes instead of anecdotes.
 *
 * Run from apps/nickstire:  pnpm exec tsx scripts/probe-reel-failures.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const res: unknown = await db.execute(sql`SELECT * FROM reel_jobs WHERE status = 'failed'`);
const rows = (res as [Array<{ id: number; status: string; error: string | null }>, unknown])[0] ?? [];

function classify(error: string | null): string {
  const e = (error ?? "").toLowerCase();
  if (!e) return "no_error_recorded";
  if (/voiceover|tts provider|elevenlabs|google.*tts|voice/.test(e)) return "voiceover";
  if (/higgsfield|seedance|generation failed|provider|credits|quota|401|403/.test(e)) return "provider_generation";
  if (/durable storage|s3_bucket|ephemeral/.test(e)) return "storage_precondition";
  if (/ffmpeg|assembly|assemble|render integrity|frozen|filtergraph|audio integrity/.test(e)) return "assembly_render";
  if (/download|fetch|econnre|etimedout|enotfound|timeout|abort/.test(e)) return "network_download";
  if (/caption|hook|gate|banned|scan|compliance|lettering/.test(e)) return "content_gate";
  if (/policy|kill|switch|reservation|budget|governor|cadence/.test(e)) return "control_plane";
  if (/beats but|clips.*gen stage|brief|storyboard|json|parse/.test(e)) return "brief_shape";
  return "other";
}

const byClass = new Map<string, { n: number; samples: string[] }>();
for (const r of rows) {
  const c = classify(r.error);
  if (!byClass.has(c)) byClass.set(c, { n: 0, samples: [] });
  const bucket = byClass.get(c)!;
  bucket.n += 1;
  if (bucket.samples.length < 3) bucket.samples.push(`#${r.id}: ${(r.error ?? "(null)").slice(0, 160)}`);
}

console.log(`FAILED_TOTAL: ${rows.length}`);
for (const [cls, b] of [...byClass.entries()].sort((a, z) => z[1].n - a[1].n)) {
  console.log(`\n[${cls}] n=${b.n}`);
  for (const s of b.samples) console.log(`  ${s}`);
}
process.exit(0);
