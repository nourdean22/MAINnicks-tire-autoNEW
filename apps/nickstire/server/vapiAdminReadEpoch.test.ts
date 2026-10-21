/**
 * The 60 s memo of the transfer-destination cards must never outlive an edit.
 *
 * setTransferDestination clears the memo, but a card read already in flight when
 * the edit lands would otherwise finish afterwards and put its PRE-edit number
 * back for a minute, showing the operator the old destination after a save.
 *
 * `fetch` is stubbed: no request leaves the test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVapiAdminReadCaches } from "./routers/vapi";

function adminContext() {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const assistantWith = (number: string) => ({
  id: "rec-1",
  name: "Nick's Tire & Auto Receptionist",
  model: { tools: [{ type: "transferCall", destinations: [{ type: "number", number, message: "Transferring" }] }] },
});

beforeAll(async () => {
  await import("./routers");
}, 60_000);

beforeEach(() => {
  resetVapiAdminReadCaches();
  vi.stubEnv("VAPI_API_KEY", "canary-vapi-key");
  vi.stubEnv("VAPI_RECEPTIONIST_ASSISTANT_ID", "rec-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetVapiAdminReadCaches();
});

describe("transfer-destination memo · a reset during a read wins", () => {
  it("a read that finishes after the reset is not kept, so the next read asks Vapi again", async () => {
    let number = "+12165550101";
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let assistantReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.endsWith("/assistant?limit=10")) return json([{ id: "rec-1", name: "Nick's Tire & Auto Receptionist" }]);
        assistantReads += 1;
        const answered = number; // what Vapi held when this read began
        if (assistantReads === 1) await firstGate; // the slow, pre-edit read
        return json(assistantWith(answered));
      }),
    );
    const { appRouter } = await import("./routers");
    const c = appRouter.createCaller(adminContext());

    const slow = c.vapi.getTransferDestination();
    await vi.waitFor(() => expect(assistantReads).toBe(1));
    number = "+12165550199"; // the edit lands while the slow read is still out
    resetVapiAdminReadCaches();
    releaseFirst();
    expect(await slow).toMatchObject({ currentNumber: "+12165550101" }); // the slow caller sees what it asked for

    expect(await c.vapi.getTransferDestination()).toMatchObject({ ok: true, currentNumber: "+12165550199" });
    expect(assistantReads).toBe(2);
  });
});
