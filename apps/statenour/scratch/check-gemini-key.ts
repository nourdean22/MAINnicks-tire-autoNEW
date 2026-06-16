import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

console.log("=== ENV CHECK ===");
console.log("GEMINI_API_KEY set?", !!process.env.GEMINI_API_KEY);
console.log("GOOGLE_GENERATIVE_AI_API_KEY set?", !!process.env.GOOGLE_GENERATIVE_AI_API_KEY);
console.log("PERPLEXITY_API_KEY set?", !!process.env.PERPLEXITY_API_KEY);
console.log("TAVILY_API_KEY set?", !!process.env.TAVILY_API_KEY);
console.log("EXA_API_KEY set?", !!process.env.EXA_API_KEY);
