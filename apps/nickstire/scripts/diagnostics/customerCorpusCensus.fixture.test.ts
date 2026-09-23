import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end positive control for customer-corpus-census: the runner, fed the
 * synthetic fixture instead of the database (through the SAME window filters
 * the SQL applies), must compute every section from rows. If this goes green
 * while production prints zeros, the zeros are the data's, not the instrument's.
 *
 * The fixture's rows each carry a `_why`. Stored `metadata.intents` are what
 * `detectIntents` actually returns for each call's customer text — generated,
 * not invented — except call 34, the deliberately stale row the
 * storedIntentsMissing metric exists to count.
 */
const APP = process.cwd();
// node + tsx's own CLI, not node_modules/.bin/tsx: a .bin shim cannot be spawned on Windows.
const TSX_CLI = join(APP, "node_modules/tsx/dist/cli.mjs");
const POSIX = process.platform !== "win32";
const CENSUS = "scripts/diagnostics/customer-corpus-census.mts";
const FIXTURE = "scripts/diagnostics/fixtures/customer-corpus.fixture.json";
const WINDOW = ["--since", "2026-09-01", "--until", "2026-09-30"];
// A copy, never process.env itself: serial vitest shares one process.
const ENV = { ...process.env, DATABASE_URL: "", CORPUS_ANALYSIS_SALT: "" };
const census = (args: string[], env: NodeJS.ProcessEnv = ENV) =>
  spawnSync(process.execPath, [TSX_CLI, CENSUS, ...args], { cwd: APP, encoding: "utf-8", env });
const json = (fixture: string, window: string[] = WINDOW) => {
  const r = census(["--fixture", fixture, ...window, "--json"]);
  if (r.status !== 0) throw new Error(`census exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

// Every derived fixture and export lives in ONE temp dir outside the repo.
const TMP = mkdtempSync(join(tmpdir(), "corpus-census-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const base = () => JSON.parse(readFileSync(FIXTURE, "utf-8"));
const writeFixture = (name: string, data: unknown) => {
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
};

describe("customer-corpus-census over the fixture", () => {
  const out = json(FIXTURE);
  const fam = (name: string) => out.families.find((f: { family: string }) => f.family === name);

  it("reads every source, and the SQL window drops what it would drop", () => {
    expect(out.unknownSections).toEqual([]);
    // 20 call rows: 2 outbound (one by call type, one only by the eval cron's
    // 'outbound' stamp — it has no archive row), 1 logged 2026-08-20, before --since
    expect(out.counts.inboundCalls).toBe(17);
    expect(out.counts.outboundCallsExcluded).toBe(2);
    expect(out.counts.texts).toBe(17);
  });

  it("customer turns come from the archive, else metadata.customerSpeech; coverage weeks are Eastern", () => {
    // 15 archive transcripts; call 33 has no archive row but a webhook speech
    // record; the anonymous call 22 has neither
    expect(out.coverage.customerTurnSource).toEqual({ archive: 15, customerSpeech: 1, none: 1 });
    // call 33 is Sunday 11:30 PM ET (Monday 03:30 UTC): the Eastern week of 9/7
    // holds it beside I's two calls and J's call — the UTC week would not
    expect(out.coverage.byEasternWeek["2026-09-07"]).toEqual({ calls: 4, withCustomerTurns: 4, smsIn: 1, smsOut: 1 });
    // 11 calls in the first week; only the anonymous one has no customer turns
    expect(out.coverage.byEasternWeek["2026-08-31"]).toEqual({ calls: 11, withCustomerTurns: 10, smsIn: 6, smsOut: 7 });
    expect(fam("alignment").episodes).toBe(1); // call 33's need, read from customerSpeech
  });

  it("episodes: a gap from the customer's last contact, beside the live kernel's UTC buckets", () => {
    // 19 = A B C D E F, three transfer customers + the anonymous call, I J K M N,
    // the 0117 and 0118 texters, and P's two calls 72 h apart
    expect(out.counts.episodes).toBe(19);
    expect(out.counts.episodesPartial).toBeNull();
    expect(out.counts.callEpisodes).toBe(15); // the 4 text-only: B, C (STOP), 0117, 0118
    // one more than the gap count, from ONE cause: I's calls at 7:55 PM and
    // 8:05 PM ET straddle UTC midnight. Stored intents equal detectIntents'
    // output, so no family difference contributes.
    expect(out.counts.kernelBucketEpisodes).toBe(16);
  });

  it("need shares are over real customers with readable text; the rest is counted apart", () => {
    expect(out.counts.needBaseEpisodes).toBe(16); // 19 − anonymous (no text) − spam call − STOP-only text
    expect(out.counts.noTranscriptEpisodes).toBe(1);
    expect(out.counts.nonCustomerEpisodes).toEqual({ total: 2, spamOrWrongNumber: 1, stopOnlyTexts: 1 });
    expect(fam("human_requested")).toMatchObject({ episodes: 3, share: "18.8%", openedWithHuman: "3/3" }); // 3/16
    expect(fam("oil_change")).toMatchObject({ episodes: 3, share: "18.8%" }); // P's two calls + the 0117 text
    expect(fam("unclear")).toMatchObject({ episodes: 2, share: "12.5%" }); // N's call, "Stop by around 3 ok?"
    expect(out.familiesApart.map((f: { family: string; episodes: number; share: string }) => [f.family, f.episodes, f.share]))
      .toEqual([["no_transcript", 1, "5.3%"], ["non_customer", 2, "10.5%"]]);
  });

  it("the ALL row carries every column's base rate over all 19 episodes", () => {
    expect(out.familiesAll).toMatchObject({
      episodes: 19,
      afterHours: "3/19", // D (9:30 PM), I (7:55 PM), call 33 (Sunday 11:30 PM)
      redial: "2/19", // A's call back 38 min later, I's redial
      transferAttempted: "6/19", // A (forward, no verdict), E, the four failures
      transferNotConnected: "4/19", // 2 verdicts, 1 *-transfer-* reason, the anonymous call
      // written DURING calls D and E, before their log rows: inside only because
      // a call is placed at its START
      arrivalRow: "2/19",
      existingCustomer: "2/19", // P's June invoice precedes both P episodes
      linkedInvoice: "3/18", // A, E (same business day), P's second episode; O is censored
      linkedMedianUsd: 480, // median of $480, $610, $200
      anyFriction: "6/19", // A, D, N, the three manager requests
      opportunityRow: "1/19",
    });
  });

  it("a same-business-day invoice links, and does not make the customer 'existing' (P0-3)", () => {
    // E's invoice is stamped 08:00 ET, the call started 10:05 ET the same day.
    expect(fam("brakes")).toMatchObject({ linkedInvoice: "1/1", existingCustomer: "0/1" });
  });

  it("an invoice links to ONE episode; refunds never link; censored windows leave the rate", () => {
    expect(out.invoiceLinkage).toMatchObject({
      linkedEpisodes: 3,
      eligibleEpisodes: 18, // O started 9/17: 9/17 + 14 days runs past --until 9/30
      censoredEpisodes: 1,
      linkedEpisodesNewCustomers: 2, // A (its 2025 invoice is outside the read window) and E
      linkedCentsTotal: 129000, // 48000 + 61000 + 20000
      linkedInvoicesByStatus: { paid: 2, pending: 1 },
      refundedInvoicesExcluded: 1,
    });
    // P's pending 9/5 invoice sits inside both P episodes' windows; only the later links
    expect(fam("oil_change").linkedInvoice).toBe("1/3");
  });

  it("friction rates are over the need base, with the all-episode base rate beside them", () => {
    expect(out.friction).toEqual({
      // A's "I already told you" and N's; A's "real person"; three "speak to a
      // manager"; D's "still waiting"
      episodesWithSignal: { repeated_self: 2, not_understood: 0, wants_human: 1, wants_manager_owner: 3, ai_distrust: 0, prior_contact: 0, broken_promise: 1, frustration: 0 },
      base: 16,
      episodesWithSignalAllEpisodes: { repeated_self: 2, not_understood: 0, wants_human: 1, wants_manager_owner: 3, ai_distrust: 0, prior_contact: 0, broken_promise: 1, frustration: 0 },
      baseAllEpisodes: 19,
    });
    expect(out.demandFriction).toEqual({ price_uncertainty: 8, human_required: 3, unknown: 2, unknown_tire_size: 1, wait_uncertainty: 1, inventory_uncertainty: 1 });
  });

  it("re-asking a size the caller already gave is counted", () => {
    expect(out.repeatedFacts).toEqual({ reaskedKnownSize: 1, reaskedKnownVehicle: 0, multiCallEpisodes: 2 }); // A re-asked; A and I have 2 calls
  });

  it("asks count only as questions; promises only when a human is SEEN following them", () => {
    // "What size are your tires?" (A's 2nd call) and "Can I get your name?" (N)
    expect(out.assistantAsksPerCall).toEqual({ ask_tire_size: 1, ask_vehicle: 0, ask_name: 1, ask_phone: 0, ask_quantity: 0, calls: 17 });
    expect(out.assistantPromises).toEqual({
      callback: 4, text_followup: 0, rack_check: 0, status_update: 0, // A twice ("I'll have someone call you back" is new), J, N
      episodesWithPromise: 3,
      // J only: an operator's manual text (human_replied) 2 h later. A got a
      // confirmation, a FAILED text and the stale-callback cron's text: none is a human.
      followedByHuman: 1,
      ledgerRowsInThoseEpisodes: 1, // A's row, written during its first call
    });
  });

  it("texts: replies split by the FIRST TEXT's own hour; STOP-looking questions are owed a reply", () => {
    expect(out.sms).toEqual({
      inboundEpisodes: 7, // B, C, D, E, J, 0117, 0118
      // B 90, J 60 and D 30 — D's episode began after hours, but its first
      // text came at 8:30 AM
      medianFirstReplyMinOpen: 60, repliedOpen: 3,
      medianFirstReplyMinClosed: null, repliedClosed: 0,
      episodesLastInboundUnanswered: 3, // E's evening question, 0117's, and "Stop by around 3 ok?"
      humanPendingSnapshot: 1,
      optOutEpisodes: 1, // only the whole-body STOP
      failedOutbound: 1,
    });
  });

  it("the live kernel vs the customer's words, on the same text", () => {
    expect(out.kernelDisagreement).toEqual({
      // spam, the three manager requests, J's bare tire request, P's "oil changes"
      // (the kernel's \bchange\b misses the plural)
      intentless: 6,
      intentlessButTireWords: 1, // J
      outcomes: { unknown: 1 },
      storedIntentsMissing: 1, // call 34
      speakerAttributionUnavailable: 1, // call 34
    });
  });

  it("recontacts: a chase is never a reply; a redial 9 min after the call ENDED is immediate", () => {
    // A (called back), B (texted 10 min later), D (the chase), E (evening text),
    // J (texted an hour later). I's redial started 9 min after the first call
    // ended; its log row lands 10 min later still, which the old placement read
    // as the start.
    expect(out.recontact).toEqual({ episodesRecontactedLater: 5, episodesImmediateOnly: 1, base: 19 });
    // E: brakes then used tires (ambiguous); logistics ("what time…") never are
    expect(out.linkConfidence).toEqual({ single: 13, consistent: 5, ambiguous: 1 });
  });

  it("transfer failures: a verdict, a *-transfer-* reason, and an anonymous call are one incident of 3 known customers", () => {
    expect(out.transferIncidents).toEqual({
      failures: 4, proxyFailures: 0, anonymousFailures: 1,
      incidents: [{ start: "2026-09-04T15:00:00.000Z", end: "2026-09-04T15:50:00.000Z", customers: 3, failures: 4, anonymousFailures: 1 }],
    });
  });

  it("callbacks, opportunities, names", () => {
    expect(out.callbacks).toEqual({ episodesWithRow: 1, humanCalled: 0, autoNoAnswerNobodyCalled: 1 });
    // A's won row landed 22 h after its last call (the refresh runs once per shop day)
    expect(out.opportunities).toEqual({ episodesWithRow: 1, episodesWithWonRow: 1 });
    expect(out.namesShared).toBe(2); // N ("My name is") and 0117 ("it's Casey")
  });

  it("the classifier's own residue and taxonomy are reported (its first consumer)", () => {
    expect(out.classifierCoverage).toMatchObject({
      customerTurns: 19, // A 3, N 3, I 2, and one per other call with speech
      unclear: 5, // A's "same size", the spam line, N's three turns
      labelled: 14,
      belowLowConfidence: 1, // "two new tires, 225/65R17": three rules fire, confidence shaded to 0.65
      residue: 6,
      lowConfidenceLine: 0.7,
      intentsInTaxonomy: 35,
    });
    expect(out.classifierCoverage.intentsNeverSeen).toHaveLength(26); // 35 − the 9 seen
    expect(out.classifierCoverage.intentsNeverSeen).not.toContain("brakes");
  });

  it("the JSON summary carries no text and no phone", () => {
    expect(JSON.stringify(out)).not.toMatch(/555|Jordan|Casey|Euclid|999th|example dot/);
  });
});

describe("a table that is not read is UNKNOWN, never zero", () => {
  const without = (key: string) => {
    const f = base();
    delete f[key];
    return writeFixture(`no-${key}.json`, f);
  };
  const rowsOf = (o: { families: unknown[]; familiesApart: unknown[]; familiesAll: unknown }) =>
    [...o.families, ...o.familiesApart, o.familiesAll] as Array<Record<string, unknown>>;

  it("no invoices: every linkage field is null, and the text says UNKNOWN", () => {
    const p = without("invoices");
    const o = json(p);
    expect(o.unknownSections).toEqual(["invoices: absent from fixture"]);
    expect(o.invoiceLinkage).toBeNull();
    for (const r of rowsOf(o)) expect([r.linkedInvoice, r.linkedMedianUsd, r.existingCustomer]).toEqual([null, null, null]);
    expect(o.counts.inboundCalls).toBe(17); // what WAS read stays a number
    const text = census(["--fixture", p, ...WINDOW]).stdout;
    expect(text).toContain("8 · INVOICE LINKAGE UNKNOWN (invoices not read)");
    expect(text).toContain("invoice linked UNKNOWN of window-complete");
  });

  it("no calls: call-derived fields are null and the episodes say they are partial", () => {
    const p = without("calls");
    const o = json(p);
    expect(o.counts).toMatchObject({ inboundCalls: null, outboundCallsExcluded: null, callEpisodes: null, kernelBucketEpisodes: null, episodesPartial: "calls UNKNOWN" });
    for (const k of ["assistantAsksPerCall", "assistantPromises", "kernelDisagreement", "classifierCoverage", "transferIncidents", "repeatedFacts", "friction", "recontact", "linkConfidence", "namesShared"]) {
      expect(o[k], k).toBeNull();
    }
    expect(o.coverage.byEasternWeek["2026-08-31"]).toEqual({ calls: null, withCustomerTurns: null, smsIn: 6, smsOut: 7 });
    for (const r of rowsOf(o)) expect([r.redial, r.transferAttempted, r.promised, r.anyFriction]).toEqual([null, null, null, null]);
    expect(o.sms.inboundEpisodes).toBe(7); // texts were read
    const text = census(["--fixture", p, ...WINDOW]).stdout;
    // from texts alone: B, C, D, E, J, 0117, 0118 (A's texts are all outbound: no episode)
    expect(text).toContain("2 · EPISODES 7 — PARTIAL (calls UNKNOWN)");
    expect(text).toContain("7 · LIVE CLASSIFIER vs CUSTOMER WORDS  UNKNOWN (calls not read)");
  });

  it("no texts: text-derived fields are null and the episodes say they are partial", () => {
    const p = without("sms");
    const o = json(p);
    expect(o.counts).toMatchObject({ texts: null, episodesPartial: "texts UNKNOWN" });
    expect(o.sms).toBeNull();
    for (const r of rowsOf(o)) expect([r.optOut, r.multiChannel, r.recontactedLater]).toEqual([null, null, null]);
    expect(o.counts.inboundCalls).toBe(17);
    const text = census(["--fixture", p, ...WINDOW]).stdout;
    expect(text).toContain("6 · TEXTS  UNKNOWN (texts not read)");
    expect(text).toContain("opt-out UNKNOWN");
  });
});

describe("dates and windows", () => {
  it("a malformed date is refused before anything is read (exit 2, a message, no stack trace)", () => {
    for (const bad of ["2026-9-1", "2026-02-30", "yesterday"]) {
      // the fixture path does not exist: reaching a read would fail differently
      const r = census(["--fixture", join(TMP, "no-such.json"), "--since", bad, "--until", "2026-09-30", "--json"]);
      expect(r.status, bad).toBe(2);
      expect(r.stderr.trim()).toBe(`customer-corpus-census: --since must be a calendar date as YYYY-MM-DD, got "${bad}"`);
      expect(r.stdout).toBe("");
    }
  });

  it("fixture rows pass through the SQL's window: --since 2026-09-08 keeps six calls", () => {
    // logged on or after 9/8: I's two, J, the customerSpeech call, M, N
    expect(json(FIXTURE, ["--since", "2026-09-08", "--until", "2026-09-30"]).counts.inboundCalls).toBe(6);
  });
});

describe("repro: the need is read in time order (f5)", () => {
  const T = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const EMPTY = { calls: [], sms: [], callback_requests: [], expected_arrivals: [], sms_response_jobs: [], customer_promises: [], revenue_opportunities: [], invoices: [] };

  it("a text sent BEFORE the call states the need; the call's later question does not replace it", () => {
    const p = writeFixture("order.json", {
      ...EMPTY,
      calls: [{
        id: 1, vapiCallId: "o-1", phoneNumber: "+12165550140", durationSeconds: 60, endedReason: "customer-ended-call", evalOutcome: null,
        callbackId: null, leadId: null, metadata: "{}", loggedT: T("2026-09-15T14:01:00Z"), startedT: T("2026-09-15T14:00:00Z"), endedT: T("2026-09-15T14:01:00Z"),
        transcript: "AI: Hi\nUser: what time do you close today\nAI: Six.", messages: null, callType: "inboundPhoneCall",
      }],
      sms: [{ id: 1, phone: "2165550140", direction: "inbound", body: "do you have used tires 17 inch", status: "received", t: T("2026-09-15T13:00:00Z"), optOutT: null }],
    });
    // Calls-first reading made this walk_in_same_day ("today").
    expect(json(p).families.map((f: { family: string }) => f.family)).toEqual(["used_tire_availability"]);
  });
});

describe("--export: masked, coarse, private — and the report never waits on it", () => {
  const file = join(TMP, "pii.jsonl");
  // A FIXED salt: customer tokens are hex, and a random one could contain a digit run the leak checks look for.
  const r = census(["--fixture", FIXTURE, ...WINDOW, "--excerpts", "3", "--export", file], { ...ENV, CORPUS_ANALYSIS_SALT: "census-test-salt" });
  const exported = readFileSync(file, "utf-8");
  const rows = exported.trim().split("\n").map((l) => JSON.parse(l));
  const texts = rows.flatMap((row) => row.contacts.flatMap((c: { turns?: Array<{ text: string }>; body?: string }) => (c.turns ? c.turns.map((t) => t.text) : [c.body!])));

  it("no fake name, street, email, plate or phone digit reaches stdout, the excerpts or the export", () => {
    expect(r.status).toBe(0);
    const LEAKS = [/Jordan/, /Example/, /Casey/, /Sample/, /999th/, /Euclid/, /casey\.sample/, /example dot com/, /4821/, /555[\s.-]?01/, /5550\d/, /\(216\)/, /two one six/, /2 1 6 5/];
    for (const re of LEAKS) {
      expect(r.stdout, String(re)).not.toMatch(re);
      expect(exported, String(re)).not.toMatch(re);
    }
    expect(rows).toHaveLength(19);
    // 47 call turns (both speakers) + 16 text bodies: C's campaign text came
    // before its STOP, and an outbound text never opens an episode
    expect(texts).toHaveLength(63);
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]); // every digit left after maskPII is hashed
    const excerptLines = r.stdout.split("\n").filter((l) => /^ {4}[0-9a-f]{10}: …/.test(l));
    expect(excerptLines).toHaveLength(7);
    expect(excerptLines.filter((l) => /\d/.test(l.slice(16)))).toEqual([]);
  });

  it("the answer to 'Can I get your name?' is replaced whole; the rest of the call is masked by rule", () => {
    const n = rows.find((row) => row.contacts[0].turns?.[0]?.text === "Can I get your name?");
    expect(n.contacts[0].turns.map((t: { text: string }) => t.text)).toEqual([
      "Can I get your name?", "[NAME]", "Thanks. And your address?", "[ADDRESS]",
      "My name is [NAME], I already told you, it's [PHONE]", "Got it, [NAME]. Someone will call you back.",
    ]);
    expect(texts).toContain("hi it's [NAME], my email is [EMAIL] and the plate is JKL ####, do you do oil changes today?");
    expect(texts).toContain("you can reach me at [PHONE] or [SPOKEN-NUMBER]");
  });

  it("times are coarse: the Eastern hour, whole minutes since the start, 10-second durations", () => {
    expect(exported).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    const a = rows.find((row) => row.family === "tire_size_help");
    expect(a.startEt).toBe("2026-09-01T10 ET");
    // call 95 s → 100; confirmation 2 min in; the call back at 40; the failed text at 60; the cron text at 285
    expect(a.contacts.map((c: { channel: string; minFromStart: number; durationSeconds?: number }) => [c.channel, c.minFromStart, c.durationSeconds ?? null]))
      .toEqual([["call", 0, 100], ["sms_out", 2, null], ["call", 40, 60], ["sms_out", 60, null], ["sms_out", 285, null]]);
  });

  it("the file is mode 600, and the stderr line says what that does and does not mean", () => {
    if (POSIX) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(r.stderr).toContain(process.platform === "win32"
      ? "mode 600 has no effect on Windows: the file inherits the folder's ACL"
      : "POSIX mode 600 applied");
  });
});

describe("--export guard (a throwaway checkout in the OS temp dir)", () => {
  // A folder holding `.git` is exactly what the guard detects; no git command runs.
  const checkout = join(TMP, "checkout");
  mkdirSync(join(checkout, ".git"), { recursive: true });
  mkdirSync(join(checkout, "sub"), { recursive: true });
  const exportTo = (target: string, extra: string[] = []) => census(["--fixture", FIXTURE, ...WINDOW, "--json", "--export", target, ...extra]);

  it("refuses a path inside a git checkout: this repo, and a throwaway one", () => {
    for (const target of [join(APP, "corpus-export.jsonl"), join(checkout, "sub", "x.jsonl")]) {
      const r = exportTo(target);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--export refused: .* is inside a git checkout/);
      expect(r.stdout).toBe("");
    }
  });

  // Creating a symlink on Windows needs admin or developer mode.
  it.skipIf(!POSIX)("refuses a symlink into a checkout: a linked folder, or a linked target", () => {
    const linkedDir = join(TMP, "looks-private");
    symlinkSync(join(checkout, "sub"), linkedDir);
    const r1 = exportTo(join(linkedDir, "x.jsonl"));
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/inside a git checkout \(.*checkout\)/);
    const linkedFile = join(TMP, "x-link.jsonl");
    symlinkSync(join(checkout, "sub", "y.jsonl"), linkedFile);
    const r2 = exportTo(linkedFile);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("is a symbolic link");
  });

  it("refuses a missing folder before reading anything", () => {
    // no such fixture either: a read would have failed with ENOENT, not exit 2
    const r = census(["--fixture", join(TMP, "no-such.json"), "--export", join(TMP, "missing", "x.jsonl")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`the folder ${join(TMP, "missing")} does not exist`);
  });

  it.skipIf(!POSIX)("tightens an EXISTING file to 600 (writeFileSync's mode applies only on create)", () => {
    const f = join(TMP, "existing.jsonl");
    writeFileSync(f, "");
    chmodSync(f, 0o644);
    expect(exportTo(f).status).toBe(0);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it("prints the whole report before writing, so a failed write loses nothing", () => {
    const dir = join(TMP, "a-directory.jsonl");
    mkdirSync(dir);
    const r = exportTo(dir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).counts.episodes).toBe(19);
    expect(r.stderr).toContain("EXPORT FAILED (the report above is complete)");
  });
});
