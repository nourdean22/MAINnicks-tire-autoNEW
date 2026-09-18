/**
 * scripts/tool-input-failure-census.ts — how do tool calls actually FAIL? (2026-09-18)
 *
 * WHY. `lib/ai/chat/repair-tool-call.ts` repairs exactly one failure class —
 * `NoSuchToolError`, a hallucinated tool NAME — and declines every other with
 * the comment "argument-validation errors are a different failure mode we
 * deliberately leave to the SDK". That was a design choice made without a
 * measurement: nobody had counted how the two classes compare.
 *
 * THIS SCRIPT DOES NOT ASSUME THE ANSWER. It splits `tool_telemetry.lastErrors`
 * into name-failures, ARGUMENT failures and everything else, prints the raw
 * strings, and refuses to rank a class it saw fewer than MIN_EXAMPLES times.
 * A repair built for a failure class that does not occur is dead code with a test.
 *
 * AND `lastErrors` NEVER AGES OUT, SO A FIXED BUG READS AS CURRENT FOREVER.
 * The first run of this script ranked ARGUMENT 24-to-9 over NAME, and the top
 * argument examples were `createTask` sending {"effort":"30 min"} — which
 * `lib/ai/tools/tasks.ts:160-162` records as DIAGNOSED AND FIXED on 2026-09-03.
 * Two months dead, still top of the ranking. So every class is now split LIVE
 * vs STALE by the tool's `lastCallAt`, and the verdict counts LIVE only. This
 * is the identical defect `scripts/tool-reachability-census.ts:141` documents;
 * it was rebuilt here from scratch hours later, which is the argument for
 * printing the split rather than trusting anyone to remember the lesson.
 *
 * IT MEASURES WHAT LANDS IN TELEMETRY, WHICH IS NOT EVERY FAILURE.
 * `lib/services/chat/tool-telemetry-walk.ts` records from AI SDK `tool-error`
 * content parts, so a failure the SDK never surfaces as a part is invisible
 * here. `lastErrors` is also capped at 5 per tool, so the STRINGS are a sample
 * while `failCount` is the count — never add the string counts and call it a
 * total. Both limits are printed with the output rather than left implicit.
 *
 * `lastCallAt` IS THE TOOL'S LAST CALL, NOT THE ERROR'S TIMESTAMP — the rows
 * carry no per-error time. So "LIVE" means "this tool is still in use", which
 * is the weaker claim: a live tool whose bug was fixed still reads LIVE until
 * its five strings are pushed out. Read it as a floor on staleness, not proof
 * of currency, and confirm against the tool's source before acting on it.
 *
 * Read-only: findMany only.
 *
 * Usage (from apps/statenour):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/tool-input-failure-census.ts
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

/** Below this many LIVE examples, a class is reported but NOT ranked. */
const MIN_EXAMPLES = 3;

/** A tool whose last call is older than this contributes only STALE evidence. */
const STALE_DAYS = 14;

export type FailureClass = "name" | "argument" | "execution" | "unknown";

/**
 * Classify one recorded error string.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL. An AI SDK argument failure reads
 * "Invalid input for tool searchMemories: ..." — it names a tool, so a
 * name-first check would swallow the whole argument class and "prove" the
 * existing design correct. Argument is tested FIRST for exactly that reason.
 */
export function classifyToolError(message: string): FailureClass {
  const m = message.toLowerCase();
  if (
    m.includes("invalid arguments") ||
    m.includes("invalid input for tool") ||
    m.includes("invalid_tool_input") ||
    m.includes("invalidtoolinput") ||
    m.includes("type validation failed") ||
    m.includes("json parsing failed") ||
    m.includes("unexpected non-whitespace character")
  ) {
    return "argument";
  }
  if (
    m.includes("no such tool") ||
    m.includes("nosuchtool") ||
    m.includes("unavailable tool") ||
    m.includes("not found in the tool set")
  ) {
    return "name";
  }
  if (m.trim().length === 0) return "unknown";
  return "execution";
}

function asMessages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        const v = o.message ?? o.error ?? o.text;
        return typeof v === "string" ? v : JSON.stringify(e);
      }
      return String(e);
    })
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required — run under `railway run -s statenour-web --`");
    process.exit(1);
  }
  const { prisma } = await import("../lib/prisma");

  const rows = await prisma.toolTelemetry.findMany({
    where: { failCount: { gt: 0 } },
    select: { toolName: true, totalCalls: true, failCount: true, lastErrors: true, lastCallAt: true },
    orderBy: { failCount: "desc" },
  });

  console.log(`tool-input failure census · ${rows.length} tools with at least one recorded failure`);
  console.log("`lastErrors` is capped at 5 per tool — the STRINGS below are a sample, the");
  console.log("failCount totals are the population. Do not add the sample counts.\n");

  const now = Date.now();
  const ageDays = (d: Date | null) =>
    d === null ? Infinity : Math.floor((now - d.getTime()) / 86_400_000);

  type Item = { tool: string; msg: string; age: number; stale: boolean };
  const byClass: Record<FailureClass, Item[]> = {
    name: [],
    argument: [],
    execution: [],
    unknown: [],
  };
  let sampled = 0;
  let totalFailCount = 0;

  for (const r of rows) {
    totalFailCount += r.failCount;
    const age = ageDays(r.lastCallAt);
    for (const msg of asMessages(r.lastErrors)) {
      sampled += 1;
      byClass[classifyToolError(msg)].push({ tool: r.toolName, msg, age, stale: age > STALE_DAYS });
    }
  }

  const order: FailureClass[] = ["argument", "name", "execution", "unknown"];
  const live = (c: FailureClass) => byClass[c].filter((i) => !i.stale).length;
  const liveSample = order.reduce((n, c) => n + live(c), 0);

  console.log(`POPULATION : ${totalFailCount} recorded failures across ${rows.length} tools`);
  console.log(`SAMPLE     : ${sampled} error strings retained in lastErrors`);
  console.log(`LIVE SAMPLE: ${liveSample} from a tool called within ${STALE_DAYS}d\n`);

  if (sampled === 0) {
    console.log("NO ERROR STRINGS RETAINED. This is UNMEASURED, not 'no failures' —");
    console.log(`  failCount totals ${totalFailCount}, so failures happened and the strings aged out.`);
    await prisma.$disconnect();
    return;
  }

  for (const cls of order) {
    const items = byClass[cls];
    const pct = Math.round((items.length / sampled) * 1000) / 10;
    console.log(`-- ${cls.toUpperCase()} · ${items.length}/${sampled} sampled (${pct}%) · LIVE ${live(cls)}`);
    if (items.length === 0) {
      console.log("   (none)\n");
      continue;
    }
    for (const { tool, msg, age, stale } of items.slice(0, 8)) {
      const tag = stale ? "STALE" : "LIVE ";
      const when = age === Infinity ? "never" : `${age}d`;
      console.log(`   ${tag} ${tool.padEnd(20)} (${when}) ${msg.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    if (items.length > 8) console.log(`   ... and ${items.length - 8} more`);
    console.log("");
  }

  // THE VERDICT COUNTS LIVE ONLY. Ranking on the full sample is what made the
  // first run crown a class that had been fixed two months earlier.
  const arg = live("argument");
  const name = live("name");
  if (arg < MIN_EXAMPLES && name < MIN_EXAMPLES) {
    console.log(
      `VERDICT: WITHHELD. Neither class reached ${MIN_EXAMPLES} LIVE examples` +
        ` (argument ${arg}, name ${name}). Not enough to justify building for either.`,
    );
  } else if (arg > name) {
    console.log(
      `VERDICT: ARGUMENT failures outnumber NAME failures among LIVE evidence (${arg} vs ${name}).` +
        " repair-tool-call.ts covers only the SMALLER class.",
    );
  } else {
    console.log(
      `VERDICT: NAME failures lead the LIVE evidence (${name} vs ${arg} argument).` +
        " The existing repair is aimed at the right class.",
    );
  }

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
