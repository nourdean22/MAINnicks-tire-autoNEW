/**
 * The Obsidian engine's status row never reached production (2026-10-02):
 * engine-config imported the Prisma client at module load, and the CLI runner
 * imports engine-config BEFORE it loads the repo-root .env (imports are
 * hoisted), so the client was built with no DATABASE_URL. The import is now
 * lazy. This pins it: loading the module must not load Prisma; a status write
 * must, and must persist the row.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loaded: false,
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  h.loaded = true;
  return {
    prisma: { localSyncLog: { findFirst: h.findFirst, create: h.create, update: h.update } },
  };
});

let cwd: string;
let tmp: string;
beforeEach(() => {
  cwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obs-status-"));
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("writeEngineStatus · Prisma is loaded at write time, not import time", () => {
  it("importing engine-config does not build the Prisma client; a write does and persists the row", async () => {
    const mod = await import("@/lib/obsidian/engine-config");
    expect(h.loaded).toBe(false);

    h.findFirst.mockResolvedValue(null);
    h.create.mockResolvedValue({ id: "s1" });
    await mod.writeEngineStatus({ health: "healthy" } as never);

    expect(h.loaded).toBe(true);
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ module: "obsidian_engine", action: "status", count: 1 }),
    });
  });
});
