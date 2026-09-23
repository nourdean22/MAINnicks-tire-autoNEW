/**
 * customer-corpus-census — what customers asked for, and what it cost them, from
 * the last N days of calls AND texts, read as EPISODES rather than rows.
 *
 * READ-ONLY. Every statement is a SELECT. Run through the service environment so
 * no key is pasted into a command:
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus -- --since 2026-06-22 --until 2026-09-22
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus -- --json > corpus.json
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus -- --excerpts 5
 *   pnpm diag:customer-corpus -- --fixture scripts/diagnostics/fixtures/customer-corpus.fixture.json
 *
 * `--since` / `--until` are YYYY-MM-DD, checked before anything is read.
 * `--fixture` replays a synthetic JSON (one array per read below) instead of the
 * database, through the SAME window filters the SQL applies — the positive
 * control: it proves every section computes from rows, so a production run
 * printing zeros means the data, not the instrument.
 *
 * WHAT IT PRINTS, IN ORDER, AND WHY THAT ORDER.
 *   1. COVERAGE first — per Eastern week, how many calls carry customer turns
 *      (from the archive transcript, or from `metadata.customerSpeech`, which
 *      the webhook has written since 2026-07-26 — the only source for a call
 *      with no archive row) and how many texts exist. A finding about "three
 *      months" is only as wide as this table; a week with no turns is UNKNOWN,
 *      not quiet.
 *   2. Episodes: one customer, one continuing need, across call + SMS, by a
 *      24h GAP from the customer's last contact (lib/customerCorpus.ts
 *      `sessionize`) — beside the live kernel's fixed UTC-day bucket count, so
 *      the difference is visible.
 *   3. Per need family: effort primitives (redials, channel switches, repeated
 *      facts, friction phrases), handoff evidence (transfer attempted vs the
 *      provider's own verdict or a `*-transfer-*` failure), obligations
 *      (callbacks, promises, expected arrivals) and whether a HUMAN visibly
 *      followed them, and invoice LINKAGE — a non-refunded invoice for the same
 *      phone dated (Eastern date) from the episode's start day to 14 days after,
 *      each invoice to one episode. Linkage is not causation and is
 *      printed as "linked", never "won" or "recovered". Need shares are over
 *      episodes with readable customer text from real customers; episodes with
 *      no text, spam/wrong-number calls and STOP-only texts are counted apart,
 *      and an ALL row gives every column's base rate over every episode.
 *   4. Where the live classifier disagrees with the customer's own words.
 *   5. With --excerpts N: up to N masked, short windows per friction signal.
 *      Never a line, never a transcript, never a digit, never a phone.
 *
 * TIME. `vapi_call_logs` rows are inserted by the END-of-call webhook, so a
 * call's time is the archive's `started_at`, else the log time minus the
 * duration; its end is `ended_at`, else start + duration. Obligation rows the
 * assistant writes DURING a call (callbacks, arrivals, promises) therefore fall
 * inside the episode. Invoices are compared on Eastern business dates.
 *
 * EVERY RATIO IS PRINTED WITH ITS DENOMINATOR, and a filtered ratio is followed
 * by the same ratio over all episodes (base-rate-check). A read that fails
 * makes every field derived from it null in JSON and UNKNOWN in text — never a
 * zero (empty-vs-error).
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import mysql from "mysql2/promise";
import { detectIntents } from "../../server/services/vapiCallClassifier.ts";
import { getBusinessDateKey } from "../../server/lib/timezoneAssert.ts";
import { episodeKey, intentFamily } from "../../shared/callTaxonomy.ts";
import { extractTireSize, extractVehicle } from "../../shared/callDemandExtraction.ts";
import {
  ACKNOWLEDGEMENT,
  addDays,
  businessWeekKey,
  classifyTurn,
  clusterIncidents,
  countAsks,
  countPromises,
  customerToken,
  excerptAround,
  FRICTION_PATTERNS,
  frictionOf,
  isOpen,
  isOptOutText,
  median,
  episodeNeed,
  isTireIntent,
  linkConfidence,
  linkInvoices,
  maskForOutput,
  maskTurns,
  namePresent,
  parseTurns,
  pct,
  phoneKey,
  recontacts,
  sessionize,
  shopClock,
  transferState,
  type Ask,
  type Contact,
  type Friction,
  type PromiseKind,
  type TransferState,
  type Turn,
} from "../lib/customerCorpus.ts";
import { LOW_CONFIDENCE, VOICE_INTENTS, type VoiceIntent } from "../../server/services/voiceDemandClassifier.ts";

const arg = (name: string, fallback: string | null = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : fallback;
};
const usage = (msg: string): never => { console.error(`customer-corpus-census: ${msg}`); process.exit(2); };

/** YYYY-MM-DD that round-trips (no 2026-9-1, no 2026-02-30), or exit 2 before any read. */
function dayArg(name: string): string | null {
  const v = arg(name);
  if (v == null) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    usage(`--${name} must be a calendar date as YYYY-MM-DD, got "${v}"`);
  }
  return v;
}

const JSON_OUT = process.argv.includes("--json");
const EXCERPTS = Math.max(0, Number(arg("excerpts", "0")) || 0);
const GAP_MIN = Math.max(30, Number(arg("gap-minutes", String(24 * 60))) || 24 * 60);
const REDIAL_MIN = 120;
const LINK_DAYS = 14;
const UNTIL_DAY = dayArg("until") ?? getBusinessDateKey(new Date());
const SINCE_DAY = dayArg("since");
const until = new Date(`${UNTIL_DAY}T23:59:59Z`);
const since = SINCE_DAY ? new Date(`${SINCE_DAY}T00:00:00Z`) : new Date(until.getTime() - 92 * 86_400_000);
if (since > until) usage(`--since ${SINCE_DAY} is after --until ${UNTIL_DAY}`);

/**
 * --export guard, all of it BEFORE any read. An export carries masked
 * conversation text; it must never land in a git checkout, where one `git add`
 * publishes it. Links are resolved first, so a symlink into a checkout is
 * refused like the checkout path itself.
 */
const EXPORT_ARG = arg("export");
let EXPORT: string | null = null;
if (EXPORT_ARG) {
  const refuse = (why: string): never => usage(`--export refused: ${why}`);
  const target = resolve(EXPORT_ARG);
  const parent = dirname(target);
  if (!existsSync(parent)) refuse(`the folder ${parent} does not exist. Create it (outside any git checkout) and re-run.`);
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) refuse(`${target} is a symbolic link. Give the real path.`);
  const real = existsSync(target) ? realpathSync(target) : join(realpathSync(parent), basename(target));
  for (let d = dirname(real); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) refuse(`${real} is inside a git checkout (${d}). Write it outside the repo.`);
    if (dirname(d) === d) break;
  }
  EXPORT = real;
}

const FIXTURE = arg("fixture");
const url = FIXTURE ? "mysql://fixture/fixture" : process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing or not mysql:// — run via: railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus");
  process.exit(1);
}

/**
 * Salt. A per-run salt makes tokens unlinkable across runs (the default for a
 * printed report). A monthly re-run that must join episodes across months
 * needs a STABLE salt: set CORPUS_ANALYSIS_SALT in the shell, never in the repo.
 */
const STABLE_SALT = process.env.CORPUS_ANALYSIS_SALT ?? "";
const SALT = STABLE_SALT || randomBytes(8).toString("hex");
const log = (...a: unknown[]) => { if (!JSON_OUT) console.log(...a); };
const S = Math.floor(since.getTime() / 1000);
const U = Math.floor(until.getTime() / 1000);
/** Obligation rows can land after the window closes; read that far ahead. */
const U_AHEAD = U + LINK_DAYS * 86_400;

type Row = Record<string, unknown>;
const fixture: Record<string, Row[]> | null = FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf-8")) : null;
const conn = fixture ? null : await mysql.createConnection(url);
const unknown: string[] = [];
/**
 * One read. `win` is the WHERE window: the SQL binds its two placeholders from
 * it, and a fixture is filtered through the same bounds on the same column, so
 * a fixture run exercises the window logic instead of bypassing it.
 */
async function q(label: string, sql: string, win: { field: string; lo: number; hi: number }): Promise<Row[] | null> {
  if (fixture) {
    if (!Array.isArray(fixture[label])) { unknown.push(`${label}: absent from fixture`); return null; }
    return fixture[label]!.filter((r) => {
      const t = r[win.field] == null ? NaN : Number(r[win.field]);
      return t >= win.lo && t <= win.hi;
    });
  }
  try {
    const [rows] = await conn!.query(sql, [win.lo, win.hi]);
    return rows as Row[];
  } catch (e) {
    unknown.push(`${label}: ${(e as Error).message.slice(0, 160)}`);
    return null;
  }
}
const parseJson = (v: unknown): unknown => {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
/** Epoch seconds → ms; null for NULL, 0 (a zero date) or garbage. */
const ms = (v: unknown): number | null => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
};
const H = 3_600_000;
const MIN = 60_000;

try {
  /* ───────────── reads ───────────── */
  // loggedT is the end-of-call webhook's insert time (the call's END); startedT /
  // endedT come from the archive when it has the call.
  const calls = await q("calls", `
    SELECT v.id, v.vapiCallId, v.phoneNumber, v.durationSeconds, v.endedReason, v.eval_outcome AS evalOutcome,
           v.callbackId, v.leadId, v.metadata, UNIX_TIMESTAMP(v.createdAt) AS loggedT,
           UNIX_TIMESTAMP(a.started_at) AS startedT, UNIX_TIMESTAMP(a.ended_at) AS endedT,
           a.transcript, a.messages_json AS messages, a.call_type AS callType
    FROM vapi_call_logs v
    LEFT JOIN vapi_call_archives a ON a.vapi_call_id = v.vapiCallId
    WHERE v.createdAt >= FROM_UNIXTIME(?) AND v.createdAt <= FROM_UNIXTIME(?)`, { field: "loggedT", lo: S, hi: U });
  // No failure_reason: it is unused here and arrives with migration 0104, which
  // may not be applied — a missing column would fail the whole SMS read.
  const sms = await q("sms", `
    SELECT m.id, c.phone, m.direction, m.body, m.status,
           UNIX_TIMESTAMP(m.createdAt) AS t, UNIX_TIMESTAMP(m.optOutAt) AS optOutT
    FROM sms_messages m JOIN sms_conversations c ON c.id = m.conversationId
    WHERE m.createdAt >= FROM_UNIXTIME(?) AND m.createdAt <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U });
  const callbacks = await q("callback_requests", `
    SELECT phone, status, UNIX_TIMESTAMP(createdAt) AS t, UNIX_TIMESTAMP(calledAt) AS calledT,
           -- The stale-callback cron (crudAutomation.ts escalateStaleCallbacks) flips an
           -- unworked row to 'no-answer' AND stamps calledAt with nobody having called,
           -- leaving this marker in notes. A flag, never the notes text (it can hold PII).
           (notes LIKE '%Auto-SMS: we will call you back%') AS autoNoAnswer
    FROM callback_requests WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U_AHEAD });
  const arrivals = await q("expected_arrivals", `
    SELECT customerPhone AS phone, status, source, UNIX_TIMESTAMP(createdAt) AS t, UNIX_TIMESTAMP(arrivedAt) AS arrivedT
    FROM expected_arrivals WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U_AHEAD });
  // updatedT: when a 'human_replied' row flipped — the operator's manual send (smsConversations.ts).
  const jobs = await q("sms_response_jobs", `
    SELECT customerPhone AS phone, status, UNIX_TIMESTAMP(createdAt) AS t, UNIX_TIMESTAMP(updatedAt) AS updatedT
    FROM sms_response_jobs WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U_AHEAD });
  const promises = await q("customer_promises", `
    SELECT customer_phone AS phone, promise_type AS type, status, UNIX_TIMESTAMP(created_at) AS t
    FROM customer_promises WHERE created_at >= FROM_UNIXTIME(?) AND created_at <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U_AHEAD });
  const opportunities = await q("revenue_opportunities", `
    SELECT customer_phone AS phone, source_type AS sourceType, state, UNIX_TIMESTAMP(created_at) AS t
    FROM revenue_opportunities WHERE created_at >= FROM_UNIXTIME(?) AND created_at <= FROM_UNIXTIME(?)`, { field: "t", lo: S, hi: U_AHEAD });
  // Invoices from a year back: the earlier ones answer "existing customer?", the
  // later ones answer "linked within 14 days?". Amounts are cents.
  const invoices = await q("invoices", `
    SELECT customerPhone AS phone, totalAmount AS cents, paymentStatus, UNIX_TIMESTAMP(invoiceDate) AS t
    FROM invoices WHERE invoiceDate >= FROM_UNIXTIME(?) AND invoiceDate <= FROM_UNIXTIME(?)`, { field: "t", lo: S - 365 * 86_400, hi: U_AHEAD });

  /** Which inputs were READ. A field derived from an unread one is null, never zero. */
  const known = {
    calls: calls != null, sms: sms != null, callbacks: callbacks != null, arrivals: arrivals != null,
    jobs: jobs != null, promises: promises != null, opportunities: opportunities != null, invoices: invoices != null,
  };
  type Input = keyof typeof known;
  const ok = (...inputs: Input[]) => inputs.every((k) => known[k]);
  const when = <T,>(inputs: Input[], v: () => T): T | null => (ok(...inputs) ? v() : null);

  /* ───────────── calls → contacts ───────────── */
  type TurnSource = "archive" | "customerSpeech" | "none";
  interface CallC extends Contact {
    channel: "call"; endAt: Date; loggedAt: Date; durationSeconds: number;
    customer: string[]; customerMasked: string[]; assistant: string[]; turnSource: TurnSource; exportTurns: Turn[];
    kernelIntents: string[]; storedIntentsMissing: boolean; speakerUnavailable: boolean; bucketKey: string;
    evalOutcome: string | null; endedReason: string; transfer: TransferState;
    tireSize: string | null; vehicle: string | null; hasCallbackRow: boolean;
    need: VoiceIntent; needAll: VoiceIntent[]; nameShared: boolean;
    asks: Record<Ask, number>; promises: Record<PromiseKind, number>;
  }
  interface SmsC extends Contact { channel: "sms_in" | "sms_out"; body: string; status: string; optOut: boolean; optOutT: number | null }
  const isCall = (c: Contact): c is CallC => c.channel === "call";
  const callContacts: CallC[] = [];
  let outboundCalls = 0;
  for (const r of calls ?? []) {
    // Outbound: the archive's call type, or the eval cron's own stamp (vapiCallEval.ts)
    // for calls with no archive row.
    if (/outbound/i.test(String(r.callType ?? "")) || r.evalOutcome === "outbound") { outboundCalls++; continue; }
    const meta = asRecord(parseJson(r.metadata));
    const durationSeconds = Math.max(0, Number(r.durationSeconds ?? 0) || 0);
    const loggedAt = new Date(ms(r.loggedT)!);
    const at = new Date(ms(r.startedT) ?? loggedAt.getTime() - durationSeconds * 1000);
    const endAt = new Date(ms(r.endedT) ?? at.getTime() + durationSeconds * 1000);
    const turns = parseTurns(r.transcript, parseJson(r.messages));
    let customer = turns.filter((x) => x.role === "customer").map((x) => x.text);
    let ordered: Turn[] = turns;
    let turnSource: TurnSource = customer.length ? "archive" : "none";
    if (!customer.length) {
      // No archive turns (the 14-day purge, or a call the archive pass never
      // reached): the webhook's customer-only record, when it parsed.
      const speech = asRecord(meta.customerSpeech);
      const said = Array.isArray(speech.turns)
        ? speech.turns.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];
      if (said.length && speech.unparsed !== true) {
        customer = said;
        ordered = said.map((text) => ({ role: "customer" as const, text }));
        turnSource = "customerSpeech";
      }
    }
    // Masked ONCE per call, from the ordered turns (only order can mask a bare-name answer).
    const masked = EXPORT || EXCERPTS > 0 ? maskTurns(ordered) : [];
    const phone10 = phoneKey(r.phoneNumber);
    // The kernel on the census's OWN customer text: like-for-like with the demand classifier.
    const kernelIntents = detectIntents(customer.join(" "));
    const stored = Array.isArray(meta.intents) ? (meta.intents as unknown[]).map(String) : null;
    const cn = episodeNeed(customer);
    const assistant = turns.filter((x) => x.role === "assistant").map((x) => x.text);
    callContacts.push({
      phone10, at, endAt, loggedAt, channel: "call", ref: String(r.id), durationSeconds,
      customer, customerMasked: masked.filter((t) => t.role === "customer").map((t) => t.text),
      assistant, turnSource,
      exportTurns: EXPORT ? masked : [],
      kernelIntents,
      storedIntentsMissing: (!stored || stored.length === 0) && kernelIntents.length > 0,
      speakerUnavailable: meta.speakerAttribution === "unavailable",
      // The live queue's key (recoveryQueue.ts): stored intents, the row's createdAt, fixed UTC-day buckets.
      bucketKey: episodeKey(phone10 || `anon-${r.id}`, intentFamily(stored ?? kernelIntents), loggedAt),
      evalOutcome: (r.evalOutcome as string | null) ?? null, endedReason: String(r.endedReason ?? ""),
      transfer: transferState(
        asRecord(meta.transferArtifact).verdict,
        String(r.endedReason ?? ""),
        asRecord(meta.transferArtifact).transferUpdateSeen,
      ),
      tireSize: customer.map((t) => extractTireSize(t)).find(Boolean) ?? null,
      vehicle: customer.map((t) => extractVehicle(t)).find(Boolean) ?? null,
      hasCallbackRow: r.callbackId != null,
      need: cn.need, needAll: cn.all, nameShared: customer.some(namePresent),
      asks: countAsks(assistant),
      promises: countPromises(assistant),
    });
  }
  /** A failed or still-queued text reached nobody: it is not a reply and not a follow-up. */
  const reached = (s: SmsC) => s.channel === "sms_out" && (s.status === "sent" || s.status === "delivered");
  /** A human worked the callback. 'no-answer' is excluded: the stale-callback cron sets it (with calledAt) without calling anyone. */
  const humanCalled = (r: Row) => r.status === "called" || r.status === "completed";
  const smsContacts: SmsC[] = (sms ?? []).map((r) => {
    const inbound = r.direction === "inbound";
    return {
      phone10: phoneKey(r.phone), at: new Date(Number(r.t) * 1000), channel: inbound ? "sms_in" : "sms_out", ref: String(r.id),
      body: String(r.body ?? ""), status: String(r.status ?? ""),
      optOut: inbound && isOptOutText(String(r.body ?? "")), optOutT: ms(r.optOutT),
    };
  });

  /* ───────────── 1 · coverage ───────────── */
  const cov = new Map<string, { calls: number; withCustomerTurns: number; smsIn: number; smsOut: number }>();
  const bump = (k: string) => cov.get(k) ?? (cov.set(k, { calls: 0, withCustomerTurns: 0, smsIn: 0, smsOut: 0 }), cov.get(k)!);
  const turnSources: Record<TurnSource, number> = { archive: 0, customerSpeech: 0, none: 0 };
  for (const c of callContacts) {
    const w = bump(businessWeekKey(c.at));
    w.calls++;
    if (c.customer.length) w.withCustomerTurns++;
    turnSources[c.turnSource]++;
  }
  for (const s of smsContacts) { const w = bump(businessWeekKey(s.at)); if (s.channel === "sms_in") w.smsIn++; else w.smsOut++; }
  // reduce, not Math.min(...all): spreading a year of contacts overflows the argument stack.
  const firstAt = [...callContacts, ...smsContacts].reduce<Date | null>((m, c) => (!m || c.at < m ? c.at : m), null);
  const lastAt = [...callContacts, ...smsContacts].reduce<Date | null>((m, c) => (!m || c.at > m ? c.at : m), null);
  const show = (v: unknown) => (v == null ? "UNKNOWN" : String(v));

  log(`TARGET ${new URL(url).hostname} · window ${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)} · gap ${GAP_MIN} min`);
  log(`ACTUAL COVERAGE first contact ${firstAt?.toISOString() ?? "none"} · last ${lastAt?.toISOString() ?? "none"}`);
  log(`inbound calls ${known.calls ? callContacts.length : "UNKNOWN"} (outbound excluded ${known.calls ? outboundCalls : "UNKNOWN"}) · texts ${known.sms ? smsContacts.length : "UNKNOWN"}`);
  if (known.calls) log(`  customer turns from: archive ${turnSources.archive} · metadata.customerSpeech ${turnSources.customerSpeech} · none ${turnSources.none}`);
  // A channel that was not read is UNKNOWN in every week, not a week of zeros.
  const weekly = [...cov].sort().map(([k, v]) => [k, {
    calls: known.calls ? v.calls : null, withCustomerTurns: known.calls ? v.withCustomerTurns : null,
    smsIn: known.sms ? v.smsIn : null, smsOut: known.sms ? v.smsOut : null,
  }] as const);
  log(`\n1 · COVERAGE BY EASTERN WEEK (Mon) — calls · with customer turns (any source) · texts in · texts out`);
  for (const [k, v] of weekly) {
    log(`  ${k}  ${show(v.calls).padStart(4)} · ${show(v.withCustomerTurns).padStart(4)} (${v.calls == null ? "UNKNOWN" : pct(v.withCustomerTurns!, v.calls)}) · ${show(v.smsIn).padStart(4)} · ${show(v.smsOut).padStart(5)}`);
  }

  /* ───────────── 2 · episodes ───────────── */
  const eps = sessionize<CallC | SmsC>([...callContacts, ...smsContacts], GAP_MIN);
  const bucketKeys = new Set(callContacts.map((c) => c.bucketKey));
  const callEps = eps.filter((e) => e.contacts.some(isCall));
  const partial = ok("calls", "sms") ? null : `${[!known.calls && "calls", !known.sms && "texts"].filter(Boolean).join(" and ")} UNKNOWN`;

  /* ───────────── invoices: business dates, one episode per invoice ───────────── */
  const invRows = (invoices ?? []).map((r) => ({
    phone10: phoneKey(r.phone), day: getBusinessDateKey(new Date(Number(r.t) * 1000)),
    cents: Number(r.cents ?? 0), status: String(r.paymentStatus ?? ""),
  }));
  // A refunded invoice is money returned: never a link, never proof of a prior customer.
  const countable = invRows.filter((i) => i.phone10 && i.status !== "refunded");
  const startDays = eps.map((e) => ({ phone10: e.phone10, startDay: getBusinessDateKey(e.start) }));
  const linkedByEp = new Map<number, typeof countable>();
  linkInvoices(startDays, countable, LINK_DAYS).forEach((ei, k) => {
    if (ei != null) (linkedByEp.get(ei) ?? (linkedByEp.set(ei, []), linkedByEp.get(ei)!)).push(countable[k]!);
  });
  const invByPhone = new Map<string, typeof countable>();
  for (const i of countable) (invByPhone.get(i.phone10) ?? (invByPhone.set(i.phone10, []), invByPhone.get(i.phone10)!)).push(i);

  /* ───────────── 3 · per-episode facts ───────────── */
  const byPhone = (rows: Row[] | null) => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) { const k = phoneKey(r.phone); if (!k) continue; (m.get(k) ?? (m.set(k, []), m.get(k)!)).push(r); }
    return m;
  };
  const oppBy = byPhone(opportunities), cbBy = byPhone(callbacks), arrBy = byPhone(arrivals), jobBy = byPhone(jobs), prmBy = byPhone(promises);
  const callsByPhone = new Map<string, CallC[]>();
  for (const c of callContacts) (callsByPhone.get(c.phone10) ?? (callsByPhone.set(c.phone10, []), callsByPhone.get(c.phone10)!)).push(c);

  type Group = "need" | "no_transcript" | "non_customer";
  interface EpFacts {
    family: string; group: Group; nonCustomer: "spam_or_wrong_number" | "stop_only" | null;
    openedWithHuman: boolean; demandFriction: string; calls: number; smsIn: number; smsOut: number; redials: number; multiChannel: boolean;
    openStart: boolean; transferAttempted: boolean; transferConnected: boolean; transferNotConnected: boolean;
    callbackRow: boolean; callbackCompleted: boolean; callbackAutoNoAnswer: boolean; promisesMade: number; promiseFollowedByHuman: boolean | null;
    arrivalRow: boolean; arrived: boolean; linkedInvoices: number; linkedCents: number; linkedStatuses: string[]; linkWindowCensored: boolean; existingCustomer: boolean;
    friction: Record<Friction, number>; reaskedKnownSize: boolean; reaskedKnownVehicle: boolean; optOut: boolean;
    humanPendingNow: boolean; firstReplyMin: number | null; firstInboundOpen: boolean | null; unansweredInbound: boolean;
    turnsCustomer: number; ledgerPromises: number;
    recontactLater: number; recontactImmediate: number; link: "single" | "consistent" | "ambiguous";
    opportunities: number; opportunityWon: boolean; nameShared: boolean;
  }
  const exportRows: string[] = [];
  const facts: EpFacts[] = [];
  const excerpts: Record<string, string[]> = {};
  const inWin = (t: unknown, lo: number, hi: number) => { const v = ms(t); return v != null && v >= lo && v <= hi; };

  eps.forEach((e, epIndex) => {
    const cs = e.contacts.filter(isCall);
    const ss = e.contacts.filter((c): c is SmsC => !isCall(c));
    const inbound = ss.filter((s) => s.channel === "sms_in");
    // The need in TIME order: each call's customer turns at its start, each text at its send time.
    const customerTurns = e.contacts.flatMap((c) => (isCall(c) ? c.customer : c.channel === "sms_in" ? [c.body] : []));
    const en = episodeNeed(customerTurns);
    const startAt = e.start.getTime();
    const lastEnd = e.lastCustomerEnd.getTime();
    const nonCustomer = cs.length > 0 && cs.every((c) => c.evalOutcome === "spam_or_wrong_number") && inbound.every((s) => s.optOut)
      ? "spam_or_wrong_number" as const
      : cs.length === 0 && inbound.length > 0 && inbound.every((s) => s.optOut) ? "stop_only" as const : null;
    const group: Group = nonCustomer ? "non_customer" : customerTurns.some((t) => t.trim() !== "") ? "need" : "no_transcript";

    let redials = 0;
    for (let i = 1; i < cs.length; i++) if (cs[i]!.at.getTime() - cs[i - 1]!.endAt.getTime() <= REDIAL_MIN * MIN) redials++;

    // Repeated-fact burden: a size or vehicle the customer already gave in an
    // EARLIER call of this episode, asked for again by the assistant later.
    let knownSize = false, knownVehicle = false, reSize = false, reVehicle = false;
    for (const c of cs) {
      if (knownSize && c.asks.ask_tire_size > 0) reSize = true;
      if (knownVehicle && c.asks.ask_vehicle > 0) reVehicle = true;
      if (c.tireSize) knownSize = true;
      if (c.vehicle) knownVehicle = true;
    }
    const promisesMade = cs.reduce((n, c) => n + Object.values(c.promises).reduce((a, b) => a + b, 0), 0);
    // Follow-up evidence a SELECT can see that a HUMAN acted, in (end of the
    // promising call, +26 h]: a callback a human marked called/completed, or an
    // operator's manual text (the sms_response_jobs row flips to 'human_replied'
    // on that send). Automated texts never count: the confirmation fires seconds
    // after hang-up, and the stale-callback cron's "your callback's still in our
    // queue" text (crudAutomation.ts) is the promise NOT being kept.
    let promiseFollowedByHuman: boolean | null = null;
    const promising = cs.find((c) => Object.values(c.promises).some((v) => v > 0));
    if (promising && ok("callbacks", "jobs")) {
      const lo = promising.endAt.getTime(), hi = lo + 26 * H;
      const after = (t: unknown) => { const v = ms(t); return v != null && v > lo && v <= hi; };
      promiseFollowedByHuman = (cbBy.get(e.phone10) ?? []).some((r) => humanCalled(r) && after(r.calledT))
        || (jobBy.get(e.phone10) ?? []).some((r) => r.status === "human_replied" && after(r.updatedT));
    }

    // Obligation windows open at the episode START — rows the assistant writes
    // DURING a call land after it — and close 2 h after the last customer contact.
    const cbRows = (cbBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, lastEnd + 2 * H));
    const arrRows = (arrBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, lastEnd + 2 * H));
    // opportunity-queue-refresh runs oncePerShopDay (server/cron/scheduler.ts), so a
    // row can land most of a business day later: 36 h, not 2.
    const opps = (oppBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, lastEnd + 36 * H));
    const startDay = startDays[epIndex]!.startDay;
    const linked = linkedByEp.get(epIndex) ?? [];
    let firstReplyMin: number | null = null;
    let firstInboundOpen: boolean | null = null;
    if (inbound.length) {
      // Open vs closed is the FIRST TEXT's own time, not the episode's start.
      firstInboundOpen = isOpen(inbound[0]!.at);
      const reply = ss.find((s) => reached(s) && s.at > inbound[0]!.at);
      if (reply) firstReplyMin = (reply.at.getTime() - inbound[0]!.at.getTime()) / MIN;
    }
    const friction = frictionOf(customerTurns);
    if (EXCERPTS > 0) {
      const maskedTurns = e.contacts.flatMap((c) => (isCall(c) ? c.customerMasked : c.channel === "sms_in" ? [c.body] : []));
      for (const [k, re] of Object.entries(FRICTION_PATTERNS)) {
        const list = (excerpts[k] ??= []);
        if (list.length >= EXCERPTS) continue;
        const hit = maskedTurns.map((t) => excerptAround(t, re)).find(Boolean);
        if (hit) list.push(`${customerToken(e.phone10, SALT)}: …${hit}…`);
      }
    }
    const rc = recontacts(e.contacts
      .filter((c) => c.channel !== "sms_out" || reached(c as SmsC))
      .map((c) => ({
        at: c.at,
        endAt: isCall(c) ? c.endAt : c.at,
        by: c.channel === "sms_out" ? ("shop" as const) : isCall(c) ? ("call" as const) : ("text" as const),
        text: c.channel === "sms_in" ? (c as SmsC).body : undefined,
      })));
    const perContactNeeds = e.contacts
      .filter((c) => c.channel !== "sms_out")
      .map((c) => (isCall(c) ? c.need : episodeNeed([(c as SmsC).body]).need));
    const f: EpFacts = {
      family: group === "need" ? en.need : group, group, nonCustomer,
      recontactLater: rc.later, recontactImmediate: rc.immediate, link: linkConfidence(perContactNeeds),
      opportunities: opps.length, opportunityWon: opps.some((r) => r.state === "won"),
      nameShared: cs.some((c) => c.nameShared) || inbound.some((s) => namePresent(s.body)),
      openedWithHuman: en.openedWithHuman, demandFriction: en.friction, calls: cs.length, smsIn: inbound.length, smsOut: ss.length - inbound.length,
      redials, multiChannel: cs.length > 0 && inbound.length > 0, openStart: isOpen(e.start),
      transferAttempted: cs.some((c) => c.transfer !== "none"),
      transferConnected: cs.some((c) => c.transfer === "connected"),
      transferNotConnected: cs.some((c) => c.transfer === "not_connected"),
      callbackRow: cbRows.length > 0 || cs.some((c) => c.hasCallbackRow),
      callbackCompleted: cbRows.some(humanCalled),
      callbackAutoNoAnswer: cbRows.some((r) => Number(r.autoNoAnswer) === 1),
      promisesMade, promiseFollowedByHuman,
      arrivalRow: arrRows.length > 0, arrived: arrRows.some((r) => r.status === "arrived"),
      linkedInvoices: linked.length, linkedCents: linked.reduce((n, i) => n + i.cents, 0), linkedStatuses: linked.map((i) => i.status),
      // The 14-day window runs past --until: an unlinked episode here may simply be early.
      linkWindowCensored: addDays(startDay, LINK_DAYS) > UNTIL_DAY,
      existingCustomer: (invByPhone.get(e.phone10) ?? []).some((i) => i.day < startDay),
      friction, reaskedKnownSize: reSize, reaskedKnownVehicle: reVehicle,
      // The STOP itself, or the server's own stamp on the outbound it answered (sms_messages.optOutAt),
      // when that STOP came while this episode was open.
      optOut: inbound.some((s) => s.optOut) || ss.some((s) => s.channel === "sms_out" && s.optOutT != null && s.optOutT <= lastEnd + GAP_MIN * MIN),
      humanPendingNow: (jobBy.get(e.phone10) ?? []).some((r) => r.status === "human_pending" && inWin(r.t, startAt, lastEnd + 2 * H)),
      firstReplyMin, firstInboundOpen, unansweredInbound: (() => {
        // A STOP is not a message owed a reply (the opt-out confirmation, if any, is not a reply).
        const owed = inbound.filter((s) => !s.optOut && !ACKNOWLEDGEMENT.test(s.body));
        return owed.length > 0 && !ss.some((s) => reached(s) && s.at > owed[owed.length - 1]!.at);
      })(),
      turnsCustomer: customerTurns.length,
      ledgerPromises: (prmBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, lastEnd + 2 * H)).length,
    };
    facts.push(f);
    if (EXPORT) {
      // Masked text only, every digit hashed; the phone is a salted token; times
      // are coarse (Eastern hour, whole minutes, 10 s) — exact timestamps plus
      // durations join back to provider logs.
      const minutes = (d: Date) => Math.round((d.getTime() - startAt) / MIN);
      const { friction: fr, ...derived } = f;
      exportRows.push(JSON.stringify({
        customerKey: e.phone10 ? customerToken(e.phone10, SALT) : null,
        startEt: `${startDay}T${String(shopClock(e.start).hour).padStart(2, "0")} ET`,
        needs: perContactNeeds, ...derived,
        firstReplyMin: derived.firstReplyMin == null ? null : Math.round(derived.firstReplyMin),
        friction: fr,
        contacts: e.contacts.map((c) => (isCall(c)
          ? {
              channel: "call", minFromStart: minutes(c.at), durationSeconds: Math.round(c.durationSeconds / 10) * 10,
              endedReason: c.endedReason, evalOutcome: c.evalOutcome, transfer: c.transfer, turnSource: c.turnSource,
              tireSize: c.tireSize, vehicle: c.vehicle,
              turns: c.exportTurns.map((t) => ({ role: t.role, text: maskForOutput(t.text).slice(0, 400) })),
            }
          : { channel: c.channel, minFromStart: minutes(c.at), status: (c as SmsC).status, body: maskForOutput((c as SmsC).body).slice(0, 400) })),
      }));
    }
  });

  /* ───────────── incidents: one system failure, many customers ───────────── */
  // A failure is the provider's not_connected verdict or a `*-transfer-*`
  // failure ended reason; for a forward with no verdict, the same customer
  // redialling within 15 minutes of its end (the measured proxy; labelled).
  const failures: Array<{ at: Date; phone10: string }> = [];
  let proxyFailures = 0;
  for (const c of callContacts) {
    if (c.transfer === "not_connected") { failures.push({ at: c.at, phone10: c.phone10 }); continue; }
    if (c.transfer !== "attempted" || !c.phone10) continue;
    const end = c.endAt.getTime();
    const redial = (callsByPhone.get(c.phone10) ?? []).some((o) => o.at.getTime() > end && o.at.getTime() - end <= 15 * MIN);
    if (redial) { failures.push({ at: c.at, phone10: c.phone10 }); proxyFailures++; }
  }
  const incidents = clusterIncidents(failures);

  /* ───────────── kernel vs customer words (per call) ───────────── */
  const kernel = { intentless: 0, intentlessButTireWords: 0, outcomes: {} as Record<string, number>, storedIntentsMissing: 0, speakerAttributionUnavailable: 0 };
  const askTotals = { ask_tire_size: 0, ask_vehicle: 0, ask_name: 0, ask_phone: 0, ask_quantity: 0 } as Record<Ask, number>;
  const promiseTotals = { callback: 0, text_followup: 0, rack_check: 0, status_update: 0 } as Record<PromiseKind, number>;
  for (const c of callContacts) {
    for (const k of Object.keys(askTotals) as Ask[]) askTotals[k] += c.asks[k];
    for (const k of Object.keys(promiseTotals) as PromiseKind[]) promiseTotals[k] += c.promises[k];
    if (c.customer.length > 0 && c.kernelIntents.length === 0) {
      kernel.intentless++;
      if (c.needAll.some(isTireIntent)) {
        kernel.intentlessButTireWords++;
        const o = c.evalOutcome ?? "unscored";
        kernel.outcomes[o] = (kernel.outcomes[o] ?? 0) + 1;
      }
    }
    if (c.storedIntentsMissing) kernel.storedIntentsMissing++;
    if (c.speakerUnavailable) kernel.speakerAttributionUnavailable++;
  }

  /* ───────────── report ───────────── */
  const N = facts.length;
  const needEps = facts.filter((f) => f.group === "need");
  const NB = needEps.length;
  const share = (xs: EpFacts[], p: (f: EpFacts) => boolean) => `${xs.filter(p).length}/${xs.length}`;
  const CS: Input[] = ["calls", "sms"];
  const row = (family: string, xs: EpFacts[], base: number) => {
    const eligible = xs.filter((f) => !f.linkWindowCensored);
    return {
      family, episodes: xs.length, share: pct(xs.length, base),
      medianContacts: when(CS, () => median(xs.map((f) => f.calls + f.smsIn))),
      openedWithHuman: when(CS, () => share(xs, (f) => f.openedWithHuman)),
      redial: when(["calls"], () => share(xs, (f) => f.redials > 0)),
      multiChannel: when(CS, () => share(xs, (f) => f.multiChannel)),
      afterHours: when(CS, () => share(xs, (f) => !f.openStart)),
      transferAttempted: when(["calls"], () => share(xs, (f) => f.transferAttempted)),
      transferConnected: when(["calls"], () => share(xs, (f) => f.transferConnected)),
      transferNotConnected: when(["calls"], () => share(xs, (f) => f.transferNotConnected)),
      callbackRow: when(["calls", "callbacks"], () => share(xs, (f) => f.callbackRow)),
      callbackCompleted: when(["callbacks"], () => share(xs, (f) => f.callbackCompleted)),
      callbackAutoNoAnswer: when(["callbacks"], () => share(xs, (f) => f.callbackAutoNoAnswer)),
      promised: when(["calls"], () => share(xs, (f) => f.promisesMade > 0)),
      promiseFollowedByHuman: when(["calls", "callbacks", "jobs"], () => share(xs.filter((f) => f.promisesMade > 0), (f) => f.promiseFollowedByHuman === true)),
      arrivalRow: when(["arrivals"], () => share(xs, (f) => f.arrivalRow)),
      arrived: when(["arrivals"], () => share(xs, (f) => f.arrived)),
      // over episodes whose whole 14-day window lies inside the data
      linkedInvoice: when(["invoices"], () => share(eligible, (f) => f.linkedInvoices > 0)),
      linkedMedianUsd: when(["invoices"], () => median(eligible.filter((f) => f.linkedInvoices > 0).map((f) => f.linkedCents / 100))),
      existingCustomer: when(["invoices"], () => share(xs, (f) => f.existingCustomer)),
      anyFriction: when(CS, () => share(xs, (f) => Object.values(f.friction).some((v) => v > 0))),
      optOut: when(["sms"], () => share(xs, (f) => f.optOut)),
      recontactedLater: when(CS, () => share(xs, (f) => f.recontactLater > 0)),
      ambiguousLink: when(CS, () => share(xs, (f) => f.link === "ambiguous")),
      opportunityRow: when(["opportunities"], () => share(xs, (f) => f.opportunities > 0)),
    };
  };
  const fams = new Map<string, EpFacts[]>();
  for (const f of needEps) (fams.get(f.family) ?? (fams.set(f.family, []), fams.get(f.family)!)).push(f);
  const rows = [...fams].sort((a, b) => b[1].length - a[1].length).map(([family, xs]) => row(family, xs, NB));
  const apart = (["no_transcript", "non_customer"] as const).map((g) => row(g, facts.filter((f) => f.group === g), N));
  const allRow = row("ALL", facts, N);
  const frictionTotals = Object.fromEntries(Object.keys(FRICTION_PATTERNS).map((k) => [k, needEps.filter((f) => f.friction[k as Friction] > 0).length])) as Record<Friction, number>;
  const frictionAll = Object.fromEntries(Object.keys(FRICTION_PATTERNS).map((k) => [k, facts.filter((f) => f.friction[k as Friction] > 0).length])) as Record<Friction, number>;
  const inboundSmsEps = facts.filter((f) => f.smsIn > 0);
  const replyOpen = inboundSmsEps.filter((f) => f.firstInboundOpen === true && f.firstReplyMin != null).map((f) => f.firstReplyMin!);
  const replyClosed = inboundSmsEps.filter((f) => f.firstInboundOpen === false && f.firstReplyMin != null).map((f) => f.firstReplyMin!);
  const promiseEps = facts.filter((f) => f.promisesMade > 0);
  const eligibleForLink = facts.filter((f) => !f.linkWindowCensored);
  const linkedEps = eligibleForLink.filter((f) => f.linkedInvoices > 0);
  const byStatus = (xs: string[]) => xs.reduce<Record<string, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
  const summary = {
    window: { since: since.toISOString(), until: until.toISOString(), firstContact: firstAt?.toISOString() ?? null, lastContact: lastAt?.toISOString() ?? null },
    coverage: {
      byEasternWeek: Object.fromEntries(weekly),
      customerTurnSource: when(["calls"], () => turnSources),
    },
    counts: {
      inboundCalls: when(["calls"], () => callContacts.length),
      outboundCallsExcluded: when(["calls"], () => outboundCalls),
      texts: when(["sms"], () => smsContacts.length),
      episodes: N,
      episodesPartial: partial,
      callEpisodes: when(["calls"], () => callEps.length),
      kernelBucketEpisodes: when(["calls"], () => bucketKeys.size),
      // Need shares and friction rates are over this base: real customers with readable text.
      needBaseEpisodes: NB,
      noTranscriptEpisodes: facts.filter((f) => f.group === "no_transcript").length,
      nonCustomerEpisodes: {
        total: facts.filter((f) => f.group === "non_customer").length,
        spamOrWrongNumber: facts.filter((f) => f.nonCustomer === "spam_or_wrong_number").length,
        stopOnlyTexts: facts.filter((f) => f.nonCustomer === "stop_only").length,
      },
    },
    families: rows,
    familiesApart: apart,
    familiesAll: allRow,
    classifierCoverage: when(["calls"], () => {
      // Every customer CALL turn through the demand classifier (masked, as the
      // census reads it): the residue a wiring decision has to price is the
      // unclear turns plus those under its own LOW_CONFIDENCE line.
      let turns = 0, unclear = 0, low = 0;
      const seen = new Set<VoiceIntent>();
      for (const c of callContacts) for (const t of c.customer) {
        turns++;
        const r = classifyTurn(t);
        if (r.intent === "unclear") { unclear++; continue; }
        seen.add(r.intent);
        if (r.confidence < LOW_CONFIDENCE) low++;
      }
      const taxonomy = VOICE_INTENTS.filter((i) => i !== "unclear");
      return {
        customerTurns: turns, unclear, labelled: turns - unclear, belowLowConfidence: low, residue: unclear + low, lowConfidenceLine: LOW_CONFIDENCE,
        intentsNeverSeen: taxonomy.filter((i) => !seen.has(i)), intentsInTaxonomy: taxonomy.length,
      };
    }),
    demandFriction: when(CS, () => Object.fromEntries([...needEps.reduce((m, f) => m.set(f.demandFriction, (m.get(f.demandFriction) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]))),
    friction: when(CS, () => ({ episodesWithSignal: frictionTotals, base: NB, episodesWithSignalAllEpisodes: frictionAll, baseAllEpisodes: N })),
    repeatedFacts: when(["calls"], () => ({
      reaskedKnownSize: facts.filter((f) => f.reaskedKnownSize).length,
      reaskedKnownVehicle: facts.filter((f) => f.reaskedKnownVehicle).length,
      multiCallEpisodes: facts.filter((f) => f.calls > 1).length,
    })),
    assistantAsksPerCall: when(["calls"], () => ({ ...askTotals, calls: callContacts.length })),
    assistantPromises: when(["calls"], () => ({
      ...promiseTotals, episodesWithPromise: promiseEps.length,
      followedByHuman: when(["callbacks", "jobs"], () => promiseEps.filter((f) => f.promiseFollowedByHuman === true).length),
      ledgerRowsInThoseEpisodes: when(["promises"], () => promiseEps.reduce((n, f) => n + f.ledgerPromises, 0)),
    })),
    sms: when(["sms"], () => ({
      inboundEpisodes: inboundSmsEps.length,
      medianFirstReplyMinOpen: median(replyOpen), repliedOpen: replyOpen.length,
      medianFirstReplyMinClosed: median(replyClosed), repliedClosed: replyClosed.length,
      episodesLastInboundUnanswered: facts.filter((f) => f.unansweredInbound).length,
      humanPendingSnapshot: when(["jobs"], () => facts.filter((f) => f.humanPendingNow).length),
      optOutEpisodes: facts.filter((f) => f.optOut).length,
      failedOutbound: smsContacts.filter((s) => s.channel === "sms_out" && s.status === "failed").length,
    })),
    kernelDisagreement: when(["calls"], () => kernel),
    recontact: when(CS, () => ({
      episodesRecontactedLater: facts.filter((f) => f.recontactLater > 0).length,
      episodesImmediateOnly: facts.filter((f) => f.recontactImmediate > 0 && f.recontactLater === 0).length,
      base: N,
    })),
    linkConfidence: when(CS, () => ({
      single: facts.filter((f) => f.link === "single").length,
      consistent: facts.filter((f) => f.link === "consistent").length,
      ambiguous: facts.filter((f) => f.link === "ambiguous").length,
    })),
    transferIncidents: when(["calls"], () => ({
      failures: failures.length, proxyFailures, anonymousFailures: failures.filter((f) => !f.phone10).length,
      incidents: incidents.map((i) => ({ ...i, start: i.start.toISOString(), end: i.end.toISOString() })),
    })),
    callbacks: when(["callbacks"], () => ({
      episodesWithRow: when(["calls"], () => facts.filter((f) => f.callbackRow).length),
      humanCalled: facts.filter((f) => f.callbackCompleted).length,
      autoNoAnswerNobodyCalled: facts.filter((f) => f.callbackAutoNoAnswer).length,
    })),
    opportunities: when(["opportunities"], () => ({
      episodesWithRow: facts.filter((f) => f.opportunities > 0).length,
      episodesWithWonRow: facts.filter((f) => f.opportunityWon).length,
    })),
    namesShared: when(CS, () => facts.filter((f) => f.nameShared).length),
    salt: STABLE_SALT ? "stable (CORPUS_ANALYSIS_SALT)" : "per-run",
    invoiceLinkage: when(["invoices"], () => ({
      linkedEpisodes: linkedEps.length,
      eligibleEpisodes: eligibleForLink.length,
      censoredEpisodes: N - eligibleForLink.length,
      linkedEpisodesNewCustomers: linkedEps.filter((f) => !f.existingCustomer).length,
      linkedCentsTotal: linkedEps.reduce((n, f) => n + f.linkedCents, 0),
      linkedInvoicesByStatus: byStatus(linkedEps.flatMap((f) => f.linkedStatuses)),
      refundedInvoicesExcluded: invRows.filter((i) => i.status === "refunded").length,
    })),
    notes: {
      recontact: "later = a customer-initiated contact >=10 min after the previous one ended; immediate = a reconnect under 10 min; a text answering a shop text sent >=15 min after the customer's last contact is a reply, unless it chases",
      promises: "followed = a callback a human marked called|completed, or an operator's manual text (sms_response_jobs 'human_replied'), in (end of the promising call, +26 h]. Automated texts never count.",
      transferIncidents: "clusters of >=3 KNOWN customers whose transfer failed within 60 min of each other; failure = not_connected verdict, a *-transfer-* failure, or a verdict-less forward redialled within 15 min (proxy); anonymous failures count as failures, never as customers",
      callbacks: "human-called = status called|completed. auto no-answer = the stale-callback cron flipped the row after 4h and texted 'still in our queue' — nobody called (it also stamps calledAt, so calledAt is not evidence).",
      humanPending: "a SNAPSHOT: jobs in 'human_pending' at run time, not a historical rate",
      invoiceLinkage: "linked = a non-refunded invoice for the same phone dated (Eastern business day) from the episode's start day to 14 days after; each invoice links to at most one episode (the latest before it); episodes whose 14 days run past --until are censored out of the rate. Not attribution, not causation.",
    },
    unknownSections: unknown,
  };

  // The report goes out BEFORE the export is written: a failed write cannot lose it.
  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const r3 = (r: ReturnType<typeof row>) => `  ${r.family.padEnd(34)} ${String(r.episodes).padStart(5)} ${r.share.padStart(6)} · contacts~${show(r.medianContacts)} · opened asking for a person ${show(r.openedWithHuman)} · redial ${show(r.redial)} · call+text ${show(r.multiChannel)} · after-hours ${show(r.afterHours)}\n` +
      `      transfer tried ${show(r.transferAttempted)}, connected ${show(r.transferConnected)}, failed ${show(r.transferNotConnected)} · callback row ${show(r.callbackRow)}, human-called ${show(r.callbackCompleted)}, auto 'no-answer' (nobody called) ${show(r.callbackAutoNoAnswer)} · promised ${show(r.promised)}, a human followed ${show(r.promiseFollowedByHuman)}\n` +
      `      arrival row ${show(r.arrivalRow)}, arrived ${show(r.arrived)} · invoice linked ${show(r.linkedInvoice)} of window-complete (median $${r.linkedMedianUsd ?? "-"}) · existing customer ${show(r.existingCustomer)} · friction ${show(r.anyFriction)} · opt-out ${show(r.optOut)}\n` +
      `      came back >=10 min later ${show(r.recontactedLater)} · ambiguous link ${show(r.ambiguousLink)} · opportunity row ${show(r.opportunityRow)}`;
    const c = summary.counts;
    log(`\n2 · EPISODES ${N}${partial ? ` — PARTIAL (${partial}): episodes are built from the channels that were read` : ""} (with a call ${show(c.callEpisodes)}; text-only ${known.calls ? N - callEps.length : "UNKNOWN"})`);
    log(`  live kernel's fixed-bucket call episodes: ${show(c.kernelBucketEpisodes)} vs gap-based call episodes: ${show(c.callEpisodes)}`);
    log(`  need base ${NB} episodes (real customers, readable text) · apart: no transcript ${c.noTranscriptEpisodes} · non-customer ${c.nonCustomerEpisodes.total} (spam/wrong number ${c.nonCustomerEpisodes.spamOrWrongNumber}, STOP-only texts ${c.nonCustomerEpisodes.stopOnlyTexts})`);
    log(`\n3 · NEEDS — voiceDemandClassifier intent, episode-level; share = of the ${NB} need-base episodes; each cell "k/n" of that row's episodes`);
    for (const r of rows) log(r3(r));
    log(`  — apart (share of all ${N} episodes) —`);
    for (const r of apart) if (r.episodes > 0) log(r3(r));
    log(`  — base rate over every episode —`);
    log(r3(allRow));
    const cc = summary.classifierCoverage;
    log(cc
      ? `  classifier (call turns): ${cc.customerTurns} customer turns · unclear ${cc.unclear} · labelled ${cc.labelled}, of them below LOW_CONFIDENCE ${cc.lowConfidenceLine} ${cc.belowLowConfidence} · residue (unclear + below the line) ${cc.residue}/${cc.customerTurns} (${pct(cc.residue, cc.customerTurns)}) · intents never seen: ${cc.intentsNeverSeen.length} of ${cc.intentsInTaxonomy}`
      : `  classifier: UNKNOWN (calls not read)`);
    log(`  blocking friction (voiceDemandClassifier, need base): ${summary.demandFriction ? Object.entries(summary.demandFriction).map(([k, v]) => `${k} ${v}`).join(" · ") : "UNKNOWN"}`);
    log(`\n4 · FRICTION PRIMITIVES — episodes with ≥1 signal / ${NB} need-base episodes (base rate over all ${N})`);
    for (const k of Object.keys(FRICTION_PATTERNS) as Friction[]) {
      log(summary.friction
        ? `  ${k.padEnd(20)} ${String(frictionTotals[k]).padStart(5)}/${NB}  ${pct(frictionTotals[k], NB).padStart(6)}  · all ${frictionAll[k]}/${N} ${pct(frictionAll[k], N)}`
        : `  ${k.padEnd(20)} UNKNOWN`);
    }
    const rf = summary.repeatedFacts;
    log(rf ? `  re-asked a size given in an earlier call ${rf.reaskedKnownSize} · a vehicle ${rf.reaskedKnownVehicle} · of ${rf.multiCallEpisodes} multi-call episodes` : `  re-asked facts UNKNOWN (calls not read)`);
    const ap = summary.assistantPromises;
    log(`\n5 · WHAT THE ASSISTANT ASKS (question sentences, turns across ${show(c.inboundCalls)} calls): ${known.calls ? Object.entries(askTotals).map(([k, v]) => `${k} ${v}`).join(" · ") : "UNKNOWN"}`);
    log(ap
      ? `  PROMISES made in ${ap.episodesWithPromise} episodes (${Object.entries(promiseTotals).map(([k, v]) => `${k} ${v}`).join(" · ")}); a HUMAN seen following up (callback called/completed, or an operator's text) within 26 h: ${show(ap.followedByHuman)}/${ap.episodesWithPromise} — automated texts never count; customer_promises rows in those episodes: ${show(ap.ledgerRowsInThoseEpisodes)}`
      : `  PROMISES UNKNOWN (calls not read)`);
    const sm = summary.sms;
    log(sm
      ? `\n6 · TEXTS  episodes with an inbound text ${sm.inboundEpisodes} · median first reply ${sm.medianFirstReplyMinOpen?.toFixed(0) ?? "-"} min (n=${sm.repliedOpen}, first text while open) / ${sm.medianFirstReplyMinClosed?.toFixed(0) ?? "-"} min (n=${sm.repliedClosed}, while closed) · last inbound unanswered ${sm.episodesLastInboundUnanswered} · human_pending now (snapshot at run time, not a rate) ${show(sm.humanPendingSnapshot)} · opt-out ${sm.optOutEpisodes} · failed outbound ${sm.failedOutbound}`
      : `\n6 · TEXTS  UNKNOWN (texts not read)`);
    log(summary.kernelDisagreement
      ? `\n7 · LIVE CLASSIFIER vs CUSTOMER WORDS  calls with speech where detectIntents (re-run on the same customer text) finds no intent ${kernel.intentless}; of those, carrying tire words ${kernel.intentlessButTireWords} · their eval outcomes ${JSON.stringify(kernel.outcomes)}\n` +
        `    stored metadata.intents empty but the text has intents ${kernel.storedIntentsMissing} · eval stamped speakerAttribution "unavailable" ${kernel.speakerAttributionUnavailable}`
      : `\n7 · LIVE CLASSIFIER vs CUSTOMER WORDS  UNKNOWN (calls not read)`);
    const rcS = summary.recontact, lcS = summary.linkConfidence, ti = summary.transferIncidents;
    log(rcS ? `\n7b · RECONTACT  episodes where the customer came back >=10 min later ${rcS.episodesRecontactedLater}/${N} (${pct(rcS.episodesRecontactedLater, N)}) · immediate reconnect only ${rcS.episodesImmediateOnly}` : `\n7b · RECONTACT  UNKNOWN`);
    log(lcS ? `     EPISODE LINKS single ${lcS.single} · consistent ${lcS.consistent} · AMBIGUOUS ${lcS.ambiguous} (reported, never forced)` : `     EPISODE LINKS UNKNOWN`);
    log(ti
      ? `     TRANSFER INCIDENTS failures ${ti.failures} (proxy ${ti.proxyFailures}, no phone ${ti.anonymousFailures}) → ${incidents.length} system incident(s) of >=3 known customers${incidents.map((i) => `\n       ${i.start.toISOString()} → ${i.end.toISOString()} · ${i.customers} customers · ${i.failures} failures (${i.anonymousFailures} with no phone)`).join("")}`
      : `     TRANSFER INCIDENTS UNKNOWN (calls not read)`);
    log(summary.callbacks
      ? `     CALLBACKS in ${show(summary.callbacks.episodesWithRow)} episodes · a human called ${summary.callbacks.humanCalled} · auto-flipped to 'no-answer' with nobody calling ${summary.callbacks.autoNoAnswerNobodyCalled}`
      : `     CALLBACKS UNKNOWN (table not read)`);
    log(summary.opportunities ? `     OPPORTUNITY ROWS in ${summary.opportunities.episodesWithRow} episodes (won ${summary.opportunities.episodesWithWonRow})` : `     OPPORTUNITY ROWS UNKNOWN (table not read)`);
    const il = summary.invoiceLinkage;
    log(il
      ? `\n8 · INVOICE LINKAGE (not causation) episodes linked ${il.linkedEpisodes}/${il.eligibleEpisodes} window-complete (${il.censoredEpisodes} censored: their 14 days run past --until) · of them new customers ${il.linkedEpisodesNewCustomers} · linked total $${(il.linkedCentsTotal / 100).toFixed(0)} · by status ${JSON.stringify(il.linkedInvoicesByStatus)} · refunded excluded ${il.refundedInvoicesExcluded}`
      : `\n8 · INVOICE LINKAGE UNKNOWN (invoices not read)`);
    if (EXCERPTS > 0) {
      log(`\n9 · MASKED EXCERPTS (customer token = salted hash, ${STABLE_SALT ? "stable salt" : "per-run salt"}; windows only; digits hashed)`);
      for (const [k, list] of Object.entries(excerpts)) { log(`  ${k}`); for (const x of list) log(`    ${x}`); }
    }
    if (unknown.length) { log(`\nUNKNOWN — these reads failed; every field built on them reads UNKNOWN above, never zero:`); for (const u of unknown) log(`  ${u}`); }
  }

  if (EXPORT) {
    try {
      writeFileSync(EXPORT, exportRows.join("\n") + (exportRows.length ? "\n" : ""), { mode: 0o600 });
      // writeFileSync's mode applies only when it CREATES the file; an existing one keeps its mode.
      chmodSync(EXPORT, 0o600);
      const perms = process.platform === "win32"
        ? "mode 600 has no effect on Windows: the file inherits the folder's ACL — keep it in a private folder"
        : "POSIX mode 600 applied";
      console.error(`EXPORT ${exportRows.length} episodes → ${EXPORT} (${perms}; masked text, digits hashed, coarse times; salt ${STABLE_SALT ? "stable" : "per-run — set CORPUS_ANALYSIS_SALT to join across runs"}). Not for git.`);
    } catch (e) {
      console.error(`EXPORT FAILED (the report above is complete): ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await conn?.end();
}
