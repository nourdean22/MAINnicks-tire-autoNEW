/**
 * A schema error is not a hiccup.
 *
 * THE INCIDENT, 2026-08-23. `42P01 relation "drift_alerts" does not exist` was
 * classified for the operator as:
 *
 *     "Database hiccup · the engine couldn't reach state. Try again in a moment."
 *
 * It matched the transient branch on the word `prisma`, because the raw message
 * begins "Invalid `prisma.$queryRaw()` invocation". That copy is an instruction to
 * retry, and retrying a dropped table can never succeed. The error ran for a MONTH
 * — first seen 2026-07-25, 814 occurrences — with nobody investigating, because the
 * system kept describing a permanent structural fault as intermittent.
 *
 * Error copy is an instrument. Copy that misreports transient-vs-structural is an
 * instrument that misreports its own reading, and it cost a month.
 *
 * These are behavioural: they call the real exported sanitizer and assert on the
 * message the operator would actually see.
 */
import { describe, it, expect, vi } from "vitest";

// The sanitizer persists to error_logs as a side effect; mock the client so these
// touch no database. The classification under test is pure.
vi.mock("@/lib/prisma", () => ({
  prisma: { errorLog: { create: vi.fn().mockResolvedValue({ id: "x" }) } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";

const say = (msg: string) =>
  sanitizeError(new Error(msg), { route: "test.route" }).publicMessage;

describe("structural errors are not reported as transient", () => {
  it("THE REGRESSION: the exact message that ran for a month", () => {
    const out = say(
      'Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `42P01`. ' +
        'Message: `relation "drift_alerts" does not exist`',
    );
    expect(out, "this is the copy that told the operator to retry a dropped table").not.toMatch(
      /hiccup|try again in a moment/i,
    );
    expect(out).toMatch(/structural/i);
    expect(out, "it must say retrying will not help, or it is the same instruction").toMatch(
      /NOT fix itself|migration/i,
    );
  });

  it("undefined column and undefined function are structural too", () => {
    expect(say('Raw query failed. Code: `42703`. Message: `column "foo" does not exist`')).toMatch(
      /structural/i,
    );
    expect(say('Raw query failed. Code: `42883`. Message: `function bar() does not exist`')).toMatch(
      /structural/i,
    );
  });

  it("POSITIVE CONTROL: a genuinely transient database error still reads as retryable", () => {
    // Without this, a classifier that called EVERYTHING structural would pass every
    // test above while telling the operator a connection blip is unfixable.
    const out = say("Can't reach database server at db:5432 — connection refused (ECONNREFUSED)");
    expect(out).toMatch(/hiccup|try again/i);
    expect(out).not.toMatch(/structural/i);
  });

  it("POSITIVE CONTROL: the other branches still classify as before", () => {
    expect(say("401 unauthorized")).toMatch(/[Aa]uthentication/);
    expect(say("429 rate limit exceeded")).toMatch(/rate limit/i);
  });

  it("NEGATIVE CONTROL: a provider model-not-found is NOT structural", () => {
    // The canonical OpenAI/OpenRouter body. The first version of this branch
    // matched the bare phrase "does not exist" and swallowed it — and because
    // sanitizeError is the GLOBAL tRPC errorFormatter (lib/trpc/trpc.ts:43),
    // that rewrote the copy for every procedure in the app. A model-name typo
    // would have told the operator to write a database migration.
    for (const msg of [
      "The model `gpt-5-turbo` does not exist or you do not have access to it.",
      "404 The model does not exist (openai)",
      "Ollama: model llama3 does not exist",
    ]) {
      const out = say(msg);
      expect(out, msg).not.toMatch(/structural/i);
      expect(out, msg).toMatch(/provider/i);
    }
  });

  it("Prisma's own P2021/P2022 are structural, and P2025 is not", () => {
    // P2021/P2022 mean the table/column is missing — same disagreement, different
    // code path, and they were reading "Database hiccup · try again" via the
    // p2\d+ alternative below. P2025 is a missing ROW, which is ordinary.
    expect(say("PrismaClientKnownRequestError: P2021 The table `main.Foo` does not exist in the current database.")).toMatch(/structural/i);
    expect(say("P2022: The column `Task.bar` does not exist in the current database.")).toMatch(/structural/i);
    expect(say("P2025: An operation failed because it depends on one or more records that were required but not found."))
      .not.toMatch(/structural/i);
  });

  it("NEGATIVE CONTROL: auth and quota errors carrying the phrase keep their own copy", () => {
    // Both verified as live shadowing cases: before anchoring, each matched the
    // structural branch first and told the operator to write a migration.
    expect(say("Unauthorized: the user does not exist or the session expired")).toMatch(/[Aa]uthentication/);
    expect(say("Quota project does not exist or you lack permission")).toMatch(/rate limit|quota/i);
  });

  it("POSITIVE CONTROL for the widened provider branch: nearby phrases still route elsewhere", () => {
    // Guards the other side of that widening. "model" is a common English word
    // in this codebase; if the alternative were just /model/ these would all
    // become "AI provider error".
    expect(say("data model validation failed")).toMatch(/malformed|validation|parse/i);
    expect(say("zod schema parse error on model output")).toMatch(/malformed|parse/i);
  });

  it("NEGATIVE CONTROL: ordinary English 'does not exist' is not a schema error", () => {
    // Two more shapes the bare phrase caught. The tool-function one matters
    // because Postgres's own undefined_function always carries SQLSTATE 42883,
    // which is matched by code — so excluding the word costs nothing.
    expect(say("The requested tool function get_weather does not exist")).not.toMatch(/structural/i);
    expect(say("user does not exist")).not.toMatch(/structural/i);
  });

  it("ordering is load-bearing: a structural error whose text also says 'prisma' stays structural", () => {
    // The transient branch matches /prisma/. If the structural check is ever moved
    // below it, this exact input regresses to "hiccup" — which is the whole bug.
    const out = say('prisma error: relation "some_table" does not exist');
    expect(out).toMatch(/structural/i);
  });
});
