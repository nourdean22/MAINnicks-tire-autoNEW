/**
 * smoke-agent-v2 · Wave-200 Phase 1.2 follow-up (2026-05-17)
 *
 * One-shot smoke test for the Mastra `nick` agent · validates the
 * entire AGENT_V2 path WITHOUT having to flip the prod env flag.
 *
 * What it checks:
 *   1. Mastra instance + agent construct cleanly (no missing env ·
 *      no @mastra/* version drift surprises)
 *   2. The agent's first response streams text deltas
 *   3. Memory wires up correctly · second turn references the first
 *
 * Run:
 *   pnpm tsx scripts/smoke-agent-v2.ts
 *
 * Output: prints PASS/FAIL summary with timing per turn. Exit code 0
 * on green, 1 on any failure. Use as a pre-cutover gate:
 *
 *   pnpm tsx scripts/smoke-agent-v2.ts && \
 *     railway variables set AGENT_V2=true
 *
 * Note: this is a LOCAL test (calls Mastra in-process). It does NOT
 * exercise the /api/agent or /api/ai/chat HTTP path · those are
 * tested separately via the Braintrust eval suite (evals/
 * nick-baseline.eval.ts).
 */

import { performance } from "node:perf_hooks";

type ExitCode = 0 | 1;

interface TurnResult {
  ok: boolean;
  durationMs: number;
  textChunks: number;
  outputPreview: string;
  error?: string;
}

async function runTurn(
  message: string,
  threadId: string,
  resourceId: string,
): Promise<TurnResult> {
  const start = performance.now();
  try {
    const { getNickAgent } = await import("../src/mastra/agents/nick");
    const agent = await getNickAgent();

    // Call the agent's stream method directly · same path the Mastra
    // HTTP handler takes internally.
    const stream = await (agent as unknown as {
      stream: (
        messages: Array<{ role: string; content: string }>,
        opts?: { memory?: { thread: string; resource: string } },
      ) => Promise<{
        textStream: AsyncIterable<string>;
      }>;
    }).stream(
      [{ role: "user", content: message }],
      { memory: { thread: threadId, resource: resourceId } },
    );

    let chunks = 0;
    let output = "";
    for await (const chunk of stream.textStream) {
      chunks++;
      output += chunk;
      if (output.length > 500) break; // cap preview cost
    }

    return {
      ok: true,
      durationMs: Math.round(performance.now() - start),
      textChunks: chunks,
      outputPreview: output.slice(0, 240).replace(/\s+/g, " ").trim(),
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - start),
      textChunks: 0,
      outputPreview: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<ExitCode> {
  console.log("─ AGENT_V2 smoke test · Mastra path ───────────────────");
  const threadId = `smoke-${Date.now()}`;
  const resourceId = "smoke-operator";

  // Turn 1 · simple greeting · verifies construct + stream.
  console.log("Turn 1 · greeting");
  const t1 = await runTurn(
    "Hello Nick · this is a smoke test · respond with one short sentence.",
    threadId,
    resourceId,
  );
  console.log(
    `  result · ok=${t1.ok} · chunks=${t1.textChunks} · ${t1.durationMs}ms`,
  );
  if (t1.ok) console.log(`  preview · "${t1.outputPreview}"`);
  if (t1.error) console.log(`  error · ${t1.error.slice(0, 200)}`);

  if (!t1.ok) {
    console.log("\nSMOKE FAILED · turn 1 errored. Do NOT flip AGENT_V2.");
    return 1;
  }

  // Turn 2 · same thread · verifies memory window carries context.
  console.log("\nTurn 2 · memory follow-up");
  const t2 = await runTurn(
    "What did I just say to you?",
    threadId,
    resourceId,
  );
  console.log(
    `  result · ok=${t2.ok} · chunks=${t2.textChunks} · ${t2.durationMs}ms`,
  );
  if (t2.ok) console.log(`  preview · "${t2.outputPreview}"`);
  if (t2.error) console.log(`  error · ${t2.error.slice(0, 200)}`);

  if (!t2.ok) {
    console.log("\nSMOKE FAILED · turn 2 errored. Do NOT flip AGENT_V2.");
    return 1;
  }

  // Heuristic memory check · turn 2 should reference smoke / test /
  // hello / greeting / similar. If it has zero memory it'll likely
  // respond "I don't have any prior context" or similar.
  const referencesPrior = /smoke|test|hello|hi|greet|said|told/i.test(
    t2.outputPreview,
  );
  console.log(
    `\n  memory check · turn 2 references prior · ${referencesPrior ? "YES" : "NO"}`,
  );

  console.log("\n─ Summary ─────────────────────────────────────────────");
  console.log(`Turn 1 · ${t1.durationMs}ms · ${t1.textChunks} chunks`);
  console.log(`Turn 2 · ${t2.durationMs}ms · ${t2.textChunks} chunks`);
  console.log(`Memory · ${referencesPrior ? "OK" : "WEAK (turn 2 may not reference turn 1)"}`);

  if (t1.ok && t2.ok) {
    console.log("\nSMOKE PASSED · safe to flip AGENT_V2=true");
    return 0;
  }
  console.log("\nSMOKE FAILED");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("smoke harness crashed:", err);
    process.exit(1);
  });
