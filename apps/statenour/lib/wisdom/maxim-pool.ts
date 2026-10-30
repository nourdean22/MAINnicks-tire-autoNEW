/**
 * The Home maxim pool: every plain maxim file under data/wisdom/maxims (PR 3364), imported statically so the
 * standalone build bundles them (a runtime read of data/ would need output file tracing). A new pack file
 * joins the pool by adding its import here; tests/wisdom/home-maxims-pool.test.ts fails when a file in that
 * folder is not imported.
 */
import bezos from "@/data/wisdom/maxims/bezos-maxims.json";
import gracian from "@/data/wisdom/maxims/gracian-maxims.json";
import greene from "@/data/wisdom/maxims/greene-maxims.json";
import munger from "@/data/wisdom/maxims/munger-maxims.json";
import naval from "@/data/wisdom/maxims/naval-maxims.json";
import { buildMaximPool, type Maxim, type MaximPack } from "@/lib/wisdom/maxims";

export const MAXIM_PACKS: readonly MaximPack[] = [greene, gracian, naval, munger, bezos] as MaximPack[];

export const MAXIM_POOL: readonly Maxim[] = buildMaximPool(MAXIM_PACKS);
