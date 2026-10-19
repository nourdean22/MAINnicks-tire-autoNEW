/**
 * Acceptance 4: an imported shop video becomes a bindable Reel beat ONLY after
 * Nour approves it. The row is built from the importer's own registration
 * (registrationFor) and the review gate's own write (APPROVE_SET), then judged
 * by the real binder (verifyRealShopVideoRow) — no hand-built row.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { verifyRealShopVideoRow, type RealShopRowLike } from "../server/services/realShotBinding";
import { APPROVE_SET } from "../server/services/shopMediaLibrary";
import { parseCatalog, registrationFor } from "./import-shop-media.mts";

const catalog = parseCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "shop-media-catalog.sample.json"), "utf8")));
if (!catalog.ok) throw new Error(catalog.error);

/** What registerAsset writes for this input (isCurrent=1; reuse_allowed defaults to 1 unless the input says false). */
function rowFrom(id: string, input: ReturnType<typeof registrationFor>): RealShopRowLike {
  return {
    id,
    rightsStatus: input.rightsStatus ?? "ai_generated",
    reuseAllowed: input.reuseAllowed === false ? 0 : 1,
    lifecycleState: input.lifecycleState ?? "available",
    format: input.format,
    mimeType: input.mimeType,
    runtimeUrl: input.runtimeUrl ?? null,
    checksumSha256: input.checksumSha256,
    durationMs: input.durationMs ?? null,
    isCurrent: 1,
  };
}

const item = (id: string) => catalog.catalog.items.find((i) => i.id === id)!;

describe("imported shop video -> real beat binding", () => {
  for (const id of ["REC-VIDEO-H", "REC-VIDEO-V"]) {
    it(`${id}: quarantined on import is NOT bindable; approved is`, () => {
      const reg = registrationFor(item(id), "https://cdn.test/shop-media/2023/abc.mov", null);
      const quarantined = verifyRealShopVideoRow(1, "ma_x", rowFrom("ma_x", reg));
      expect(quarantined).toMatchObject({ ok: false, refusal: "reuse_not_allowed" });

      const approved = verifyRealShopVideoRow(1, "ma_x", { ...rowFrom("ma_x", reg), ...APPROVE_SET });
      expect(approved.ok).toBe(true);
      if (approved.ok) expect(approved.binding.sourceDurationSec).toBe((item(id).durationMs ?? 0) / 1000);
    });
  }

  it("an approved AI edit never binds as real footage", () => {
    const repaint = { ...item("REC-REPAINT"), kind: "video" as const, durationMs: 5000, file: "C:/x/y.mp4" };
    const reg = registrationFor(repaint, "https://cdn.test/shop-media/2019/def.mp4", "ma_orig");
    expect(verifyRealShopVideoRow(1, "ma_y", { ...rowFrom("ma_y", reg), ...APPROVE_SET })).toMatchObject({ ok: false, refusal: "not_real_shop" });
  });
});
