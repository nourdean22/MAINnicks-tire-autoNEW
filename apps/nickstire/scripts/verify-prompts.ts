import { classifyIntent } from "../server/services/classifiers";
import { draftSmsReply } from "../server/services/nickgpt-client";
import { getDbTyped } from "../server/db";
import { nickgptDrafts } from "../drizzle/schema";

const testPrompts = [
  "Do you guys do brakes?",
  "Can I come today?",
  "Where are you located?",
  "What time do you close?",
  "I failed E-Check can you help?",
  "My car is shaking on the highway.",
  "How much are tires?"
];

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  for (const prompt of testPrompts) {
    console.log(`\n=============================================`);
    console.log(`TEST INPUT: "${prompt}"`);

    // 1. Intent classification
    const classification = await classifyIntent(prompt);
    let intent = "general";
    let confidence = 0.5;
    if (classification.ok) {
      intent = classification.topLabel;
      confidence = classification.topScore;
    }
    console.log(`Detected Intent: ${intent} (${Math.round(confidence * 100)}%)`);

    // 2. Auto-send eligibility
    const candidateLabels = [
      "asking about hours or location",
      "greeting or hello",
      "booking or appointment request",
      "pricing query or quote request",
      "complaint or negative feedback",
      "opting out of texts"
    ] as const;
    const autoSendClass = await classifyIntent(prompt, { labels: candidateLabels });
    let autoSendIntent = "other";
    let autoSendScore = 0.0;
    if (autoSendClass.ok) {
      autoSendIntent = autoSendClass.topLabel;
      autoSendScore = autoSendClass.topScore;
    }
    const lowRiskLabels = ["asking about hours or location", "greeting or hello"];
    const isAutoSendEligible = lowRiskLabels.includes(autoSendIntent) && autoSendScore >= 0.85;
    console.log(`Auto-Send Intent: ${autoSendIntent} (${Math.round(autoSendScore * 100)}%)`);
    console.log(`Auto-Send Eligible: ${isAutoSendEligible ? "YES" : "NO"}`);

    // 3. Draft reply
    const draftResult = await draftSmsReply({
      inboundMessage: prompt
    });

    if (draftResult.ok) {
      console.log(`Generated Draft: "${draftResult.draft}"`);
      console.log(`Provider/Model: ${draftResult.source} / ${draftResult.modelName}`);
      console.log(`Latency: ${draftResult.latencyMs}ms`);

      // 4. Log to database
      try {
        const [inserted] = await db.insert(nickgptDrafts).values({
          customerPhone: "2168620005",
          inboundMessage: prompt,
          draftReply: draftResult.draft,
          intent,
          confidence,
          provider: draftResult.source,
          latencyMs: draftResult.latencyMs,
          status: "draft",
          autoSent: false,
        });
        console.log(`Logged to nickgpt_drafts: YES (id: ${inserted.insertId})`);
      } catch (dbErr) {
        console.error("Failed to insert draft log into DB", dbErr);
      }
    } else {
      console.log(`Draft Generation Failed: ${draftResult.error}`);
    }
  }
}

main().catch(console.error);
