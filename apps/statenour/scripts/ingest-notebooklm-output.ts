/**
 * Compatibility entrypoint.
 *
 * The original importer wrote NotebookLM output directly into BrainMemory.
 * The governed importer preserves the CLI contract while routing every item
 * through the shared KnowledgeCandidate evidence, confidence, risk, review,
 * and action-approval gate.
 */
import "./ingest-notebooklm-candidates";
