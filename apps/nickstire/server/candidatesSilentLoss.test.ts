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

const runCandidateIntakeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./services/candidateIntake", () => ({
  runCandidateIntake: (...a: unknown[]) => runCandidateIntakeMock(...a),
}));

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

describe("a filled honeypot is SAVED and flagged, never silently dropped (post-merge audit 2026-09-23)", () => {
  // The first version returned { success: true, id: 0 } and wrote nothing. A
  // browser autofilling the hidden field for a real person would have been the
  // exact silent loss this file exists to forbid.
  beforeEach(() => {
    createCandidateMock.mockReset();
    runCandidateIntakeMock.mockClear();
  });

  it("writes the row with source careers_honeypot and returns its real id", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 77, columns0129: true });
    await expect(
      anon().candidates.submit({ ...application, website: "http://spam.example" }),
    ).resolves.toMatchObject({ success: true, id: 77 });
    expect(createCandidateMock).toHaveBeenCalledTimes(1);
    expect(createCandidateMock.mock.calls[0][0]).toMatchObject({ source: "careers_honeypot", name: "Dana Reyes" });
  });

  it("sends NO owner text or email for a flagged row", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 78, columns0129: true });
    await anon().candidates.submit({ ...application, website: "x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(runCandidateIntakeMock).not.toHaveBeenCalled();
  });

  it("control: an ordinary submission is source careers and DOES reach intake", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 79, columns0129: true });
    await anon().candidates.submit(application);
    await new Promise((r) => setTimeout(r, 0));
    expect(createCandidateMock.mock.calls[0][0]).toMatchObject({ source: "careers" });
    expect(runCandidateIntakeMock).toHaveBeenCalledTimes(1);
  });
});


describe("hostile or messy input never costs the application (audit 2026-09-23)", () => {
  beforeEach(() => {
    createCandidateMock.mockReset();
    runCandidateIntakeMock.mockClear();
  });

  it("over-long attribution (a long ad landing URL) is CLIPPED to the column, and the row saves", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 90, columns0129: true });
    await expect(
      anon().candidates.submit({
        ...application,
        landingPage: `https://nickstire.org/careers?fbclid=${"x".repeat(700)}`,
        utmSource: "s".repeat(150),
        gclid: "g".repeat(300),
      }),
    ).resolves.toMatchObject({ success: true, id: 90 });
    const row = createCandidateMock.mock.calls[0][0];
    expect(row.landingPage).toHaveLength(500);
    expect(row.utmSource).toHaveLength(100);
    expect(row.gclid).toHaveLength(255);
  });

  it("positionTitle keeps only a real posting's title — it lands in the owner's email and text", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 91, columns0129: true });
    await anon().candidates.submit({ ...application, positionTitle: '<a href="https://x.example">Resume</a>' });
    expect(createCandidateMock.mock.calls[0][0].positionTitle).toBeNull();
    createCandidateMock.mockClear();
    await anon().candidates.submit({ ...application, positionTitle: "Automotive Technician" });
    expect(createCandidateMock.mock.calls[0][0].positionTitle).toBe("Automotive Technician");
  });

  it("a phone field holding two numbers saves without phoneE164 (VARCHAR(20) would reject the row)", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 92, columns0129: true });
    await anon().candidates.submit({ ...application, phone: "+12165551234, 2165559876" });
    expect(createCandidateMock.mock.calls[0][0]).not.toHaveProperty("phoneE164");
    createCandidateMock.mockClear();
    await anon().candidates.submit({ ...application, phone: "(216) 555-0142" });
    expect(createCandidateMock.mock.calls[0][0].phoneE164).toBe("+12165550142");
  });

  it("the form's last-touch ?ref= code wins over the first landing page; a junk code is ignored", async () => {
    createCandidateMock.mockResolvedValue({ success: true, id: 93, columns0129: true });
    const landingPage = "https://nickstire.org/careers?ref=first-touch";
    await anon().candidates.submit({ ...application, landingPage, refCode: "Tool-Truck-1" });
    expect(createCandidateMock.mock.calls[0][0].refCode).toBe("tool-truck-1");
    createCandidateMock.mockClear();
    await anon().candidates.submit({ ...application, landingPage, refCode: "<script>" });
    expect(createCandidateMock.mock.calls[0][0].refCode).toBe("first-touch");
  });

  it("a failed insert logs the error code, never the applicant's details", async () => {
    const lines: string[] = [];
    // logger.ts writes error lines to stderr, the rest to stdout.
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (lines.push(String(chunk)), true));
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (lines.push(String(chunk)), true));
    try {
      createCandidateMock.mockImplementation(async () => {
        throw Object.assign(new Error("Failed query: insert into `candidates` ... params: Dana Reyes,216-555-0142"), {
          cause: { code: "ER_DATA_TOO_LONG", errno: 1406 },
        });
      });
      await expect(anon().candidates.submit(application)).rejects.toThrow(/call us/i);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const logged = lines.join("\n");
    expect(logged).toMatch(/ER_DATA_TOO_LONG/);
    expect(logged).not.toContain("Dana Reyes");
    expect(logged).not.toContain("555-0142");
  });
});
