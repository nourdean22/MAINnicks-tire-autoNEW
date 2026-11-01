/**
 * Operator copy on bdnick.info reads like a person wrote it (job 2026-11-01-statenour-humanizer-pages,
 * the StateNour half of Nour's 2026-10-30 antislop + humanizer ask; the nickstire.org half is
 * apps/nickstire/client/src/__tests__/humanizer-tells-pages.test.ts).
 *
 * Scans every UI file under app/ (not app/api), components/, features/ and hooks/, plus the two config
 * files whose strings render on /system pages (config/crons.ts on /system/crons, config/repos.ts on the
 * repos panel). Out of scope by ruling: prompt text (`prompt:` values), Nick's chat outputs, tests.
 *
 * Comments are removed by a small lexer that knows where strings are, so `accept="image/*"` and
 * `"a // b"` stay copy. Blanked before matching: a lone "—" placeholder glyph and `${a}–${b}` ranges.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "components", "features", "hooks"];
const CONFIG = ["config/crons.ts", "config/repos.ts"];

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])(?<![0-9] ?[ap]m)–|–(?![0-9$])/i;
const NEGATION_TAIL = /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|spin)\b/i;
/** A dash inside code, not copy: the header-diet parser splits titles on dashes. */
const CODE_DASH = ["const SEPARATORS = /"];

function uiFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!["node_modules", "__tests__", "api"].includes(e.name)) uiFiles(rel, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$|\.(test|spec|stories)\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/**
 * Blank `//` and `/* *\/` comments (JSX `{/* *\/}` included) outside string literals, keeping newlines so
 * line numbers hold. `"` and `'` strings end at a newline, so an apostrophe in JSX text costs one line.
 */
export function stripComments(src: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === quote || (c === "\n" && quote !== "`")) quote = "";
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else out += c;
  }
  return out;
}

/** Lines of copy with comments, placeholder glyphs, prompt text and template ranges blanked. */
export function copyLines(src: string): string[] {
  return stripComments(src)
    .split(/\r?\n/)
    .map((l) =>
      CODE_DASH.some((c) => l.includes(c))
        ? ""
        : l
            .replace(/\bprompt:\s*(["'`]).*?(?<!\\)\1/g, "prompt: ''")
            .replace(/(["'`])[—–]\1/g, "$1$1")
            .replace(/>\s*[—–]\s*</g, "><")
            .replace(/\}–(?=\$\{)/g, "} "),
    );
}

const FILES = [...DIRS.flatMap((d) => uiFiles(d)), ...CONFIG];

function scan(re: RegExp): string[] {
  const bad: string[] = [];
  for (const rel of FILES) {
    copyLines(readFileSync(join(ROOT, rel), "utf8")).forEach((l, i) => {
      if (re.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  return bad;
}

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells and spares ranges, comments, placeholders and prompt text", () => {
    const hit = (s: string) => copyLines(s).some((l) => DASH.test(l));
    expect(hit('toast.error("Nothing to resolve — it was already gone");')).toBe(true);
    expect(hit("<p>Read failed -- unknown</p>")).toBe(true);
    expect(hit('label: "Mon–Sat"')).toBe(true);
    expect(hit("<span>{name} – {role}</span>")).toBe(true);
    expect(hit('label: "9 AM–4 PM"')).toBe(false);
    expect(hit("`${fmt(a)}–${fmt(b)}`")).toBe(false);
    expect(hit('value ?? "—"')).toBe(false);
    expect(hit("<td>—</td>")).toBe(false);
    expect(hit("// a note — in a comment")).toBe(false);
    expect(hit("{/* JSX — comment */}")).toBe(false);
    expect(hit('{ cmd: "/x", label: "X", prompt: "Give me X — today" }')).toBe(false);
    expect(hit('{ cmd: "/x", label: "X — y", prompt: "Give me X" }')).toBe(true);
    expect(NEGATION_TAIL.test("Fast, no guessing")).toBe(true);
    expect(NEGATION_TAIL.test("no login, no setup")).toBe(true);
    expect(NEGATION_TAIL.test("No conviction")).toBe(false);
  });

  it("the comment lexer keeps copy that only looks like a comment", () => {
    // `image/*` once opened a block comment that blanked the next 15 lines of a real page.
    const src = ['<input accept="image/*" />', "<p>Memory — after the input</p>", 'const u = "https://x.y/a // b — c";', "x(); // gone — really"].join("\n");
    const lines = copyLines(src);
    expect(lines[1]).toContain("Memory —");
    expect(lines[2]).toContain("// b — c");
    expect(lines[3]).not.toContain("gone");
  });

  it("scans the UI tree (the scanner saw its subject)", () => {
    expect(FILES.length).toBeGreaterThan(300);
    for (const f of ["components/command-palette.tsx", "app/(mastery)/system/inbox/page.tsx", "hooks/use-slash-commands.ts", "config/crons.ts"]) {
      expect(FILES, f).toContain(f);
    }
    expect(FILES.some((f) => f.startsWith("app/api/"))).toBe(false);
    expect(FILES.some((f) => /\.test\.tsx?$/.test(f))).toBe(false);
    // The code-dash exemption still names a live line, so it cannot silently widen.
    expect(readFileSync(join(ROOT, "components/layout/header-diet.ts"), "utf8")).toContain(CODE_DASH[0]);
  });
});

describe("operator copy on bdnick.info", () => {
  it("carries no prose dash", () => {
    expect(scan(DASH)).toEqual([]);
  });

  it("carries no stacked 'no X, no Y' tail", () => {
    expect(scan(NEGATION_TAIL)).toEqual([]);
  });
});

/**
 * Sentence case (docs/design/ui-v2/PLAN.md, UI v3 W1a). The CSS net in app/styles/base.css can lift an
 * `uppercase` class, but it cannot lower an authored "Memory Queue Clear". A label is flagged when it is
 * short and title-shaped: every word longer than three letters is capitalized and at least one of them,
 * after the first word, is not a proper noun. A sentence that quotes a control ("Tap Pin on any reply")
 * has lowercase words and passes.
 */
const PROPER = new Set(
  (
    "Nick Nour NOUR Tire Auto Google Gmail Telegram Railway Neon GitHub Inngest Ollama Langfuse Apple Instagram Facebook " +
    "TikTok YouTube Vapi Twilio Stripe ShopDriver Obsidian Perplexity Claude Codex Gemini OpenAI Groq Firecrawl Sentry " +
    "Prisma Postgres Euclid Cleveland Monday Tuesday Wednesday Thursday Friday Saturday Sunday Ebbinghaus Ultron Greene " +
    "Stitch NotebookLM Drive Calendar Health Places Watch Geist Mono " +
    // Page names, which a sentence names like places ("Go to Missions", "Saved to the Inbox").
    "Home Chat Missions Journal Brain People Stats Body System Crons Actions Inbox Settings Rhythms Mastery"
  ).split(" "),
);
/** Coined names, page names and titles that keep their capitals, each a whole label. */
const NAMES = new Set([
  "Execution Deck", "Cron Deck", "Power Atlas", "Reality Mode", "Reality Mode on", "Reality Mode off", "Private Lab", "Photo Improver",
  "View in Actions", "Review in System", "Open Money", "48 Laws", "33 Strategies", "50th Law", "Human Nature",
  "Balanced Polymath", "Physical Sentinel", "Mind Strategist", "Empire Architect", "Sovereign Influencer",
]);

export function isTitleCase(text: string): boolean {
  if (!/^[A-Z0-9][A-Za-z0-9' &,:()/+-]*$/.test(text.trim())) return false;
  // A parenthetical is a note on the label ("Run cron job (manually)"); the label's own words decide.
  const t = text.replace(/\([^)]*\)?/g, " ").replace(/[\s:,]+$/, "").trim();
  if (NAMES.has(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 7) return false;
  const bare = words.map((w) => w.replace(/[^A-Za-z']/g, "").replace(/'s$/, ""));
  if (bare.some((w) => w.length > 3 && /^[a-z]/.test(w))) return false;
  return bare.slice(1).some((w) => /^[A-Z][a-z]/.test(w) && !PROPER.has(w));
}

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;

/**
 * Every piece of copy on one comment-free line: each string literal (lexed left to right, so a short
 * `"G"` cannot shift the pairing), then the JSX text left between tags and braces once strings are
 * removed. Labels joined by " · " are tested piece by piece.
 */
export function labelsIn(line: string): string[] {
  const l = line.replace(/\bd="[^"]*"/g, ""); // SVG path data
  const strings = [...l.matchAll(STRING)].map((m) => m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, " "));
  // JSX text: after a `>` or `}`, or at the start of a line that is not a list of identifiers. Text after
  // `<` or `{` is a type argument or an import list (`Record<A, B>`, `export { X, Y }`).
  const rest = l.replace(STRING, " ");
  const text = [...rest.matchAll(/(^|[>}])([^<>{}]*)/g)]
    .filter((m) => m[1] !== "" || !/[,;]$/.test(rest.trim()))
    .map((m) => m[2]);
  return [...strings, ...text].flatMap((s) => s.split(/\s+·\s+/)).map((s) => s.trim()).filter((s) => s.length >= 3);
}

function titleCaseLabels(): string[] {
  const bad: string[] = [];
  for (const rel of FILES) {
    copyLines(readFileSync(join(ROOT, rel), "utf8")).forEach((l, i) => {
      if (/^\s*(?:import|export\s+(?:type|interface))\b/.test(l)) return;
      for (const s of labelsIn(l)) if (isTitleCase(s)) bad.push(`${rel}:${i + 1}: ${s}`);
    });
  }
  return bad;
}

describe("sentence case (positive control)", () => {
  it("flags title-case labels and spares names, sentences and acronyms", () => {
    for (const s of ["Memory Queue Clear", "Overwrite Conflicting", "Submit & Continue", "Correct Status:", "Run Cron Job (manually)", "Quarantined Items ("]) {
      expect(isTitleCase(s), s).toBe(true);
    }
    for (const s of ["Memory queue clear", "Execution Deck", "Ghost Nick predictions", "Tap Pin on any assistant reply", "AI spend", "Nick's Tire", "Greene · 48 Laws", "Skill library in Brain", "Open it. Then Retry"]) {
      expect(isTitleCase(s), s).toBe(false);
    }
  });

  it("extraction reaches every copy shape a page uses", () => {
    const flagged = (line: string) => labelsIn(line).filter(isTitleCase);
    // A one-letter string before the label once shifted quote pairing and hid it.
    expect(flagged('  { keys: ["G", "H"], action: "Go to Knowledge Review", section: "System Ops" },')).toEqual(["Go to Knowledge Review", "System Ops"]);
    expect(flagged("              Quarantined Items ({items.length})")).toEqual(["Quarantined Items ("]);
    expect(flagged("  Panel: ComponentType<InspectorPanelProps>;")).toEqual([]);
    expect(flagged("<span>Docs Grounded: {n}/{m}</span>")).toEqual(["Docs Grounded:"]);
    expect(flagged('<Button onClick={go}>Exit Focus</Button>')).toEqual(["Exit Focus"]);
    expect(flagged('label: "Reality Mode · Show Inline"')).toEqual(["Show Inline"]);
    expect(flagged("const total = Array.from(items).length; return <Foo bar={x} />;")).toEqual([]);
    expect(flagged("const PANELS: Record<EntityKind, InspectorRenderer> = {};")).toEqual([]);
    expect(flagged("  Play, Timer, AlertTriangle, ArrowRight, CheckCircle2,")).toEqual([]);
    expect(flagged("export { Tooltip, TooltipTrigger, TooltipContent };")).toEqual([]);
    expect(flagged('<path d="M12 19V5m0 0l-7 7m7-7l7 7" />')).toEqual([]);
  });
});

describe("operator copy on bdnick.info is sentence case", () => {
  it("carries no title-case label, heading, button or toast", () => {
    expect(titleCaseLabels()).toEqual([]);
  });
});
