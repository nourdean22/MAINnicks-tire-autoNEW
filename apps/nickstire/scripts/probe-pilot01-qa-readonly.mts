/** READ-ONLY: job 2070001's rendered-QA verdict, audio QA, approval and draft state. No writes. */
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.log("database unavailable"); process.exit(1); }
const { reelJobs, socialContentInventory } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");
const [job] = await d.select({ id: reelJobs.id, status: reelJobs.status, payload: reelJobs.payload, error: reelJobs.error, igPostId: reelJobs.igPostId }).from(reelJobs).where(eq(reelJobs.id, Number(process.argv[2] ?? 2070001))).limit(1);
const p = JSON.parse(job?.payload ?? "{}");
console.log(`job ${job?.id} status=${job?.status} igPostId=${job?.igPostId ?? "-"} error=${(job?.error ?? "").slice(0, 160)}`);
console.log("payload keys:", Object.keys(p).join(", "));
const rq = p.renderedQa;
if (rq) {
  console.log(`renderedQa: decision=${rq.decision} qaState=${rq.qaState} critic=${rq.critic} frames=${rq.framesEvaluated} craft=${rq.craftScore?.total ?? "-"} escalate=${rq.escalate ?? "-"} attempts=${p.renderedQaAttempts ?? "-"}`);
  for (const f of rq.findings ?? []) console.log(`  [${f.severity}] beat ${f.beatNumber} ${f.code} (conf ${f.confidence ?? "-"}): ${String(f.description).slice(0, 220)} | change: ${(f.change ?? []).join("; ").slice(0, 160)}`);
  if (rq.pixelStats) console.log("  pixelStats flags:", JSON.stringify(rq.pixelStats.flags ?? rq.pixelStats).slice(0, 300));
  if (rq.flash) console.log("  flash:", JSON.stringify(rq.flash).slice(0, 200));
} else console.log("renderedQa: none");
for (const k of ["audioQa", "audioVerdict", "deliveredQa", "observedVisualBible"]) if (p[k]) console.log(`${k}:`, JSON.stringify(p[k]).slice(0, 500));
const [draft] = await d.select({ status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, String(process.argv[3] ?? "pilot-01-looks-fine-look-closer"))).limit(1);
console.log("draft:", JSON.stringify(draft));
process.exit(0);
