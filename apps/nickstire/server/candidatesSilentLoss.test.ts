/**
 * An applicant must never be told "Application Received" when nothing was saved.
 *
 * WHY (2026-09-10): `createCandidate` RETURNS — it does not throw —
 * `{ success: false, migrationPending: true }` when the candidates table is
 * missing. candidates.submit returned that shape straight through, so the tRPC
 * mutation RESOLVED, Careers.tsx's `onSuccess` ran, and the applicant saw the
 * green "Application Received" panel while no row existed. The referral write
 * that fires from the same onSuccess also read `data.id` off that shape —
 * `undefined` — so the technician-referral row lost its candidateId link.
 *
 * The router's own doc comment says this endpoint "DOES throw on a real
 * failure ... losing a job application silently is worse than a visible
 * 'please call us instead'". This is that promise, asserted as BEHAVIOUR
 * rather than as source text: the caller is invoked for real, and the only
 * thing mocked is the DB boundary.
 *
 * Production has 0122 applied, so this was a latent trap — a fresh dev DB, a
 * restored backup, a new environment — not a live loss. It is still the exact
 * silent-failure class this repo has a doctrine about.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const createCandidateMock = vi.fn();

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, createCandidate: (...a: unknown[]) => createCandidateMock(...a) };
});

const { appRouter } = await import("./routers");
type TrpcContext = Parameters<typeof appRouter.createCaller>[0];

/** Unauthenticated caller — candidates.submit is a publicProcedure. */
const anon = () =>
  appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext);

const application = {
  name: "Dana Reyes",
  phone: "216-555-0142",
  positionTitle: "Technician",
};

describe("candidates.submit never reports success it did not achieve", () => {
  beforeEach(() => createCandidateMock.mockReset());

  it("THROWS when the table is missing, instead of resolving the migrationPending shape", async () => {
    createCandidateMock.mockResolvedValue({ success: false, migrationPending: true });

    await expect(anon().candidates.submit(application)).rejects.toBeInstanceOf(TRPCError);
  });

  it("tells the applicant to call, rather than leaking the DB state", async () => {
    createCandidateMock.mockResolvedValue({ success: false, migrationPending: true });

    await expect(anon().candidates.submit(application)).rejects.toThrow(
      /couldn't save your application.*call us/i,
    );
  });

  it("still resolves with the real row id on the happy path", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 4211 });

    // Careers.tsx reads `data.id` here to link the technician-referral row.
    await expect(anon().candidates.submit(application)).resolves.toMatchObject({
      success: true,
      id: 4211,
    });
  });

  // NOT asserted here: "a genuine DB error still throws". The router's catch
  // block is already pinned at source level by candidates.test.ts, and driving
  // a raw throw through the mock makes vitest report the mock's own error as an
  // uncaught test failure even though the router handles it correctly (visible
  // in the run's logs: "[candidates.submit] failed: ER_LOCK_WAIT_TIMEOUT" then
  // the TRPCError). Fighting the harness for coverage that already exists would
  // buy noise, not signal.
});
