/**
 * import-shop-media.mts — bulk-import Nour's edited shop photos and videos
 * (catalog v1, 2026-10-18) into the media_assets registry, behind a review gate.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/import-shop-media.mts <catalog.json> [--execute] [--limit N]
 *
 * Without --execute it validates the catalog, re-hashes every file and prints
 * per-kind counts, bytes and refusals, then RETURNS before the DB, storage or
 * registry modules are ever imported (pinned by scripts/import-shop-media.test.ts).
 *
 * Rules (decided, job 2026-10-18-shop-media-library):
 *  - triage.skip is skipped; triage.sensitive != "none" is NEVER uploaded
 *    (storage URLs are public; customer paperwork and screens must not reach it);
 *  - a file whose sha256 differs from the catalog is refused; a checksum already
 *    in the registry is not uploaded again (findByChecksum);
 *  - every row lands quarantined with reuse_allowed=0: nothing is reusable until
 *    Nour approves it (shopMedia.review);
 *  - real items are real_shop / operator_capture; AI-edited items are
 *    ai_generated / operator_ai_edit with lineage to the original, never real_shop.
 * Horizontal video is stored (with width/height), not refused: pickers filter
 * by orientation. Re-running is safe: dedupe skips what already landed.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { z } from "zod";
import { REAL_EDIT_ATTESTATION } from "../shared/shopMedia";
import type { RegisterAssetInput } from "../server/services/mediaRegistry";

const SHA256 = /^[a-f0-9]{64}$/;
const ABSOLUTE = /^([A-Za-z]:[\\/]|\/)/;

const itemSchema = z.object({
  id: z.string().min(1).max(128),
  file: z.string().regex(ABSOLUTE, "file must be an absolute path"),
  kind: z.enum(["photo", "video"]),
  capturedAt: z.string().datetime({ offset: true, local: true }).nullable(),
  originalName: z.string().max(255),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(SHA256),
  bytes: z.number().int().positive(),
  faces: z.number().int().nonnegative(),
  triage: z.object({
    subject: z.string().max(120),
    tags: z.array(z.string().max(64)).max(40),
    quality: z.number().int().min(1).max(5),
    moe: z.boolean(),
    people: z.enum(["none", "staff", "nour", "customer", "unclear"]),
    plate: z.boolean(),
    sensitive: z.enum(["none", "paperwork", "screen", "other"]),
    use: z.array(z.enum(["reel", "site", "gbp", "social", "avatar"])),
    skip: z.boolean(),
  }),
  edit: z.object({ recipe: z.string().max(500), generative: z.boolean() }),
  derivedFrom: z.string().max(128).nullable(),
});
/**
 * Lineage is checked before anything uploads: an AI edit must name exactly one
 * real original in this catalog, or it would land with no derived_from and
 * could not be traced back to the photo it was made from (Rule 1).
 */
const catalogSchema = z.object({ version: z.literal(1), items: z.array(itemSchema).min(1) }).superRefine((c, ctx) => {
  const byId = new Map<string, z.infer<typeof itemSchema>[]>();
  for (const i of c.items) byId.set(i.id, [...(byId.get(i.id) ?? []), i]);
  for (const [id, list] of byId) {
    if (list.length > 1) ctx.addIssue({ code: "custom", path: ["items"], message: `id ${id} is used by ${list.length} items` });
  }
  c.items.forEach((i, n) => {
    if (!i.edit.generative) return;
    const originals = i.derivedFrom ? byId.get(i.derivedFrom) ?? [] : [];
    const why = !i.derivedFrom ? "names no original (derivedFrom is null)"
      : originals.length === 0 ? `names original ${i.derivedFrom}, which is not in the catalog`
      : originals.length > 1 ? `names original ${i.derivedFrom}, which is ambiguous`
      : originals[0].edit.generative ? `names original ${i.derivedFrom}, which is itself an AI edit`
      : null;
    if (why) ctx.addIssue({ code: "custom", path: ["items", n, "derivedFrom"], message: `AI edit ${i.id} ${why}` });
  });
});

export type CatalogItem = z.infer<typeof itemSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** The trust boundary: one schema error refuses the whole file. */
export function parseCatalog(raw: unknown): { ok: true; catalog: Catalog } | { ok: false; error: string } {
  const r = catalogSchema.safeParse(raw);
  if (r.success) return { ok: true, catalog: r.data };
  return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

const MIME: Record<CatalogItem["kind"], Record<string, string>> = {
  photo: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
  video: { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v" },
};
const extOf = (file: string) => path.extname(file).slice(1).toLowerCase();
const mimeOf = (item: CatalogItem): string | undefined => MIME[item.kind][extOf(item.file)];

export function storageKey(item: CatalogItem): string {
  const year = item.capturedAt ? item.capturedAt.slice(0, 4) : "undated";
  return `shop-media/${year}/${item.sha256.slice(0, 12)}.${extOf(item.file)}`;
}

/** The registry row for one item. Pure: the importer and the binding test both use it. */
export function registrationFor(item: CatalogItem, runtimeUrl: string, derivedFromAssetId: string | null): RegisterAssetInput {
  const generative = item.edit.generative;
  return {
    logicalKey: `shop_media:${item.sha256.slice(0, 12)}`,
    assetType: item.kind === "video" ? "shop_clip" : "shop_photo",
    format: item.kind === "video" ? "video" : "image",
    mimeType: mimeOf(item) ?? "application/octet-stream",
    byteSize: item.bytes,
    checksumSha256: item.sha256,
    lifecycleState: "quarantined",
    reuseAllowed: false,
    runtimeUrl,
    rightsStatus: generative ? "ai_generated" : "real_shop",
    provider: generative ? "operator_ai_edit" : "operator_capture",
    width: item.width,
    height: item.height,
    durationMs: item.kind === "video" ? item.durationMs : null,
    derivedFrom: generative && derivedFromAssetId ? [derivedFromAssetId] : undefined,
    generationParams: {
      catalogId: item.id,
      originalName: item.originalName,
      capturedAt: item.capturedAt,
      triage: item.triage,
      faces: item.faces,
      edit: item.edit,
      ...(generative ? { derivedFromCatalogId: item.derivedFrom } : { attestation: REAL_EDIT_ATTESTATION }),
      registeredBy: "scripts/import-shop-media.mts",
    },
  };
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file).on("error", reject).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex")));
  });
}

type Refusal = "sensitive" | "unsupported_type" | "missing_file" | "sha_mismatch" | "duplicate_in_catalog" | "original_not_imported";
interface Plan { importable: CatalogItem[]; skipped: CatalogItem[]; refused: Array<{ item: CatalogItem; reason: Refusal }> }

/** Reads and hashes files only; never touches a database or storage. */
async function plan(catalog: Catalog): Promise<Plan> {
  const out: Plan = { importable: [], skipped: [], refused: [] };
  const seen = new Set<string>();
  for (const item of catalog.items) {
    if (item.triage.skip) { out.skipped.push(item); continue; }
    if (item.triage.sensitive !== "none") { out.refused.push({ item, reason: "sensitive" }); continue; }
    if (!mimeOf(item)) { out.refused.push({ item, reason: "unsupported_type" }); continue; }
    if (!fs.existsSync(item.file)) { out.refused.push({ item, reason: "missing_file" }); continue; }
    if ((await hashFile(item.file)) !== item.sha256) { out.refused.push({ item, reason: "sha_mismatch" }); continue; }
    if (seen.has(item.sha256)) { out.refused.push({ item, reason: "duplicate_in_catalog" }); continue; }
    seen.add(item.sha256);
    out.importable.push({ ...item, bytes: fs.statSync(item.file).size });
  }
  // An AI edit whose original is refused or skipped here would land with no lineage: refuse it too.
  const importableIds = new Set(out.importable.map((i) => i.id));
  out.importable = out.importable.filter((item) => {
    if (!item.edit.generative || (item.derivedFrom && importableIds.has(item.derivedFrom))) return true;
    out.refused.push({ item, reason: "original_not_imported" });
    return false;
  });
  // Originals before AI edits, so an edit's lineage can name its original's asset id.
  out.importable.sort((a, b) => Number(a.edit.generative) - Number(b.edit.generative));
  return out;
}

interface Io { log: (s: string) => void; error: (s: string) => void }

export async function run(argv: string[], io: Io = { log: console.log, error: console.error }): Promise<number> {
  const li = argv.indexOf("--limit");
  const file = argv.find((a, i) => !a.startsWith("--") && (li < 0 || i !== li + 1));
  const execute = argv.includes("--execute");
  const limit = li >= 0 ? Number(argv[li + 1]) : undefined;
  if (!file || (limit !== undefined && !(Number.isInteger(limit) && limit > 0))) {
    io.error("usage: import-shop-media.mts <catalog.json> [--execute] [--limit N]");
    return 2;
  }
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    io.error(`REFUSING: catalog unreadable (${e instanceof Error ? e.message : String(e)})`);
    return 2;
  }
  const parsed = parseCatalog(raw);
  if (!parsed.ok) { io.error(`REFUSING the whole catalog: ${parsed.error}`); return 2; }

  const p = await plan(parsed.catalog);
  io.log(`catalog: ${parsed.catalog.items.length} items (${file})`);
  for (const kind of ["photo", "video"] as const) {
    const items = p.importable.filter((i) => i.kind === kind);
    io.log(`kind ${kind}: ${items.length} to import, ${items.reduce((n, i) => n + i.bytes, 0)} bytes`);
  }
  io.log(`  of which generative (ai_generated): ${p.importable.filter((i) => i.edit.generative).length}`);
  io.log(`skipped: ${p.skipped.length} (triage.skip)`);
  const reasons = [...new Set(p.refused.map((r) => r.reason))];
  for (const reason of reasons) {
    const ids = p.refused.filter((r) => r.reason === reason).map((r) => r.item.id);
    io.log(`refused ${reason}: ${ids.length} (${ids.slice(0, 10).join(", ")}${ids.length > 10 ? ", ..." : ""})`);
  }
  if (!execute) {
    io.log("DRY RUN: nothing uploaded or registered. Pass --execute to import.");
    return 0;
  }

  const { getDbTyped } = await import("../server/db");
  const database = await getDbTyped();
  if (!database) { io.error("database unavailable"); return 1; }
  const { findByChecksum, registerAsset } = await import("../server/services/mediaRegistry");
  const { storagePut, assertDurableStorageForGeneration } = await import("../server/storage");
  assertDurableStorageForGeneration("shop media import");

  const byCatalogId = new Map(parsed.catalog.items.map((i) => [i.id, i]));
  const assetIdByCatalogId = new Map<string, string>();
  let registered = 0;
  try {
    for (const item of p.importable) {
      if (limit !== undefined && registered >= limit) break;
      const dup = await findByChecksum(database, item.sha256);
      if (dup.length) {
        assetIdByCatalogId.set(item.id, dup[0].id);
        io.log(`${item.id}: already registered as ${dup.map((r) => `${r.id} (${r.rightsStatus})`).join(", ")}; nothing written`);
        continue;
      }
      const bytes = fs.readFileSync(item.file);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
        io.error(`${item.id}: file changed since the dry-run hash; stopping`);
        return 1;
      }
      let derivedId: string | null = null;
      if (item.edit.generative && item.derivedFrom) {
        const original = byCatalogId.get(item.derivedFrom);
        derivedId = assetIdByCatalogId.get(item.derivedFrom)
          ?? (original ? (await findByChecksum(database, original.sha256))[0]?.id ?? null : null);
      }
      if (item.edit.generative && !derivedId) {
        io.error(`${item.id}: AI edit whose original ${item.derivedFrom} has no registered asset; not uploaded`);
        continue;
      }
      const { url } = await storagePut(storageKey(item), bytes, mimeOf(item)!);
      const row = await registerAsset(database, { ...registrationFor(item, url, derivedId), byteSize: bytes.length });
      assetIdByCatalogId.set(item.id, row.id);
      registered += 1;
      io.log(`registered ${row.id}: ${item.id} ${item.kind} ${item.edit.generative ? "ai_generated" : "real_shop"} quarantined`);
    }
  } catch (e) {
    io.error(`import stopped after ${registered} registered: ${e instanceof Error ? e.message : String(e)} (re-run is safe: dedupe skips what landed)`);
    return 1;
  }
  io.log(`done: ${registered} registered, all quarantined with reuse off; approve them in the shop media review screen.`);
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() : "";
if (entry === import.meta.url.toLowerCase()) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
