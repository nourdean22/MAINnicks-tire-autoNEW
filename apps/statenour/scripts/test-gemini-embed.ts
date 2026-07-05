import { generateText, embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

async function main() {
  console.log("Testing Gemini Embedding...");
  // SECURITY: never hardcode the key. A committed key here was auto-disabled by
  // Google's secret scanner ("API key was reported as leaked") — read from env.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY not set.");
    process.exit(1);
  }
  const google = createGoogleGenerativeAI({ apiKey });
  try {
    const { embedding } = await embed({
      model: google.textEmbeddingModel("text-embedding-004"),
      value: "This is a test of the Gemini embedding system.",
    });
    console.log("Success! Dimensions:", embedding.length);
  } catch (err) {
    console.error("Gemini failed:", err);
  }
}
main();
