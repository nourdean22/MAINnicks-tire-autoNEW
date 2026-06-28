import { getEmbedding } from "../lib/ai/provider";

async function main() {
  console.log("Testing provider.ts getEmbedding...");
  try {
    const embedding = await getEmbedding("This is a test.");
    console.log("Success! Dimensions:", embedding.length);
  } catch (err) {
    console.error("Failed:", err);
  }
}
main();
