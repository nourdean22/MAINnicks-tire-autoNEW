import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error("No Gemini API key found in environment!");
    process.exit(1);
  }

  console.log("Using API key:", apiKey.slice(0, 10) + "...");
  const google = createGoogleGenerativeAI({ apiKey });

  try {
    const result = await generateText({
      model: google("gemini-2.0-flash"),
      prompt: "Who won the NBA championship in 2026?",
      tools: {
        googleSearch: google.tools.googleSearch({}) as any,
      },
    });

    console.log("Text result:", result.text);
    const providerMetadata = (result as any).providerMetadata || (result as any).experimental_providerMetadata;
    console.log("Citations/Grounding metadata:", JSON.stringify(providerMetadata, null, 2));
  } catch (error) {
    console.error("Error running Gemini search grounding:", error);
  }
}

main();
