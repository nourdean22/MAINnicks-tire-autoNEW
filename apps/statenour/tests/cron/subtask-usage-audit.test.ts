import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockFs, mockDatetime } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      count: vi.fn(),
    },
  },
  mockFs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
  },
  mockDatetime: {
    today: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/utils/datetime", () => mockDatetime);
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

// Mock node:fs with a default export that forwards to our spies
vi.mock("node:fs", () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
    readFileSync: (path: string, options: any) => mockFs.readFileSync(path, options),
    unlinkSync: (path: string) => mockFs.unlinkSync(path),
    rmSync: (path: string, options: any) => mockFs.rmSync(path, options),
  }
}));

import { GET } from "@/app/api/cron/subtask-usage-audit/route";

const baseReq = new Request("http://test/api/cron/subtask-usage-audit");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.existsSync.mockReturnValue(false);
});

describe("cron/subtask-usage-audit", () => {
  it("returns waiting if the target date is not reached yet", async () => {
    mockDatetime.today.mockReturnValue("2026-06-11");
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { status: string; message: string };
    expect(r.status).toBe("waiting");
    expect(r.message).toContain("Audit date (2026-06-22) has not arrived yet");
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
  });

  it("justifies the feature if subtasks are in use in the DB", async () => {
    mockDatetime.today.mockReturnValue("2026-06-22");
    mockPrisma.task.count.mockResolvedValueOnce(3); // 3 subtasks
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { status: string; justified: boolean };
    expect(r.status).toBe("justified");
    expect(r.justified).toBe(true);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it("justifies the feature if checkboxes in ADR-0017 are checked off", async () => {
    mockDatetime.today.mockReturnValue("2026-06-22");
    mockPrisma.task.count.mockResolvedValueOnce(0); // 0 subtasks in DB
    mockFs.existsSync.mockReturnValueOnce(true); // ADR exists
    mockFs.readFileSync.mockReturnValueOnce(
      `
      - [x] Real subtask candidate 1: abc · explanation
      - [X] Real subtask candidate 2: def · explanation
      `
    );
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { status: string; justified: boolean };
    expect(r.status).toBe("justified");
    expect(r.justified).toBe(true);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it("cleans up/deletes the ADR and migrations if feature is not justified", async () => {
    mockDatetime.today.mockReturnValue("2026-06-22");
    mockPrisma.task.count.mockResolvedValueOnce(0); // 0 subtasks in DB
    mockFs.existsSync.mockReturnValue(true); // ADR and migrations exist
    mockFs.readFileSync.mockReturnValueOnce(
      `
      - [ ] Real subtask candidate 1: <task id> · why a subtask helped
      - [ ] Real subtask candidate 2: <task id> · why a subtask helped
      `
    );

    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { status: string; justified: boolean; actionsTaken: string[] };
    expect(r.status).toBe("cleaned_up");
    expect(r.justified).toBe(false);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
    expect(mockFs.rmSync).toHaveBeenCalledTimes(2);
    expect(r.actionsTaken).toContain("Deleted docs/adr/0017-task-subtasks-semantics.md");
    expect(r.actionsTaken).toContain("Deleted prisma/migrations/20260523_task_parent_task_id");
  });
});
