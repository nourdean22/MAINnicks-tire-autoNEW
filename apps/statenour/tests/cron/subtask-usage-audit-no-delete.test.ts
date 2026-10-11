/**
 * subtask-usage-audit never deletes files (R3-02 add-on, 2026-10-11).
 *
 * When its ADR-0017 A1 gate failed, the cron unlinked docs/adr/0017-task-subtasks-semantics.md
 * and rm -rf'd prisma/migrations/20260523_task_parent_task_id, both resolved against
 * process.cwd(). That migration is APPLIED (lib/db/migration-manifest.ts lists it), and in a
 * dev or worktree shell the paths are tracked repo files. A cron reports; a human deletes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  count: vi.fn(),
  warn: vi.fn(),
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    rmdirSync: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
    promises: { rm: vi.fn(), unlink: vi.fn(), rmdir: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { task: { count: h.count } } }));
vi.mock("@/lib/utils/datetime", () => ({ today: () => "2026-10-11" }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn() }) },
}));
vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: unknown) => fn }));
vi.mock("node:fs", () => ({ default: h.fs, ...h.fs }));
vi.mock("fs", () => ({ default: h.fs, ...h.fs }));

import { GET } from "@/app/api/cron/subtask-usage-audit/route";

const run = () => (GET as unknown as () => Promise<Record<string, unknown>>)();
const UNCHECKED = "- [ ] Real subtask candidate 1: x\n- [ ] Real subtask candidate 2: y\n";

beforeEach(() => {
  vi.clearAllMocks();
  h.count.mockResolvedValue(0); // no subtasks in use
  h.fs.existsSync.mockReturnValue(true); // the ADR and the migration dir exist
  h.fs.readFileSync.mockReturnValue(UNCHECKED); // candidates not filled in
});

describe("subtask-usage-audit: a failed gate reports, never deletes", () => {
  it("no unlink / rm / rmdir of any kind when the gate fails", async () => {
    await run();
    expect(h.fs.unlinkSync).not.toHaveBeenCalled();
    expect(h.fs.rmSync).not.toHaveBeenCalled();
    expect(h.fs.rmdirSync).not.toHaveBeenCalled();
    expect(h.fs.rm).not.toHaveBeenCalled();
    expect(h.fs.unlink).not.toHaveBeenCalled();
    expect(h.fs.promises.rm).not.toHaveBeenCalled();
    expect(h.fs.promises.unlink).not.toHaveBeenCalled();
    expect(h.fs.promises.rmdir).not.toHaveBeenCalled();
  });

  it("the failed gate is reported: not justified, a warn line, no claim of cleanup", async () => {
    const r = await run();
    expect(r).toMatchObject({ justified: false, status: "gate_failed" });
    expect(h.warn).toHaveBeenCalledWith("subtask_feature_not_justified", expect.anything());
  });

  it("CONTROL: a justified gate is still justified", async () => {
    h.count.mockResolvedValue(2);
    expect(await run()).toMatchObject({ justified: true, status: "justified" });
  });
});
