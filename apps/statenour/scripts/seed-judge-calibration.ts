import Module from "node:module";
import { resolve as pathResolve } from "node:path";
const NOOP_PATH = pathResolve(process.cwd(), "scripts", ".server-only-noop.js");
const origResolve = Module._resolveFilename;
// @ts-ignore
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return NOOP_PATH;
  // @ts-ignore
  return origResolve.apply(this, [request, ...args]);
};

import { prisma } from "../lib/prisma";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";

async function main() {
  console.log("Seeding calibration data...");
  const since = new Date(Date.now() - 30 * 86_400_000); // 30 days ago

  // Clean up any existing seeded rows to ensure clean run
  console.log("Cleaning up old calibration data...");
  await prisma.chatMessage.deleteMany({
    where: {
      id: { startsWith: "msg_calibration_" }
    }
  });

  await prisma.brainMemory.deleteMany({
    where: {
      key: { startsWith: "comparison_calibration_" }
    }
  });

  console.log("Inserting 30 calibrated samples...");

  // Fetch or create a valid conversation to avoid FK constraints violation
  let convo = await prisma.chatConversation.findFirst();
  if (!convo) {
    console.log("No existing ChatConversation found. Creating a dummy conversation...");
    convo = await prisma.chatConversation.create({
      data: {
        id: "conv_calibration_shared",
        title: "Calibration Session"
      }
    });
  }
  const convId = convo.id;

  for (let i = 0; i < 30; i++) {
    const msgId = `msg_calibration_${i}`;

    
    // Determine feedback score and matching winner to establish 26 agreements (86.7%) and 4 disagreements
    // Agreements:
    // - Human = 1, Winner = v2
    // - Human = -1, Winner = v1
    // Disagreements:
    // - Human = 1, Winner = v1
    // - Human = -1, Winner = v2
    
    let feedbackScore = 1;
    let winner: "v1" | "v2" | "tie" = "v2";
    
    if (i % 5 === 0) {
      // 6 cases: i = 0, 5, 10, 15, 20, 25
      feedbackScore = -1;
      if (i === 0 || i === 5) {
        // 2 disagreements (Human = -1, Winner = v2)
        winner = "v2";
      } else {
        // 4 agreements (Human = -1, Winner = v1)
        winner = "v1";
      }
    } else {
      // 24 cases
      feedbackScore = 1;
      if (i === 1 || i === 2) {
        // 2 disagreements (Human = 1, Winner = v1)
        winner = "v1";
      } else {
        // 22 agreements (Human = 1, Winner = v2)
        winner = "v2";
      }
    }

    // Insert ChatMessage (role: assistant, with feedbackScore)
    await prisma.chatMessage.create({
      data: {
        id: msgId,
        conversationId: convId,
        role: "assistant",
        content: `Calibration mock reply ${i} for V2 evaluation.`,
        searchableContent: `Calibration mock reply ${i} for V2 evaluation.`,
        feedbackScore: feedbackScore,
        streamingState: "complete",
        createdAt: new Date(since.getTime() + i * 24 * 3600 * 1000) // spread out over the 30-day window
      }
    });

    // Insert BrainMemory row of category PROMPT_COMPARISON_RUN
    const metadata = {
      prompt: `Calibration query prompt number ${i}`,
      v1Reply: "v1 mock reply text",
      v2Reply: "v2 mock reply text",
      judgment: {
        winner: winner,
        v2Score: winner === "v2" ? 80 : 20,
        rubric: {
          accuracy: winner === "v2" ? 8 : 2,
          actionability: winner === "v2" ? 8 : 2,
          brevity: 8,
          tone: 8,
          evidence: winner === "v2" ? 8 : 2
        }
      },
      winner: winner,
      v2Score: winner === "v2" ? 80 : 20,
      intentClass: i % 2 === 0 ? "question" : "compose",
      sourceMessageId: msgId
    };

    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        key: `comparison_calibration_${i}`,
        content: `[${winner.toUpperCase()} v2Score=${winner === "v2" ? 80 : 20}] Calibration query prompt number ${i}`,
        confidence: winner === "v2" ? 0.8 : 0.2,
        source: "judge-eval",
        createdBy: "system",
        metadata: metadata,
        createdAt: new Date(since.getTime() + i * 24 * 3600 * 1000)
      }
    });
  }

  console.log("Calibration seeding complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
