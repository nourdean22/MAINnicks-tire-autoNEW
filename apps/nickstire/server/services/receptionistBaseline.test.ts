/**
 * receptionistBaseline: which prompt the evolution loop should treat as the
 * baseline, and how far the replay lane is from the lane callers ride.
 *
 * Three properties carry the weight, each with its positive control:
 *  1. The baseline is the LIVE prompt text (code + lessons when pushed), not
 *     the code constant, and its parity label says which of the three shapes
 *     it has. All three labels are shown reachable.
 *  2. Every way the read can be wrong THROWS, and the same harness with the
 *     break removed resolves, so a module that always throws cannot pass.
 *  3. REPLAY_LANE is pinned to what the REAL ghostReplay() sends (invokeLLM is
 *     mocked; nothing leaves the process), and the lessons shape check is run
 *     against the REAL getPromptLessons() formatter (db-helper is mocked; no
 *     database is opened).
 *
 * Review fixes (2026-10-09), each with its control: the proven lessons rung is
 * pinned on its own (a wrapped lesson only it can label); a shape-only match
 * never vouches for provenance; an unconfigured memory store (db() null) reads
 * "could not be read", not "none", and an unreachable one reads as the
 * hedged "read empty"; toolIds count as live tools; a second model message or a
 * role-less first message refuses; code + lessonsSuffix rebuilds the served
 * prompt byte for byte, or the detail says it only holds after normalization.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// ghostReplay() imports invokeLLM lazily; this stub is the only LLM it can reach.
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "../_core/llm";
import { GHOST_AGENT_MODEL, ghostReplay } from "./ghostReplay";
import {
  REPLAY_LANE,
  describeLaneParity,
  repositoryBaseline,
  resolveLiveReceptionistBaseline,
  type LiveBaselineDeps,
  type ReceptionistLane,
  type RoutingReading,
} from "./receptionistBaseline";
import { ASSISTANT_SYSTEM_PROMPT } from "./vapi";

const PINNED = "150fe622-0b9f-4b03-b8c7-3063812717ae";
// The last two groups are not all digits on purpose: a 4-digit group followed
// by a 12-digit group reads as 16 digits to lint:pii's card rule.
const OTHER = "0000aaaa-0000-4000-8000-00000000000a";
const RETIRED = "afcad79e-ec33-4156-98fe-7eb325c1222a";
const SERVED_HASH = "abcdef0123456789abcdef01";

/** A lessons block in getPromptLessons' shape (ASCII header; the real one is tested below). */
const LESSONS =
  "\n\n## WHAT WE'VE LEARNED (from recent calls - apply when relevant)\n" +
  "- Brake callers usually want a same-day walk-in.\n" +
  "- Give the cross street when giving the address.";

const MATCH: RoutingReading = {
  state: "match",
  detail: "+12164249249 answers with the same assistant that Push Latest Config writes to.",
  answeringAssistantId: PINNED,
  editTargetAssistantId: PINNED,
};

function liveAssistant(prompt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PINNED,
    name: "Nick's Tire & Auto Receptionist",
    model: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.4,
      maxTokens: 250,
      messages: [{ role: "system", content: prompt }],
      tools: [
        { type: "transferCall", destinations: [{ type: "number", number: "+12165550199" }] },
        { type: "function", function: { name: "tireInquiry" } },
        { type: "function", function: { name: "bookSlot" } },
      ],
    },
    metadata: { nickBehaviorHash: SERVED_HASH, nickBehaviorSchema: "vapi-behavior-v1" },
    ...extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function sha24(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

/** One harness for every case: a clean live read unless a break is supplied. */
function harness(over: {
  routing?: RoutingReading | Error;
  response?: () => Promise<Response>;
  lessons?: string | Error;
} = {}) {
  const fetchAssistant = vi.fn(async (_id: string) =>
    over.response ? over.response() : json(liveAssistant(ASSISTANT_SYSTEM_PROMPT)),
  );
  const deps: LiveBaselineDeps = {
    routing: async () => {
      if (over.routing instanceof Error) throw over.routing;
      return over.routing ?? MATCH;
    },
    fetchAssistant,
    lessons: async () => {
      if (over.lessons instanceof Error) throw over.lessons;
      return over.lessons ?? "";
    },
  };
  return { deps, fetchAssistant };
}

/** The full resolution for one live prompt, through the public API only. */
async function resolveFor(live: string, lessons: string | Error = "") {
  const { deps } = harness({ response: async () => json(liveAssistant(live)), lessons });
  return resolveLiveReceptionistBaseline(deps);
}

/** The parity label for one live prompt, through the public API only. */
async function parityOf(live: string, lessons: string | Error = ""): Promise<string> {
  return (await resolveFor(live, lessons)).parity;
}

/**
 * What the mocked db-helper's db() returns. ONE shared cell, read at call
 * time: nickMemory binds db() once, at its first import, to whichever doMock
 * factory is active then. Every factory below reads this cell, so the tests
 * that load nickMemory keep control of the store in any order (proven with
 * --sequence.shuffle).
 */
const memoryDb: { current: unknown } = { current: null };

/** Rows in shopSettings' shape for two receptionist lessons the real ranker keeps. */
const LESSON_ROWS = [
  { id: 1, key: "nick_memory_lesson_a", value: JSON.stringify({ type: "lesson", content: "Brake callers usually want a same-day walk-in.", source: "vapi_eval_cron", confidence: 0.8, uses: 3 }) },
  { id: 2, key: "nick_memory_lesson_b", value: JSON.stringify({ type: "lesson", content: "Give the cross street when giving the address.", source: "vapi_eval_cron", confidence: 0.7, uses: 2 }) },
];

/**
 * Mock db-helper so db() returns a fake drizzle chain over `rows`, or null
 * (store unconfigured: production's getDb() is null only when DATABASE_URL is
 * unset). No database is opened.
 */
function mockMemoryStore(rows: Array<Record<string, unknown>> | null): void {
  if (rows === null) {
    memoryDb.current = null;
  } else {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows,
    });
    memoryDb.current = chain;
  }
  vi.doMock("../lib/db-helper", () => ({ db: async () => memoryDb.current }));
}

afterEach(() => {
  vi.mocked(invokeLLM).mockReset();
  vi.doUnmock("../lib/db-helper");
  memoryDb.current = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the baseline is the prompt callers hear", () => {
  it("IDENTICAL: live equals the code prompt; every field comes from the provider read", async () => {
    const { deps, fetchAssistant } = harness();
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(fetchAssistant).toHaveBeenCalledWith(PINNED);
    expect(b.source).toBe("live_provider");
    expect(b.assistantId).toBe(PINNED);
    expect(b.prompt).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(b.parity).toBe("identical");
    expect(b.lessonsSuffix).toBe("");
    expect(b.promptHash).toBe(sha24(ASSISTANT_SYSTEM_PROMPT));
    expect(b.providerBehaviorHash).toBe(SERVED_HASH);
    expect(b.providerBehaviorSchema).toBe("vapi-behavior-v1");
    expect(b.liveLane).toEqual({
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.4,
      maxTokens: 250,
      toolNames: ["transferCall", "tireInquiry", "bookSlot"],
    });
    expect(Number.isNaN(Date.parse(b.fetchedAt))).toBe(false);
  });

  it("CODE + LESSONS: the baseline is the live text WITH today's lessons, not the code constant", async () => {
    const live = ASSISTANT_SYSTEM_PROMPT + LESSONS;
    const { deps } = harness({ response: async () => json(liveAssistant(live)), lessons: LESSONS });
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(b.parity).toBe("code_plus_lessons");
    // The PROVEN rung (today's block, exactly), not the shape-only fallback.
    expect(b.parityDetail).toContain("exactly as Push Latest Config builds it");
    expect(b.parityDetail).not.toContain("shape only");
    // The point of the module: replaying the code constant here would have
    // measured a prompt no caller hears.
    expect(b.prompt).toBe(live);
    expect(b.prompt).not.toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(b.promptHash).toBe(sha24(live));
    expect(b.promptHash).not.toBe(repositoryBaseline().promptHash);
    // Like-for-like replay of a code-level candidate: code + suffix rebuilds
    // exactly what callers hear, so the lessons are not appended twice.
    expect(b.lessonsSuffix).toBe(LESSONS);
    expect(ASSISTANT_SYSTEM_PROMPT + b.lessonsSuffix).toBe(b.prompt);
  });

  it("CODE + LESSONS with today's lessons empty: still the lessons label, but the detail does not claim why", async () => {
    const live = ASSISTANT_SYSTEM_PROMPT + LESSONS;
    const { deps } = harness({ response: async () => json(liveAssistant(live)), lessons: "" });
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(b.parity).toBe("code_plus_lessons");
    expect(b.lessonsSuffix).toBe(LESSONS); // the SERVED lessons, not today's (none)
    // "" is ambiguous in production (recall() swallows query errors into []),
    // so the detail names both readings and asserts neither.
    expect(b.parityDetail).toContain("read empty (no lesson qualifies, or the memory store query failed)");
    expect(b.parityDetail).toContain("provenance not verified");
    expect(b.parityDetail).not.toContain("no lesson qualifies today");
  });

  it("a failed lessons read never fails the run; it only narrows the label's evidence", async () => {
    const withLessons = harness({
      response: async () => json(liveAssistant(ASSISTANT_SYSTEM_PROMPT + LESSONS)),
      lessons: new Error("ECONNREFUSED"),
    });
    const a = await resolveLiveReceptionistBaseline(withLessons.deps);
    expect(a.parity).toBe("code_plus_lessons");
    expect(a.parityDetail).toContain("could not be read");

    const plain = harness({ lessons: new Error("ECONNREFUSED") });
    expect((await resolveLiveReceptionistBaseline(plain.deps)).parity).toBe("identical");
  });

  it("the DEFAULT lessons reader turns an unconfigured memory store (db() null) into 'could not be read', not a confident empty", async () => {
    // Production's getPromptLessons() returns "" when db() is null (DATABASE_URL
    // unset); without the guard in defaultLessons this read as "no lesson
    // qualifies". An UNREACHABLE store is not this case: getDb() still returns
    // a lazy pool, recall() swallows the query error, and the read arrives as
    // "", which the "read empty (... or the memory store query failed)" test covers.
    mockMemoryStore(null);
    const live = ASSISTANT_SYSTEM_PROMPT + LESSONS;
    const { routing, fetchAssistant } = harness({ response: async () => json(liveAssistant(live)) }).deps;
    const down = await resolveLiveReceptionistBaseline({ routing, fetchAssistant }); // no `lessons`: the default reader runs
    expect(down.parity).toBe("code_plus_lessons");
    expect(down.parityDetail).toContain("today's lessons could not be read");
    expect(down.parityDetail).not.toContain("read empty");

    // Positive control: the same default reader with the store reachable runs
    // the REAL formatter and reaches the proven rung, so the guard is not a
    // reader that always fails.
    mockMemoryStore(LESSON_ROWS);
    const { getPromptLessons } = await import("./nickMemory");
    const today = await getPromptLessons();
    expect(today).toContain("Brake callers usually want a same-day walk-in.");
    const up = await resolveLiveReceptionistBaseline({
      routing,
      fetchAssistant: async () => json(liveAssistant(ASSISTANT_SYSTEM_PROMPT + today)),
    });
    expect(up.parity).toBe("code_plus_lessons");
    expect(up.parityDetail).toContain("exactly as Push Latest Config builds it");
  });

  it("a block that only LOOKS like lessons keeps the label, but the detail does not vouch for its provenance", async () => {
    // A dashboard hand edit written as bullets under the lessons header.
    const handEdit = "\n\n## WHAT WE'VE LEARNED (operator)\n- Ask for the vehicle year before anything else.";
    const b = await resolveFor(ASSISTANT_SYSTEM_PROMPT + handEdit, LESSONS);
    expect(b.parity).toBe("code_plus_lessons");
    expect(b.lessonsSuffix).toBe(handEdit); // carried to both replay arms either way
    expect(b.parityDetail).toContain("does not equal today's lessons");
    expect(b.parityDetail).toContain("matched by shape only");
    expect(b.parityDetail).toContain("provenance not verified");
    expect(b.parityDetail).not.toContain("so the block is from an earlier push");
    // Positive control: today's exact block is vouched for and carries none of the shape-only words.
    const exact = await resolveFor(ASSISTANT_SYSTEM_PROMPT + LESSONS, LESSONS);
    expect(exact.parityDetail).toContain("exactly as Push Latest Config builds it");
    expect(exact.parityDetail).not.toContain("shape only");
  });

  it("ASSISTANT_SYSTEM_PROMPT + lessonsSuffix rebuilds the served prompt byte for byte, trailing whitespace included", async () => {
    const cases = [
      ASSISTANT_SYSTEM_PROMPT,
      `${ASSISTANT_SYSTEM_PROMPT}\n  `, // identical after normalization
      ASSISTANT_SYSTEM_PROMPT + LESSONS, // proven rung
      `${ASSISTANT_SYSTEM_PROMPT}${LESSONS}\n`, // proven rung, trailing newline
    ];
    for (const live of cases) {
      const b = await resolveFor(live, LESSONS);
      expect(b.parity).not.toBe("diverged");
      expect(b.prompt).toBe(live);
      expect(ASSISTANT_SYSTEM_PROMPT + b.lessonsSuffix).toBe(b.prompt);
      expect(b.parityDetail).not.toContain("only after normalization");
    }
    // Shape-only rung with trailing whitespace: same contract.
    const stale = await resolveFor(`${ASSISTANT_SYSTEM_PROMPT}${LESSONS}\n`, "");
    expect(stale.parity).toBe("code_plus_lessons");
    expect(stale.parityDetail).toContain("shape only"); // really the shape-only rung
    expect(ASSISTANT_SYSTEM_PROMPT + stale.lessonsSuffix).toBe(stale.prompt);
    expect(stale.parityDetail).not.toContain("only after normalization");
  });

  it("served CRLF on the IDENTICAL and SHAPE-ONLY rungs: the detail says the rebuild holds only after normalization", async () => {
    // The byte-exact contract is broken on every rung when the served text uses
    // CRLF, so every rung must say so; the LF cases above are the negative control.
    const handEdit = "\n\n## WHAT WE'VE LEARNED (operator)\n- Ask for the vehicle year before anything else.";
    const rungs: Array<{ name: string; live: string; lessons: string; parity: string; rung: RegExp }> = [
      { name: "identical", live: ASSISTANT_SYSTEM_PROMPT, lessons: "", parity: "identical", rung: /^The live prompt equals the repository prompt\./ },
      { name: "shape-only", live: ASSISTANT_SYSTEM_PROMPT + handEdit, lessons: "", parity: "code_plus_lessons", rung: /shape only/ },
    ];
    for (const r of rungs) {
      const lf = await resolveFor(r.live, r.lessons);
      const crlf = await resolveFor(r.live.replace(/\n/g, "\r\n"), r.lessons);
      // Same rung either way, so the note is the only difference under test.
      expect(lf.parity, r.name).toBe(r.parity);
      expect(crlf.parity, r.name).toBe(r.parity);
      expect(lf.parityDetail, r.name).toMatch(r.rung);
      expect(crlf.parityDetail, r.name).toMatch(r.rung);
      // LF: byte-exact rebuild holds and the detail stays silent.
      expect(ASSISTANT_SYSTEM_PROMPT + lf.lessonsSuffix, r.name).toBe(lf.prompt);
      expect(lf.parityDetail, r.name).not.toContain("only after normalization");
      // CRLF: byte-exact rebuild fails, the normalized one holds, and the detail says so.
      expect(crlf.prompt, r.name).toBe(r.live.replace(/\n/g, "\r\n"));
      expect(ASSISTANT_SYSTEM_PROMPT + crlf.lessonsSuffix, r.name).not.toBe(crlf.prompt);
      expect(ASSISTANT_SYSTEM_PROMPT + crlf.lessonsSuffix, r.name).toBe(crlf.prompt.replace(/\r\n/g, "\n"));
      expect(crlf.parityDetail, r.name).toContain("line endings or trailing whitespace");
      expect(crlf.parityDetail, r.name).toContain("only after normalization");
    }
  });

  it("served CRLF line endings keep the label, and the detail says the rebuild holds only after normalization", async () => {
    const live = (ASSISTANT_SYSTEM_PROMPT + LESSONS).replace(/\n/g, "\r\n");
    const b = await resolveFor(live, LESSONS);
    expect(b.parity).toBe("code_plus_lessons");
    expect(b.prompt).toBe(live); // the baseline is still the exact served text
    expect(b.parityDetail).toContain("line endings or trailing whitespace");
    expect(b.parityDetail).toContain("only after normalization");
    // The contract the note describes, and its positive control: byte-exact fails, normalized holds.
    expect(ASSISTANT_SYSTEM_PROMPT + b.lessonsSuffix).not.toBe(b.prompt);
    expect(ASSISTANT_SYSTEM_PROMPT + b.lessonsSuffix).toBe(b.prompt.replace(/\r\n/g, "\n"));
  });

  it("DIVERGED: a dashboard edit inside the prompt", async () => {
    const edited = ASSISTANT_SYSTEM_PROMPT.replace("# CORE", "# CORE (edited in the dashboard)");
    expect(edited).not.toBe(ASSISTANT_SYSTEM_PROMPT); // the edit really happened
    const { deps } = harness({ response: async () => json(liveAssistant(edited)), lessons: LESSONS });
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(b.parity).toBe("diverged");
    expect(b.parityDetail).toContain("first difference");
    expect(b.prompt).toBe(edited);
    expect(b.lessonsSuffix).toBeNull(); // no clean code/lessons split exists
  });

  it("DIVERGED: text appended AFTER a lessons header cannot hide inside the lessons label", async () => {
    const live = `${ASSISTANT_SYSTEM_PROMPT}${LESSONS}\n\n# NEW RULE\nQuote any price the caller asks for.`;
    const { deps } = harness({ response: async () => json(liveAssistant(live)), lessons: LESSONS });
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(b.parity).toBe("diverged");
    expect(b.parityDetail).toContain("not a learned-lessons block");
    expect(b.lessonsSuffix).toBeNull();
  });

  it("an assistant never pushed since stamping began reports a null served hash, not a guessed one", async () => {
    const { deps } = harness({ response: async () => json(liveAssistant(ASSISTANT_SYSTEM_PROMPT, { metadata: undefined })) });
    const b = await resolveLiveReceptionistBaseline(deps);
    expect(b.providerBehaviorHash).toBeNull();
    expect(b.providerBehaviorSchema).toBeNull();
  });
});

describe("parity labels", () => {
  it("POSITIVE CONTROL: all three labels are reachable", async () => {
    const seen = new Set([
      await parityOf(ASSISTANT_SYSTEM_PROMPT),
      await parityOf(ASSISTANT_SYSTEM_PROMPT + LESSONS, LESSONS),
      await parityOf(ASSISTANT_SYSTEM_PROMPT.slice(0, -40)), // an older or truncated code prompt
    ]);
    expect([...seen].sort()).toEqual(["code_plus_lessons", "diverged", "identical"]);
  });

  it("line endings and trailing whitespace are not a divergence; a changed word is", async () => {
    const crlf = `${ASSISTANT_SYSTEM_PROMPT.replace(/\n/g, "\r\n")}\n  `;
    expect(crlf).not.toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(await parityOf(crlf)).toBe("identical");
    expect(await parityOf(ASSISTANT_SYSTEM_PROMPT.replace("Nick", "Nik"))).toBe("diverged");
  });

  it("today's exact lessons block is recognised even when the strict shape check would reject it", async () => {
    // A lesson whose content wraps a line: getPromptLessons emits "- " + content
    // verbatim, so the second line has no "- " prefix and the shape check fails.
    const wrapped = "\n\n## WHAT WE'VE LEARNED (from recent calls - apply when relevant)\n- Ask for the tire size first\nthen the vehicle year.";
    const b = await resolveFor(ASSISTANT_SYSTEM_PROMPT + wrapped, wrapped);
    expect(b.parity).toBe("code_plus_lessons");
    expect(b.lessonsSuffix).toBe(wrapped); // the integrator still gets the like-for-like suffix
    expect(b.parityDetail).toContain("exactly as Push Latest Config builds it");
    // Positive control: without today's lessons the same text reaches only the
    // shape check, which rejects it. So only the proven rung labelled it above.
    const shapeOnly = await resolveFor(ASSISTANT_SYSTEM_PROMPT + wrapped, "");
    expect(shapeOnly.parity).toBe("diverged");
    expect(shapeOnly.lessonsSuffix).toBeNull();
  });

  it("the lessons shape check accepts the block the REAL getPromptLessons() builds", async () => {
    // Real nickMemory formatter over two fake rows; only the DB handle is fake.
    // No resetModules: it would re-create the hoisted invokeLLM mock and detach
    // the reference the ghostReplay test below asserts on. The shared
    // memoryDb cell is what keeps this order-independent (see its comment).
    mockMemoryStore(LESSON_ROWS);
    const { getPromptLessons } = await import("./nickMemory");
    const block = await getPromptLessons();
    // Positive control: the real formatter actually ran on our rows.
    expect(block).toContain("Brake callers usually want a same-day walk-in.");

    expect(await parityOf(ASSISTANT_SYSTEM_PROMPT + block, block)).toBe("code_plus_lessons");
    // With today's lessons unreadable or different, the SHAPE alone must still recognise it.
    expect(await parityOf(ASSISTANT_SYSTEM_PROMPT + block, new Error("db down"))).toBe("code_plus_lessons");
    expect(await parityOf(ASSISTANT_SYSTEM_PROMPT + block, "")).toBe("code_plus_lessons");
  });
});

describe("fails closed: a weekly run must not measure the wrong baseline", () => {
  const assistantWith = (model: unknown) => async () => json({ id: PINNED, model });

  const breaks: Array<{ name: string; over: Parameters<typeof harness>[0]; rx: RegExp; fetches: boolean }> = [
    { name: "fetch throws", over: { response: async () => { throw new Error("ECONNRESET"); } }, rx: /could not read assistant 150fe622.*ECONNRESET/, fetches: true },
    { name: "non-OK 503", over: { response: async () => new Response("upstream down", { status: 503 }) }, rx: /HTTP 503/, fetches: true },
    { name: "non-OK 404", over: { response: async () => new Response("not found", { status: 404 }) }, rx: /HTTP 404/, fetches: true },
    { name: "body is not JSON", over: { response: async () => new Response("<html>oops</html>", { status: 200 }) }, rx: /not JSON/, fetches: true },
    { name: "body is not an object", over: { response: async () => json([1, 2]) }, rx: /not an assistant object/, fetches: true },
    { name: "no model block", over: { response: async () => json({ id: PINNED }) }, rx: /no model block/, fetches: true },
    { name: "no messages", over: { response: assistantWith({ messages: [] }) }, rx: /no system prompt/, fetches: true },
    { name: "blank prompt", over: { response: assistantWith({ messages: [{ role: "system", content: "   " }] }) }, rx: /no system prompt/, fetches: true },
    { name: "first message is not system", over: { response: assistantWith({ messages: [{ role: "user", content: "hi" }] }) }, rx: /not "system"/, fetches: true },
    {
      name: "first message has no role",
      over: { response: assistantWith({ messages: [{ content: ASSISTANT_SYSTEM_PROMPT }] }) },
      rx: /has no role, not "system"/,
      fetches: true,
    },
    {
      // A dashboard few-shot turn is not a system message, but the served model
      // reads it on every call. Counting only system messages would label this
      // "identical" and drop it from the baseline.
      name: "a second model message with role assistant (a few-shot turn)",
      over: {
        response: assistantWith({
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            { role: "assistant", content: "Sure. What size is on the sidewall of your current tires?" },
          ],
        }),
      },
      rx: /serves 2 model messages/,
      fetches: true,
    },
    {
      // A second message is text callers hear that the one-prompt replay would drop.
      name: "a second model message the replay would omit",
      over: {
        response: assistantWith({
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            { role: "system", content: "Second instruction the replay never sees." },
          ],
        }),
      },
      rx: /serves 2 model messages/,
      fetches: true,
    },
    { name: "provider returned another assistant", over: { response: async () => json(liveAssistant(ASSISTANT_SYSTEM_PROMPT, { id: OTHER })) }, rx: /returned 0000aaaa/, fetches: true },
    {
      name: "routing mismatch",
      over: { routing: { state: "mismatch", detail: "line answers with another assistant.", answeringAssistantId: OTHER, editTargetAssistantId: PINNED } },
      rx: /routing mismatch/,
      fetches: false,
    },
    {
      name: "routing unknown (provider unread)",
      over: { routing: { state: "unknown", detail: "VAPI returned 503 for the phone-number list.", answeringAssistantId: null, editTargetAssistantId: PINNED } },
      rx: /routing is unknown.*503/,
      fetches: false,
    },
    {
      name: "routing unknown (edit target unpinned)",
      over: { routing: { state: "unknown", detail: "VAPI_RECEPTIONIST_ASSISTANT_ID is unset.", answeringAssistantId: PINNED, editTargetAssistantId: null } },
      rx: /routing is unknown/,
      fetches: false,
    },
    { name: "routing read throws", over: { routing: new Error("boom") }, rx: /routing read threw \(boom\)/, fetches: false },
    {
      name: "line answers with a retired assistant",
      over: { routing: { state: "match", detail: "match", answeringAssistantId: RETIRED, editTargetAssistantId: RETIRED } },
      rx: /RETIRED/,
      fetches: false,
    },
    {
      name: "a 'match' whose ids disagree",
      over: { routing: { state: "match", detail: "match", answeringAssistantId: PINNED, editTargetAssistantId: OTHER } },
      rx: /edit target is 0000aaaa/,
      fetches: false,
    },
  ];

  for (const b of breaks) {
    it(`THROWS: ${b.name}`, async () => {
      const { deps, fetchAssistant } = harness(b.over);
      await expect(resolveLiveReceptionistBaseline(deps)).rejects.toThrow(b.rx);
      await expect(resolveLiveReceptionistBaseline(deps)).rejects.toThrow(/^Live receptionist baseline refused: /);
      // Routing refusals happen BEFORE the provider read: nothing unproven is fetched.
      if (!b.fetches) expect(fetchAssistant).not.toHaveBeenCalled();
    });
  }

  it("POSITIVE CONTROL: the same harness with no break resolves", async () => {
    const { deps, fetchAssistant } = harness();
    await expect(resolveLiveReceptionistBaseline(deps)).resolves.toMatchObject({ source: "live_provider", assistantId: PINNED });
    expect(fetchAssistant).toHaveBeenCalledTimes(1);
  });
});

describe("default wiring: real routing truth + real fetchAssistantById over a stubbed fetch", () => {
  function stubVapi(answering: string) {
    vi.stubEnv("VAPI_API_KEY", "test-key");
    vi.stubEnv("VAPI_RECEPTIONIST_ASSISTANT_ID", PINNED);
    const calls: Array<{ method: string; url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ method: (init.method ?? "GET").toUpperCase(), url: String(url), auth: headers.Authorization ?? null });
      if (String(url).endsWith("/phone-number")) return json([{ id: "pn_1", number: "+12164249249", assistantId: answering }]);
      if (String(url).endsWith(`/assistant/${PINNED}`)) return json(liveAssistant(ASSISTANT_SYSTEM_PROMPT));
      return json({ message: "not stubbed" }, 404);
    }));
    return calls;
  }

  it("reads the line binding, then GETs exactly that assistant, read-only and authenticated", async () => {
    const calls = stubVapi(PINNED);
    const b = await resolveLiveReceptionistBaseline({ lessons: async () => "" });
    expect(b.assistantId).toBe(PINNED);
    expect(b.parity).toBe("identical");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.vapi.ai/phone-number",
      `https://api.vapi.ai/assistant/${PINNED}`,
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.every((c) => c.auth === "Bearer test-key")).toBe(true);
  });

  it("POSITIVE CONTROL: the same wiring refuses when the line answers with another assistant", async () => {
    const calls = stubVapi(OTHER);
    await expect(resolveLiveReceptionistBaseline({ lessons: async () => "" })).rejects.toThrow(/routing mismatch/);
    expect(calls.some((c) => c.url.includes("/assistant/"))).toBe(false);
  });
});

describe("lane parity: the replay lane is recorded, not hidden", () => {
  const LIVE: ReceptionistLane = {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.4,
    maxTokens: 250,
    toolNames: ["transferCall", "tireInquiry", "bookSlot"],
  };

  it("REPLAY_LANE is the ghost lane: GHOST_AGENT_MODEL (default deepseek-v4-pro), temperature 0, 700 tokens, no tools", () => {
    expect(REPLAY_LANE.model).toBe(GHOST_AGENT_MODEL);
    expect(REPLAY_LANE.model).toBe(process.env.GHOST_AGENT_MODEL || "deepseek-v4-pro");
    expect(REPLAY_LANE.temperature).toBe(0);
    expect(REPLAY_LANE.maxTokens).toBe(700);
    expect(REPLAY_LANE.tools).toEqual([]);
  });

  it("names all four live-vs-replay differences: model, temperature, maxTokens, tools", () => {
    const r = describeLaneParity(LIVE, REPLAY_LANE);
    expect(r.parity).toBe(false);
    expect(r.differences).toHaveLength(4);
    expect(r.differences).toContain(`model: live openai/gpt-4o vs replay ${REPLAY_LANE.model}`);
    expect(r.differences).toContain("temperature: live 0.4 vs replay 0");
    expect(r.differences).toContain("maxTokens: live 250 vs replay 700");
    expect(r.differences).toContain("tools: live 3 (transferCall, tireInquiry, bookSlot) vs replay 0 (none)");
  });

  it("POSITIVE CONTROL: identical lanes have parity, and each single break is named alone", () => {
    const same = { model: "gpt-4o", temperature: 0.4, maxTokens: 250, tools: ["bookSlot", "tireInquiry", "transferCall"] };
    expect(describeLaneParity(LIVE, same)).toEqual({ parity: true, differences: [] }); // tool order is irrelevant
    const singles: Array<[Partial<typeof same>, RegExp]> = [
      [{ model: "gpt-4o-mini" }, /^model: /],
      [{ temperature: 0 }, /^temperature: /],
      [{ maxTokens: 700 }, /^maxTokens: /],
      [{ tools: ["bookSlot", "tireInquiry"] }, /^tools: /],
    ];
    for (const [change, rx] of singles) {
      const r = describeLaneParity(LIVE, { ...same, ...change });
      expect(r.parity).toBe(false);
      expect(r.differences).toHaveLength(1);
      expect(r.differences[0]).toMatch(rx);
    }
  });

  it("tools referenced by id are live tools, so a toolIds-only assistant still differs from the tool-less replay", async () => {
    const base = liveAssistant(ASSISTANT_SYSTEM_PROMPT);
    const byId = { ...(base.model as Record<string, unknown>), tools: undefined, toolIds: ["tool_abc", "tool_def"] };
    const b = await resolveLiveReceptionistBaseline(harness({ response: async () => json({ ...base, model: byId }) }).deps);
    expect(b.liveLane.toolNames).toEqual(["toolId:tool_abc", "toolId:tool_def"]);
    expect(describeLaneParity(b.liveLane).differences).toContain(
      "tools: live 2 (toolId:tool_abc, toolId:tool_def) vs replay 0 (none)",
    );
    // Positive control: with no inline tools and no tool ids, the tools difference disappears.
    const bare = { ...byId, toolIds: [] };
    const c = await resolveLiveReceptionistBaseline(harness({ response: async () => json({ ...base, model: bare }) }).deps);
    expect(c.liveLane.toolNames).toEqual([]);
    expect(describeLaneParity(c.liveLane).differences.some((d) => d.startsWith("tools:"))).toBe(false);
  });

  it("an unset live field is reported as unset, not silently equal", () => {
    const r = describeLaneParity({ ...LIVE, temperature: null, maxTokens: null }, { model: "gpt-4o", temperature: 0.4, maxTokens: 250, tools: LIVE.toolNames });
    expect(r.differences).toEqual(["temperature: live unset vs replay 0.4", "maxTokens: live unset vs replay 250"]);
  });

  it("REPLAY_LANE matches what the REAL ghostReplay() sends to the model", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({ choices: [{ message: { content: "Sure, come on by today." } }] } as never);
    const replies = await ghostReplay("PROMPT UNDER TEST", ["Do you have tires for a 2017 Civic?"]);
    expect(replies).toEqual(["Sure, come on by today."]);
    expect(vi.mocked(invokeLLM)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(invokeLLM).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(sent.tools).toBeUndefined();
    const observed: ReceptionistLane = {
      provider: null,
      model: sent.model as string,
      temperature: sent.temperature as number,
      maxTokens: sent.maxTokens as number,
      toolNames: [],
    };
    expect(describeLaneParity(observed, REPLAY_LANE)).toEqual({ parity: true, differences: [] });
    // Positive control: the comparison CAN fail on the observed lane.
    expect(describeLaneParity(observed, { ...REPLAY_LANE, maxTokens: 250 }).parity).toBe(false);
  });
});

describe("repositoryBaseline: the code constant, labelled as such", () => {
  it("carries the code prompt and the lane the code would push", () => {
    const r = repositoryBaseline();
    expect(r.source).toBe("repository");
    expect(r.assistantId).toBeNull();
    expect(r.prompt).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(r.promptHash).toBe(sha24(ASSISTANT_SYSTEM_PROMPT));
    expect(r.providerBehaviorHash).toBeNull();
    expect(r.parity).toBe("identical");
    expect(r.lessonsSuffix).toBe("");
    expect(r.parityDetail).toContain("not read from the provider");
    expect(r.liveLane.provider).toBe("openai");
    expect(r.liveLane.model).toBe("gpt-4o");
    expect(r.liveLane.temperature).toBe(0.4);
    expect(r.liveLane.maxTokens).toBe(250);
    expect(r.liveLane.toolNames).toEqual(expect.arrayContaining(["transferCall", "tireInquiry", "bookSlot", "escalate"]));
  });

  it("the code's own lane differs from the replay lane on all four axes today", () => {
    const r = describeLaneParity(repositoryBaseline().liveLane);
    expect(r.parity).toBe(false);
    expect(r.differences.map((d) => d.split(":")[0])).toEqual(["model", "temperature", "maxTokens", "tools"]);
  });
});
