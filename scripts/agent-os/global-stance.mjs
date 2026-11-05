#!/usr/bin/env node
/**
 * global-stance: copy .agents/core/STANDING-ORDERS.md into the user-level instruction file of every agent program on
 * this PC, so the stance holds outside this repo and on any account signed in here (Nour, 2026-11-05).
 *
 *   node scripts/agent-os/global-stance.mjs            install or refresh, one receipt line per program
 *   node scripts/agent-os/global-stance.mjs --check    report only (ok | MISSING | DRIFT), exit 1 when not clean
 *   --home <dir>                                       act on <dir> instead of the OS home (tests)
 *
 * The block goes between its markers; text around it stays, with line endings normalised to LF. A file that is not
 * UTF-8, or whose markers are not one begin line then one end line, is left alone and reported.
 * A file is backed up to <home>/.claude/bootstrap-backup/ before it changes. A second run changes nothing.
 * Cursor keeps user rules in its own database and claude.ai keeps preferences on the account, so neither is here:
 * both take the same text by paste. Canary: globalStance.test.mjs.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "./plugin-index.mjs";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".agents", "core", "STANDING-ORDERS.md");
const BEGIN_PREFIX = "<!-- nourcity-standing-orders:begin";
const BEGIN = `${BEGIN_PREFIX} (written by scripts/agent-os/global-stance.mjs; edit the repo copy) -->`;
const END = "<!-- nourcity-standing-orders:end -->";
const VSCODE_HEADER = '---\napplyTo: "**"\n---\n\n';

export const targets = (home, env = {}, platform = process.platform) => [
  ["Claude", join(configDir(home), "CLAUDE.md")],
  ["Codex", join(env.CODEX_HOME ?? join(home, ".codex"), "AGENTS.md")],
  ["Gemini", join(home, ".gemini", "GEMINI.md")],
  ["Copilot CLI", join(env.COPILOT_HOME ?? join(home, ".copilot"), "copilot-instructions.md")],
  ["VS Code Copilot", join(home, ...(platform === "win32" ? ["AppData", "Roaming"] : [".config"]), "Code", "User", "prompts", "nour-standing-orders.instructions.md")],
];

const lf = (text) => text.replaceAll("\r\n", "\n");

const occurrences = (text, needle) => text.split(needle).length - 1;

/** Exactly one begin line, then one end line, or none of either; anything else could cost his text. */
function blockSpan(text) {
  const begins = occurrences(text, BEGIN_PREFIX);
  const ends = occurrences(text, END);
  if (begins === 0 && ends === 0) return "none";
  if (begins !== 1 || ends !== 1) return null;
  const start = text.indexOf(BEGIN_PREFIX);
  const end = text.indexOf(END);
  const ownLines = (start === 0 || text[start - 1] === "\n") && text[end - 1] === "\n" && /^(\n|$)/.test(text.slice(end + END.length));
  return end > start && ownLines ? { start, end: end + END.length } : null;
}

/** The target's text with the block in place, or null when its markers are broken. */
function withBlock(current, block, file) {
  let text = current ?? "";
  if (file.endsWith(".instructions.md") && !/^\uFEFF?---\n/.test(text)) text = VSCODE_HEADER + text;
  const span = blockSpan(text);
  if (span === null) return null;
  if (span === "none") return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${block}\n`;
  return `${text.slice(0, span.start)}${block}${text.slice(span.end)}`;
}

/** The file as text, or null when it is not UTF-8 and rewriting it would destroy it. */
function readText(file) {
  const bytes = readFileSync(file);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0)) return null;
  try {
    return lf(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return null;
  }
}

function main(args) {
  const homeAt = args.indexOf("--home");
  const home = homeAt === -1 ? homedir() : resolve(args[homeAt + 1]);
  const check = args.includes("--check");
  const block = `${BEGIN}\n${lf(readFileSync(SOURCE, "utf8")).trim()}\n${END}`;
  const stamp = new Date().toISOString().replaceAll(":", "-");
  let clean = true;
  for (const [name, file] of targets(home, homeAt === -1 ? process.env : {})) {
    const current = existsSync(file) ? readText(file) : undefined;
    const next = current === null ? null : withBlock(current, block, file);
    if (next === null) {
      clean = false;
      console.log(`[stance] ${name}: DRIFT, ${current === null ? "not UTF-8" : "broken markers"} in ${file}; fix by hand`);
    } else if (next === current) {
      console.log(`[stance] ${name}: ok`);
    } else if (check) {
      clean = false;
      console.log(`[stance] ${name}: ${current?.includes(BEGIN_PREFIX) ? "DRIFT" : "MISSING"} (${file}), fix: node scripts/agent-os/global-stance.mjs`);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      if (current !== undefined) {
        const backups = join(home, ".claude", "bootstrap-backup");
        mkdirSync(backups, { recursive: true });
        copyFileSync(file, join(backups, `${stamp}-${name.replaceAll(" ", "-")}-${basename(file)}`));
      }
      writeFileSync(file, next);
      console.log(`[stance] ${name}: installed (${file})`);
    }
  }
  return clean ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
