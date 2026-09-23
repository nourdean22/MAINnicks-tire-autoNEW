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
 * `--fixture` replays a synthetic JSON (one array per read below) instead of the
 * database — the positive control: it proves every section computes from rows,
 * so a production run printing zeros means the data, not the instrument.
 *
 * WHAT IT PRINTS, IN ORDER, AND WHY THAT ORDER.
 *   1. COVERAGE first — per week, how many calls carry a role-tagged transcript
 *      and how many texts exist. A finding about "three months" is only as wide
 *      as this table; a week with no transcripts is UNKNOWN, not quiet.
 *   2. Episodes: one customer, one continuing contact, across call + SMS, by a
 *      24h GAP (lib/customerCorpus.ts `sessionize`) — alongside the live
 *      kernel's fixed-bucket count, so the difference is visible.
 *   3. Per need family: effort primitives (redials, channel switches, repeated
 *      facts, friction phrases), handoff evidence (transfer attempted vs the
 *      provider's own connected verdict), obligations (callbacks, promises,
 *      expected arrivals) and what followed them, and invoice LINKAGE — a paid
 *      invoice for the same phone within 14 days. Linkage is not causation and
 *      is printed as "linked", never "won" or "recovered".
 *   4. Where the live classifier disagrees with the customer's own words.
 *   5. With --excerpts N: up to N masked, short windows per friction signal.
 *      Never a line, never a transcript, never a phone (maskPII runs first).
 *
 * EVERY RATIO IS PRINTED WITH ITS DENOMINATOR, and a filtered ratio is followed
 * by the same ratio over all episodes (base-rate-check). A query that fails
 * prints UNKNOWN for its section — never a zero (empty-vs-error).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";
import { detectIntents } from "../../server/services/vapiCallClassifier.ts";
import { episodeKey, intentFamily } from "../../shared/callTaxonomy.ts";
import { extractTireSize, extractVehicle } from "../../shared/callDemandExtraction.ts";
import {
  ASK_PATTERNS,
  clusterIncidents,
  countMatches,
  customerToken,
  excerptAround,
  FRICTION_PATTERNS,
  frictionOf,
  isOpen,
  median,
  episodeNeed,
  isTireIntent,
  linkConfidence,
  maskPII,
  namePresent,
  parseTurns,
  pct,
  phoneKey,
  PROMISE_PATTERNS,
  recontacts,
  sessionize,
  type Contact,
  type Friction,
} from "../lib/customerCorpus.ts";
import { classifyVoiceDemand, LOW_CONFIDENCE, VOICE_INTENTS, type VoiceIntent } from "../../server/services/voiceDemandClassifier.ts";

const arg = (name: string, fallback: string | null = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : fallback;
};
const JSON_OUT = process.argv.includes("--json");
const EXCERPTS = Math.max(0, Number(arg("excerpts", "0")) || 0);
const GAP_MIN = Math.max(30, Number(arg("gap-minutes", String(24 * 60))) || 24 * 60);
const REDIAL_MIN = 120;
const LINK_DAYS = 14;
const until = new Date(`${arg("until", new Date().toISOString().slice(0, 10))}T23:59:59Z`);
const since = arg("since")
  ? new Date(`${arg("since")}T00:00:00Z`)
  : new Date(until.getTime() - 92 * 86_400_000);

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
const EXPORT = arg("export");
if (EXPORT) {
  // An export carries masked conversation text. It must never land in a git
  // checkout, where one `git add` publishes it: refuse any path under a .git root.
  let d = dirname(resolve(EXPORT));
  for (;;) {
    if (existsSync(resolve(d, ".git"))) {
      console.error(`--export refused: ${resolve(EXPORT)} is inside a git checkout (${d}). Write it outside the repo.`);
      process.exit(2);
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
}
const log = (...a: unknown[]) => { if (!JSON_OUT) console.log(...a); };
const S = Math.floor(since.getTime() / 1000);
const U = Math.floor(until.getTime() / 1000);
/** Obligation rows can land after the window closes; read that far ahead. */
const U_AHEAD = U + LINK_DAYS * 86_400;

type Row = Record<string, unknown>;
const fixture: Record<string, Row[]> | null = FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf-8")) : null;
const conn = fixture ? null : await mysql.createConnection(url);
const unknown: string[] = [];
async function q(label: string, sql: string, params: unknown[]): Promise<Row[] | null> {
  if (fixture) {
    if (!Array.isArray(fixture[label])) { unknown.push(`${label}: absent from fixture`); return null; }
    return fixture[label]!;
  }
  try {
    const [rows] = await conn!.query(sql, params);
    return rows as Row[];
  } catch (e) {
    unknown.push(`${label}: ${(e as Error).message.slice(0, 160)}`);
    return null;
  }
}
/** Export turns: masked, capped at 400 chars each — enough to read language, never a whole monologue. */
function parseTurnsForExport(c: { customer: string[]; assistant: string[]; turnsOrdered?: Array<{ role: string; text: string }> }) {
  return (c.turnsOrdered ?? []).map((t) => ({ role: t.role, text: maskPII(t.text).slice(0, 400) }));
}
const parseJson = (v: unknown): unknown => {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};

try {
  /* ───────────── reads ───────────── */
  const calls = await q("calls", `
    SELECT v.id, v.vapiCallId, v.phoneNumber, v.durationSeconds, v.endedReason, v.eval_outcome AS evalOutcome,
           v.callbackId, v.leadId, v.metadata, UNIX_TIMESTAMP(v.createdAt) AS t,
           a.transcript, a.messages_json AS messages, a.call_type AS callType
    FROM vapi_call_logs v
    LEFT JOIN vapi_call_archives a ON a.vapi_call_id = v.vapiCallId
    WHERE v.createdAt >= FROM_UNIXTIME(?) AND v.createdAt <= FROM_UNIXTIME(?)`, [S, U]);
  const sms = await q("sms", `
    SELECT m.id, c.phone, m.direction, m.body, m.status, m.failure_reason AS failureReason,
           UNIX_TIMESTAMP(m.createdAt) AS t, UNIX_TIMESTAMP(m.optOutAt) AS optOutT
    FROM sms_messages m JOIN sms_conversations c ON c.id = m.conversationId
    WHERE m.createdAt >= FROM_UNIXTIME(?) AND m.createdAt <= FROM_UNIXTIME(?)`, [S, U]);
  const callbacks = await q("callback_requests", `
    SELECT phone, status, UNIX_TIMESTAMP(createdAt) AS t, UNIX_TIMESTAMP(calledAt) AS calledT
    FROM callback_requests WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, [S, U_AHEAD]);
  const arrivals = await q("expected_arrivals", `
    SELECT customerPhone AS phone, status, source, UNIX_TIMESTAMP(createdAt) AS t, UNIX_TIMESTAMP(arrivedAt) AS arrivedT
    FROM expected_arrivals WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, [S, U_AHEAD]);
  const jobs = await q("sms_response_jobs", `
    SELECT customerPhone AS phone, status, UNIX_TIMESTAMP(createdAt) AS t
    FROM sms_response_jobs WHERE createdAt >= FROM_UNIXTIME(?) AND createdAt <= FROM_UNIXTIME(?)`, [S, U]);
  const promises = await q("customer_promises", `
    SELECT customer_phone AS phone, promise_type AS type, status, UNIX_TIMESTAMP(created_at) AS t
    FROM customer_promises WHERE created_at >= FROM_UNIXTIME(?) AND created_at <= FROM_UNIXTIME(?)`, [S, U]);
  const opportunities = await q("revenue_opportunities", `
    SELECT customer_phone AS phone, source_type AS sourceType, state, UNIX_TIMESTAMP(created_at) AS t
    FROM revenue_opportunities WHERE created_at >= FROM_UNIXTIME(?) AND created_at <= FROM_UNIXTIME(?)`, [S, U_AHEAD]);
  // Invoices from a year back: the earlier ones answer "existing customer?", the
  // later ones answer "linked within 14 days?". Amounts are cents.
  const invoices = await q("invoices", `
    SELECT customerPhone AS phone, totalAmount AS cents, paymentStatus, UNIX_TIMESTAMP(invoiceDate) AS t
    FROM invoices WHERE invoiceDate >= FROM_UNIXTIME(?) AND invoiceDate <= FROM_UNIXTIME(?)`, [S - 365 * 86_400, U_AHEAD]);

  /* ───────────── calls → contacts ───────────── */
  interface CallC extends Contact {
    customer: string[]; assistant: string[]; attributed: boolean; kernelIntents: string[];
    evalOutcome: string | null; endedReason: string; transfer: "none" | "attempted" | "connected" | "not_connected";
    durationSeconds: number; tireSize: string | null; vehicle: string | null; hasCallbackRow: boolean; outbound: boolean;
    need: VoiceIntent; nameShared: boolean; turnsOrdered: Array<{ role: string; text: string }>;
  }
  interface SmsC extends Contact { body: string; status: string; optOut: boolean }
  const callContacts: CallC[] = [];
  let outboundCalls = 0;
  for (const r of calls ?? []) {
    const outbound = /outbound/i.test(String(r.callType ?? ""));
    if (outbound) { outboundCalls++; continue; }
    const meta = (parseJson(r.metadata) ?? {}) as Record<string, unknown>;
    const turns = parseTurns(r.transcript, parseJson(r.messages));
    const customer = turns.filter((x) => x.role === "customer").map((x) => x.text);
    const assistant = turns.filter((x) => x.role === "assistant").map((x) => x.text);
    const verdict = String(((meta.transferArtifact ?? {}) as Record<string, unknown>).verdict ?? "");
    const forwarded = /forward/i.test(String(r.endedReason ?? ""));
    callContacts.push({
      phone10: phoneKey(r.phoneNumber), at: new Date(Number(r.t) * 1000), channel: "call", ref: String(r.id),
      customer, assistant, attributed: turns.length > 0,
      kernelIntents: Array.isArray(meta.intents) ? (meta.intents as string[]) : detectIntents(customer.join(" ")),
      evalOutcome: (r.evalOutcome as string | null) ?? null, endedReason: String(r.endedReason ?? ""),
      transfer: verdict === "connected" ? "connected" : verdict === "not_connected" ? "not_connected" : forwarded ? "attempted" : "none",
      durationSeconds: Number(r.durationSeconds ?? 0),
      tireSize: customer.map((t) => extractTireSize(t)).find(Boolean) ?? null,
      vehicle: customer.map((t) => extractVehicle(t)).find(Boolean) ?? null,
      hasCallbackRow: r.callbackId != null, outbound,
      need: episodeNeed(customer).need, nameShared: customer.some(namePresent),
      turnsOrdered: EXPORT ? turns : [],
    });
  }
  const STOP = /^\s*(stop|stopall|unsubscribe|end|quit|cancel|opt ?out)\b/i;
  /** A failed or still-queued text reached nobody: it is not a reply and not a follow-up. */
  const reached = (s: SmsC) => s.channel === "sms_out" && (s.status === "sent" || s.status === "delivered");
  const smsContacts: SmsC[] = (sms ?? []).map((r) => ({
    phone10: phoneKey(r.phone), at: new Date(Number(r.t) * 1000),
    channel: r.direction === "inbound" ? "sms_in" : "sms_out", ref: String(r.id),
    body: String(r.body ?? ""), status: String(r.status ?? ""),
    optOut: r.direction === "inbound" && STOP.test(String(r.body ?? "")),
  }));

  /* ───────────── 1 · coverage ───────────── */
  const week = (d: Date) => {
    const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const cov = new Map<string, { calls: number; attributed: number; smsIn: number; smsOut: number }>();
  const bump = (k: string) => cov.get(k) ?? (cov.set(k, { calls: 0, attributed: 0, smsIn: 0, smsOut: 0 }), cov.get(k)!);
  for (const c of callContacts) { const w = bump(week(c.at)); w.calls++; if (c.attributed) w.attributed++; }
  for (const s of smsContacts) { const w = bump(week(s.at)); if (s.channel === "sms_in") w.smsIn++; else w.smsOut++; }
  const firstAt = [...callContacts, ...smsContacts].reduce<Date | null>((m, c) => (!m || c.at < m ? c.at : m), null);
  const lastAt = [...callContacts, ...smsContacts].reduce<Date | null>((m, c) => (!m || c.at > m ? c.at : m), null);

  log(`TARGET ${new URL(url).hostname} · window ${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)} · gap ${GAP_MIN} min`);
  log(`ACTUAL COVERAGE first contact ${firstAt?.toISOString() ?? "none"} · last ${lastAt?.toISOString() ?? "none"}`);
  log(`inbound calls ${calls ? callContacts.length : "UNKNOWN"} (outbound excluded ${outboundCalls}) · texts ${sms ? smsContacts.length : "UNKNOWN"}`);
  log(`\n1 · COVERAGE BY WEEK (Mon) — calls · with role-tagged turns · texts in · texts out`);
  for (const [k, v] of [...cov].sort()) log(`  ${k}  ${String(v.calls).padStart(4)} · ${String(v.attributed).padStart(4)} (${pct(v.attributed, v.calls)}) · ${String(v.smsIn).padStart(4)} · ${String(v.smsOut).padStart(5)}`);

  /* ───────────── 2 · episodes ───────────── */
  const contacts: Contact[] = [...callContacts, ...smsContacts];
  const eps = sessionize(contacts, GAP_MIN);
  const bucketKeys = new Set(callContacts.map((c) => episodeKey(c.phone10 || `anon-${c.ref}`, intentFamily(c.kernelIntents), c.at)));
  const callEps = eps.filter((e) => e.contacts.some((c) => c.channel === "call"));
  log(`\n2 · EPISODES ${eps.length} (with a call ${callEps.length}; text-only ${eps.length - callEps.length})`);
  log(`  live kernel's fixed-bucket call episodes: ${bucketKeys.size} vs gap-based call episodes: ${callEps.length}`);

  /* ───────────── 3 · per-episode facts ───────────── */
  const byPhone = <T extends { phone: unknown; t: unknown }>(rows: Row[] | null) => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) { const k = phoneKey(r.phone); if (!k) continue; (m.get(k) ?? (m.set(k, []), m.get(k)!)).push(r); }
    return m;
  };
  const oppBy = byPhone(opportunities);
  const cbBy = byPhone(callbacks), arrBy = byPhone(arrivals), jobBy = byPhone(jobs), invBy = byPhone(invoices), prmBy = byPhone(promises);

  interface EpFacts {
    family: string; openedWithHuman: boolean; demandFriction: string; calls: number; smsIn: number; smsOut: number; redials: number; multiChannel: boolean;
    openStart: boolean; transferAttempted: boolean; transferConnected: boolean; transferNotConnected: boolean;
    callbackRow: boolean; callbackCompleted: boolean; promisesMade: number; promiseFollowedByContact: boolean | null;
    arrivalRow: boolean; arrived: boolean; linkedInvoice: boolean; linkedCents: number; existingCustomer: boolean;
    friction: Record<Friction, number>; reaskedKnownSize: boolean; reaskedKnownVehicle: boolean; optOut: boolean;
    humanPending: boolean; firstReplyMin: number | null; unansweredInbound: boolean; kernelIntentless: boolean;
    turnsCustomer: number; ledgerPromises: number;
    recontactLater: number; recontactImmediate: number; link: "single" | "consistent" | "ambiguous";
    opportunities: number; opportunityWon: boolean; nameShared: boolean;
  }
  const exportRows: string[] = [];
  const facts: EpFacts[] = [];
  const kernelDisagree = { intentlessButTireWords: 0, intentless: 0, outcomes: {} as Record<string, number> };
  const askTotals = countMatches([], ASK_PATTERNS);
  const promiseTotals = countMatches([], PROMISE_PATTERNS);
  const excerpts: Record<string, string[]> = {};

  for (const e of eps) {
    const cs = e.contacts.filter((c): c is CallC => c.channel === "call") as CallC[];
    const ss = e.contacts.filter((c): c is SmsC => c.channel !== "call") as SmsC[];
    const customerTurns = [...cs.flatMap((c) => c.customer), ...ss.filter((s) => s.channel === "sms_in").map((s) => s.body)];
    const en = episodeNeed(customerTurns);
    const endAt = e.end.getTime();
    const startAt = e.start.getTime();
    const inWin = (t: unknown, lo: number, hi: number) => t != null && Number(t) * 1000 >= lo && Number(t) * 1000 <= hi;

    let redials = 0;
    for (let i = 1; i < cs.length; i++) {
      const prevEnd = cs[i - 1]!.at.getTime() + cs[i - 1]!.durationSeconds * 1000;
      if (cs[i]!.at.getTime() - prevEnd <= REDIAL_MIN * 60_000) redials++;
    }

    // Repeated-fact burden: a size or vehicle the customer already gave in an
    // EARLIER call of this episode, asked for again by the assistant later.
    let knownSize = false, knownVehicle = false, reSize = false, reVehicle = false;
    for (const c of cs) {
      const asks = countMatches(c.assistant, ASK_PATTERNS);
      for (const k of Object.keys(asks) as Array<keyof typeof asks>) askTotals[k] += asks[k];
      const prm = countMatches(c.assistant, PROMISE_PATTERNS);
      for (const k of Object.keys(prm) as Array<keyof typeof prm>) promiseTotals[k] += prm[k];
      if (knownSize && asks.ask_tire_size > 0) reSize = true;
      if (knownVehicle && asks.ask_vehicle > 0) reVehicle = true;
      if (c.tireSize) knownSize = true;
      if (c.vehicle) knownVehicle = true;
      if (c.kernelIntents.length === 0 && c.customer.length > 0) {
        kernelDisagree.intentless++;
        if (episodeNeed(c.customer).all.some(isTireIntent)) {
          kernelDisagree.intentlessButTireWords++;
          const o = c.evalOutcome ?? "unscored";
          kernelDisagree.outcomes[o] = (kernelDisagree.outcomes[o] ?? 0) + 1;
        }
      }
    }
    const promisesMade = cs.reduce((n, c) => n + Object.values(countMatches(c.assistant, PROMISE_PATTERNS)).reduce((a, b) => a + b, 0), 0);
    // Follow-up evidence available to a SELECT: an outbound text, a completed
    // callback row, or another call, after the first promise, within 26 h.
    let promiseFollowed: boolean | null = null;
    if (promisesMade > 0) {
      const pAt = cs.find((c) => Object.values(countMatches(c.assistant, PROMISE_PATTERNS)).some((v) => v > 0))!.at.getTime();
      const outText = smsContacts.some((s) => s.phone10 === e.phone10 && reached(s) && s.at.getTime() > pAt && s.at.getTime() <= pAt + 26 * 3_600_000);
      const cbDone = (cbBy.get(e.phone10) ?? []).some((r) => inWin(r.calledT, pAt, pAt + 26 * 3_600_000));
      promiseFollowed = outText || cbDone;
    }

    const cbRows = (cbBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, endAt + 2 * 3_600_000));
    const arrRows = (arrBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, endAt + 2 * 3_600_000));
    const invs = invBy.get(e.phone10) ?? [];
    const linked = invs.filter((r) => inWin(r.t, startAt, startAt + LINK_DAYS * 86_400_000));
    const inbound = ss.filter((s) => s.channel === "sms_in");
    let firstReplyMin: number | null = null;
    if (inbound.length) {
      const reply = ss.find((s) => reached(s) && s.at > inbound[0]!.at);
      if (reply) firstReplyMin = (reply.at.getTime() - inbound[0]!.at.getTime()) / 60_000;
    }
    const friction = frictionOf(customerTurns);
    if (EXCERPTS > 0) {
      for (const [k, re] of Object.entries(FRICTION_PATTERNS)) {
        const list = (excerpts[k] ??= []);
        if (list.length >= EXCERPTS) continue;
        const hit = customerTurns.map((t) => excerptAround(t, re)).find(Boolean);
        if (hit) list.push(`${customerToken(e.phone10, SALT)}: …${hit}…`);
      }
    }
    const customerInit = e.contacts
      .filter((c) => c.channel !== "sms_out")
      .map((c) => ({ at: c.at, endAt: c.channel === "call" ? new Date(c.at.getTime() + (c as CallC).durationSeconds * 1000) : c.at }));
    const rc = recontacts(customerInit);
    const perContactNeeds = e.contacts
      .filter((c) => c.channel !== "sms_out")
      .map((c) => (c.channel === "call" ? (c as CallC).need : episodeNeed([(c as SmsC).body]).need));
    const link = linkConfidence(perContactNeeds);
    const opps = (oppBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, endAt + 2 * 3_600_000));
    facts.push({
      recontactLater: rc.later, recontactImmediate: rc.immediate, link,
      opportunities: opps.length, opportunityWon: opps.some((r) => r.state === "won"),
      nameShared: cs.some((c) => c.nameShared) || inbound.some((s) => namePresent(s.body)),
      family: en.need, openedWithHuman: en.openedWithHuman, demandFriction: en.friction, calls: cs.length, smsIn: inbound.length, smsOut: ss.length - inbound.length,
      redials, multiChannel: cs.length > 0 && inbound.length > 0, openStart: isOpen(e.start),
      transferAttempted: cs.some((c) => c.transfer !== "none"),
      transferConnected: cs.some((c) => c.transfer === "connected"),
      transferNotConnected: cs.some((c) => c.transfer === "not_connected"),
      callbackRow: cbRows.length > 0 || cs.some((c) => c.hasCallbackRow),
      callbackCompleted: cbRows.some((r) => r.status === "completed" || r.calledT != null),
      promisesMade, promiseFollowedByContact: promiseFollowed,
      arrivalRow: arrRows.length > 0, arrived: arrRows.some((r) => r.status === "arrived"),
      linkedInvoice: linked.length > 0, linkedCents: linked.reduce((n, r) => n + Number(r.cents ?? 0), 0),
      existingCustomer: invs.some((r) => Number(r.t) * 1000 < startAt),
      friction, reaskedKnownSize: reSize, reaskedKnownVehicle: reVehicle,
      optOut: ss.some((s) => s.optOut), humanPending: (jobBy.get(e.phone10) ?? []).some((r) => r.status === "human_pending" && inWin(r.t, startAt, endAt)),
      firstReplyMin, unansweredInbound: inbound.length > 0 && !ss.some((s) => reached(s) && s.at > inbound[inbound.length - 1]!.at),
      kernelIntentless: cs.some((c) => c.kernelIntents.length === 0 && c.customer.length > 0),
      turnsCustomer: customerTurns.length,
      ledgerPromises: (prmBy.get(e.phone10) ?? []).filter((r) => inWin(r.t, startAt, endAt + 2 * 3_600_000)).length,
    });
    if (EXPORT) {
      // Masked text only; the phone is a salted token; the derived facts carry no PII.
      const { friction: fr, ...derived } = facts[facts.length - 1]!;
      exportRows.push(JSON.stringify({
        customerKey: e.phone10 ? customerToken(e.phone10, SALT) : null,
        start: e.start.toISOString(), end: e.end.toISOString(),
        needs: perContactNeeds, ...derived, friction: fr,
        contacts: e.contacts.map((c) => c.channel === "call"
          ? {
              channel: "call", at: c.at.toISOString(), durationSeconds: (c as CallC).durationSeconds,
              endedReason: (c as CallC).endedReason, evalOutcome: (c as CallC).evalOutcome, transfer: (c as CallC).transfer,
              tireSize: (c as CallC).tireSize, vehicle: (c as CallC).vehicle,
              turns: parseTurnsForExport(c as CallC),
            }
          : { channel: c.channel, at: c.at.toISOString(), status: (c as SmsC).status, body: maskPII((c as SmsC).body) }),
      }));
    }
  }

  /* ───────────── incidents: one system failure, many customers ───────────── */
  // A failure is the provider's own not_connected verdict, or — for calls before
  // the verdict existed — a forwarded call the same customer redialled within 15
  // minutes (the measured proxy; labelled as such).
  const failures: Array<{ at: Date; phone10: string }> = [];
  const callsByPhone = new Map<string, CallC[]>();
  for (const c of callContacts) (callsByPhone.get(c.phone10) ?? (callsByPhone.set(c.phone10, []), callsByPhone.get(c.phone10)!)).push(c);
  let proxyFailures = 0;
  for (const c of callContacts) {
    if (c.transfer === "not_connected") { failures.push({ at: c.at, phone10: c.phone10 }); continue; }
    if (c.transfer !== "attempted" || !c.phone10) continue;
    const end = c.at.getTime() + c.durationSeconds * 1000;
    const redial = (callsByPhone.get(c.phone10) ?? []).some((o) => o.at.getTime() > end && o.at.getTime() - end <= 15 * 60_000);
    if (redial) { failures.push({ at: c.at, phone10: c.phone10 }); proxyFailures++; }
  }
  const incidents = clusterIncidents(failures);

  /* ───────────── report ───────────── */
  const N = facts.length;
  const fams = new Map<string, EpFacts[]>();
  for (const f of facts) (fams.get(f.family) ?? (fams.set(f.family, []), fams.get(f.family)!)).push(f);
  const share = (xs: EpFacts[], p: (f: EpFacts) => boolean) => `${xs.filter(p).length}/${xs.length}`;
  const rows = [...fams].sort((a, b) => b[1].length - a[1].length).map(([family, xs]) => ({
    family, episodes: xs.length, share: pct(xs.length, N),
    medianContacts: median(xs.map((f) => f.calls + f.smsIn)),
    openedWithHuman: share(xs, (f) => f.openedWithHuman),
    redial: share(xs, (f) => f.redials > 0), multiChannel: share(xs, (f) => f.multiChannel),
    afterHours: share(xs, (f) => !f.openStart),
    transferAttempted: share(xs, (f) => f.transferAttempted), transferConnected: share(xs, (f) => f.transferConnected),
    transferNotConnected: share(xs, (f) => f.transferNotConnected),
    callbackRow: share(xs, (f) => f.callbackRow), callbackCompleted: share(xs, (f) => f.callbackCompleted),
    promised: share(xs, (f) => f.promisesMade > 0), promiseFollowed: share(xs.filter((f) => f.promisesMade > 0), (f) => f.promiseFollowedByContact === true),
    arrivalRow: share(xs, (f) => f.arrivalRow), arrived: share(xs, (f) => f.arrived),
    linkedInvoice: share(xs, (f) => f.linkedInvoice), linkedMedianUsd: median(xs.filter((f) => f.linkedInvoice).map((f) => f.linkedCents / 100)),
    existingCustomer: share(xs, (f) => f.existingCustomer),
    anyFriction: share(xs, (f) => Object.values(f.friction).some((v) => v > 0)),
    optOut: share(xs, (f) => f.optOut),
    recontactedLater: share(xs, (f) => f.recontactLater > 0),
    ambiguousLink: share(xs, (f) => f.link === "ambiguous"),
    opportunityRow: share(xs, (f) => f.opportunities > 0),
  }));
  const frictionTotals = Object.fromEntries(Object.keys(FRICTION_PATTERNS).map((k) => [k, facts.filter((f) => f.friction[k as Friction] > 0).length]));
  const inboundSmsEps = facts.filter((f) => f.smsIn > 0);
  const replyOpen = facts.filter((f) => f.smsIn > 0 && f.openStart && f.firstReplyMin != null).map((f) => f.firstReplyMin!);
  const replyClosed = facts.filter((f) => f.smsIn > 0 && !f.openStart && f.firstReplyMin != null).map((f) => f.firstReplyMin!);
  const promiseEps = facts.filter((f) => f.promisesMade > 0);
  const summary = {
    window: { since: since.toISOString(), until: until.toISOString(), firstContact: firstAt?.toISOString() ?? null, lastContact: lastAt?.toISOString() ?? null },
    coverage: Object.fromEntries([...cov].sort()),
    counts: { inboundCalls: calls ? callContacts.length : null, outboundCallsExcluded: outboundCalls, texts: sms ? smsContacts.length : null, episodes: N, callEpisodes: callEps.length, kernelBucketEpisodes: bucketKeys.size },
    families: rows,
    classifierCoverage: (() => {
      // Every customer turn the demand classifier labelled (masked first, as
      // episodeNeed does): how many sit below its own LOW_CONFIDENCE line —
      // the turns its header says belong to a model tier or a human, i.e. the
      // residue a wiring decision has to price — and which intents never occur.
      let labelled = 0, low = 0;
      for (const c of callContacts) for (const t of c.customer) {
        const r = classifyVoiceDemand(maskPII(t));
        if (r.intent === "unclear") continue;
        labelled++;
        if (r.confidence < LOW_CONFIDENCE) low++;
      }
      return { labelledTurns: labelled, belowLowConfidence: low, lowConfidenceLine: LOW_CONFIDENCE, intentsNeverSeen: VOICE_INTENTS.filter((i) => !fams.has(i)) };
    })(),
    demandFriction: Object.fromEntries([...facts.reduce((m, f) => m.set(f.demandFriction, (m.get(f.demandFriction) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])),
    friction: { episodesWithSignal: frictionTotals, baseEpisodes: N },
    repeatedFacts: {
      reaskedKnownSize: facts.filter((f) => f.reaskedKnownSize).length,
      reaskedKnownVehicle: facts.filter((f) => f.reaskedKnownVehicle).length,
      multiCallEpisodes: facts.filter((f) => f.calls > 1).length,
    },
    assistantAsksPerCall: { ...askTotals, calls: callContacts.length },
    assistantPromises: { ...promiseTotals, episodesWithPromise: promiseEps.length, followedByVisibleContact: promiseEps.filter((f) => f.promiseFollowedByContact).length, ledgerRowsInThoseEpisodes: promiseEps.reduce((n, f) => n + f.ledgerPromises, 0) },
    sms: {
      inboundEpisodes: inboundSmsEps.length,
      medianFirstReplyMinOpen: median(replyOpen), medianFirstReplyMinClosed: median(replyClosed),
      episodesLastInboundUnanswered: facts.filter((f) => f.unansweredInbound).length,
      humanPendingEpisodes: facts.filter((f) => f.humanPending).length,
      optOutEpisodes: facts.filter((f) => f.optOut).length,
      failedOutbound: smsContacts.filter((s) => s.channel === "sms_out" && s.status === "failed").length,
    },
    kernelDisagreement: kernelDisagree,
    recontact: {
      note: "later = a customer-initiated contact >=10 min after the previous one ended; immediate = a reconnect under 10 min",
      episodesRecontactedLater: facts.filter((f) => f.recontactLater > 0).length,
      episodesImmediateOnly: facts.filter((f) => f.recontactImmediate > 0 && f.recontactLater === 0).length,
      base: N,
    },
    linkConfidence: {
      single: facts.filter((f) => f.link === "single").length,
      consistent: facts.filter((f) => f.link === "consistent").length,
      ambiguous: facts.filter((f) => f.link === "ambiguous").length,
    },
    transferIncidents: {
      note: "clusters of >=3 customers whose transfer failed within 60 min of each other; failure = not_connected verdict, or a forwarded call redialled within 15 min (proxy)",
      failures: failures.length, proxyFailures, incidents: incidents.map((i) => ({ ...i, start: i.start.toISOString(), end: i.end.toISOString() })),
    },
    opportunities: {
      episodesWithRow: facts.filter((f) => f.opportunities > 0).length,
      episodesWithWonRow: facts.filter((f) => f.opportunityWon).length,
    },
    namesShared: facts.filter((f) => f.nameShared).length,
    salt: STABLE_SALT ? "stable (CORPUS_ANALYSIS_SALT)" : "per-run",
    invoiceLinkage: {
      note: "linked = a paid-or-pending invoice for the same phone within 14 days of episode start. Not attribution, not causation.",
      linkedEpisodes: facts.filter((f) => f.linkedInvoice).length,
      linkedEpisodesNewCustomers: facts.filter((f) => f.linkedInvoice && !f.existingCustomer).length,
      linkedCentsTotal: facts.reduce((n, f) => n + f.linkedCents, 0),
    },
    unknownSections: unknown,
  };

  if (EXPORT) {
    writeFileSync(EXPORT, exportRows.join("\n") + (exportRows.length ? "\n" : ""), { mode: 0o600 });
    console.error(`EXPORT ${exportRows.length} episodes → ${resolve(EXPORT)} (mode 600; masked text; salt ${STABLE_SALT ? "stable" : "per-run — set CORPUS_ANALYSIS_SALT to join across runs"}). Not for git.`);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(`\n3 · NEEDS — voiceDemandClassifier intent, episode-level; each cell "k/n" of that need's episodes`);
    for (const r of rows) log(`  ${r.family.padEnd(34)} ${String(r.episodes).padStart(5)} ${r.share.padStart(6)} · contacts~${r.medianContacts} · opened asking for a person ${r.openedWithHuman} · redial ${r.redial} · call+text ${r.multiChannel} · after-hours ${r.afterHours}\n` +
      `      transfer tried ${r.transferAttempted}, connected ${r.transferConnected}, verified-failed ${r.transferNotConnected} · callback row ${r.callbackRow}, done ${r.callbackCompleted} · promised ${r.promised}, followed ${r.promiseFollowed}\n` +
      `      arrival row ${r.arrivalRow}, arrived ${r.arrived} · invoice linked ${r.linkedInvoice} (median $${r.linkedMedianUsd ?? "-"}) · existing customer ${r.existingCustomer} · friction ${r.anyFriction} · opt-out ${r.optOut}\n` +
      `      came back >=10 min later ${r.recontactedLater} · ambiguous link ${r.ambiguousLink} · opportunity row ${r.opportunityRow}`);
    log(`  classifier: ${summary.classifierCoverage.belowLowConfidence}/${summary.classifierCoverage.labelledTurns} labelled turns below LOW_CONFIDENCE ${LOW_CONFIDENCE} (model-tier / human candidates) · intents never seen: ${summary.classifierCoverage.intentsNeverSeen.length} of ${VOICE_INTENTS.length}`);
    log(`  blocking friction (voiceDemandClassifier): ${Object.entries(summary.demandFriction).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    log(`\n4 · FRICTION PRIMITIVES — episodes with ≥1 signal (base: all ${N} episodes)`);
    for (const [k, v] of Object.entries(frictionTotals)) log(`  ${k.padEnd(20)} ${String(v).padStart(5)}  ${pct(v as number, N)}`);
    log(`  re-asked a size given in an earlier call ${summary.repeatedFacts.reaskedKnownSize} · a vehicle ${summary.repeatedFacts.reaskedKnownVehicle} · of ${summary.repeatedFacts.multiCallEpisodes} multi-call episodes`);
    log(`\n5 · WHAT THE ASSISTANT ASKS (turns across ${callContacts.length} calls): ${Object.entries(askTotals).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    log(`  PROMISES made in ${promiseEps.length} episodes (${Object.entries(promiseTotals).map(([k, v]) => `${k} ${v}`).join(" · ")}); followed by a visible outbound text or completed callback within 26h: ${summary.assistantPromises.followedByVisibleContact}/${promiseEps.length}; customer_promises rows in those episodes: ${summary.assistantPromises.ledgerRowsInThoseEpisodes}${promises ? "" : " (table UNKNOWN)"}`);
    log(`\n6 · TEXTS  episodes with an inbound text ${inboundSmsEps.length} · median first reply ${median(replyOpen)?.toFixed(0) ?? "-"} min (open) / ${median(replyClosed)?.toFixed(0) ?? "-"} min (closed) · last inbound unanswered ${summary.sms.episodesLastInboundUnanswered} · human_pending ${summary.sms.humanPendingEpisodes} · opt-out ${summary.sms.optOutEpisodes} · failed outbound ${summary.sms.failedOutbound}`);
    log(`\n7 · LIVE CLASSIFIER vs CUSTOMER WORDS  calls with speech but no kernel intent ${kernelDisagree.intentless}; of those, carrying tire words ${kernelDisagree.intentlessButTireWords} · their eval outcomes ${JSON.stringify(kernelDisagree.outcomes)}`);
    log(`\n7b · RECONTACT  episodes where the customer came back >=10 min later ${summary.recontact.episodesRecontactedLater}/${N} (${pct(summary.recontact.episodesRecontactedLater, N)}) · immediate reconnect only ${summary.recontact.episodesImmediateOnly}`);
    log(`     EPISODE LINKS single ${summary.linkConfidence.single} · consistent ${summary.linkConfidence.consistent} · AMBIGUOUS ${summary.linkConfidence.ambiguous} (reported, never forced)`);
    log(`     TRANSFER INCIDENTS failures ${failures.length} (proxy ${proxyFailures}) → ${incidents.length} system incident(s) of >=3 customers${incidents.map((i) => `\n       ${i.start.toISOString()} → ${i.end.toISOString()} · ${i.customers} customers · ${i.failures} failures`).join("")}`);
    log(`     OPPORTUNITY ROWS in ${summary.opportunities.episodesWithRow} episodes (won ${summary.opportunities.episodesWithWonRow})${opportunities ? "" : " (table UNKNOWN)"}`);
    log(`\n8 · INVOICE LINKAGE (not causation) episodes linked ${summary.invoiceLinkage.linkedEpisodes}/${N} · of them new customers ${summary.invoiceLinkage.linkedEpisodesNewCustomers} · linked total $${(summary.invoiceLinkage.linkedCentsTotal / 100).toFixed(0)}`);
    if (EXCERPTS > 0) {
      log(`\n9 · MASKED EXCERPTS (customer token = per-run salted hash; windows only)`);
      for (const [k, list] of Object.entries(excerpts)) { log(`  ${k}`); for (const x of list) log(`    ${x}`); }
    }
    if (unknown.length) { log(`\nUNKNOWN — these reads failed; their sections above are not zeros:`); for (const u of unknown) log(`  ${u}`); }
  }
} finally {
  await conn?.end();
}
