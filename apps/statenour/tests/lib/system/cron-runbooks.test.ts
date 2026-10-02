/**
 * tests/lib/system/cron-runbooks.test.ts · 2026-10-02 · full-circle wave 2
 *
 * The runbook link on /system/crons must point at a file that exists and at a
 * cron that exists. The map was ported from the deleted Settings cron panel,
 * whose links were never checked ("runbook file existence not checked" in
 * docs/design/settings-census-2026-10-02.md); this pins both ends.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CRONS } from "@/config/crons";
import { CRON_RUNBOOKS, cronRunbookHref } from "@/lib/system/cron-runbooks";

const RUNBOOKS_DIR = join(__dirname, "../../../docs/runbooks");

describe("CRON_RUNBOOKS", () => {
  it("every mapped runbook file exists under docs/runbooks", () => {
    const missing = Object.entries(CRON_RUNBOOKS)
      .filter(([, file]) => !existsSync(join(RUNBOOKS_DIR, file)))
      .map(([job, file]) => `${job} -> ${file}`);
    expect(missing).toEqual([]);
  });

  it("every key names a cron in the manifest", () => {
    const names = new Set(CRONS.map((c) => c.name));
    const unknown = Object.keys(CRON_RUNBOOKS).filter((job) => !names.has(job));
    expect(unknown).toEqual([]);
  });

  it("an unmapped cron gets no link, never a guessed one", () => {
    expect(cronRunbookHref("mega")).toMatch(/\/docs\/runbooks\/statenour-current-truth\.md$/);
    expect(cronRunbookHref("no-such-cron")).toBeNull();
  });
});
