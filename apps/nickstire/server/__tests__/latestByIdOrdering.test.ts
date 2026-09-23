import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gate (Q-11): no NEW "latest row" read that orders by id first.
 *
 * TiDB allocates AUTO_INCREMENT values in per-server batches
 * (docs.pingcap.com/tidb/stable/auto-increment), so a higher id is not a later
 * row across TiDB servers or restarts. `ORDER BY id DESC` can return an OLDER
 * row as "the latest" — it picked the call summary that seeds an SMS reply
 * (smsOrchestrator.loadCustomerContext) until 2026-09-23. Order by the event
 * time first and keep id only as the tiebreak:
 *
 *     .orderBy(desc(t.createdAt), desc(t.id))
 *
 * A site flags when id is the FIRST sort key, with or without a LIMIT: 12 of
 * the 13 sites fixed alongside this gate read a newest-N window, not one row.
 * Where id order IS the intent (keyset/cursor pagination, an id-range scan of
 * an append-only table) add the file to ALLOWED with the reason. An entry whose
 * file no longer has a site fails too, so the allowlist cannot rot into slack.
 *
 * Known gaps: `sql\`${t.id} DESC\`` inside orderBy, and an id column aliased to
 * another name, are not recognised.
 */
const ALLOWED: Record<string, string> = {
  // "relative/path.ts": "why id order is intended here",
};

const DRIZZLE_ID_FIRST = /\.orderBy\(\s*desc\(\s*[\w$]+\.id\s*\)/g;
const RAW_ID_FIRST = /ORDER\s+BY\s+(?:`?\w+`?\.)?`?id`?\s+DESC\b/gi;

function findIdFirstOrderings(src: string): string[] {
  return [...src.matchAll(DRIZZLE_ID_FIRST), ...src.matchAll(RAW_ID_FIRST)].map((m) =>
    m[0].replace(/\s+/g, " "),
  );
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) yield p;
  }
}

describe("latest-row reads do not trust TiDB id order", () => {
  it("positive control: the matcher catches every id-first shape", () => {
    const planted = [
      ".orderBy(desc(vapiCallLogs.id)).limit(1)",
      ".orderBy(\n      desc(reelJobs.id)\n    )\n    .limit(25)",
      ".orderBy(desc(t.id), desc(t.createdAt))",
      "sql`SELECT * FROM leads ORDER BY id DESC LIMIT 1`",
      "sql`SELECT * FROM leads l ORDER BY l.`id` DESC`",
    ];
    for (const src of planted) expect(findIdFirstOrderings(src), src).toHaveLength(1);
  });

  it("negative control: event-time-first orderings pass", () => {
    const fine = [
      ".orderBy(desc(smsMessages.createdAt), desc(smsMessages.id)).limit(1)",
      ".orderBy(asc(reelJobs.id))",
      "ORDER BY s.capturedAt DESC, s.id DESC",
      "ORDER BY vapi_call_id DESC",
      ".orderBy(desc(t.customerId))",
    ];
    for (const src of fine) expect(findIdFirstOrderings(src), src).toEqual([]);
  });

  it("no server source orders a read by id first outside the reviewed allowlist", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of walk(SERVER_DIR)) {
      const rel = path.relative(SERVER_DIR, file).split(path.sep).join("/");
      const hits = findIdFirstOrderings(fs.readFileSync(file, "utf8"));
      if (hits.length === 0) continue;
      seen.add(rel);
      if (!(rel in ALLOWED)) offenders.push(`${rel} → ${hits.join(" | ")}`);
    }
    expect(
      offenders,
      `"Latest" read ordered by id first — TiDB ids are not time-ordered. Use (createdAt DESC, id DESC), or add the file to ALLOWED with a reason:\n${offenders.join("\n")}`,
    ).toEqual([]);
    const stale = Object.keys(ALLOWED).filter((f) => !seen.has(f));
    expect(stale, `ALLOWED entries with no remaining site — delete them:\n${stale.join("\n")}`).toEqual([]);
  });
});
