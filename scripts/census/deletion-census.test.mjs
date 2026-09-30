// Deletion census (Q-33): fixture tests for every classifier, each with a planted positive
// and a known negative, plus one run over the real tree. Run: node --test scripts/census/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyKeep,
  classifyEnv,
  classifyTable,
  drizzlePatterns,
  parseDrizzleTables,
  parsePrismaModels,
  parseRailwayEnv,
  prismaPatterns,
  renderMarkdown,
  runCensus,
  SERVICE_TREES,
  trackedFiles,
} from "./deletion-census.mjs";

const RAILWAY = `
  const a = service("svc-a", {
    build: { watchPatterns: ["apps/a/**"] },
    env: { LIVE_VAR: preserve(), DEAD_VAR: preserve(), TEST_ONLY_VAR: preserve() },
  });
  const b = service("svc-b", {
    env: { OTHER: preserve() },
  });
`;

test("parseRailwayEnv reads each service's env block, not its neighbour's", () => {
  const env = parseRailwayEnv(RAILWAY);
  assert.deepEqual(env.get("svc-a"), ["LIVE_VAR", "DEAD_VAR", "TEST_ONLY_VAR"]);
  assert.deepEqual(env.get("svc-b"), ["OTHER"]);
});

test("classifyEnv: unread → DELETE, test-only → WATCH, read → not listed", () => {
  const files = [
    { path: "apps/a/server/env.ts", text: "const x = process.env.LIVE_VAR;\n// LIVE_VARIANT is a different name" },
    { path: "apps/a/server/x.test.ts", text: "process.env.TEST_ONLY_VAR = '1';" },
    { path: "apps/a/server/near.ts", text: "const DEAD_VAR_SUFFIX = 1; const PREFIX_DEAD_VAR = 2;" },
  ];
  const out = classifyEnv("svc-a", ["LIVE_VAR", "DEAD_VAR", "TEST_ONLY_VAR"], files);
  const by = Object.fromEntries(out.map((f) => [f.name, f.verdict]));
  assert.deepEqual(by, { DEAD_VAR: "DELETE", TEST_ONLY_VAR: "WATCH" });
});

const DRIZZLE = `
export const leads = mysqlTable("leads", { id: int("id") });
export const errorLog = mysqlTable("error_log", { id: int("id") });
export const auditTrail = mysqlTable("audit_trail", { id: int("id") });
export const otpCodes = mysqlTable("otp_codes", { id: int("id") });
export const rawRead = mysqlTable("raw_read", { id: int("id") });
`;

test("Drizzle: no mention → DELETE, insert-only → WATCH, delete-only → purged WATCH, any read → live", () => {
  const tables = parseDrizzleTables(DRIZZLE);
  assert.equal(tables.length, 5);
  const files = [
    { path: "apps/n/server/a.ts", text: "await db.select().from(leads).where(eq(leads.id, 1));" },
    { path: "apps/n/server/b.ts", text: "await db.insert(schema.auditTrail).values(row);" },
    { path: "apps/n/server/c.ts", text: "await db.delete(otpCodes).where(lt(otpCodes.expiresAt, t));" },
    { path: "apps/n/server/d.ts", text: "await db.execute(sql`SELECT COUNT(*) FROM raw_read`);" },
    { path: "apps/n/server/e.test.ts", text: "db.select().from(errorLog)" },
  ];
  const got = Object.fromEntries(
    tables.map((t) => [t.name, classifyTable("nickstire", t.name, drizzlePatterns(t), files)?.verdict ?? "LIVE"]),
  );
  assert.deepEqual(got, { leads: "LIVE", error_log: "DELETE", audit_trail: "WATCH", otp_codes: "WATCH", raw_read: "LIVE" });
  const purged = classifyTable("nickstire", "otp_codes", drizzlePatterns(tables[3]), files);
  assert.match(purged.evidence, /only ever purged/);
});

test("Drizzle: a raw DELETE FROM is not mistaken for a read", () => {
  const [t] = parseDrizzleTables('export const sweep = mysqlTable("sweep", {});');
  const f = classifyTable("nickstire", "sweep", drizzlePatterns(t), [
    { path: "apps/n/server/x.ts", text: "await db.execute(sql`DELETE FROM sweep WHERE ts < ${cut}`);" },
  ]);
  assert.equal(f?.verdict, "WATCH");
});

const PRISMA = `
model Task {
  id     String @id
  events TaskEvent[]
}

model TaskEvent {
  id     String @id
  taskId String
  task   Task   @relation(fields: [taskId], references: [id])
  @@map("task_events")
}

model ScheduledAction {
  id String @id
}

model KnownFace {
  id String @id
}

model LinkClick {
  id String @id
}
`;

test("parsePrismaModels: @@map table names, camelCase accessors and relation-field aliases", () => {
  const m = Object.fromEntries(parsePrismaModels(PRISMA).map((x) => [x.model, x]));
  assert.equal(m.TaskEvent.table, "task_events");
  assert.equal(m.ScheduledAction.accessor, "scheduledAction");
  assert.deepEqual(m.TaskEvent.aliases, ["events"]);
  assert.deepEqual(m.Task.aliases, ["task"]);
});

test("Prisma: a chain broken across lines is still a read (prettier's `prisma.x\\n  .findMany`)", () => {
  const models = parsePrismaModels(PRISMA);
  const files = [
    { path: "apps/s/lib/state.ts", text: "const rows = await prisma.scheduledAction\n      .findMany({ take: 5 });" },
    { path: "apps/s/lib/task.ts", text: "prisma.task.findUnique({ where: { id }, include: { events: true } })" },
    { path: "apps/s/app/api/short/route.ts", text: "await prisma.linkClick.create({ data })" },
  ];
  const got = Object.fromEntries(models.map((m) => [m.model, classifyTable("statenour", m.model, prismaPatterns(m), files)?.verdict ?? "LIVE"]));
  assert.deepEqual(got, { Task: "LIVE", TaskEvent: "LIVE", ScheduledAction: "LIVE", KnownFace: "DELETE", LinkClick: "WATCH" });
});

test("applyKeep: flagged+kept → KEEP; kept but read again → STALE; kept but gone → STALE", () => {
  const findings = [{ key: "env:s:A", kind: "env", scope: "s", name: "A", verdict: "DELETE", evidence: "no reference" }];
  const keep = { "env:s:A": "platform reads it", "env:s:B": "was platform", "env:s:GONE": "old" };
  const out = applyKeep(findings, keep, new Set(["env:s:A", "env:s:B"]));
  const by = Object.fromEntries(out.map((f) => [f.key, f]));
  assert.equal(by["env:s:A"].verdict, "KEEP");
  assert.equal(by["env:s:B"].verdict, "STALE");
  assert.match(by["env:s:B"].evidence, /now referenced/);
  assert.equal(by["env:s:GONE"].verdict, "STALE");
  assert.match(by["env:s:GONE"].evidence, /no longer exists/);
});

test("renderMarkdown shouts when the instrument is blind", () => {
  const md = renderMarkdown({ findings: [], totals: { services: 0, envVars: 0, drizzleTables: 0, prismaModels: 0 }, controls: ["parsed zero Railway services"] });
  assert.match(md, /INSTRUMENT BLIND/);
});

test("real tree: parses every source, the live controls stay live, a planted unread name is caught", () => {
  const result = runCensus();
  assert.deepEqual(result.controls, [], `instrument blind: ${result.controls.join("; ")}`);
  assert.ok(result.totals.services >= 3 && result.totals.envVars > 100, JSON.stringify(result.totals));
  assert.ok(result.totals.drizzleTables > 100 && result.totals.prismaModels > 50, JSON.stringify(result.totals));
  // Every verdict is one of the four; nothing else leaks into the report.
  for (const f of result.findings) assert.ok(["DELETE", "WATCH", "KEEP", "STALE"].includes(f.verdict), f.key);
  // No keep entry may be stale on main: a stale entry means someone fixed the reader and forgot the list.
  assert.deepEqual(result.findings.filter((f) => f.verdict === "STALE").map((f) => f.key), []);

  // Planted positive over the REAL nickstire tree: a name nothing reads must come back DELETE,
  // and a name the server reads on boot must not.
  const nick = trackedFiles(SERVICE_TREES["MAINnicks-tire-auto"]);
  const planted = classifyEnv("MAINnicks-tire-auto", ["CENSUS_CANARY_NOTHING_READS_THIS", "DATABASE_URL"], nick);
  assert.deepEqual(planted.map((f) => [f.name, f.verdict]), [["CENSUS_CANARY_NOTHING_READS_THIS", "DELETE"]]);
});
