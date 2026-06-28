import { generateText, embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

async function main() {
  console.log("Testing Gemini Embedding...");
  const google = createGoogleGenerativeAI({ apiKey: "AIzaSyCTsr33-Kxuj5Awz8hhJC6AzzWw2Mk8PCg" });
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
