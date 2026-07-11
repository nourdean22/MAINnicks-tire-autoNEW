/**
 * Compatibility entrypoint.
 *
 * The original importer wrote NotebookLM output directly into BrainMemory.
 * The governed importer preserves the CLI contract while routing every item
 * through the shared KnowledgeCandidate evidence, confidence, risk, review,
 * and action-approval gate.
 */
import path from "node:path";
import { resolveInsideRoot } from "../lib/knowledge/path-safety";

const args = process.argv.slice(2);
const slugIndex = args.indexOf("--slug");
const fileIndex = args.indexOf("--file");

if (fileIndex >= 0) {
  const slug = slugIndex >= 0 ? args[slugIndex + 1]?.trim() : "";
  const requestedFile = args[fileIndex + 1]?.trim();
  if (!slug || !requestedFile) {
    throw new Error("--file requires a valid --slug and file path.");
  }

  const monorepoRoot = path.resolve(__dirname, "../../..");
  const packDir = path.join(monorepoRoot, "research-packs", slug);
  process.argv[fileIndex + 3] = resolveInsideRoot(packDir, requestedFile);
}

await import("./ingest-notebooklm-candidates");
