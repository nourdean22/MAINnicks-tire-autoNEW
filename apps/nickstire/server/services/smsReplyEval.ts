/**
 * SMS reply eval (2026-10-30, job calls-texts-review): a fixed set of real customer
 * texts, paraphrased (no names, numbers or customer words), each with the answer a
 * good counter person would give. scripts/sms-reply-eval.ts runs every case through
 * the real orchestrateSms decision inside the replay scope (no writes, no sends) and
 * scores it here, so each wave can show a before/after number, not just green tests.
 *
 * Source: the 90-day phase-1 read (inbound customer texts 2026-08-01..10-30). Baseline
 * measured on real traffic: about 8 of 61 customer texts got a right answer.
 *
 * Expectations:
 *   answer  — the bot should reply on its own with a finished text that carries `must`.
 *   handoff — staff must answer (comeback, safety, diagnosis, job status, anything not
 *             in the facts files). The customer gets the holding reply, never an AI answer.
 *   silent  — not a customer conversation (spam, carrier notice, auto-reply): no text,
 *             nothing in the staff queue.
 *   either  — a thank-you or FYI: silence or a short finished reply are both fine; a
 *             fragment or a staff-queue item is not.
 */

export type EvalExpect =
  | { kind: "answer"; must: RegExp[]; mustNot?: RegExp[] }
  | { kind: "handoff"; mustNot?: RegExp[] }
  | { kind: "silent" }
  | { kind: "either" };

export interface EvalCase {
  id: string;
  group: "customer" | "noise";
  body: string;
  expect: EvalExpect;
}

export type EvalScore = "right" | "wrong" | "fragment" | "none";

export interface EvalOutcome {
  status: string;
  shouldAutoSend: boolean;
  body: string;
  /** W2: held for staff and the customer got the holding reply. */
  holdingReply?: boolean;
}

/** Nour, 2026-10-30: the exact holding reply while staff picks up a thread. */
const HOLDING_REPLY_RE = /a staff member will get back to you shortly/i;

const PRICE = /\$\d+/;
const SHOP = /nick'?s/i;
const ACK = /\b(see you|sounds good|got it|thanks|thank you|we'?ll|come (by|in)|first come)\b/i;
const ASKS = /\?/;
const ALIGN = /\balignment/i;
const ALIGN_PUSHES_INSPECTION = /steering and suspension first/i;
const VISIT = /(first come|walk[- ]?in|come by|stop by|pull (up|in)|open)/i;
const SIZE = /\b(size|stock|check)\b/i;
const FREE_CHECK = /\bfree\b/i;
const OIL_CHANGE_PRICE = /oil change|conventional|synthetic/i;

const answer = (must: RegExp[], mustNot?: RegExp[]): EvalExpect => ({ kind: "answer", must, mustNot });
const handoff = (mustNot?: RegExp[]): EvalExpect => ({ kind: "handoff", mustNot });
const c = (id: string, body: string, expect: EvalExpect): EvalCase => ({ id, group: "customer", body, expect });
const n = (id: string, body: string): EvalCase => ({ id, group: "noise", body, expect: { kind: "silent" } });

export const SMS_EVAL_CASES: EvalCase[] = [
  // ── prices and services the facts files answer ──
  c("tire-price-1", "how much for a tire", answer([PRICE])),
  c("tire-price-2", "Tires", answer([PRICE])),
  c("tire-price-3", "Tires", answer([PRICE])),
  c("tire-price-4", "tires", answer([PRICE])),
  c("tire-price-5", "yes i need a used tire", answer([PRICE])),
  c("tire-size-1", "trying to see if you got any 225/65/17", answer([SIZE])),
  c("tire-size-2", "225/65/r17", answer([SIZE])),
  c("tire-size-3", "I need two rear tires but they're an odd size, 235/45 18R", answer([SIZE])),
  c("tire-quote-1", "can I get a quote for 4 new tires and an alignment on my suv", answer([/tire/i, SIZE])),
  c("brakes-1", "Brakes", answer([FREE_CHECK])),
  c("brakes-2", "suspension and brakes", answer([FREE_CHECK])),
  c("align-1", "I just got new tires and want the alignment checked, how does that work", answer([ALIGN], [ALIGN_PUSHES_INSPECTION])),
  c("align-2", "nothing is wrong with the car I just need an alignment", answer([ALIGN, VISIT], [ALIGN_PUSHES_INSPECTION])),
  c("align-3", "because I just had front end work done", answer([ALIGN], [ALIGN_PUSHES_INSPECTION])),
  c("align-4", "the car is fine, I only need the alignment, I don't need anything extra", answer([ALIGN, VISIT], [ALIGN_PUSHES_INSPECTION])),
  c("align-5", "new tires and new tie rods, only need an alignment, nothing else checked", answer([ALIGN, VISIT], [ALIGN_PUSHES_INSPECTION])),
  c("align-6", "when do you have time for a front alignment on a small sedan and how much", answer([ALIGN, VISIT], [ALIGN_PUSHES_INSPECTION])),
  c("align-7", "just tires and a wheel alignment", answer([ALIGN])),
  c("hours-1", "I'm waiting outside for you to open", answer([VISIT])),
  c("visit-fee-1", "yes it runs and I can bring it, when is a good time and is there a fee? I work second shift", answer([VISIT])),

  // ── the customer already said they're coming ──
  c("arrive-1", "I'll be there today", answer([ACK])),
  c("arrive-2", "I'm on my way", answer([ACK])),
  c("arrive-3", "I'll be in the area around noon", answer([ACK])),
  c("arrive-4", "I'm going to have it towed over Monday morning", answer([ACK])),
  c("arrive-5", "I'll be back to drop it off, just waiting on a ride home", answer([ACK])),

  // ── who is this / hello ──
  c("who-1", "who is this", answer([SHOP])),
  c("who-2", "I'm not familiar?", answer([SHOP])),
  c("who-3", "Hello?", answer([SHOP])),
  c("who-4", "Hey Nick", answer([ASKS])),

  // ── a one-word answer to our "tires, brakes or something else?" text ──
  c("menu-1", "Something else", answer([ASKS])),
  c("menu-2", "Something else", answer([ASKS])),
  c("menu-3", "Something else", answer([ASKS])),
  c("menu-4", "Engine", answer([ASKS])),

  // ── staff must answer: diagnosis, comebacks, safety, job status, unknown facts ──
  c("diag-1", "my valve cover is leaking oil", handoff([OIL_CHANGE_PRICE])),
  c("diag-2", "the valve cover is leaking oil onto the alternator", handoff([OIL_CHANGE_PRICE])),
  c("diag-3", "I think the timing is off, it idles rough", handoff()),
  c("diag-4", "I have a wobble in the front and a ticking noise when I accelerate and at idle", handoff()),
  c("diag-5", "I think my truck needs a timing chain, it throws a code, rattles on the right side and hesitates", handoff()),
  c("diag-6", "how long would the diagnosis take? timing chains are hard to get to", handoff()),
  c("diag-7", "I need a starter rebuilt", handoff()),
  c("comeback-1", "the steering wheel is still a little crooked", handoff()),
  c("comeback-2", "you fixed my car last week and it's doing the same thing, stopped again, the starter", handoff()),
  c("comeback-3", "everything is fine but an emissions light came on as I drove away, did you clear all the codes?", handoff()),
  c("safety-1", "the car is running hot again, third time since I picked it up", handoff()),
  c("status-1", "checking on the status of my car", handoff()),
  c("status-2", "checking to see if my car is done", handoff()),
  c("talk-1", "I need to speak to you", handoff()),
  c("rim-1", "need a rim", handoff()),
  c("holiday-1", "are you open today for the holiday?", handoff()),
  c("context-1", "I forgot to say, it happens while driving", handoff()),

  // ── thank-yous and FYIs ──
  c("fyi-1", "I was in earlier about the sensors, you have to order them, I'll check back in a few days", { kind: "either" }),
  c("fyi-2", "at work, sorry for the late reply", { kind: "either" }),
  c("fyi-3", "driving around feeling safe, told some friends to come see you", { kind: "either" }),
  c("thanks-1", "it's ok so far!", { kind: "either" }),
  c("thanks-2", "I got it taken care of, thank you so much", { kind: "either" }),
  c("thanks-3", "everything is great, thanks for checking", { kind: "either" }),
  c("thanks-4", "thanks I got it fixed", { kind: "either" }),
  c("thanks-5", "good so far thanks!", { kind: "either" }),

  // ── not a shop conversation ──
  n("carrier-1", "You have been blocked from originating messages to this number"),
  n("autoreply-1", "I'm Driving - Sent from My Car"),
  n("spam-health-1", "Hi, can I send you prices on affordable health plans from the big carriers? Reply END to opt out"),
  n("spam-health-2", "Open enrollment is here! Self-employed? Want a health quote? Reply YES for pricing, END to stop"),
  n("spam-payroll-1", "Automate HR with our AI payroll software. Reply YES for a demo, STOP to end"),
  n("spam-land-1", "Hi, I buy vacant land in Cleveland and saw you own a lot here. Interested in selling for cash?"),
  n("spam-junk-1", "I buy junk cars with or without titles, got anything?"),
  n("spam-partner-1", "Would you be open to letting local shoppers pick up packages at your store? No cost to join"),
  n("notice-1", "Your order from a dealership parts department is shipping. Tracking number inside."),
  n("notice-2", "Your file has been moved into approved status, please call us. Reply STOP to opt out"),
  n("link-1", "https://www.facebook.com/share/r/example/"),
  n("personal-1", "hey babe"),
  n("personal-2", "you running late or on time?"),
  n("personal-3", "ok how much time babe"),
  n("personal-4", "half now, rest in cash face to face"),
];

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** A sent text that stops mid-sentence or is a stub. Mirrors the planner's check. */
function isFragment(body: string): boolean {
  const t = body.replace(/\s*Reply STOP to opt out\.?\s*$/i, "").trim();
  if (wordCount(t) < 5) return true;
  return !/[.!?)"'’”\d]$/.test(t) && !/\w\.\w|\//.test(t.split(/\s+/).pop() ?? "");
}

/**
 * The runner's exit code (Codex review of #3393): a run that measured nothing is a
 * failure, not a score. Any errored case, any failed draft (provider down or bad
 * credentials), an empty result set, a paid-lane attempt or unclean isolation exits 1.
 */
export function evalExitCode(input: {
  rows: Array<{ score: EvalScore | "error"; draftFailed: boolean }>;
  paidAttempts: number;
  isolationClean: boolean;
}): { code: 0 | 1; reason: string } {
  if (input.paidAttempts > 0) return { code: 1, reason: "the drafter attempted a paid lane (refused)" };
  if (!input.isolationClean) return { code: 1, reason: "replay isolation was not clean" };
  if (input.rows.length === 0) return { code: 1, reason: "no cases ran" };
  const errored = input.rows.filter((r) => r.score === "error").length;
  if (errored > 0) return { code: 1, reason: `${errored} case(s) errored` };
  const failed = input.rows.filter((r) => r.draftFailed).length;
  if (failed > 0) return { code: 1, reason: `${failed} draft(s) failed: no valid measurement for those cases` };
  return { code: 0, reason: "ok" };
}
/**
 * Score one orchestrateSms decision against its case, from the customer's side.
 * Manager rule (2026-10-30): "wrong" counts only what would actually be SENT; a
 * draft held for staff is never wrong. The holding reply is an acknowledgement:
 * right for a staff-only question, "none" for a question the bot should answer.
 */
export function scoreEvalOutcome(c: EvalCase, o: EvalOutcome): { score: EvalScore; why: string } {
  const sent = o.shouldAutoSend && o.body.trim() !== "";
  const holding = o.holdingReply === true || (sent && HOLDING_REPLY_RE.test(o.body));
  const queued = !sent && o.status === "drafted";
  const e = c.expect;
  if (e.kind === "silent") {
    if (sent || holding) return { score: "wrong", why: "texted a non-customer" };
    if (queued) return { score: "wrong", why: "put a non-customer in the staff queue" };
    return { score: "right", why: "silent" };
  }
  if (e.kind === "either") {
    if (sent && !holding && isFragment(o.body)) return { score: "fragment", why: "sent a fragment" };
    if (holding) return { score: "none", why: "holding reply to a thank-you" };
    if (queued) return { score: "none", why: "held for staff" };
    return { score: "right", why: sent ? "short finished reply" : "silent" };
  }
  if (e.kind === "handoff") {
    if (holding) return { score: "right", why: "holding reply, staff picks up" };
    if (sent && e.mustNot?.some((re) => re.test(o.body))) return { score: "wrong", why: "answered with the wrong service" };
    if (sent) return { score: "wrong", why: "AI answered a staff-only question" };
    return { score: "none", why: queued ? "held for staff, customer hears nothing" : "no reply" };
  }
  if (holding) return { score: "none", why: "holding reply, the answer waits for staff" };
  if (!sent) return { score: "none", why: queued ? "held for staff, customer hears nothing" : "no reply" };
  if (isFragment(o.body)) return { score: "fragment", why: "sent a fragment" };
  const missing = e.must.filter((re) => !re.test(o.body));
  if (missing.length) return { score: "wrong", why: `missing ${missing.map(String).join(", ")}` };
  if (e.mustNot?.some((re) => re.test(o.body))) return { score: "wrong", why: "said what the customer pushed back on" };
  return { score: "right", why: "answered" };
}

/**
 * Fetch for an eval run: only the model hosts the drafter calls, everything else
 * (Twilio, Telegram, email, Langfuse, webhooks) is refused and counted.
 */
const EVAL_MODEL_HOSTS = [
  "ollama.com", "generativelanguage.googleapis.com", "openrouter.ai", "api.openai.com", "api.anthropic.com",
  // classifyIntent's confidence decides auto-send vs staff review, so the eval must reach it
  "router.huggingface.co",
];

export function installModelOnlyFetch(
  target: { fetch?: unknown } = globalThis as { fetch?: unknown },
  allowHosts: readonly string[] = EVAL_MODEL_HOSTS,
): { blockedHosts: string[]; restore(): void } {
  const original = target.fetch as (input: unknown, init?: unknown) => Promise<unknown>;
  const blockedHosts: string[] = [];
  target.fetch = (input: unknown, init?: unknown) => {
    let host = "unknown";
    try { host = new URL(typeof input === "string" ? input : String((input as { url?: string })?.url ?? input)).host; } catch { /* unknown */ }
    if (allowHosts.some((h) => host === h || host.endsWith(`.${h}`))) return original(input, init);
    blockedHosts.push(host);
    return Promise.reject(new Error(`sms eval: outbound fetch blocked (${host})`));
  };
  return { blockedHosts, restore() { target.fetch = original; } };
}
