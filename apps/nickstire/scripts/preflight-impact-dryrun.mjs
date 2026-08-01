/**
 * READ-ONLY. What would REEL_REQUIRE_CLAIM_EVIDENCE=true actually block?
 *
 * Replays the claim/evidence packet for real recent reel-job briefs and reports
 * the verdict distribution, so the flag is flipped on a measured block rate
 * rather than a guess. Writes nothing and enqueues nothing.
 *
 * Run from apps/nickstire with DATABASE_URL set:
 *   node scripts/preflight-impact-dryrun.mjs [limit]
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const LIMIT = Number(process.argv[2] || 15);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = fs
    .readFileSync(path.join(process.cwd(), ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not set");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const conn = await mysql.createConnection({
  uri: loadDatabaseUrl(),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60_000,
});

const [rows] = await conn.query(
  `SELECT id, briefId, payload FROM reel_jobs ORDER BY id DESC LIMIT ${LIMIT}`,
);
console.log(`replaying ${rows.length} recent reel jobs\n`);

const { buildClaimsFromBrief } = await import("../server/services/episodeClaims.ts");
const { fromReelJobBrief, preflightEpisode } = await import("../shared/episodeContract.ts");

const tally = { wouldPass: 0, wouldBlock: 0 };
const blockReasons = new Map();
const verdicts = new Map();

for (const row of rows) {
  let brief;
  try {
    brief = JSON.parse(row.payload ?? "{}");
  } catch {
    continue;
  }

  const packet = await buildClaimsFromBrief(brief);
  for (const e of packet.evidence) verdicts.set(e.entailment, (verdicts.get(e.entailment) ?? 0) + 1);

  const { contract } = fromReelJobBrief(brief, {
    objective: "DISCOVERY",
    disclosureMode: "visibly_animated",
    claims: packet.claims,
    evidence: packet.evidence,
    script: {
      caption: brief.selectedCaption ?? "",
      voiceover: brief.voiceoverScript ?? "",
      ctaType: "NONE",
      hashtags: (brief.hashtags ?? []).slice(0, 5),
    },
  });

  const strict = preflightEpisode(contract, new Date(), { requireClaimEvidence: process.env.STRICT === "1" });
  if (strict.allowed) tally.wouldPass++;
  else {
    tally.wouldBlock++;
    for (const b of strict.blocks) blockReasons.set(b, (blockReasons.get(b) ?? 0) + 1);
  }

  console.log(
    `job ${String(row.id).padEnd(9)} claims=${packet.claims.length} evidence=${packet.evidence.length} ` +
      `entail=[${packet.evidence.map((e) => e.entailment).join(",") || "-"}] ` +
      `${strict.allowed ? "PASS" : "BLOCK: " + strict.blocks.join(",")}`,
  );
}

console.log(`\n=== with REEL_REQUIRE_CLAIM_EVIDENCE=true ===`);
console.log(`would pass : ${tally.wouldPass}`);
console.log(`would BLOCK: ${tally.wouldBlock}`);
console.log(`\nblock reasons:`);
for (const [k, v] of [...blockReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\nentailment verdicts across all evidence:`);
for (const [k, v] of [...verdicts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

await conn.end();
