/**
 * KnowledgeCandidateSchema bounds `content` (Codex P2 on #2553, deferred to "the ingestion PR that owns
 * that schema" - this is it).
 *
 * The schema had `content: z.string().min(1)` with no ceiling, and persistKnowledgeCandidate writes it
 * verbatim to brain_memories, where `content_tsv` (GENERATED, #2553) and the older expression index both
 * evaluate to_tsvector(content) on every write and abort the statement above Postgres's 1 MiB tsvector
 * limit. Production, read-only, 2026-09-23: the widely assumed "15,000-char cap" is not a writer rule at
 * all - every one of the 1,065 live rows at exactly 15,000 chars is one archive_document import from
 * 2026-06-24; nothing else bounds content, and the last 60 days' live maximum is 5,125 chars
 * (people:dossier, p99 <= 5k). KNOWLEDGE_CONTENT_MAX_CHARS = 32,000 is ~6x above anything written in two
 * months and ~60x below where the tsvector limit bites (the largest measured vector was 297 KB from
 * 561,770 chars), so it rejects nothing real today and makes the write-time failure unreachable.
 *
 * Reject, never truncate: a silently clipped note would hash, dedupe and index as something the source
 * never said. The only callers are the owner-authed /api/knowledge/candidates route (a Zod rejection is a
 * 400 there) and the adapters that feed it.
 *
 * Positive control (recorded): against the unbounded schema the two "over the bound" cases are red
 * (buildKnowledgeCandidate returns a candidate instead of throwing; safeParse succeeds).
 */
import { describe, expect, it } from "vitest";

import {
  buildKnowledgeCandidate,
  KNOWLEDGE_CONTENT_MAX_CHARS,
  KnowledgeCandidateSchema,
} from "@/lib/knowledge/candidate";

const build = (content: string) =>
  buildKnowledgeCandidate({
    content,
    kind: "observation",
    sourceType: "obsidian",
    sourceId: "01_Inbox/long-note.md",
    generatedBy: "human:obsidian",
    confidence: 0.9,
    evidence: [{ type: "operator_authored", value: "01_Inbox/long-note.md" }],
  });

describe("KnowledgeCandidateSchema · content is bounded", () => {
  it("pins the bound where production data and the tsvector limit put it", () => {
    expect(KNOWLEDGE_CONTENT_MAX_CHARS).toBe(32_000);
  });

  it("CONTROL: content exactly at the bound builds and round-trips through the schema", () => {
    const candidate = build("x".repeat(KNOWLEDGE_CONTENT_MAX_CHARS));
    expect(candidate.content).toHaveLength(KNOWLEDGE_CONTENT_MAX_CHARS);
    expect(KnowledgeCandidateSchema.safeParse(candidate).success).toBe(true);
  });

  it("BREAKS: one char over the bound is rejected by the builder, not truncated", () => {
    expect(() => build("x".repeat(KNOWLEDGE_CONTENT_MAX_CHARS + 1))).toThrow(/content/i);
  });

  it("BREAKS: a pre-built candidate over the bound fails the schema the submit route parses", () => {
    const candidate = build("y".repeat(100));
    const oversize = { ...candidate, content: "y".repeat(KNOWLEDGE_CONTENT_MAX_CHARS + 1) };
    const result = KnowledgeCandidateSchema.safeParse(oversize);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toContain("content");
  });

  it("the bound applies to normalised content: trailing whitespace does not count against it", () => {
    const candidate = build("z".repeat(KNOWLEDGE_CONTENT_MAX_CHARS) + "   \n\n");
    expect(candidate.content).toHaveLength(KNOWLEDGE_CONTENT_MAX_CHARS);
  });
});
