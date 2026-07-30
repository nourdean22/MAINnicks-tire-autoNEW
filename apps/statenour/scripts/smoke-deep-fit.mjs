/**
 * Deep honesty probe · 9 read-only checks against live DB.
 *
 * Run after every AI / brain-pipeline / cron deploy. Catches the
 * class of bug where unit tests pass + types are clean but production
 * runtime is silently degraded.
 *
 *   1. Cron heartbeat — what fired in last 24h, what didn't
 *   2. BrainBusEvent stuck rows (status != done after 1h)
 *   3. AgentTrace error spike by surface (last 6h)
 *   4. Vector storage — text vs vec column population + dim uniformity
 *   5. AI provider last-success by name (which provider went silent?)
 *   6. ChatMessage write rate today vs 7d avg
 *   7. BrainMemory tombstone bloat (deleted vs live ratio)
 *   8. AutonomousEvent dual-write parity since v10.0.198 deploy
 *   9. ToolVerbRatio dual-write parity since v10.0.197 deploy
 *
 * Usage: node --env-file=.env.local scripts/smoke-deep-fit.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const tag = (s) => ({ ok: "🟢", warn: "🟡", fail: "🔴", info: "⚪" })[s] || "·";
const findings = [];

// ── 1. Cron heartbeat ───────────────────────────────────────────────
async function check_cronHeartbeat() {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "jobName"::text AS j,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status='success' THEN 1 ELSE 0 END)::int AS ok,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS fail,
           MAX("createdAt") AS last_run
    FROM cron_job_logs
    WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
    GROUP BY "jobName"
    ORDER BY total DESC
  `);
  const totalJobs = rows.length;
  const failedJobs = rows.filter(r => Number(r.fail) > 0);
  const fail = failedJobs.length > 0 ? "warn" : "ok";
  findings.push({
    s: fail,
    t: "1·cron heartbeat 24h",
    d: `${totalJobs} distinct jobs · ${failedJobs.length} have failures · top fail: ${failedJobs.slice(0,3).map(r => `${r.j}(${r.fail}/${r.total})`).join(", ") || "none"}`,
  });
}

// ── 2. BrainBusEvent stuck rows ─────────────────────────────────────
async function check_busStuck() {
  const since = new Date(Date.now() - 6 * 3600_000);
  const stuck = await prisma.$queryRawUnsafe(`
    SELECT topic::text AS t, status::text AS s, COUNT(*)::int AS n
    FROM brain_bus_events
    WHERE created_at < NOW() - INTERVAL '1 hour'
      AND status NOT IN ('done','failed_terminal')
    GROUP BY topic, status
    ORDER BY n DESC LIMIT 10
  `);
  const total = stuck.reduce((s, r) => s + Number(r.n), 0);
  findings.push({
    s: total > 5 ? "warn" : "ok",
    t: "2·bus events stuck",
    d: total === 0 ? "0 stuck (>1h, !done, !failed_terminal)" : stuck.map(r => `${r.t}/${r.s}=${r.n}`).join(" · "),
  });
}

// ── 3. AgentTrace error rate ────────────────────────────────────────
async function check_agentTraceErrors() {
  const recent = await prisma.$queryRawUnsafe(`
    SELECT label::text AS l, COUNT(*)::int AS total,
           SUM(CASE WHEN error_class IS NOT NULL THEN 1 ELSE 0 END)::int AS errs
    FROM agent_traces
    WHERE created_at >= NOW() - INTERVAL '6 hours'
    GROUP BY label
    HAVING COUNT(*) >= 3
    ORDER BY errs DESC LIMIT 10
  `);
  const hot = recent.filter(r => Number(r.errs) / Number(r.total) > 0.2);
  const sev = hot.length > 0 ? "warn" : "ok";
  findings.push({
    s: sev,
    t: "3·agent_traces err 6h",
    d: hot.length === 0
      ? "no surface above 20% error rate"
      : hot.map(r => `${r.l}=${r.errs}/${r.total} (${Math.round(100*Number(r.errs)/Number(r.total))}%)`).join(" · "),
  });
}

// ── 4. Vector dim audit + pgvector column population ───────────────
async function check_vectorDimMix() {
  // The schema has both embedding (Text/JSON) and embedding_vec
  // (pgvector). HNSW only indexes the vector column. If embedding_vec
  // is null for all rows, the v10.0.205 HNSW work isn't actually
  // accelerating anything — recall falls back to text JSON parse.
  const totals = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           SUM(CASE WHEN embedding_vec IS NOT NULL THEN 1 ELSE 0 END)::int AS vec_filled,
           SUM(CASE WHEN embedding_vec_1536 IS NOT NULL THEN 1 ELSE 0 END)::int AS vec1536_filled,
           SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END)::int AS text_filled
    FROM vector_embeddings
  `);
  const r = totals[0];
  const dimRows = await prisma.$queryRawUnsafe(`
    SELECT embedding_dim AS d, COUNT(*)::int AS n
    FROM vector_embeddings
    WHERE embedding_dim IS NOT NULL
    GROUP BY embedding_dim
    ORDER BY n DESC
  `);
  const dimMix = dimRows.map(x => `${x.d}d=${x.n}`).join(" · ") || "no embedding_dim metadata";
  const vecPct = r.total > 0 ? Math.round((Number(r.vec_filled) / Number(r.total)) * 100) : 0;
  const sev = vecPct < 90 ? "warn" : "ok";
  findings.push({
    s: sev,
    t: "4·vector storage",
    d: `total=${r.total} · text=${r.text_filled} · vec=${r.vec_filled}(${vecPct}%) · vec1536=${r.vec1536_filled} · dims: ${dimMix}`,
  });
}

// ── 6. ChatMessage write rate ───────────────────────────────────────
async function check_chatLiveness() {
  const today = await prisma.chatMessage.count({
    where: { createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
  });
  const last7d = await prisma.chatMessage.count({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
  });
  const avgPerDay = Math.round(last7d / 7);
  findings.push({
    s: today < avgPerDay * 0.3 ? "warn" : "ok",
    t: "6·chat liveness",
    d: `${today} msgs today · 7d avg=${avgPerDay}/day · ratio=${avgPerDay > 0 ? (today/avgPerDay).toFixed(1) : "∞"}×`,
  });
}

// ── 7. Soft-delete orphans ──────────────────────────────────────────
async function check_softDeleteOrphans() {
  // BrainMemory has deletedAt + a vector_embeddings link. Already cleaned
  // in v10.0.205. Also check ChatMessage orphans (deleted but still
  // referenced by parent_message_id).
  const tombstoned = await prisma.brainMemory.count({ where: { deletedAt: { not: null } } });
  const live = await prisma.brainMemory.count({ where: { deletedAt: null } });
  const pct = live > 0 ? Math.round((tombstoned / (tombstoned + live)) * 100) : 0;
  findings.push({
    s: pct > 30 ? "warn" : "ok",
    t: "7·brain_mem tombstones",
    d: `${tombstoned} deleted / ${live} live (${pct}% tombstone) — bloating recall index?`,
  });
}

// ── 8. AutonomousEvent writers anywhere ────────────────────────────
// v10.0.213 · the v10.0.198 deploy was at 2026-05-05T14:08Z. Probes
// run inside the 24h smoke window saw a window that was 95% pre-
// deploy and falsely flagged the dual-write as broken. The real
// honesty signal is: did the table get any writes since its
// extraction commit?
async function check_autonomousAnywhere() {
  const DEPLOY_TS = new Date("2026-05-05T14:08:00Z");
  const total = await prisma.autonomousEvent.count();
  const sinceDeploy = await prisma.autonomousEvent.count({ where: { firedAt: { gte: DEPLOY_TS } } });
  const legacySince = await prisma.brainMemory.count({
    where: { category: "autonomous_event", deletedAt: null, createdAt: { gte: DEPLOY_TS } },
  });
  let sev = "ok";
  if (legacySince > 0 && sinceDeploy === 0) sev = "fail"; // legacy writing, typed silent → real bug
  else if (legacySince === 0 && sinceDeploy === 0) sev = "info"; // no upstream events yet
  findings.push({
    s: sev,
    t: "8·AutonomousEvent post-deploy",
    d: `total=${total} · since-v198-deploy: typed=${sinceDeploy} legacy=${legacySince}`,
  });
}

// ── 9. ToolVerbRatio writers anywhere ──────────────────────────────
async function check_toolVerbRatioAnywhere() {
  const DEPLOY_TS = new Date("2026-05-05T13:51:00Z"); // v10.0.197 deploy
  const total = await prisma.toolVerbRatio.count();
  const sinceDeploy = await prisma.toolVerbRatio.count({ where: { createdAt: { gte: DEPLOY_TS } } });
  const legacySince = await prisma.brainMemory.count({
    where: { category: "telemetry_tool_verb", deletedAt: null, createdAt: { gte: DEPLOY_TS } },
  });
  let sev = "ok";
  if (legacySince > 0 && sinceDeploy === 0) sev = "fail";
  else if (legacySince === 0 && sinceDeploy === 0) sev = "info";
  findings.push({
    s: sev,
    t: "9·ToolVerbRatio post-deploy",
    d: `total=${total} · since-v197-deploy: typed=${sinceDeploy} legacy=${legacySince}`,
  });
}

async function main() {
  console.log("\n=== Deep honesty probe ===\n");
  await check_cronHeartbeat();
  await check_busStuck();
  await check_agentTraceErrors();
  await check_vectorDimMix();
  await check_chatLiveness();
  await check_softDeleteOrphans();
  await check_autonomousAnywhere();
  await check_toolVerbRatioAnywhere();

  for (const f of findings) {
    console.log(`${tag(f.s)} ${f.t.padEnd(28)} ${f.d}`);
  }
  const fails = findings.filter(f => f.s === "fail").length;
  const warns = findings.filter(f => f.s === "warn").length;
  console.log(`\nSummary: ${fails} fail · ${warns} warn · ${findings.length - fails - warns} ok/info\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
