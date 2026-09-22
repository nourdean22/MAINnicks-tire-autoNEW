/**
 * tire-size-recall — how often a spoken tire size is captured, on REAL calls.
 *
 * READ-ONLY. Every statement is a SELECT. Run against production through the
 * service environment so no key is pasted into a command:
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:tire-size-recall
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:tire-size-recall -- --days 14 --limit 40
 *
 * WHY THIS EXISTS. extractTireSize (shared/callDemandExtraction.ts) is unit-tested
 * on spoken forms, but the question that matters is recall on production speech:
 * of the tire-intent calls the eval cron scored, how many carry demand.tireSize,
 * and for the ones that do not, did the caller actually say a size? On 2026-09-22
 * that question was answered by hand — 11 calls, 3 sizes, and ONE transcript with
 * a size the extractor missed ("two two five fifty r 18", the width read digit by
 * digit; fixed the same day). This turns that hand probe into one command, so the
 * next change to the extractor can be measured instead of assumed.
 *
 * TWO NUMBERS, NEVER COLLAPSED.
 *   coverage — calls that carry demand at all (the writer ran). The eval cron
 *              scores each call ONCE, so a window that reaches before the
 *              writer shipped (2026-09-18) reads as sparse; that is the window,
 *              not the instrument. --days defaults to 7 for that reason.
 *   recall   — of calls with a size-like customer line, the share with an
 *              extracted size. The size-like filter is a NET, deliberately wide
 *              (any 3-digit number or a spoken tens word), so "missed" rows are
 *              CANDIDATES for a human to read, not verdicts. A rim-only "size
 *              eighteen" is a correct null and will appear here.
 *
 * PII. Transcripts carry names and numbers. This prints only customer lines that
 * match the size-like net, truncated, with 10-digit runs masked. It never prints
 * an assistant line or a whole transcript.
 */
import mysql from "mysql2/promise";
import { extractTireSize } from "../../shared/callDemandExtraction.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DAYS = Math.max(1, Number(arg("days", "7")) || 7);
const LIMIT = Math.max(1, Number(arg("limit", "25")) || 25);

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing or not mysql:// — run via: railway run -s MAINnicks-tire-auto -- pnpm diag:tire-size-recall");
  process.exit(1);
}

const TIRE_INTENT =
  "(JSON_SEARCH(v.metadata, 'one', 'used_tire', NULL, '$.intents') IS NOT NULL" +
  " OR JSON_SEARCH(v.metadata, 'one', 'new_tire', NULL, '$.intents') IS NOT NULL" +
  " OR JSON_SEARCH(v.metadata, 'one', 'tire_size_request', NULL, '$.intents') IS NOT NULL)";
const SIZE_LIKE = /\b\d{3}\b|\b(fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy)\b/i;
const mask = (s) => s.replace(/\d{10,}/g, "##########").replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "###-###-####");

const conn = await mysql.createConnection(url);
try {
  const u = new URL(url);
  console.log(`TARGET ${u.hostname}${u.pathname} · last ${DAYS}d · tire-intent calls\n`);

  const [cov] = await conn.query(
    `SELECT COUNT(*) AS tireCalls,
            SUM(JSON_EXTRACT(v.metadata, '$.demand') IS NOT NULL) AS withDemand,
            SUM(JSON_TYPE(JSON_EXTRACT(v.metadata, '$.demand.tireSize')) = 'STRING') AS withSize
     FROM vapi_call_logs v
     WHERE v.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${TIRE_INTENT}`,
    [DAYS],
  );
  const c = cov[0];
  console.log(`COVERAGE  tire-intent calls ${c.tireCalls} · with demand ${c.withDemand} · with a size ${c.withSize}`);
  if (Number(c.withDemand) < Number(c.tireCalls)) {
    console.log(`          ${Number(c.tireCalls) - Number(c.withDemand)} calls carry no demand: not yet scored, or created before 2026-09-18. Not a recall miss.`);
  }

  const [rows] = await conn.query(
    `SELECT v.id, JSON_EXTRACT(v.metadata, '$.demand.tireSize') AS size, a.transcript
     FROM vapi_call_logs v
     LEFT JOIN vapi_call_archives a ON a.vapi_call_id = v.vapiCallId
     WHERE v.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${TIRE_INTENT}
       AND JSON_EXTRACT(v.metadata, '$.demand') IS NOT NULL
     ORDER BY v.createdAt DESC LIMIT ?`,
    [DAYS, LIMIT],
  );

  let candidates = 0;
  let captured = 0;
  let wouldCaptureNow = 0;
  const misses = [];
  for (const r of rows) {
    const customerLines = String(r.transcript ?? "")
      .split("\n")
      .filter((l) => /^\s*(user|customer|caller)\s*:/i.test(l))
      .map((l) => l.replace(/^\s*\w+\s*:\s*/, ""));
    const sizeLike = customerLines.filter((l) => SIZE_LIKE.test(l));
    if (sizeLike.length === 0) continue;
    candidates++;
    const stored = typeof r.size === "string" ? r.size.replace(/^"|"$/g, "") : null;
    if (stored && stored !== "null") {
      captured++;
      continue;
    }
    // What the CURRENT extractor (this checkout) would do with the same lines —
    // so a fix can be measured against production speech before it deploys.
    const now = customerLines.map((l) => extractTireSize(l)).find(Boolean) ?? null;
    if (now) wouldCaptureNow++;
    misses.push({ id: r.id, now, lines: sizeLike.slice(0, 2).map((l) => mask(l).slice(0, 100)) });
  }

  console.log(`RECALL    calls with a size-like customer line ${candidates} · stored size ${captured} · missed ${candidates - captured}`);
  if (candidates > 0) console.log(`          stored recall ${Math.round((captured / candidates) * 100)}% · this checkout would add ${wouldCaptureNow} of the ${candidates - captured} missed`);
  if (rows.length >= LIMIT) console.log(`          (limit ${LIMIT} reached — raise --limit to read the rest)`);
  if (misses.length) {
    console.log(`\nMISSED — candidates for a human to read (size-like lines only, masked):`);
    for (const m of misses) {
      console.log(`  call ${m.id}${m.now ? ` · this checkout would extract ${m.now}` : ""}`);
      for (const l of m.lines) console.log(`      "${l}"`);
    }
  }
} finally {
  await conn.end();
}
