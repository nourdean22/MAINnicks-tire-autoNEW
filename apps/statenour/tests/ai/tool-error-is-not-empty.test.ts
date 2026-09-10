/**
 * tests/ai/tool-error-is-not-empty.test.ts · 2026-09-10
 *
 * `wrapToolsWithEmptyHandling` rewrites an empty query result into
 *
 *   { success: true, count: 0, data: [], status: "no_data_found",
 *     message: "Query completed successfully, but zero matching records
 *               were found." }
 *
 * and its `isEmptyDataObject` predicate matched `{ error: "...", data: [] }`.
 * So a tool that caught its own database error and reported it honestly
 * had that report DELETED and replaced with an affirmative claim that
 * the query ran and the corpus was empty.
 *
 * The wrapper already handled a THROWN execute and a TIMEOUT correctly --
 * both return `{ error, reflection }`, and the timeout guidance even
 * says "never present an unanswered query as an empty result." The one
 * path it got wrong was the tool that follows this codebase's own
 * convention and returns its error in the result (tools/brain.ts
 * `getBlindSpots` returns `{ error, blindSpots: [] }`).
 *
 * That made the wrapper an amplifier: any swallowed failure anywhere in
 * a query tool's call tree reached the model as "Query completed
 * successfully", with the error string already gone.
 *
 * The control matters as much as the canary. Empty-handling exists
 * because a bare `[]` reads badly to the model, and this fix must not
 * disable it for genuine empties.
 */
import { describe, it, expect, vi } from "vitest";

const mockGetThings = vi.fn();
const mockSearchThings = vi.fn();

vi.mock("@/lib/ai/tools/brain", () => ({ brainTools: {} }));
vi.mock("@/lib/ai/tools/tasks", () => ({
  tasksTools: {
    getThings: { description: "Get things", execute: (...a: any[]) => mockGetThings(...a) },
    searchThings: { description: "Search things", execute: (...a: any[]) => mockSearchThings(...a) },
  },
}));
vi.mock("@/lib/ai/tools/business", () => ({ businessTools: {} }));
vi.mock("@/lib/ai/tools/content", () => ({ contentTools: {} }));
vi.mock("@/lib/ai/tools/social", () => ({ socialTools: {} }));
vi.mock("@/lib/ai/tools/system", () => ({ systemTools: {} }));
vi.mock("@/lib/ai/tools/meta", () => ({ metaTools: {} }));

import { nourTools } from "@/lib/ai/tools";

const SUCCESS_CLAIM = "Query completed successfully";

describe("a reported error survives the empty-result wrapper", () => {
  // The ONE true canary here, measured: disabling the guard fails this
  // test and only this test. The two PINs below pass either way, which
  // is why they are not called canaries -- a test that passes against
  // the unfixed code proves nothing about the fix.
  it("CANARY · { error, data: [] } is not restamped as success", async () => {
    const reported = { error: "connection to the database was lost", data: [] };
    mockGetThings.mockResolvedValue(reported);

    const res: any = await (nourTools as any).getThings.execute({});

    // The whole point: the failure is still there to be read.
    expect(res.error).toBe("connection to the database was lost");
    expect(res.success).not.toBe(true);
    expect(JSON.stringify(res)).not.toContain(SUCCESS_CLAIM);
    expect(res.status).not.toBe("no_data_found");
  });

  it("PIN · an error beside a populated list also survives", async () => {
    // NOT a canary, and labelled honestly after measuring it: with the
    // guard disabled this still passed, because `data` is non-empty so
    // the interception never fired. It pins the partial-failure shape --
    // one source answered, another died, the rows are real and must stay
    // usable while the incompleteness survives -- against a future change
    // to the predicate.
    const reported = { error: "brain dumps read failed", data: [{ id: "r1" }] };
    mockGetThings.mockResolvedValue(reported);

    const res: any = await (nourTools as any).getThings.execute({});
    expect(res.error).toBe("brain dumps read failed");
    expect(res.data).toHaveLength(1);
  });

  it("PIN · the error-carrying shape brain.ts actually uses survives", async () => {
    // Also not a canary: getBlindSpots returns { error, blindSpots: [] }
    // with no `data` key, so it escaped interception by luck rather than
    // by design, and this passed with the guard disabled too. It exists
    // so a future widening of the predicate cannot start eating it.
    mockSearchThings.mockResolvedValue({ error: "detectBlindSpots threw", blindSpots: [] });
    const res: any = await (nourTools as any).searchThings.execute({});
    expect(res.error).toBe("detectBlindSpots threw");
    expect(JSON.stringify(res)).not.toContain(SUCCESS_CLAIM);
  });
});

describe("CONTROL · genuine empties are still wrapped", () => {
  /**
   * Without these, the fix above could have been "delete the empty
   * handling", which would pass every canary and remove a feature that
   * exists for a reason.
   */
  it("a bare [] from a query tool still becomes no_data_found", async () => {
    mockGetThings.mockResolvedValue([]);
    const res: any = await (nourTools as any).getThings.execute({});
    expect(res.status).toBe("no_data_found");
    expect(res.success).toBe(true);
    expect(res.message).toContain(SUCCESS_CLAIM);
  });

  it("{ data: [] } with NO error still becomes no_data_found", async () => {
    mockGetThings.mockResolvedValue({ success: true, data: [] });
    const res: any = await (nourTools as any).getThings.execute({});
    expect(res.status).toBe("no_data_found");
  });

  it("a falsy error field does not suppress empty-handling", async () => {
    // `error: null` / `error: ""` is how a "no error" field is often
    // spelled. Treating that as a failure would switch empty-handling
    // off for every tool that declares the key defensively.
    mockGetThings.mockResolvedValue({ error: null, data: [] });
    const res: any = await (nourTools as any).getThings.execute({});
    expect(res.status).toBe("no_data_found");
  });

  it("a populated result is returned untouched", async () => {
    const data = [{ id: "t1" }];
    mockGetThings.mockResolvedValue(data);
    expect(await (nourTools as any).getThings.execute({})).toBe(data);
  });
});
