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
 * never said. Callers: the owner-authed /api/knowledge/candidates route (a Zod rejection is a 400 there),
 * and the two ingest scripts that build candidates from files and persist them directly -
 * scripts/ingest-obsidian-candidates.ts (obsidian:ingest / sync / watch) and
 * scripts/ingest-notebooklm-candidates.ts. Those pre-check normalizedContentLength() against the bound
 * BEFORE building, so an oversize note is a reported quarantine row / rejected item, not a thrown
 * ZodError counted as `failed` that flips the whole vault's sync health to "error" (self-review on
 * #2562). Note the Obsidian adapter prefixes `[title]\n`, so a note body's effective ceiling is
 * 32,000 minus the title and 3 chars - the pre-check measures the prefixed text.
 *
 * Positive control (recorded): against the unbounded schema the two "over the bound" cases are red
 * (buildKnowledgeCandidate returns a candidate instead of throwing; safeParse succeeds); against the
 * scripts without the pre-check the two ingest contracts are red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildKnowledgeCandidate,
  KNOWLEDGE_CONTENT_MAX_CHARS,
  KnowledgeCandidateSchema,
  normalizedContentLength,
} from "@/lib/knowledge/candidate";

const root = new URL("../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

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

describe("ingest scripts · an oversize source is reported before the schema throws", () => {
  it("normalizedContentLength measures exactly what the schema judges (CRLF, trailing blanks, trim)", () => {
    expect(normalizedContentLength("a\r\nb  \n\n")).toBe(3);
    const body = "x".repeat(KNOWLEDGE_CONTENT_MAX_CHARS);
    expect(normalizedContentLength(body + "   \n")).toBe(KNOWLEDGE_CONTENT_MAX_CHARS);
    expect(() => build(body + "   \n")).not.toThrow();
    expect(() => build(body + "y")).toThrow();
  });

  it("the Obsidian ingest pre-checks the PREFIXED text against the bound before building, and reports rather than fails", () => {
    const src = strip(read("scripts/ingest-obsidian-candidates.ts"));
    const check = src.indexOf("normalizedContentLength(`[${title}]\\n${parsed.content}`)");
    const build = src.indexOf("const candidate = buildObsidianCandidate(");
    expect(check).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(check);
    const between = src.slice(check, build);
    expect(between).toMatch(/> KNOWLEDGE_CONTENT_MAX_CHARS/);
    expect(between).toMatch(/counters\.quarantined \+= 1/);
    expect(between).not.toMatch(/counters\.failed/);
    expect(between).toMatch(/continue;/);
  });

  it("the NotebookLM ingest pre-checks item.text against the bound before building, and rejects rather than fails", () => {
    const src = strip(read("scripts/ingest-notebooklm-candidates.ts"));
    const check = src.indexOf("normalizedContentLength(item.text)");
    const build = src.indexOf("buildNotebookLmCandidate({");
    expect(check).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(check);
    const between = src.slice(check, build);
    expect(between).toMatch(/> KNOWLEDGE_CONTENT_MAX_CHARS/);
    expect(between).toMatch(/summary\.rejected \+= 1/);
    expect(between).not.toMatch(/failures/);
    expect(between).toMatch(/continue;/);
  });
});
