import { getDbTyped } from "../server/db";
import { nickgptTrainingExamples } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Exporting NickGPT learning corpus...");
  const db = await getDbTyped();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  try {
    const examples = await db.select()
      .from(nickgptTrainingExamples)
      .where(eq(nickgptTrainingExamples.approvedForTraining, true));

    console.log(`Found ${examples.length} approved training examples.`);

    const outputDir = path.join(process.cwd(), "data", "training");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, "nickgpt-learning.jsonl");
    const stream = fs.createWriteStream(outputPath, { flags: "w" });

    for (const ex of examples) {
      const systemPrompt = "You are Nick, the service manager at Nick's Tire & Auto, a straight-shooting auto repair shop in Cleveland, OH. Be brief, warm, eager, and use shop language (bring it by, drop it off, free check first).";
      
      const line = JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: ex.inboundMessage },
          { role: "assistant", content: ex.operatorFinalReply }
        ],
        metadata: {
          id: ex.id,
          intent: ex.intent,
          service: ex.serviceMention,
          createdAt: ex.createdAt
        }
      });
      stream.write(line + "\n");
    }

    stream.end();
    console.log(`Corpus exported successfully to ${outputPath}`);
  } catch (err) {
    console.error("Failed to export training corpus", err);
    process.exit(1);
  }
}

main();
