/**
 * classify-claim-banners · READ-ONLY lister of every `chat_claim_warn` row in a
 * window, joined to the assistant turn it flagged, that turn's persisted receipt
 * shadow (`tokenUsage.claimDoneShadow`), the operator's ask before it and the
 * operator's reply after it — the raw material for classifying each banner as
 *
 *   TRUE_ACTION_CORRECT · TRUE_ACTION_FAILED · NO_ACTION_CLAIM · THIRD_PARTY_ACTION
 *   USER_ACTION · FUTURE_INTENT · QUOTE_OR_RECAP · TOOL_MAPPING_ERROR
 *   RECEIPT_MISSING · AMBIGUOUS
 *
 * (operator mandate 2026-09-22, item 1). The classification itself is a human
 * read of the printout; this script only lays the evidence side by side.
 *
 * READ-ONLY BY CONSTRUCTION: findMany / count only. Prints to stdout, writes no
 * file, mutates no row.
 *
 * Usage (from apps/statenour; the worktree has no .env, so let Railway inject it):
 *   railway run -s <statenour service> -- pnpm exec tsx scripts/classify-claim-banners.ts --days 60
 */
import Module from "node:module";

function installScriptEnvironment(): void {
  // `server-only` is a tripwire whose entry throws outside Next's bundler.
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const one = (s: string | null | undefined, n: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Strip the verifier banner so the ORIGINAL response is what we read. */
function originalOf(content: string): string {
  const marker = "_Original response (unverified):_";
  const i = content.indexOf(marker);
  return i >= 0 ? content.slice(i + marker.length) : content;
}

type Meta = {
  conversationId?: string;
  traceId?: string;
  claims?: Array<{ verb?: string; snippet?: string; expectedTool?: string }>;
  offenders?: Array<{ toolName?: string; status?: string; label?: string; errorSafeMessage?: string }>;
  toolsActuallyFired?: string[];
  textPreview?: string;
};

async function main(): Promise<void> {
  installScriptEnvironment();
  const { prisma } = await import("@/lib/prisma");
  const days = Number(arg("days", "60"));
  const since = new Date(Date.now() - days * 86_400_000);

  const warns = await prisma.brainMemory.findMany({
    where: { category: "chat_claim_warn", createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { key: true, content: true, createdAt: true, metadata: true, source: true },
  });
  const assistantTurns = await prisma.chatMessage.count({ where: { role: "assistant", createdAt: { gte: since } } });
  const byPrefix = new Map<string, number>();
  for (const w of warns) {
    const p = w.key.replace(/-[0-9a-f-]{8,}.*$/i, "").replace(/-\d+.*$/, "");
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  console.log(`window ${days}d since ${since.toISOString()} · assistant turns ${assistantTurns} · chat_claim_warn rows ${warns.length}`);
  console.log("rows by key prefix: " + [...byPrefix].map(([k, n]) => `${k}×${n}`).join(" · "));

  // one block per traceId (a turn can carry several rows)
  const byTrace = new Map<string, typeof warns>();
  for (const w of warns) {
    const md = (w.metadata ?? {}) as Meta;
    const t = md.traceId ?? w.key;
    byTrace.set(t, [...(byTrace.get(t) ?? []), w]);
  }
  console.log(`distinct flagged turns: ${byTrace.size}`);

  // Receipt census: how many turns carry a persisted claimDoneShadow at all,
  // and how many of those show a gap between the legacy and strict verdicts.
  // (Persisted only when a turn fired at least one tool, since 2026-09-15.)
  const shadowed = await prisma.chatMessage.findMany({
    where: { role: "assistant", createdAt: { gte: since }, tokenUsage: { path: ["claimDoneShadow"], not: { equals: null } } },
    select: { id: true, createdAt: true, tokenUsage: true, content: true },
  });
  let gap = 0;
  let strictFail = 0;
  let bannered = 0;
  for (const m of shadowed) {
    const sh = ((m.tokenUsage ?? {}) as { claimDoneShadow?: { gap?: number; strictOk?: boolean } }).claimDoneShadow;
    if ((sh?.gap ?? 0) > 0) gap += 1;
    if (sh?.strictOk === false) strictFail += 1;
    if (m.content.includes("[VERIFIER")) bannered += 1;
  }
  console.log(
    `receipt shadows persisted: ${shadowed.length} turns (first ${shadowed[0]?.createdAt.toISOString() ?? "n/a"}) · legacy/strict gap>0: ${gap} · strictOk=false: ${strictFail} · of those turns bannered: ${bannered}\n`,
  );

  let idx = 0;
  for (const [traceId, rows] of byTrace) {
    idx += 1;
    const first = rows[0];
    const md = (first.metadata ?? {}) as Meta;
    const convId = md.conversationId;
    console.log(`━━━ #${idx} · ${first.createdAt.toISOString()} · trace ${traceId.slice(0, 12)} · keys ${rows.map((r) => r.key.split("-").slice(0, 2).join("-")).join(",")}`);
    for (const r of rows) console.log(`  row: ${one(r.content, 140)}`);
    const claims = rows.flatMap((r) => ((r.metadata ?? {}) as Meta).claims ?? []);
    for (const c of claims) console.log(`  claim: "${one(c.verb, 40)}" → ${c.expectedTool ?? "?"} · "${one(c.snippet, 110)}"`);
    const fired = [...new Set(rows.flatMap((r) => ((r.metadata ?? {}) as Meta).toolsActuallyFired ?? []))];
    console.log(`  tools fired: ${fired.length ? fired.join(", ") : "(none recorded)"}`);
    if (!convId) {
      console.log("  (no conversationId in metadata — cannot join the turn)\n");
      continue;
    }
    const lo = new Date(first.createdAt.getTime() - 15 * 60_000);
    const hi = new Date(first.createdAt.getTime() + 5 * 60_000);
    const msgs = await prisma.chatMessage.findMany({
      where: { conversationId: convId, createdAt: { gte: lo, lte: hi } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, tokenUsage: true, createdAt: true },
    });
    const assistants = msgs.filter((m) => m.role === "assistant");
    const byTraceMatch = assistants.find((m) => (m.tokenUsage as { traceId?: string } | null)?.traceId === traceId);
    const bannered = assistants.filter((m) => m.content.includes("[VERIFIER")).at(-1);
    const turn = byTraceMatch ?? bannered ?? assistants.at(-1);
    if (!turn) {
      console.log("  (no assistant turn found within the window)\n");
      continue;
    }
    const ask = msgs.filter((m) => m.role === "user" && m.createdAt < turn.createdAt).at(-1);
    const tu = (turn.tokenUsage ?? {}) as Record<string, unknown>;
    const shadow = tu.claimDoneShadow as Record<string, unknown> | undefined;
    console.log(`  turn ${turn.id.slice(0, 8)} @ ${turn.createdAt.toISOString()} · matched by ${byTraceMatch ? "traceId" : bannered ? "banner" : "time"} · bannered: ${turn.content.includes("[VERIFIER")}`);
    console.log(`  tokenUsage keys: ${Object.keys(tu).join(",") || "(none)"}`);
    console.log(`  receipt shadow: ${shadow ? JSON.stringify(shadow).slice(0, 220) : "(none persisted)"}`);
    console.log(`  ask: ${ask ? `"${one(ask.content, 170)}"` : "(none in window)"}`);
    console.log(`  said: "${one(originalOf(turn.content), 300)}"`);
    // Replay the CURRENT detector over the original text with the tools the
    // row says fired, so the historical banner and today's verdict sit side
    // by side (precision changes since the row was written show up here).
    const { detectActionClaimsWithoutTools } = await import("@/lib/ai/chat/action-claim-detector");
    const now = detectActionClaimsWithoutTools(originalOf(turn.content), fired.map((name) => ({ name })));
    console.log(
      now.length
        ? `  detector today: STILL FLAGS ${now.map((c) => `"${one(c.verb, 30)}"→${c.expectedTool}`).join(", ")}`
        : "  detector today: clean",
    );
    const [reply] = await prisma.chatMessage.findMany({
      where: { conversationId: convId, role: "user", createdAt: { gt: turn.createdAt } },
      orderBy: { createdAt: "asc" },
      take: 1,
      select: { content: true, createdAt: true },
    });
    console.log(
      reply
        ? `  reply +${Math.round((reply.createdAt.getTime() - turn.createdAt.getTime()) / 1000)}s: "${one(reply.content, 170)}"`
        : "  reply: (none — conversation ended)",
    );
    console.log("");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
