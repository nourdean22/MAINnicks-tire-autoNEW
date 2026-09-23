/**
 * customerCorpus — the pure half of `scripts/diagnostics/customer-corpus-census.mts`.
 *
 * WHY THIS EXISTS. The 2026-09-23 research mission asked what Nick's customers
 * actually want and what it costs them to get it, from three months of calls
 * and texts. Every existing reader answers a narrower question on one channel:
 * the recovery queue counts CALLS for a sales lane, `tire-size-recall` measures
 * one extractor, `vapi-90d-report` counts tool writes. None sees a customer who
 * called, was told "come in", texted twice and never arrived as ONE episode, and
 * none counts what the customer had to repeat. This module is that reading,
 * kept pure so each rule is pinned by a test before it touches production text.
 *
 * TWO DEFECTS IN THE LIVE KERNEL THIS MEASURES RATHER THAN SILENTLY FIXES.
 *   1. `detectIntents` (server/services/vapiCallClassifier.ts) has no pattern for
 *      a bare tire request: "I need two tires for my Honda" yields NO intent,
 *      so `intentFamily` files it under "general" and `classifyCall` can end it
 *      at `unknown`. The unwired `classifyVoiceDemand` reads it as tire_service;
 *      the census prints how many production calls the live kernel filed
 *      intent-less while the demand classifier found a tire need — the number
 *      that decides whether the eval cron switches classifiers.
 *   2. `episodeKey` (shared/callTaxonomy.ts) buckets by fixed UTC days, so the
 *      boundary falls at 8 PM Eastern (7 PM in winter): two calls ten minutes
 *      apart across it are two episodes, and a Tuesday-6pm/Wednesday-9am pair
 *      can be one or two depending on the clock, not the customer. `sessionize`
 *      uses a GAP instead: a contact within `gapMinutes` of the previous one
 *      continues the episode. The census reports both counts side by side.
 *
 * PRIVACY. Transcripts and texts carry names, numbers, plates and addresses.
 * Nothing here returns raw text except `excerptAround`, which masks FIRST and
 * then cuts a short window — mask before you match, match before you print
 * (the rule `tire-size-recall.mjs` paid for). Phones become a salted hash.
 */
import { createHash } from "node:crypto";
import { BUSINESS } from "../../shared/business";
import {
  classifyVoiceDemand,
  type VoiceFriction,
  type VoiceIntent,
} from "../../server/services/voiceDemandClassifier";

/* ─────────────────────────────── identity ─────────────────────────────── */

/** Last ten digits, or "" when the input carries fewer than ten. */
export function phoneKey(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** A per-run salted hash: stable inside one report, unlinkable across runs. */
export function customerToken(phone10: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${phone10}`).digest("hex").slice(0, 10);
}

/* ──────────────────────────────── masking ─────────────────────────────── */

/**
 * Replace every identifier shape a call or text carries. Order matters: emails
 * and phones before bare digit runs, so a formatted number cannot survive as
 * fragments.
 */
export function maskPII(text: string): string {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]")
    .replace(/\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g, "[PHONE]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[VIN]")
    .replace(/\b\d{7,}\b/g, "[NUMBER]")
    .replace(/\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+\s+(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|way)\b\.?/gi, "[ADDRESS]")
    .replace(/\b(my name is|this is|name's|it's|i'm)\s+([A-Z][a-z]+)(\s+[A-Z][a-z]+)?/g, "$1 [NAME]")
    // spoken phone numbers ("two one six five five five ...") — seven or more digit words in a row
    .replace(/\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,.-]+){6,}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, "[SPOKEN-NUMBER]");
}

/** A short masked window around the first match — never the whole line. */
export function excerptAround(text: string, re: RegExp, words = 7): string | null {
  const masked = maskPII(text);
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(masked);
  if (!m) return null;
  // Cut on whitespace boundaries of the MASKED text, so punctuation stays where
  // the speaker put it and no identifier can be re-joined from fragments.
  let start = m.index;
  for (let n = 0; n <= words && start > 0; n++) start = masked.lastIndexOf(" ", start - 2) + 1;
  let end = m.index + m[0].length;
  for (let n = 0; n < words && end < masked.length; n++) {
    const next = masked.indexOf(" ", end + 1);
    end = next < 0 ? masked.length : next;
  }
  return masked.slice(start, end).trim().slice(0, 160);
}

/* ──────────────────────────────── turns ──────────────────────────────── */

export interface Turn {
  role: "customer" | "assistant";
  text: string;
}

const CUSTOMER_PREFIX = /^\s*(user|customer|human|caller)\s*:\s*/i;
const ASSISTANT_PREFIX = /^\s*(ai|assistant|bot|agent|system)\s*:\s*/i;

/**
 * Role-tagged turns, uncapped (the census needs late turns: repetition and
 * frustration happen there). Prefers Vapi's structured `messages` array, which
 * is role-tagged at source; falls back to the prefixed flat transcript. A
 * transcript with no prefixes yields [] — the caller's words cannot be told
 * from the assistant's, and guessing is the contamination customerTurns.ts
 * exists to remove.
 */
export function parseTurns(transcript: unknown, messages: unknown): Turn[] {
  if (Array.isArray(messages) && messages.length > 0) {
    const out: Turn[] = [];
    for (const m of messages as Array<Record<string, unknown>>) {
      const role = String(m?.role ?? "").toLowerCase();
      const raw = m?.message ?? m?.content ?? m?.text;
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (role === "user" || role === "customer" || role === "human") out.push({ role: "customer", text: raw.trim() });
      else if (role === "assistant" || role === "bot" || role === "ai") out.push({ role: "assistant", text: raw.trim() });
    }
    if (out.length) return out;
  }
  if (typeof transcript !== "string" || !transcript.trim()) return [];
  const out: Turn[] = [];
  let current: Turn | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    if (CUSTOMER_PREFIX.test(line)) {
      if (current) out.push(current);
      current = { role: "customer", text: line.replace(CUSTOMER_PREFIX, "").trim() };
    } else if (ASSISTANT_PREFIX.test(line)) {
      if (current) out.push(current);
      current = { role: "assistant", text: line.replace(ASSISTANT_PREFIX, "").trim() };
    } else if (current && line.trim()) {
      current.text += ` ${line.trim()}`;
    }
  }
  if (current) out.push(current);
  return out.filter((t) => t.text.length > 0);
}

/* ──────────────────────────────── needs ──────────────────────────────── */

/**
 * What the customer came for — read with the EXISTING demand taxonomy
 * (server/services/voiceDemandClassifier.ts), never a third one. That module
 * was built from the real July residue and pinned by its own tests, but no
 * production path imports it (the eval cron still uses `detectIntents`); this
 * census is its first reader over live data, which is the evidence the wiring
 * decision needs.
 *
 * It classifies ONE turn by design (the caller's own framing). An episode has
 * many, and a caller who opens "can I talk to someone" states the need later,
 * so: every customer turn in order; the first intent that is neither `unclear`
 * nor `human_requested` is the need; an opening human request is kept as its
 * own fact instead of hiding the need behind it.
 */
const TIRE_INTENTS = new Set<VoiceIntent>([
  "used_tire_price", "used_tire_availability", "new_tire_quote", "tire_size_help",
  "flat_or_puncture", "tpms", "tire_service", "rack_check",
]);
export const isTireIntent = (i: VoiceIntent) => TIRE_INTENTS.has(i);

export interface EpisodeNeed {
  need: VoiceIntent;
  friction: VoiceFriction;
  /** The first substantive classification was a request for a person. */
  openedWithHuman: boolean;
  /** Every distinct non-unclear intent seen, in order of first appearance. */
  all: VoiceIntent[];
}

export function episodeNeed(customerTurns: readonly string[]): EpisodeNeed {
  let need: VoiceIntent = "unclear";
  let friction: VoiceFriction = "unknown";
  let openedWithHuman = false;
  let first = true;
  const all: VoiceIntent[] = [];
  for (const t of customerTurns) {
    // MASK FIRST. The classifier's size rule reads "(216) 555-0102" as a tire
    // size (tire_size_help, 0.8) — a caller reciting a callback number would be
    // filed as tire demand. Pinned in customerCorpus.test.ts; whoever wires the
    // classifier into the eval cron must mask (or fix the rule) the same way.
    const c = classifyVoiceDemand(maskPII(t));
    if (c.intent === "unclear") continue;
    if (first) { openedWithHuman = c.intent === "human_requested"; first = false; }
    if (!all.includes(c.intent)) all.push(c.intent);
    if (need === "unclear" && c.intent !== "human_requested") { need = c.intent; friction = c.friction; }
  }
  if (need === "unclear" && openedWithHuman) { need = "human_requested"; friction = "human_required"; }
  return { need, friction, openedWithHuman, all };
}

/* ─────────────────────────── friction signals ────────────────────────── */

/**
 * Customer-side evidence of effort. Each is a PRIMITIVE the census counts on
 * its own; none is combined into a score here (item: raw metrics until a
 * composite is shown to add information).
 */
export const FRICTION_PATTERNS = {
  repeated_self: /\b(i (already )?(said|told you)|like i said|as i said|i just (said|told)|again,? (it'?s|i need))\b/i,
  not_understood: /\b(that'?s not what i said|no,? i said|you'?re not (understanding|listening|getting)|what\?|huh\?|can you repeat|say that again|i can'?t (hear|understand) you)\b/i,
  wants_human: /\b(talk|speak) (to|with) (a |an )?(real |actual |live )?(person|human|someone|somebody|representative|mechanic|guy)\b|\b(real person|live person|human being|operator)\b/i,
  wants_manager_owner: /\b(manager|owner|nick himself|the boss|supervisor)\b/i,
  ai_distrust: /\b(are you (a )?(robot|real|ai|machine|computer|bot)|is this (a )?(robot|recording|ai|machine|bot))\b/i,
  prior_contact: /\b(i (called|texted|came in) (earlier|yesterday|before|this morning|last week|twice|already)|called (you )?(two|three|a few|several) times|second time (i'?m )?calling)\b/i,
  broken_promise: /\b(no ?one (called|got back|texted)|nobody (called|got back|texted)|never (called|got back|heard back)|(was|were) supposed to (call|text)|still waiting|been waiting)\b/i,
  frustration: /\b(ridiculous|frustrat\w*|annoy\w*|waste of (my )?time|this is crazy|forget it|never mind|nevermind|unbelievable)\b/i,
} as const;
export type Friction = keyof typeof FRICTION_PATTERNS;

export function frictionOf(customerTurns: readonly string[]): Record<Friction, number> {
  const out = Object.fromEntries(Object.keys(FRICTION_PATTERNS).map((k) => [k, 0])) as Record<Friction, number>;
  for (const t of customerTurns) {
    for (const [k, re] of Object.entries(FRICTION_PATTERNS) as Array<[Friction, RegExp]>) {
      if (re.test(t)) out[k] += 1;
    }
  }
  return out;
}

/* ─────────────────────── what the assistant asks / promises ─────────────────────── */

export const ASK_PATTERNS = {
  ask_tire_size: /\b(tire size|size of (your|the) tires?|numbers? on the (side|sidewall)|what size)\b/i,
  ask_vehicle: /\b(year,? make,? (and )?model|what (kind of )?(car|vehicle|truck)|make and model)\b/i,
  ask_name: /\b(your name|name (for|on) the|who am i speaking)\b/i,
  ask_phone: /\b(phone number|number to (reach|call|text)|best number|callback number)\b/i,
  ask_quantity: /\b(how many tires|one tire or|a pair or|all four)\b/i,
} as const;
export type Ask = keyof typeof ASK_PATTERNS;

/**
 * Assistant turns that commit the shop to a future action. These are the
 * obligations the Promise Ledger was built for; the census measures how many
 * are made and whether any follow-up contact is visible afterwards.
 */
export const PROMISE_PATTERNS = {
  callback: /\b(someone|a team member|we|they|the team|nick|he|a technician|the shop)\b.{0,40}\b(will|'ll|is going to|are going to|gonna)\b.{0,20}\b(call|reach out|get back|contact)\b/i,
  text_followup: /\b(will|'ll|going to)\b.{0,20}\b(text|send (you )?(a )?(text|message|link))\b/i,
  rack_check: /\b(check|look at|see what we have on)\b.{0,25}\b(the )?(rack|stock|inventory|in the back|what we have)\b/i,
  status_update: /\b(let you know|update you|keep you posted|when (it'?s|your car is) ready)\b/i,
} as const;
export type PromiseKind = keyof typeof PROMISE_PATTERNS;

export function countMatches<K extends string>(turns: readonly string[], patterns: Record<K, RegExp>): Record<K, number> {
  const out = Object.fromEntries(Object.keys(patterns).map((k) => [k, 0])) as Record<K, number>;
  for (const t of turns) {
    for (const [k, re] of Object.entries(patterns) as Array<[K, RegExp]>) {
      if (re.test(t)) out[k] += 1;
    }
  }
  return out;
}

/* ─────────────────────────────── episodes ────────────────────────────── */

export interface Contact {
  phone10: string;
  at: Date;
  channel: "call" | "sms_in" | "sms_out";
  ref: string;
}

export interface Episode<C extends Contact = Contact> {
  phone10: string;
  start: Date;
  end: Date;
  contacts: C[];
}

/**
 * Gap sessionization per customer: a contact continues the open episode when it
 * arrives within `gapMinutes` of that episode's LAST contact. Outbound-only
 * runs never open an episode (a campaign text is not a customer need); they
 * attach to an open one. Contacts with no phone are their own episode.
 */
export function sessionize<C extends Contact>(contacts: readonly C[], gapMinutes = 24 * 60): Episode<C>[] {
  const byPhone = new Map<string, C[]>();
  const loose: Episode<C>[] = [];
  for (const c of contacts) {
    if (!c.phone10) {
      if (c.channel !== "sms_out") loose.push({ phone10: "", start: c.at, end: c.at, contacts: [c] });
      continue;
    }
    const list = byPhone.get(c.phone10);
    if (list) list.push(c);
    else byPhone.set(c.phone10, [c]);
  }
  const out: Episode<C>[] = [...loose];
  const gap = gapMinutes * 60_000;
  for (const [phone10, list] of byPhone) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let open: Episode<C> | null = null;
    for (const c of list) {
      if (open && c.at.getTime() - open.end.getTime() <= gap) {
        open.contacts.push(c);
        open.end = c.at;
        continue;
      }
      if (c.channel === "sms_out") continue; // no customer-initiated contact to attach to
      open = { phone10, start: c.at, end: c.at, contacts: [c] };
      out.push(open);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ─────────────────────────────── stats ──────────────────────────────── */

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function pct(n: number, d: number): string {
  return d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "n/a (0 denominator)";
}

/** Hour and weekday in the shop's zone, for the open/closed split. */
export function shopClock(at: Date, timeZone: string = BUSINESS.timezone): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return { hour, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Open per BUSINESS.hours.structured — the one hours authority, never re-typed here. */
export function isOpen(at: Date, timeZone: string = BUSINESS.timezone): boolean {
  const { hour, weekday } = shopClock(at, timeZone);
  const span = (BUSINESS.hours.structured as Record<string, string>)[WEEKDAYS[weekday]!];
  const m = /^(\d{2}):\d{2}-(\d{2}):\d{2}$/.exec(span ?? "");
  if (!m) return false;
  return hour >= Number(m[1]) && hour < Number(m[2]);
}

/* ───────────────────────── recontact · link · incidents ───────────────────────── */

/**
 * Did the customer have to come back? Customer-initiated contacts only (calls
 * and inbound texts). A contact under `immediateMin` after the previous one
 * ENDED is a dropped-line or hold redial and is counted apart: "had to
 * recontact" means the first contact did not finish the job, which a
 * two-minute reconnect does not show.
 */
export function recontacts(
  contacts: ReadonlyArray<{ at: Date; endAt?: Date }>,
  immediateMin = 10,
): { immediate: number; later: number } {
  const sorted = [...contacts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let immediate = 0;
  let later = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = (sorted[i - 1]!.endAt ?? sorted[i - 1]!.at).getTime();
    if (sorted[i]!.at.getTime() - prevEnd < immediateMin * 60_000) immediate++;
    else later++;
  }
  return { immediate, later };
}

/**
 * How sure is the gap rule that these contacts are one need? `ambiguous` when
 * two contacts name needs from different families (tire intents are one
 * family). Never forced: the census counts ambiguous episodes and reports them
 * apart rather than splitting or merging on a guess.
 */
export function linkConfidence(needsPerContact: readonly VoiceIntent[]): "single" | "consistent" | "ambiguous" {
  if (needsPerContact.length <= 1) return "single";
  const fam = new Set(
    needsPerContact
      .filter((n) => n !== "unclear" && n !== "human_requested")
      .map((n) => (isTireIntent(n) ? "tire" : n)),
  );
  return fam.size > 1 ? "ambiguous" : "consistent";
}

/**
 * SRE-style grouping: failures that touch several customers inside one window
 * are ONE system incident with N customer-recovery obligations, not N lost
 * leads. A cluster opens on a failure and absorbs every failure within
 * `windowMin` of the cluster's LAST failure; it is an incident candidate only
 * when at least `minCustomers` distinct customers are in it.
 */
export function clusterIncidents(
  failures: ReadonlyArray<{ at: Date; phone10: string }>,
  windowMin = 60,
  minCustomers = 3,
): Array<{ start: Date; end: Date; customers: number; failures: number }> {
  const sorted = [...failures].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Array<{ start: Date; end: Date; phones: Set<string>; failures: number }> = [];
  for (const f of sorted) {
    const open = out[out.length - 1];
    if (open && f.at.getTime() - open.end.getTime() <= windowMin * 60_000) {
      open.end = f.at;
      open.failures++;
      open.phones.add(f.phone10 || `anon-${open.failures}`);
    } else {
      out.push({ start: f.at, end: f.at, phones: new Set([f.phone10 || "anon-0"]), failures: 1 });
    }
  }
  return out
    .filter((c) => c.phones.size >= minCustomers)
    .map((c) => ({ start: c.start, end: c.end, customers: c.phones.size, failures: c.failures }));
}

/** True when an introduction phrase is present — recorded as a boolean, never the name. */
export function namePresent(text: string): boolean {
  return /\b(my name is|this is|name's)\s+[A-Z][a-z]+/.test(String(text ?? ""));
}
