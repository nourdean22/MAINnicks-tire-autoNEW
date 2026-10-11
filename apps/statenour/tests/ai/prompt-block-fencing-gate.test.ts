/**
 * tests/ai/prompt-block-fencing-gate.test.ts · 2026-09-02 · S-1 completion
 *
 * The guardian-registry-drift pattern on the system-prompt assembly: ENUMERATE
 * the producers, ASSERT the subject, keep an INVERSE check. brain-context.ts
 * imports ~30 modules and splices their output into the chat system prompt.
 * Any of them that interpolates stored `.content` (BrainMemory rows, prior
 * chat turns) into that text is a door external content can take into the
 * prompt — the audit's S-1 named one (contextual-recall); a self-review found
 * four more that shipped bare AFTER S-1 was "fixed". This gate makes the set
 * explicit: interpolate `.content` → call fenceContent, or be allowlisted
 * here with a reason that a reader can check.
 *
 * Static by design: it enumerates call sites, which the behavioural test in
 * brain-context-fencing.test.ts cannot do (it asserts the blocks that fire).
 * Together: this file says "every producer is fenced or explained", that file
 * says "the fences actually reach the prompt, closed".
 *
 * Read from syntax trees (hardened 2026-10-10 after a red team found 13 bypasses):
 * imports in any form (relative, single-quoted, multi-line dynamic) are enumerated;
 * comments are gone before any test, so a comment can neither fence nor read; a
 * read through any receiver (`db.brainMemory`) or raw SQL ("BrainMemory") counts;
 * a producer that calls a reading function from another module is a reader; and
 * each `tool(...)` call is its own subject, with the same-file helpers it calls.
 * NOT closed: one fenced render vouches for an unfenced render in the same file.
 * Telling them apart needs data flow (which value reaches the prompt); a per-function
 * rule flagged ten correctly fenced producers whose fence lives in another function.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONSUMER = join(APP_ROOT, "lib/services/chat/brain-context.ts");

const printer = ts.createPrinter({ removeComments: true });
const parse = (file: string, src: string) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** A module's top-level declarations by name (`export default` also as "default"). */
function topLevel(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) out.set(s.name.text, s);
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) out.set(d.name.text, d);
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) out.set("default", s);
  }
  return out;
}

/** The code of `start` plus every same-file declaration it reaches by name, comments removed. */
function reachCode(start: ts.Node, decls: Map<string, ts.Node>, sf: ts.SourceFile): string {
  const seen = new Set<ts.Node>([start]);
  const queue = [start];
  for (let n = queue.pop(); n; n = queue.pop()) {
    (function ids(x: ts.Node): void {
      const d = ts.isIdentifier(x) ? decls.get(x.text) : undefined;
      if (d && !seen.has(d) && !(d.pos <= start.pos && d.end >= start.end)) {
        seen.add(d);
        queue.push(d);
      }
      ts.forEachChild(x, ids);
    })(n);
  }
  return [...seen].map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
}

/** A module specifier, resolved against the importing file, when it points into the app's lib/. */
function libFile(spec: string, from: string): string | null {
  const abs = spec.startsWith("@/") ? join(APP_ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : undefined;
  if (!abs || !relative(APP_ROOT, abs).split(sep).join("/").startsWith("lib/")) return null;
  for (const c of [`${abs}.ts`, `${abs}.tsx`, join(abs, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

/**
 * Modules that interpolate `.content` but deliberately do NOT fence. Each
 * entry needs a reason a reviewer can verify by opening the file. The inverse
 * check below fails if an entry stops interpolating (stale) or starts fencing
 * (then it no longer belongs here).
 */
const ALLOWLIST: Record<string, string> = {
  "@/lib/ai/predictive-prefetch":
    "FORECAST MEMORY branch serialises system-authored financial_forecast rows as JSON data · not an ingestion category · revisit if a prefetch intent ever reads gmail/drive/review categories",
  "@/lib/brain/cross-system-nudge":
    "renders the overnight belief-refresh line · LLM-derived belief text, not raw ingested content",
  "@/lib/brain/conversation-memory":
    "cross-session thread text is fenced by its consumer at brain-context.ts (cross_session, #2062) before slicing",
  "@/lib/brain/identity-snapshot":
    "renders numeric identity axes (value/100) only · no stored free text reaches the prompt",
  "@/lib/brain/skill-extractor":
    "skill protocols are instructions BY DESIGN — fencing them as data would defeat them; the poisoning path is captureSkillFromSource, which is owner-gated",
  "@/lib/ai/greene-message-matcher":
    "reads the app-seeded greene_law corpus · static curated text, not operator or third-party input",
  "@/lib/ai/dark-psychology-matcher":
    "reads the app-seeded dark_psychology corpus · static curated text, not operator or third-party input",
};

/**
 * Keyed on READING memory / chat rows, not on a render idiom. The #2064 review
 * showed why: belief-harvester renders `b.statement`, qualitative-identity
 * renders `e.text`, searchMemories returned whole rows — a `.content` regex
 * saw none of them. If a module the consumer imports reads the rows, it
 * either fences what it renders or explains here why the rows it reads can
 * carry no stored free text worth fencing.
 */
const INTERPOLATES =
  /\.(brainMemory|chatMessage)\b|"(BrainMemory|ChatMessage)"|searchColdMemory\(|semanticSearch\(|recallMemoriesForQuery\(|getContextualMemories\(|brainMemory\.(recall|search|get|list)/;

/**
 * Every lib module the consumer imports: static, dynamic, re-export, type-only; any quote, any line breaks,
 * `@/` or relative. Mapped to whether any import of it is a RUNTIME one (a type-only import calls nothing).
 */
function importedLibModuleKinds(): Map<string, boolean> {
  const sf = parse(CONSUMER, readFileSync(CONSUMER, "utf-8"));
  const specs = new Map<string, boolean>();
  (function find(n: ts.Node): void {
    const s =
      ts.isImportDeclaration(n) || ts.isExportDeclaration(n)
        ? n.moduleSpecifier
        : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
          ? n.arguments[0]
          : undefined;
    if (s && ts.isStringLiteralLike(s)) {
      const abs = s.text.startsWith("@/") ? join(APP_ROOT, s.text.slice(2)) : s.text.startsWith(".") ? resolve(dirname(CONSUMER), s.text) : undefined;
      const rel = abs && relative(APP_ROOT, abs).split(sep).join("/");
      const b = ts.isImportDeclaration(n) ? n.importClause?.namedBindings : undefined;
      const typeOnly =
        (ts.isImportDeclaration(n) && !!n.importClause?.isTypeOnly) ||
        (ts.isImportDeclaration(n) && !n.importClause?.name && !!b && ts.isNamedImports(b) && b.elements.every((e) => e.isTypeOnly)) ||
        (ts.isExportDeclaration(n) && n.isTypeOnly);
      if (rel && rel.startsWith("lib/")) specs.set(`@/${rel}`, (specs.get(`@/${rel}`) ?? false) || !typeOnly);
    }
    ts.forEachChild(n, find);
  })(sf);
  return specs;
}

function importedLibModules(): string[] {
  return [...importedLibModuleKinds().keys()].sort();
}

function resolveModule(spec: string): string | null {
  return libFile(spec, CONSUMER);
}

/** Per module: the top-level names whose code (with the same-file helpers it calls) reads rows, plus "*" if any does. */
const readingExportsCache = new Map<string, Set<string>>();
function readingExports(file: string): Set<string> {
  const hit = readingExportsCache.get(file);
  if (hit) return hit;
  const sf = parse(file, readFileSync(file, "utf-8"));
  const decls = topLevel(sf);
  const out = new Set([...decls].filter(([, n]) => INTERPOLATES.test(reachCode(n, decls, sf))).map(([name]) => name));
  if (out.size) out.add("*");
  readingExportsCache.set(file, out);
  return out;
}

/**
 * Does a module get rows by calling a reading function of another lib module (one hop)? A named import
 * counts when that export reads; a namespace import or a dynamic `import()` counts when any export does.
 * shortcut: one hop, and an import counts as a call. Make it a closure if rows ever arrive two modules away.
 */
function readsThroughImport(sf: ts.SourceFile, file: string): boolean {
  let reads = false;
  (function find(n: ts.Node): void {
    if (reads) return;
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier) && n.importClause && !n.importClause.isTypeOnly) {
      const target = libFile(n.moduleSpecifier.text, file);
      const r = target ? readingExports(target) : new Set<string>();
      const b = n.importClause.namedBindings;
      if (n.importClause.name && r.has("default")) reads = true;
      if (b && ts.isNamespaceImport(b) && r.has("*")) reads = true;
      if (b && ts.isNamedImports(b) && b.elements.some((e) => !e.isTypeOnly && r.has((e.propertyName ?? e.name).text))) reads = true;
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      const target = libFile(n.arguments[0].text, file);
      if (target && readingExports(target).has("*")) reads = true;
    }
    ts.forEachChild(n, find);
  })(sf);
  return reads;
}

const runtimeImported = importedLibModuleKinds();
const modules = importedLibModules().map((spec) => {
  const file = resolveModule(spec);
  if (!file) return { spec, file, interpolates: false, fences: false };
  const sf = parse(file, readFileSync(file, "utf-8"));
  const code = printer.printFile(sf);
  // The hop applies only to a module the consumer CALLS: a type-only import (`import type { ChatMode }`) runs nothing.
  const hop = runtimeImported.get(spec) === true && readsThroughImport(sf, file);
  return { spec, file, interpolates: INTERPOLATES.test(code) || hop, fences: /\bfenceContent\(/.test(code) };
});

/**
 * KNOWN, 2026-10-10: found when this gate learned to follow a reading function one import away. Neither
 * fenced nor explained; the owner fences it at source or moves it to ALLOWLIST with a reason a reviewer
 * can check, then deletes it here (the reverse canary fails once it is fenced or allowlisted).
 *   @/lib/ai/tactician/next-move · buildNextMoveBlock (lib/ai/tactician/next-move.ts:92) renders picks from
 *   greene-message-matcher, dark-psychology-matcher and contextual-greene-laws (which also reads kept_word and
 *   greene_contextual_pick rows) into the prompt as bare text.
 */
const KNOWN_UNFENCED = new Set(["@/lib/ai/tactician/next-move"]);

// ── the other door: TOOL RESULTS ──────────────────────────────────────────
// The same rows reach the model as tool output. Analysed PER TOOL, not per
// file (#2065 review): a file-level "contains fenceContent" let the first
// fenced tool in the 1,600-line brain.ts vouch for every other tool in it,
// while surfaceAntiPatterns and getHabitRevenueCorrelation still returned raw
// content. Each `name: tool({ ... })` block is its own subject: if it reads
// BrainMemory / chat rows AND touches `.content`, it must call fenceContent
// inside that block, or be allowlisted by name with the categories it reads.
// searchMemories returned WHOLE rows, so the key is reading + touching
// content, never a render idiom.
const TOOLS_DIR = join(APP_ROOT, "lib/ai/tools");
const READS_ROWS = /\.(brainMemory|chatMessage)\b|"(BrainMemory|ChatMessage)"|searchColdMemory\(|semanticSearch\(|recallMemoriesForQuery\(|getContextualMemories\(/;

export interface ToolAnalysis {
  file: string;
  tool: string;
  reads: boolean;
  touchesContent: boolean;
  fenced: boolean;
}

/**
 * Pure, so the mutation canary below can run it on a doctored source string.
 * Every `tool(...)` call is one subject, wherever it sits (an object property,
 * `export const x = tool(...)`, any name, any type arguments, any indent), keyed
 * by the property or variable that holds it. Its code is the call plus the
 * same-file helpers it reaches by name, comments removed.
 */
export function analyzeToolSource(file: string, src: string): ToolAnalysis[] {
  const sf = parse(file, src);
  const decls = topLevel(sf);
  const out: ToolAnalysis[] = [];
  (function walk(n: ts.Node): void {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "tool" && n.arguments.length > 0) {
      const p = n.parent;
      const named = (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
      const tool = named ?? `tool@${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      const seg = reachCode(n, decls, sf);
      out.push({ file, tool, reads: READS_ROWS.test(seg), touchesContent: /\.content\b/.test(seg), fenced: /\bfenceContent\(/.test(seg) });
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

/** Per-TOOL allowlist: reads rows + touches content, deliberately unfenced, with the categories it reads. */
const TOOL_ALLOWLIST: Record<string, string> = {
  "goals.ts:getWeeklyTargets": "WEEKLY_TARGET rows are numbers the operator set via setWeeklyTargets · app-authored ledger",
  "habits.ts:weeklyReview": "IDENTITY_SNAPSHOT (numeric axes) + coach_event rows the app writes · no stored free text from an ingestion category",
  "habits.ts:analyzeWeek": "IDENTITY_SNAPSHOT (numeric axes) + coach_event rows the app writes · no stored free text from an ingestion category",
  "tasks.ts:getDecisionsDueForReplay": "decision_replay_due rows hold decisions Nour journaled himself via journalDecision · operator-authored",
  "tasks.ts:decisionPreFlight": "IDENTITY_SNAPSHOT numeric axes only",
  "tasks.ts:dailyPulse": "IDENTITY_SNAPSHOT numeric axes only",
  "tasks.ts:endOfDay": "IDENTITY_SNAPSHOT numeric axes only",
};

const toolAnalyses: ToolAnalysis[] = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .flatMap((f) => analyzeToolSource(f, readFileSync(join(TOOLS_DIR, f), "utf-8")));
const toolKey = (t: ToolAnalysis) => `${t.file}:${t.tool}`;
const subjects = toolAnalyses.filter((t) => t.reads && t.touchesContent);

describe("tool-result fencing gate · every TOOL that reads memory or chat rows and touches content fences what it returns, or explains", () => {
  it("enumerates the tools (sanity · the splitter must find the real blocks)", () => {
    expect(toolAnalyses.length).toBeGreaterThanOrEqual(150);
    expect(subjects.length).toBeGreaterThanOrEqual(12);
    for (const k of ["brain.ts:searchMemories", "brain.ts:searchColdMemory", "brain.ts:searchConversations", "brain.ts:surfaceAntiPatterns", "brain.ts:getHabitRevenueCorrelation", "business.ts:findCustomer", "missions.ts:getMissionRetros"]) {
      expect(subjects.map(toolKey), `${k} must be a subject`).toContain(k);
    }
  });

  it("no subject tool is unfenced unless allowlisted by name with the categories it reads", () => {
    const bare = subjects.filter((t) => !t.fenced && !(toolKey(t) in TOOL_ALLOWLIST)).map(toolKey);
    expect(bare, `tools that read BrainMemory / chat rows and touch .content with no <tool_data> fence inside their own block:\n${bare.join("\n")}`).toEqual([]);
  });

  it("inverse · an allowlist entry that is no longer a subject, or now fences, must leave the list", () => {
    const stale = Object.keys(TOOL_ALLOWLIST).filter((k) => {
      const t = toolAnalyses.find((x) => toolKey(x) === k);
      return !t || !(t.reads && t.touchesContent) || t.fenced;
    });
    expect(stale, `stale TOOL_ALLOWLIST entries:\n${stale.join("\n")}`).toEqual([]);
    for (const [k, reason] of Object.entries(TOOL_ALLOWLIST)) expect(reason.length, `${k} needs a real reason`).toBeGreaterThan(20);
  });

  it("mutation canary · stripping ONE tool's fence makes exactly that tool bare (the gate sees per tool, not per file)", () => {
    const src = readFileSync(join(TOOLS_DIR, "brain.ts"), "utf-8");
    const before = analyzeToolSource("brain.ts", src);
    expect(before.find((t) => t.tool === "searchColdMemory")?.fenced).toBe(true);
    const mutated = src.replace('fenceContent("searchColdMemory", "memory_recall", m.content.slice(0, 600))', "m.content.slice(0, 600)");
    expect(mutated).not.toBe(src);
    const after = analyzeToolSource("brain.ts", mutated);
    const bareAfter = after.filter((t) => t.reads && t.touchesContent && !t.fenced).map((t) => t.tool);
    expect(bareAfter).toContain("searchColdMemory");
    // and ONLY that one changed — the other fenced tools in the same file still count as fenced
    expect(after.find((t) => t.tool === "searchMemories")?.fenced).toBe(true);
    expect(after.find((t) => t.tool === "searchConversations")?.fenced).toBe(true);
  });
});

describe("prompt-block fencing gate · every brain-context producer that renders stored content is fenced or explained", () => {
  it("enumerates the producers (sanity · the scan must not silently match nothing)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(25);
    const unresolved = modules.filter((m) => !m.file).map((m) => m.spec);
    expect(unresolved, "brain-context imports this gate cannot resolve").toEqual([]);
    // The four producers S-1 + its completion fenced must show up as such —
    // otherwise the interpolation regex no longer matches this codebase's idiom.
    const fenced = modules.filter((m) => m.interpolates && m.fences).map((m) => m.spec);
    for (const spec of [
      "@/lib/brain/contextual-recall", "@/lib/brain/memory-recall", "@/lib/brain/anticipatory-recall", "@/lib/brain/chat-recall",
      "@/lib/brain/belief-harvester", "@/lib/brain/qualitative-identity", "@/lib/brain/ghost-nick", "@/lib/brain/anticipated-questions",
      "@/lib/brain/contradiction-injector", "@/lib/brain/session-distiller", "@/lib/brain/objection-injector",
    ]) {
      expect(fenced, `${spec} must both read memory rows and fence what it renders`).toContain(spec);
    }
  });

  it("no producer that reads memory or chat rows renders without fenceContent, unless allowlisted with a reason", () => {
    const bare = modules.filter((m) => m.interpolates && !m.fences && !(m.spec in ALLOWLIST) && !KNOWN_UNFENCED.has(m.spec)).map((m) => m.spec);
    expect(
      bare,
      `brain-context producers that read BrainMemory / chat rows and render with no <tool_data> fence — fence at source (see contextual-recall's fenceRecallBlock) or allowlist WITH a reason a reviewer can check:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("inverse · an allowlist entry that no longer interpolates, or now fences, must leave the list", () => {
    const stale = Object.keys(ALLOWLIST).filter((spec) => {
      const m = modules.find((x) => x.spec === spec);
      return !m || !m.interpolates || m.fences;
    });
    expect(stale, `stale ALLOWLIST entries (not imported / no longer interpolating / now fenced):\n${stale.join("\n")}`).toEqual([]);
    for (const [spec, reason] of Object.entries(ALLOWLIST)) expect(reason.length, `${spec} needs a real reason`).toBeGreaterThan(20);
  });

  it("REVERSE CANARY: every KNOWN_UNFENCED producer is still a bare reader (delete it once fenced or allowlisted)", () => {
    const fixed = [...KNOWN_UNFENCED].filter((spec) => {
      const m = modules.find((x) => x.spec === spec);
      return !m || !m.interpolates || m.fences || spec in ALLOWLIST;
    });
    expect(fixed, `remove from KNOWN_UNFENCED:\n${fixed.join("\n")}`).toEqual([]);
  });

  it("positive control: the parts the 2026-10-10 red team found blind now see", () => {
    // Comments can neither fence nor read.
    const code = (src: string) => printer.printFile(parse("x.ts", src));
    expect(/\bfenceContent\(/.test(code("// TODO: fenceContent( before ship\nexport const a = 1;"))).toBe(false);
    expect(INTERPOLATES.test(code("// never reads prisma.brainMemory\nexport const a = 1;"))).toBe(false);
    // Any receiver, and raw SQL, are reads.
    expect(INTERPOLATES.test("const rows = await db.brainMemory.findMany();")).toBe(true);
    expect(INTERPOLATES.test('const rows = await prisma.$queryRaw`SELECT content FROM "BrainMemory"`;')).toBe(true);
    // The consumer's real imports are enumerated whatever their form (36+ today, 2026-10-10).
    expect(modules.length).toBeGreaterThanOrEqual(30);
    // Tools: a name with `_`, type arguments, a top-level const, and a comment "fence" are each their own bare subject.
    const bare = analyzeToolSource(
      "t.ts",
      [
        'import { tool } from "ai";',
        "export const tools = {",
        '  readFenced: tool({ execute: async () => (await prisma.brainMemory.findMany()).map((m) => fenceContent("r", "memory_recall", m.content)) }),',
        "  read_rows: tool({ execute: async () => (await prisma.brainMemory.findMany()).map((m) => m.content) }),",
        "    readMore: tool<{ q: string }, string[]>({ execute: async () => (await prisma.brainMemory.findMany()).map((m) => m.content) }),",
        "  readNote: tool({ // fenceContent( is a TODO",
        "    execute: async () => (await prisma.brainMemory.findMany()).map((m) => m.content) }),",
        "};",
        "export const readTop = tool({ execute: async () => (await loadRows()).map((m) => m.content) });",
        "async function loadRows() { return prisma.brainMemory.findMany(); }",
      ].join("\n"),
    ).filter((t) => t.reads && t.touchesContent && !t.fenced);
    expect(bare.map((t) => t.tool)).toEqual(["read_rows", "readMore", "readNote", "readTop"]);
  });
});
