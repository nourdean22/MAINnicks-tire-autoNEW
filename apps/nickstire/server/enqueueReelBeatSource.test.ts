/**
 * enqueueReelJob must keep a beat's real-clip binding. zod strips unknown keys,
 * so a beat schema without `source` / `realAssetId` silently dropped the
 * picker's choice at the transport boundary, and reelPipeline's binding
 * (resolveRealBeatAssets, reelPipeline.ts:559) never saw it. Read through the
 * REAL procedure's input schema, not a copy.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { contentAdminRouter } from "./routers/content";

type AnyObj = z.ZodObject<Record<string, z.ZodTypeAny>>;
const input = (contentAdminRouter._def.procedures.enqueueReelJob as unknown as { _def: { inputs: AnyObj[] } })._def.inputs[0];
const beatSchema = ((input.shape.brief as AnyObj).shape.storyboardBeats as unknown as z.ZodArray<AnyObj>).element;

const beat = { beatNumber: 2, visual: "lug nuts torqued", startSecond: 3, endSecond: 6, motion: "static", onScreenText: "" };

describe("enqueueReelJob storyboard beat schema", () => {
  it("a real beat keeps source and realAssetId through enqueue parsing", () => {
    const parsed = beatSchema.parse({ ...beat, source: "real", realAssetId: "ma_0f3c" });
    expect(parsed).toMatchObject({ source: "real", realAssetId: "ma_0f3c" });
  });

  it("an unknown source is rejected, not stripped", () => {
    expect(beatSchema.safeParse({ ...beat, source: "stock_footage" }).success).toBe(false);
  });

  it("a beat with neither field still parses (both optional)", () => {
    expect(beatSchema.parse(beat)).not.toHaveProperty("source");
  });
});
