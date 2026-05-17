/**
 * E2B Code Interpreter integration · v10.0.515 · #3 code sandbox
 *
 * Lets Nick RUN python — not just describe what python would say.
 *
 * Use cases:
 *   · "Compute the geometric mean of my last 30 task durations"
 *   · "Plot revenue trend last 90 days as a chart"
 *   · "Parse this CSV into a markdown table"
 *   · "What's the regression slope on these numbers?"
 *
 * The sandbox is a real Python kernel running in E2B's cloud. Each
 * tool invocation spins a fresh sandbox (no state carried between
 * calls). Output captures stdout, stderr, return values, and
 * file artifacts. Charts (matplotlib) come back as PNG bytes which
 * the chat surface inlines as an image.
 *
 * Setup (operator-only, one-time):
 *   1. Sign up at https://e2b.dev (free tier: 100 runs/day, no card)
 *   2. Copy the API key from the dashboard
 *   3. Set E2B_API_KEY in environment (Railway/Vercel)
 *
 * The tool returns a clear "needs E2B_API_KEY" error when the env
 * var is missing — Nick can surface this to the operator instead
 * of pretending he ran the code.
 *
 * Safety:
 *   · No network access from the sandbox by default
 *   · 60-second wall-clock timeout per invocation
 *   · Sandbox auto-destroys after the run completes
 *   · No filesystem persistence — every run starts clean
 */

export interface PythonRunResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  /** Return value of the last expression (Python's "last" semantic). */
  returnValue?: unknown;
  /** Base64-encoded PNG charts produced by matplotlib. */
  charts?: string[];
  /** Total wall-clock duration in ms. */
  durationMs?: number;
  /** Error message when ok=false. */
  error?: string;
  /** Stable error code for the caller. */
  code?:
    | "ok"
    | "missing_api_key"
    | "timeout"
    | "syntax_error"
    | "runtime_error"
    | "sandbox_failed";
}

const E2B_TIMEOUT_MS = 60_000;
const E2B_STDOUT_MAX_CHARS = 5000;
const E2B_RESULT_MAX_CHARS = 5000;

/**
 * Execute a python snippet in an isolated E2B sandbox. Returns a
 * structured result that's safe to inline into a chat reply.
 */
export async function runPython(code: string): Promise<PythonRunResult> {
  const apiKey = (process.env.E2B_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "missing_api_key",
      error:
        "E2B_API_KEY not set. Add it to Vercel/Railway env (free key at e2b.dev) to enable Python execution.",
    };
  }

  const started = Date.now();
  let sandbox: { runCode: (code: string) => Promise<unknown>; kill: () => Promise<void> } | null = null;

  try {
    const { Sandbox } = await import("@e2b/code-interpreter");
    sandbox = (await Sandbox.create({
      apiKey,
      timeoutMs: E2B_TIMEOUT_MS,
    })) as unknown as {
      runCode: (code: string) => Promise<unknown>;
      kill: () => Promise<void>;
    };

    // execution is a JS object with stdout array, stderr array,
    // results array (each may have a `png` field for matplotlib),
    // and `error` (when the kernel raised).
    const execution = (await sandbox.runCode(code)) as {
      logs?: { stdout?: string[]; stderr?: string[] };
      results?: Array<{ png?: string; text?: string; html?: string }>;
      error?: { name?: string; value?: string; traceback?: string };
    };

    const stdout = (execution.logs?.stdout ?? []).join("").slice(0, E2B_STDOUT_MAX_CHARS);
    const stderr = (execution.logs?.stderr ?? []).join("").slice(0, E2B_STDOUT_MAX_CHARS);

    if (execution.error) {
      return {
        ok: false,
        code: execution.error.name === "SyntaxError" ? "syntax_error" : "runtime_error",
        error: `${execution.error.name ?? "Error"}: ${execution.error.value ?? "unknown"}`,
        stdout: stdout || undefined,
        stderr: stderr || execution.error.traceback?.slice(0, E2B_STDOUT_MAX_CHARS),
        durationMs: Date.now() - started,
      };
    }

    // Extract chart PNGs (matplotlib output) and the last return value.
    const charts: string[] = [];
    let lastValue: unknown = undefined;
    for (const r of execution.results ?? []) {
      if (r.png) charts.push(r.png);
      if (r.text) lastValue = r.text.slice(0, E2B_RESULT_MAX_CHARS);
    }

    return {
      ok: true,
      code: "ok",
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      returnValue: lastValue,
      charts: charts.length > 0 ? charts : undefined,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|timed out/i.test(msg);
    return {
      ok: false,
      code: isTimeout ? "timeout" : "sandbox_failed",
      error: msg,
      durationMs: Date.now() - started,
    };
  } finally {
    // Best-effort cleanup. Sandbox.create() schedules its own
    // auto-destruct after timeoutMs but explicit kill releases the
    // slot faster.
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
