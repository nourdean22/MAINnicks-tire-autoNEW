#!/usr/bin/env node
/**
 * prompt-sharpen: when Nour sends a short, open-ended ask ("what about the rest", "?", "improve", "u figure out whats
 * going on with those"), add one "[sharpen]" block to the turn: the likely intent, the deliverable, the earlier asks it
 * most likely points at, the other sessions active now, the unknowns, and a rewritten prompt. The session states that
 * reading in one line and acts, instead of guessing or asking him to rephrase (job 2026-10-31-prompt-sharpener, W1).
 *
 * His words, 2026-10-30: "build some kind of system that will detect vague things i say and automaticly drq them like
 * bdnick does". On 10-31 alone he typed "what about the rest" and its cousins six or more times, each one a re-audit.
 *
 *   UserPromptSubmit hook (stdin JSON: session_id, prompt). `--scope global` is the ~/.claude/settings.json entry
 *   (bootstrap-machine.mjs) and stays silent in a project whose own settings already run this script.
 *
 * Deterministic, no model call, nothing leaves the machine. Signals, in order: a bare "?" / "huh"; an open-scope phrase
 * ("the rest", "everything else", "what else", "still missing stuff"); then, unless the ask is a report ("i saved
 * ..."), a bare vague verb ("improve", "fix it") or an unnamed plural set that is not the first words' object ("with
 * those", not "do those") and no anchor (a number, a path, a named system). An open-scope phrase that names its set
 * ("the rest of the sessions") is anchored. Asks over 20 words carry their own object and are skipped.
 * Labels and the bar: prompt-sharpen.eval.json; results table: docs/agent-os/prompt-sharpen-eval.md.
 *
 * Referents come from operator-asks.mjs's machine-local asks file for this session (its last 3 substantive asks,
 * newest first). No asks file, or no substantive earlier ask, prints nothing: no referent means no guess.
 * PRIVACY: an ask holding any <private> tag prints nothing; redacted asks are never offered as referents.
 * FAILURE POSTURE: fails OPEN. Any error prints nothing on stdout (a note on stderr) and exits 0; the block is written in
 * one write at the very end, so a hang killed by the hook timeout prints nothing either. Canary: promptSharpen.test.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_WORDS = 20;
const DANGLING_MAX_WORDS = 12;
const REF_CHARS = 140;
const OTHERS_WINDOW_MS = 6 * 3600 * 1000;

const LONE = /^(?:\?+|huh\?*|what\?+|hm+\?*|wdym\?*)$/;
// Red-team 2026-10-31: "anything left?" and "and the remaining ones?" were missed; "the remaining" counts only when it ends
// the ask ("the remaining 3 PRs" names its set).
const OPEN_SCOPE = /\b(?:the rest|everything else|anything else|what else|all the rest|the others|all of it|other stuff|missing (?:some )?stuff|what'?s (?:left|remaining)|what is (?:left|remaining)|anything left|the remaining(?: ones| stuff| items)?(?=[\s?.!]*$))\b/;
// "what else u got", "what else could u fix": he asks for suggestions, not for the rest of an earlier ask (2 of the 32
// fires on the 797 real asks, 2026-10-31). The open-scope reading would point the session at the wrong job.
const ASKS_FOR_IDEAS = /^\s+(?:(?:can|could|would|should|do)\s+(?:u|you|we)\b|(?:u|you|ya)\s+(?:got|have|think)\b)/;
const REPORT = /^(?:i|im|i'm|ive|i've|its|it's|we|we're)\b/;
const FILLER = /^(?:(?:ok(?:ay)?|also|and|n|so|plus|just|pls|please|now)\s+)+/;
const VAGUE_VERB = /^(?:improve(?: it| that)?|fix(?: it| that)?|do the rest|handle (?:it|that)|finish (?:it|that)|clean (?:it|that) up|make it better|sort it out|figure it out)$/;
// Only an unnamed plural set. "it", "that", "them" were tried and dropped: on the 1,098 real asks (2026-10-31) that arm
// fired 39 times and about 6 were vague; "send it", "run them", "start it" act on the last proposal.
const PRONOUNS = new Set(["those", "these"]);
// An open-scope phrase that names its own set is anchored: "the rest of the sessions", "what's left on the SMS lane".
const NAMED_SET = /^\s+(?:of|on|in|from)\s+(?:the\s+|my\s+|our\s+|ur\s+|your\s+)?(?!(?:it|them|this|that|those|these)\b)[a-z]/;
// A set word followed by one of these (or by nothing) is the object itself, not a determiner ("those branches").
const AFTER = new Set(["into", "to", "too", "for", "with", "on", "in", "up", "out", "again", "now", "also", "and", "n", "so", "was", "is", "are", "were", "from", "at", "over", "back", "as", "then", "pls", "please", "here", "there"]);
// shortcut: a fixed list of the nouns his clear short asks name; a missed noun reads as "no anchor" and can fire the
// dangling arm. Widen it when the eval or the fire log shows a false positive.
const ANCHORS = new Set("pr prs branch branches reel reels video videos vids session sessions sesh worktree worktrees ram memory ci check checks main camera cameras skill skills chrome terminal audit backup loop model brief test tests hook hooks deploy usage instagram telegram sentry langfuse railway ledger migration schema admin bdnick nickstire site page perplexity plan job lane pc wifi key token account".split(" "));
const SHORTHAND = { u: "you", ur: "your", n: "and", pls: "please", plz: "please", idk: "I don't know", r: "are", abt: "about", rn: "right now", ya: "yes", yea: "yes", tho: "though", sesh: "session", prob: "probably", thx: "thanks", whats: "what's", dont: "don't", im: "I'm", lets: "let's", cuz: "because", bc: "because" };

const words = (s) => s.split(/\s+/).filter(Boolean);
const bare = (w) => w.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, "");

/** The ask with slash-command tokens dropped and shorthand spelled out, for display only. */
export function expand(text) {
  return words(text.replace(/(^|\s)\/[\w:-]+/g, " ")).map((w) => {
    const k = bare(w);
    return SHORTHAND[k] ? w.replace(new RegExp(k, "i"), SHORTHAND[k]) : w;
  }).join(" ");
}

/** null, or { signal: lone|open|verb|dangling, cue }: why this ask needs a sharper reading. Pure, no I/O. */
export function detect(text) {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw || /<\/?private\b/i.test(raw)) return null;
  if (/^[/<]/.test(raw) || /^\[Request interrupted/.test(raw) || raw.includes("<task-notification")) return null;
  const t = raw.replace(/(^|\s)\/[\w:-]+/g, " ").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const ws = words(t);
  if (!ws.length || ws.length > MAX_WORDS) return null;
  if (LONE.test(t)) return { signal: "lone", cue: t };
  const open = t.match(OPEN_SCOPE);
  const after = open ? t.slice(open.index + open[0].length) : "";
  // "yes all of it", "fix all of it": the object of a go-ahead in the first two words acts on the last proposal (the
  // dangling arm's first-object rule).
  const goAhead = open?.[0] === "all of it" && words(t.slice(0, open.index).replace(FILLER, "")).length <= 1;
  if (open && !goAhead && !NAMED_SET.test(after) && !(open[0] === "what else" && ASKS_FOR_IDEAS.test(after))) return { signal: "open", cue: open[0] };
  if (REPORT.test(t) && !t.includes("?")) return null;
  const core = t.replace(FILLER, "").replace(/[\s.!?]+$/, "").replace(/\s+(?:too|pls|please|now)$/, "");
  if (VAGUE_VERB.test(core)) return { signal: "verb", cue: core };
  if (ws.length > DANGLING_MAX_WORDS || /[\d#/`"]/.test(t)) return null;
  const bs = ws.map(bare);
  if (bs.some((w) => ANCHORS.has(w))) return null;
  // At index 0 or 1 the set is the object of a go-ahead or an imperative ("do those", "yes those", "run these"): it acts
  // on the last proposal.
  const at = bs.findIndex((w, i) => i > 1 && PRONOUNS.has(w) && (i === bs.length - 1 || AFTER.has(bs[i + 1])));
  return at >= 0 ? { signal: "dangling", cue: bs[at] } : null;
}

const quote = (s) => {
  const flat = s.replace(/\s*\r?\n\s*/g, " / ");
  return flat.length > REF_CHARS ? `${flat.slice(0, REF_CHARS)}...` : flat;
};

/** The block text, or "" when there is nothing to refer back to. */
export function buildBlock(det, prompt, history, others) {
  if (!history.length) return "";
  const ref = quote(history[0]);
  const ask = quote(expand(prompt.trim()));
  const by = {
    lone: [
      "He is waiting on you, or did not follow your last reply.",
      "Three lines: what finished since his last ask, what is running, what needs him.",
      "Status or a plainer restatement: give the status, then one plain sentence on your last point.",
      `Where are we on "${ref}"? Done, running, and what needs me, in three lines.`,
    ],
    open: [
      `Cover every remaining item of the earlier ask ("${det.cue}"), not only the ones already reported.`,
      "One list of every item that ask covered, each marked done (with its receipt), running or not started; then finish the not-started ones.",
      `Which earlier ask "${det.cue}" belongs to: take 1) unless your last reply was about another one.`,
      `For "${ref}": list every item it covers, mark each done / running / not started with a receipt, and finish the ones not started.`,
    ],
    verb: [
      `Apply "${det.cue}" to the newest thing in play, most likely 1).`,
      "The change itself, with a receipt and what now works.",
      "What better means here: pick the change with the most effect on 1) and name it before you start.",
      `${det.cue}: "${ref}". Make the change, then show the receipt and what now works.`,
    ],
    dangling: [
      `"${det.cue}" points at something earlier in this session, most likely 1).`,
      `The ask itself, with "${det.cue}" read as 1).`,
      `Whether "${det.cue}" means 1) or the subject of your last reply: name the one you pick.`,
      `${ask} (where "${det.cue}" means: ${ref})`,
    ],
  }[det.signal];
  const lines = [
    "[sharpen] Short or open-ended ask: state your reading of it in one line, then act on it. If your last reply already makes it plain, ignore this block.",
    `- Ask, shorthand spelled out: "${ask}"`,
    `- Likely intent: ${by[0]}`,
    `- Deliverable: ${by[1]}`,
    `- Refers back to (this session's last asks, newest first): ${history.map((h, i) => `${i + 1}) "${quote(h)}"`).join(" ")}`,
    `- Other sessions with asks in the last 6 h: ${others.length ? others.join(", ") : "none"}`,
    `- Unknowns: ${by[2]}`,
    `- Rewritten: "${by[3]}"`,
  ];
  return `${lines.join("\n")}\n`;
}

/** `--scope global`: silent where the project's own settings already run this script (skill-recall.mjs's rule). */
function projectAlreadyRuns(root) {
  if (resolve(root) === resolve(homedir())) return false;
  try {
    const s = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    return (s.hooks?.UserPromptSubmit ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command || "").includes("prompt-sharpen.mjs")));
  } catch {
    return false;
  }
}

export async function main(argv, stdinText, env) {
  let p;
  try {
    p = JSON.parse(stdinText || "{}") || {};
  } catch {
    return "";
  }
  const session = String(p.session_id ?? "").replace(/[^\w.-]/g, "");
  if (!session || typeof p.prompt !== "string") return "";
  const scope = argv.indexOf("--scope");
  if (scope >= 0 && argv[scope + 1] === "global" && projectAlreadyRuns(resolve(env.CLAUDE_PROJECT_DIR || process.cwd()))) return "";
  const det = detect(p.prompt);
  if (!det) return "";
  // Imported here, not at the top, so a missing or broken dependency is caught below and fails open with exit 0.
  const { asksDir, readAsks } = await import("./operator-asks.mjs");
  const dir = asksDir(env);
  const file = join(dir, `${session}.md`);
  if (!existsSync(file)) return "";
  // operator-asks.mjs --refresh runs beside this hook and may already hold the current prompt. Dropping every vague ask
  // drops it too, and dropping one- or two-word asks leaves referents that name an object.
  const history = readAsks(file).map((a) => a.text.trim())
    .filter((t) => !t.includes("[private: redacted]") && !detect(t) && words(t).length >= 3)
    .reverse().slice(0, 3);
  const cutoff = Date.now() - OTHERS_WINDOW_MS;
  const others = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== `${session}.md`)
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .filter((x) => x.t >= cutoff).sort((a, b) => b.t - a.t).slice(0, 3).map((x) => x.f.slice(0, 8));
  return buildBlock(det, p.prompt, history, others);
}

if (process.argv[1] && /prompt-sharpen\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const t0 = performance.now();
  try {
    const out = await main(process.argv.slice(2), readFileSync(0, "utf8"), process.env);
    if (out) process.stdout.write(out);
    if (process.env.PROMPT_SHARPEN_TIMING) process.stderr.write(`[prompt-sharpen] work ${(performance.now() - t0).toFixed(1)} ms\n`);
  } catch (err) {
    process.stderr.write(`[prompt-sharpen] off (nothing added to the prompt): ${String(err?.message ?? err).split(/\r?\n/)[0]}\n`);
  }
  process.exitCode = 0;
}
