/**
 * People W1 backfill, DRY RUN ONLY (2026-10-30).
 *
 * Reads production and prints what a backfill would add to the people tracker:
 * counts and person-id suffixes, never names or notes. By default it writes
 * nothing. The apply is a production write and lands in its own change after
 * Nour's yes; until then `--apply` is refused before any connection opens.
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/people-backfill.ts [--limit 20] [--with-model]
 *
 * Lane A (tasks): promise tasks whose promiseTo names a live person exactly.
 * Lane B (chat): conversations where his own messages name a tracked person who
 *   has no digest ledger row for that conversation yet, oldest first.
 *   `--with-model` re-reads `--limit` of them with the live digest extractor
 *   (digestConversation), one model call each, and EACH CALL WRITES ONE
 *   AgentTrace ROW to production (tracedAiChat). Without it the run counts
 *   candidates only and writes nothing.
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

const args = process.argv.slice(2);
if (args.includes("--apply")) {
  console.error("refused: the apply is not built yet; it needs Nour's yes on these dry-run counts first");
  process.exit(2);
}
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Math.max(1, Number(args[limitArg + 1]) || 20) : 20;
// The model step is opt-in: each digest call goes through tracedAiChat, which
// writes one AgentTrace row to production. The default run writes nothing
// (Codex on 3419); --with-model is for a run that write was approved for.
const NO_MODEL = !args.includes("--with-model");

const suffix = (id: string) => id.slice(-6);

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const plan = await import("@/lib/services/people/backfill-plan");

  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  // Lane A
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, personId: null, promiseTo: { not: null } },
    select: { id: true, personId: true, promiseTo: true },
  });
  const laneA = plan.planPromiseLinks(tasks, people);

  // Lane B candidates
  const ledger = await prisma.relationshipLedger.findMany({
    select: { personId: true, createdAt: true, metadata: true },
  });
  const digestRows = ledger.flatMap((r) => {
    const conversationId = (r.metadata as { conversationId?: unknown } | null)?.conversationId;
    return typeof conversationId === "string" ? [{ personId: r.personId, conversationId }] : [];
  });
  const userMsgs = await prisma.chatMessage.findMany({
    where: { role: "user" },
    select: { conversationId: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = plan.selectCandidates(userMsgs, people, digestRows);

  console.log(`people live: ${people.length}`);
  console.log(`lane A tasks: ${laneA.rows.length} links planned, ${laneA.untrackedNames} promise tasks name someone not tracked`);
  console.log(`lane B candidate conversations (a person he named has no digest row for it yet): ${candidates.length}`);
  if (NO_MODEL) console.log("model step skipped (pass --with-model to digest; each call writes one AgentTrace row)");

  let laneB: ReturnType<typeof plan.planChatInteractions> = {
    rows: [],
    skipped: { mentionOnly: 0, unmatched: 0, alreadyLogged: 0, duplicate: 0 },
  };
  let digestFailed = 0;
  if (!NO_MODEL) {
    const { digestConversation } = await import("@/lib/brain/conversation-memory");
    const convs: Parameters<typeof plan.planChatInteractions>[0][number][] = [];
    // Shared Ollama, no cross-app scheduler (board rule): one call at a time,
    // paced, and stop after 3 failures in a row instead of hammering a 429.
    let failStreak = 0;
    for (const { conversationId, firstMatchAt } of candidates.slice(0, LIMIT)) {
      if (failStreak >= 3) {
        console.log("lane B stopped early: 3 digest failures in a row (provider busy or down)");
        break;
      }
      if (convs.length + digestFailed > 0) await new Promise((r) => setTimeout(r, 3000));
      const all = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
      });
      // The digest keeps the last 30 messages only, so hand it the window around the
      // turn that made this a candidate. shortcut: a message over 500 chars is still
      // cut by the digest, so a name past char 500 can undercount (never a wrong write).
      const messages = plan.digestWindow(all, firstMatchAt);
      const digest = await digestConversation(conversationId, messages).catch(() => null);
      if (!digest || messages.length === 0) {
        digestFailed++;
        if (messages.length >= 3) failStreak++; // too-short conversations are not provider failures
        continue;
      }
      failStreak = 0;
      convs.push({
        conversationId,
        start: messages[0].createdAt,
        end: messages[messages.length - 1].createdAt,
        mentioned: digest.peopleMentioned.map((p) => ({
          name: p.name,
          interacted: Boolean(p.interacted),
          interactionKind: p.interactionKind ?? null,
        })),
      });
    }
    laneB = plan.planChatInteractions(convs, people, ledger);
    console.log(`lane B digested: ${convs.length} of ${Math.min(LIMIT, candidates.length)} (failed or too short: ${digestFailed})`);
    console.log(`lane B rows planned: ${laneB.rows.length}; skipped ${JSON.stringify(laneB.skipped)}`);
  }

  const perPerson = new Map<string, { chat: number; tasks: number }>();
  for (const r of laneB.rows) (perPerson.get(r.personId) ?? perPerson.set(r.personId, { chat: 0, tasks: 0 }).get(r.personId)!).chat++;
  for (const r of laneA.rows) (perPerson.get(r.personId) ?? perPerson.set(r.personId, { chat: 0, tasks: 0 }).get(r.personId)!).tasks++;
  for (const [id, n] of perPerson) console.log(`  person ...${suffix(id)}: chat ${n.chat}, tasks ${n.tasks}`);

  console.log(`confirm token: ${plan.planToken({ chat: laneB.rows, tasks: laneA.rows })}${NO_MODEL ? " (no model run: lane A only)" : ""}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("dry run failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
