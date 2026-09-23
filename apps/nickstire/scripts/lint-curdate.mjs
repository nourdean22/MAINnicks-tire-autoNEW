#!/usr/bin/env node
/**
 * UTC-DATE GATE (lint:curdate) — no NEW calendar date computed from the UTC DB
 * clock in server SQL.
 *
 * WHY. apps/nickstire/AGENTS.md ("Time — Cleveland/Eastern, explicitly"): the
 * database session clock is UTC, so any SQL that turns it into a calendar date,
 * day, week, month or hour rolls over at 8 PM Eastern (7 PM in winter). From then
 * until midnight "today" is already tomorrow in Cleveland. NT-009 is the incident
 * this costs: a booking for TODAY was auto-cancelled and the customer texted while
 * they could still walk in (server/cron/jobs/crudAutomation.ts).
 *
 * WHAT COUNTS AS A SITE — a calendar function applied DIRECTLY to the DB clock:
 *   - CURDATE(), CURRENT_DATE[()], UTC_DATE[()]
 *   - DATE / DATE_FORMAT / TO_DAYS / LAST_DAY / YEARWEEK / WEEK / WEEKOFYEAR /
 *     MONTH / MONTHNAME / YEAR / QUARTER / DAY / DAYNAME / DAYOFMONTH / DAYOFWEEK /
 *     DAYOFYEAR / WEEKDAY / HOUR  (<clock> …)
 *   - DATEDIFF(<clock>, …) and DATEDIFF(…, <clock>), CAST(<clock> AS DATE),
 *     CONVERT(<clock>, DATE), EXTRACT(<calendar unit> FROM <clock>)
 * where <clock> is NOW(), SYSDATE(), UTC_TIMESTAMP[()], CURRENT_TIMESTAMP[()],
 * LOCALTIME[()] or LOCALTIMESTAMP[()] (an fsp argument like NOW(3) included),
 * optionally inside DATE_SUB / DATE_ADD / SUBDATE / ADDDATE, because date
 * arithmetic leaves it a UTC datetime. Case-insensitive, whitespace-tolerant.
 * NOT a site: the clock converted first — DATE(CONVERT_TZ(NOW(), '+00:00',
 * 'America/New_York')) — and a rolling window like NOW() - INTERVAL 24 HOUR,
 * which has no day boundary to get wrong.
 *
 * THE FIX TO USE INSTEAD (both already in the tree):
 *   - JS-computed shop date, passed as a parameter:
 *       getBusinessDateKey() from server/lib/timezoneAssert.ts  (the NT-009 fix)
 *   - SQL, when the date must stay in the query:
 *       DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))  (kpiSnapshot.ts)
 *
 * SHAPE — the knip-orphan-gate pattern: a REASON-CARRYING baseline
 * (config/curdate-baseline.json), so the gate is green on day one and only new
 * sites fail. Counted per file, not per line, because line numbers drift on every
 * unrelated edit. It is a RATCHET both ways:
 *   - a file with more sites than its baseline, or a new file, fails (NEW);
 *   - a file with fewer sites than its baseline also fails (LOWER THE BASELINE),
 *     so a fix is locked in and its slack cannot quietly absorb a new site.
 * `--baseline` only LOWERS counts and drops files that reached 0. It refuses to
 * raise a count or add a file: those need a hand edit of the JSON with an effect
 * class and a reason, which is visible in review. (Before 2026-09-23 it rewrote
 * every count, so file A going 1→0 and file B going 1→2 re-baselined green with
 * B's new site under B's old reason.)
 *
 * HOW SOURCE IS READ — a single-pass lexer for JS/TS, not regexes. SQL can only
 * live in string and template-literal TEXT, so that is all the matcher sees:
 * comments, regex literals, ${…} code and all other code are masked to spaces
 * (newlines kept, so line numbers survive). Each literal is its own SQL text: its
 * delimiters, and a template's `${` and `}`, become a barrier a match can cross
 * only as an opaque argument — DATEDIFF(${col}, NOW()) still matches, but a
 * string handed to a JS helper inside ${…} never fuses with the SQL around it
 * (lot.ts: DATEDIFF(${etDate("NOW()")}, …), where etDate() converts to ET, is
 * correct code and is not a site). Inside literal text, SQL `-- `
 * comments (dash dash + whitespace, to end of line) are masked too, unless they
 * sit inside a SQL '…' or "…" literal. A `/` starts a regex literal after
 * start-of-file, an operator or punctuator ( , = : [ ! & | ? { } ; + - * % < > ~ ^
 * or a keyword (return typeof instanceof in of new delete void throw case do else
 * yield await); otherwise it is division. (The regex stripper this replaced
 * opened a "block comment" at any slash-star inside a string (the Accept header
 * value star-slash-star) or a line comment (`// …/api/*`) and deleted everything
 * up to the next star-slash: 1,429 lines in 6 files were invisible to it, and a
 * new site at shopDriverMirror.ts:231 passed.)
 * The lexer FAILS CLOSED: an unterminated string, template, comment or regex
 * means it lost track of what is code, so the file fails instead of going quiet.
 *
 * KNOWN GAPS — each is a deliberate limit, not an oversight:
 *   - SAME-FILE SWAP: fixing one site and adding another in the same file keeps
 *     the per-file count equal and passes. Per-site fingerprints would close it at
 *     the cost of churn on every unrelated edit; the ratchet makes the fix side
 *     visible in review instead.
 *   - A clock that arrives through ${…} interpolation, a site split across two
 *     `+`-joined literals, and JS-side date math (new Date(), getHours()) are
 *     invisible — this gate reads each literal's SQL text only.
 *   - SQL `#` and `/* … *\/` comments are NOT masked (MySQL `/*! … *\/` executes),
 *     so a site written inside one still counts. That errs loud, never silent.
 *   - `/` after `)` or `]` is read as division, so `if (x) /re/.test(y)` is
 *     misread. A quote inside such a regex fails closed; a `/*` inside one opens
 *     a comment silently, which only the TypeScript-agreement case in
 *     scripts/lintCurdate.test.ts catches (none of the tree's 1,386 regexes does).
 *   - .tsx/.jsx are read as TS plus two JSX allowances (`/>` is never a regex, an
 *     apostrophe in JSX text may end at the newline); there are none in server/.
 *
 *   node scripts/lint-curdate.mjs                 # gate
 *   node scripts/lint-curdate.mjs --list          # every site, file:line
 *   node scripts/lint-curdate.mjs --baseline      # LOWER counts only, keep reasons
 *   node scripts/lint-curdate.mjs --root <dir> --baseline-file <json>   # tests
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The rule, verbatim — CI greps stderr for this phrase to prove the RIGHT failure fired. */
const RULE = "a calendar date computed from the UTC DB clock";
const EFFECTS = ["customer-send", "customer-state", "customer-view", "staff-today", "alert-dedupe", "rolling-window"];
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

// ── Lexer ────────────────────────────────────────────────────────────────────
const REGEX_AFTER_PUNCT = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const WORD_CHAR = /[\w$]|[^\x00-\x7f]/;
/** Stands in for a literal's delimiters in the masked text. Not whitespace, not a word character. */
const BARRIER = "\x00";
const SPACE = /\s/;

/**
 * Mask JS/TS source down to its string and template-literal TEXT. Returns a string
 * of the same length (newlines in place; each literal's delimiters and ${ } become
 * BARRIER) plus any lexer errors, each { index, msg }.
 * `raw` keeps literal text verbatim (no SQL `-- ` masking, escapes as written): the
 * pure JS-level classification that lintCurdate.test.ts checks against TypeScript.
 */
export function maskSource(src, { jsx = false, raw = false } = {}) {
  const n = src.length;
  const out = new Array(n);
  const errors = [];
  const hide = (k) => { out[k] = src[k] === "\n" ? "\n" : " "; };
  const keep = (k) => { out[k] = src[k]; };
  // Literal delimiters and ${ } become BARRIER, not a space: each literal is its own
  // SQL text, so a string handed to a JS call inside ${…} cannot fuse with the SQL
  // around it (DATEDIFF(${etDate("NOW()")}, …) converts NOW() in etDate — lot.ts).
  const wall = (k) => { out[k] = BARRIER; };

  let i = 0;
  let mode = "code"; // code | line | block | str | tpl | re
  let start = 0; // where the current construct opened, for error messages
  let quote = ""; // the delimiter of the current '…' / "…" string
  let sql = null; // SQL state of the current literal: { q: open SQL quote char, comment: in a `-- ` comment }
  let reClass = false; // inside [...] of a regex literal
  const frames = []; // open ${ … } substitutions: { depth, sql, start }
  // The last significant code token, for the regex-vs-division call:
  // "" start of file · a punctuator · "w:<word>" · ".w:<word>" (a property) · "v" a value.
  let prev = "";

  const regexAllowed = () =>
    prev === "" || REGEX_AFTER_PUNCT.has(prev) || (prev.startsWith("w:") && REGEX_AFTER_WORD.has(prev.slice(2)));

  /** One escape sequence inside literal text (src[i] is the backslash). */
  const literalEscape = () => {
    const d = src[i + 1];
    if (d === undefined) { hide(i); i++; return; }
    if (d === "\n" || d === "\r") { // line continuation: no character in the cooked text
      hide(i); hide(i + 1); i += 2;
      if (d === "\r" && src[i] === "\n") { hide(i); i++; }
      return;
    }
    if (raw) { keep(i); keep(i + 1); i += 2; return; }
    if (sql.comment) {
      if (d === "n" || d === "r") sql.comment = false; // a newline in the SQL text ends `-- `
      hide(i); hide(i + 1); i += 2;
      return;
    }
    if (d === "n" || d === "r" || d === "t") { out[i] = " "; out[i + 1] = " "; i += 2; return; } // SQL whitespace
    if (d === "'" || d === '"') { // an escaped quote is still a quote in the SQL text
      if (!sql.q) sql.q = d; else if (sql.q === d) sql.q = "";
    }
    keep(i); keep(i + 1); i += 2;
  };

  /** Whitespace or a control character follows `--`: MySQL's rule for a line comment. */
  const sqlCommentAfter = (k) => {
    const ch = src[k];
    if (ch === undefined) return false;
    if (ch === "\\") return src[k + 1] === "n" || src[k + 1] === "t" || src[k + 1] === "r";
    return ch <= " ";
  };

  /** One plain character of literal text. */
  const literalChar = () => {
    const c = src[i];
    if (raw) { keep(i); i++; return; }
    if (sql.comment) {
      if (c === "\n") sql.comment = false;
      hide(i); i++;
      return;
    }
    if (c === "'" || c === '"') {
      if (!sql.q) sql.q = c; else if (sql.q === c) sql.q = "";
    } else if (!sql.q && c === "-" && src[i + 1] === "-" && sqlCommentAfter(i + 2)) {
      sql.comment = true;
      hide(i); hide(i + 1); i += 2;
      return;
    }
    keep(i); i++;
  };

  if (src.startsWith("#!")) while (i < n && src[i] !== "\n") hide(i++);

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    switch (mode) {
      case "line":
        if (c === "\n") mode = "code";
        hide(i); i++;
        continue;
      case "block":
        if (c === "*" && d === "/") { hide(i); hide(i + 1); i += 2; mode = "code"; continue; }
        hide(i); i++;
        continue;
      case "re":
        if (c === "\n") {
          errors.push({ index: start, msg: "unterminated regex literal (or a division the lexer misread as one)" });
          mode = "code"; prev = "v";
          continue;
        }
        if (c === "\\") { hide(i); if (d !== undefined && d !== "\n") { hide(i + 1); i += 2; } else i++; continue; }
        if (c === "[") reClass = true;
        else if (c === "]") reClass = false;
        else if (c === "/" && !reClass) {
          hide(i); i++;
          while (i < n && WORD_CHAR.test(src[i])) hide(i++); // flags
          mode = "code"; prev = "v";
          continue;
        }
        hide(i); i++;
        continue;
      case "str":
        if (c === "\\") { literalEscape(); continue; }
        if (c === quote) { wall(i); i++; mode = "code"; prev = "v"; sql = null; continue; }
        if (c === "\n") {
          // An apostrophe in JSX text looks like an unterminated string; anywhere else it is lexer confusion.
          if (!jsx) errors.push({ index: start, msg: "unterminated string literal" });
          mode = "code"; prev = "v"; sql = null;
          continue;
        }
        literalChar();
        continue;
      case "tpl":
        if (c === "\\") { literalEscape(); continue; }
        if (c === "`") { wall(i); i++; mode = "code"; prev = "v"; sql = null; continue; }
        if (c === "$" && d === "{") {
          frames.push({ depth: 0, sql, start });
          wall(i); wall(i + 1); i += 2;
          mode = "code"; prev = "{"; sql = null;
          continue;
        }
        literalChar();
        continue;
    }

    // ── code ──
    if (c === "/" && d === "/") { hide(i); hide(i + 1); i += 2; mode = "line"; continue; }
    if (c === "/" && d === "*") { start = i; hide(i); hide(i + 1); i += 2; mode = "block"; continue; }
    if (c === "/") {
      if (jsx && d === ">") { hide(i); hide(i + 1); i += 2; prev = ">"; continue; } // `<Foo {...p} />`
      if (regexAllowed()) { start = i; reClass = false; hide(i); i++; mode = "re"; continue; }
      hide(i); i++; prev = "/";
      continue;
    }
    if (c === "'" || c === '"') { start = i; quote = c; sql = { q: "", comment: false }; wall(i); i++; mode = "str"; continue; }
    if (c === "`") { start = i; sql = { q: "", comment: false }; wall(i); i++; mode = "tpl"; continue; }
    if (c === "{") { if (frames.length) frames[frames.length - 1].depth++; hide(i); i++; prev = "{"; continue; }
    if (c === "}") {
      const f = frames[frames.length - 1];
      if (f && f.depth === 0) { wall(i); i++; frames.pop(); sql = f.sql; start = f.start; mode = "tpl"; continue; }
      hide(i); i++;
      if (f) f.depth--;
      prev = "}";
      continue;
    }
    if (SPACE.test(c)) { hide(i); i++; continue; }
    if (WORD_CHAR.test(c)) {
      let j = i;
      while (j < n && WORD_CHAR.test(src[j])) hide(j++);
      prev = (prev === "." ? ".w:" : "w:") + src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "<" && d === "/") { hide(i); hide(i + 1); i += 2; prev = "/"; continue; } // `</tag>` is never a regex
    if ((c === "+" || c === "-") && d === c) { hide(i); hide(i + 1); i += 2; prev = c + c; continue; } // x++ / 2
    if (c === "!" && d !== "=" && /[\w$)\]]/.test(src[i - 1] ?? "")) { hide(i); i++; prev = "v"; continue; } // x! / 2
    hide(i); i++; prev = c;
  }

  if (mode === "block") errors.push({ index: start, msg: "unterminated block comment" });
  else if (mode === "str") errors.push({ index: start, msg: "unterminated string literal" });
  else if (mode === "tpl") errors.push({ index: start, msg: "unterminated template literal" });
  else if (mode === "re") errors.push({ index: start, msg: "unterminated regex literal" });
  if (mode === "code" && frames.length) errors.push({ index: frames[0].start, msg: "unterminated ${…} in a template literal" });
  return { text: out.join(""), errors };
}

// ── Matcher ──────────────────────────────────────────────────────────────────
const CLOCK = String.raw`(?:(?:NOW|SYSDATE)\s*\(\s*\d*\s*\)|(?:UTC_TIMESTAMP|CURRENT_TIMESTAMP|LOCALTIMESTAMP|LOCALTIME)\b(?:\s*\(\s*\d*\s*\))?)`;
const CLOCK_EXPR = String.raw`(?:(?:DATE_SUB|DATE_ADD|SUBDATE|ADDDATE)\s*\(\s*)*${CLOCK}`;
const CALENDAR = "DATE|DATE_FORMAT|DATEDIFF|TO_DAYS|LAST_DAY|YEARWEEK|WEEK|WEEKOFYEAR|MONTH|MONTHNAME|YEAR|QUARTER|DAY|DAYNAME|DAYOFMONTH|DAYOFWEEK|DAYOFYEAR|WEEKDAY|HOUR";
/** One function argument: up to three levels of nested parentheses, no top-level comma. */
const ARG = String.raw`(?:[^(),]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*`;
const SITE = new RegExp(
  [
    String.raw`\bCURDATE\s*\(\s*\)`,
    String.raw`\b(?:CURRENT_DATE|UTC_DATE)\b(?:\s*\(\s*\))?`,
    String.raw`\b(?:${CALENDAR})\s*\(\s*${CLOCK_EXPR}`,
    String.raw`\bDATEDIFF\s*\(${ARG},\s*${CLOCK_EXPR}`,
    String.raw`\bCAST\s*\(\s*${CLOCK_EXPR}[^()]*?\bAS\s+DATE\b`,
    String.raw`\bCONVERT\s*\(\s*${CLOCK_EXPR}\s*,\s*DATE\s*\)`,
    String.raw`\bEXTRACT\s*\(\s*(?:YEAR|QUARTER|MONTH|WEEK|DAY|HOUR|YEAR_MONTH|DAY_[A-Z]+)\s+FROM\s+${CLOCK_EXPR}`,
  ].join("|"),
  "gi",
);

const lineOf = (src, index) => {
  let line = 1;
  for (let k = src.indexOf("\n"); k !== -1 && k < index; k = src.indexOf("\n", k + 1)) line++;
  return line;
};

/** Every site in one file's source: [{ line, text }], plus lexer errors: [{ line, msg }]. */
export function findSites(src, opts) {
  const { text, errors } = maskSource(src, opts);
  const sites = [...text.matchAll(SITE)].map((m) => ({ line: lineOf(src, m.index), text: m[0].replace(/[\s\x00]+/g, " ").trim() }));
  return { sites, errors: errors.map((e) => ({ line: lineOf(src, e.index), msg: e.msg })) };
}

// ── Scan ─────────────────────────────────────────────────────────────────────
function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      yield* walk(p);
    } else if (SOURCE_EXT.test(name) && !TEST_FILE.test(name)) {
      yield p;
    }
  }
}

/** Every source file under <root>/server, test files excluded: { sites: Map(file -> [{line, text}]), lexErrors, files }. */
function scan(root) {
  const serverDir = path.join(root, "server");
  // A root with nothing to scan would pass with zero sites: the silent-instrument shape. Fail instead.
  if (!existsSync(serverDir)) {
    console.error(`curdate gate: no server/ directory under ${root} — nothing to scan`);
    process.exit(2);
  }
  const sites = new Map();
  const lexErrors = [];
  let files = 0;
  for (const abs of walk(serverDir)) {
    files++;
    const file = path.relative(root, abs).split(path.sep).join("/");
    const found = findSites(readFileSync(abs, "utf8"), { jsx: /x$/.test(abs) });
    if (found.sites.length) sites.set(file, found.sites);
    for (const e of found.errors) lexErrors.push({ file, ...e });
  }
  if (files === 0) {
    console.error(`curdate gate: server/ under ${root} holds no source files — nothing to scan`);
    process.exit(2);
  }
  return { sites, lexErrors, files };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const FLAGS = new Set(["--baseline", "--list"]);
  const VALUED = new Set(["--root", "--baseline-file"]);
  for (let k = 0; k < argv.length; k++) {
    if (FLAGS.has(argv[k])) continue;
    // A valued flag with no value used to fall back to the live repo and pass: fail instead.
    if (VALUED.has(argv[k]) && argv[k + 1] !== undefined && !argv[k + 1].startsWith("--")) {
      k++;
      continue;
    }
    console.error(`curdate gate: bad argument "${argv[k]}"\n  usage: lint-curdate.mjs [--list | --baseline] [--root <dir>] [--baseline-file <json>]`);
    process.exit(2);
  }
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ROOT = path.resolve(opt("--root") ?? path.join(import.meta.dirname, ".."));
  const BASELINE = path.resolve(opt("--baseline-file") ?? path.join(ROOT, "config", "curdate-baseline.json"));
  const mode = argv.includes("--baseline") ? "baseline" : argv.includes("--list") ? "list" : "gate";

  const { sites, lexErrors, files } = scan(ROOT);
  const counts = new Map([...sites].map(([f, s]) => [f, s.length]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const reportLexErrors = () => {
    if (!lexErrors.length) return;
    console.error(`\n✗ The lexer lost track of what is code, string or comment in ${lexErrors.length} place(s), so it cannot vouch for those files (fails closed):\n`);
    for (const e of lexErrors) console.error(`    ${e.file}:${e.line}  ${e.msg}`);
    console.error(`\n  Valid TS never ends mid-literal: the file is malformed, or the lexer misread it (see KNOWN GAPS in scripts/lint-curdate.mjs).\n`);
  };

  const readBaseline = () => {
    try {
      return JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch (err) {
      console.error(`curdate gate: cannot read baseline ${BASELINE}: ${err.message}`);
      process.exit(1);
    }
  };

  if (mode === "list") {
    for (const [file, list] of [...sites].sort(([a], [b]) => a.localeCompare(b))) {
      for (const s of list) console.log(`${file}:${s.line}  ${s.text}`);
    }
    console.log(`curdate gate — ${files} file(s) scanned; ${total} site(s) in ${counts.size} file(s)`);
    reportLexErrors();
    process.exit(lexErrors.length ? 1 : 0);
  }

  if (mode === "baseline") {
    if (!existsSync(BASELINE)) {
      console.error(`curdate gate: no baseline at ${BASELINE}. --baseline only lowers counts; write the first one by hand.`);
      process.exit(1);
    }
    if (lexErrors.length) {
      reportLexErrors();
      console.error(`  Nothing was written: a count from a file the lexer cannot read is not a count to lower a baseline to.`);
      process.exit(1);
    }
    const prev = readBaseline();
    const entries = Array.isArray(prev.entries) ? prev.entries : [];
    const listed = new Set(entries.map((e) => e?.file));
    const refused = [];
    // Per ENTRY, not per file: with a duplicate entry a per-file lookup sees only the
    // last one, and the rewrite would raise the first under its reviewed reason.
    for (const e of entries) {
      const n = counts.get(e?.file) ?? 0;
      if (n > 0 && !(Number.isInteger(e?.count) && n <= e.count)) refused.push({ file: e?.file, was: Number.isInteger(e?.count) ? e.count : 0, n });
    }
    for (const [file, n] of counts) if (!listed.has(file)) refused.push({ file, was: 0, n });
    if (refused.length) {
      console.error(`\n✗ --baseline only LOWERS counts. It will not raise a count or add a file: that is how a re-baseline launders a new site in under an old reason.\n`);
      for (const r of refused) console.error(`    ${r.file}  ${r.was} → ${r.n}`);
      console.error(
        `\n  Each is ${RULE}. Fix it (getBusinessDateKey() from server/lib/timezoneAssert.ts, or\n` +
          `  DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')) in SQL), or hand-edit ${path.relative(ROOT, BASELINE)}\n` +
          `  with the count, an effect class and a reason you wrote after reading the code. Nothing was written.\n`,
      );
      process.exit(1);
    }
    const kept = [];
    const lowered = [];
    for (const e of entries) {
      const n = counts.get(e?.file) ?? 0;
      if (Number.isInteger(e?.count) && n < e.count) lowered.push(`${e.file}  ${e.count} → ${n}${n === 0 ? "  (removed)" : ""}`);
      if (n > 0) kept.push({ ...e, count: n });
    }
    kept.sort((a, b) => a.file.localeCompare(b.file));
    writeFileSync(BASELINE, JSON.stringify({ ...prev, entries: kept }, null, 2) + "\n");
    for (const l of lowered) console.log(`  lowered ${l}`);
    console.log(`curdate baseline: ${lowered.length} entr(ies) lowered; ${kept.length} files, ${kept.reduce((s, e) => s + e.count, 0)} sites`);
    process.exit(0);
  }

  // ── gate ──
  if (!existsSync(BASELINE)) {
    console.error(`curdate gate: no baseline at ${BASELINE}`);
    process.exit(1);
  }
  const list = readBaseline();
  const entries = Array.isArray(list.entries) ? list.entries : [];

  // An entry the ratchet cannot read is a hole in it: a missing count compares false
  // against every n (`n > undefined`), so it would admit unlimited new sites.
  const invalid = [];
  const seen = new Set();
  for (const e of entries) {
    const name = typeof e?.file === "string" && e.file ? e.file : JSON.stringify(e);
    const why = [];
    if (seen.has(e?.file)) why.push("duplicate entry");
    seen.add(e?.file);
    if (!Number.isInteger(e?.count) || e.count < 1) why.push("count must be a positive integer");
    if (typeof e?.effect !== "string" || !EFFECTS.includes(e.effect)) why.push(`effect class must be one of ${EFFECTS.join(", ")}`);
    if (typeof e?.reason !== "string" || !e.reason.trim()) why.push("reason is empty");
    if (why.length) invalid.push(`${name} — ${why.join("; ")}`);
  }
  const allowed = new Map(entries.map((e) => [e?.file, e]));

  const fresh = [];
  const lowered = [];
  for (const [file, n] of counts) {
    const was = allowed.get(file)?.count;
    if (!(Number.isInteger(was) && n <= was)) fresh.push({ file, n, was: Number.isInteger(was) ? was : 0 });
  }
  for (const e of entries) {
    const n = counts.get(e?.file) ?? 0;
    if (Number.isInteger(e?.count) && n < e.count) lowered.push({ file: e.file, n, was: e.count });
  }

  console.log(
    `curdate gate — ${files} file(s) scanned; ${total} site(s) in ${counts.size} file(s); ` +
      `baseline ${entries.reduce((s, e) => s + (Number.isInteger(e?.count) ? e.count : 0), 0)} in ${entries.length}`,
  );

  if (fresh.length) {
    console.error(`\n✗ NEW site(s): ${RULE}. The DB session clock is UTC, so "today" flips at 8 PM Eastern (7 PM in winter):\n`);
    for (const f of fresh) {
      console.error(`    ${f.file}  ${f.was} → ${f.n}`);
      for (const s of sites.get(f.file)) console.error(`      L${s.line}  ${s.text}`);
    }
    console.error(
      `\n  Use the shop date instead:\n` +
        `    getBusinessDateKey() from server/lib/timezoneAssert.ts, passed as a parameter\n` +
        `    or DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')) in SQL\n` +
        `  A deliberate UTC date goes in config/curdate-baseline.json by hand, with an effect class and a reason.\n`,
    );
  }
  if (lowered.length) {
    console.error(`\n✗ A site was fixed — lower the baseline so the slack cannot absorb a new one:\n`);
    for (const f of lowered) console.error(`    ${f.file}  ${f.was} → ${f.n}`);
    console.error(`\n  node scripts/lint-curdate.mjs --baseline   (lowers counts only; keeps reasons)\n`);
  }
  if (invalid.length) {
    console.error(`\n✗ ${invalid.length} baseline entr(ies) without a valid count, effect class or reason:\n`);
    for (const line of invalid) console.error(`    ${line}`);
  }
  reportLexErrors();
  if (fresh.length || lowered.length || invalid.length || lexErrors.length) process.exit(1);
  console.log(`✓ no new site (${RULE})`);
}

// The test imports maskSource/findSites with this set. The default is to RUN: a
// main-module check (import.meta.url vs argv[1]) differs under a junction or symlink
// and would turn the gate into a silent no-op, so the opt-out is explicit instead.
if (process.env.CURDATE_GATE_AS_LIBRARY !== "1") main();
