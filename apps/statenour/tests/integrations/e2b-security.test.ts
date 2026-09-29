const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  runCode: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: { create: mocks.create },
}));

import { runPython } from "@/lib/integrations/e2b";

describe("E2B sandbox security contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("E2B_API_KEY", "test-e2b-key");
    mocks.runCode.mockResolvedValue({
      logs: { stdout: ["ok\n"], stderr: [] },
      results: [],
    });
    mocks.kill.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({
      runCode: mocks.runCode,
      kill: mocks.kill,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("explicitly denies internet access instead of trusting the E2B default", async () => {
    const result = await runPython("print('ok')");

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-e2b-key",
        timeoutMs: 60_000,
        allowInternetAccess: false,
      }),
    );
    expect(mocks.kill).toHaveBeenCalledTimes(1);
  });

  it("fails closed before sandbox creation when the API key is missing", async () => {
    vi.stubEnv("E2B_API_KEY", "");

    const result = await runPython("print('should not run')");

    expect(result).toMatchObject({
      ok: false,
      code: "missing_api_key",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
