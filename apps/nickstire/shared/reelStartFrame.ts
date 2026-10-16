/**
 * Which beats start from the hero frame (2026-10-16, reel 2100001).
 *
 * Image conditioning used to hand EVERY beat the same hero start image. When
 * that hero is a real shop photo (visualWorld.style "real_shop_still", set by
 * the pipeline from a real_shop registry still), the underbody, lift and road
 * beats each began on the storefront and morphed into their shot (the caption
 * at 8.2 s sat on the morphing shop sign). A real photo only helps a beat whose
 * camera stands where it was taken; every other beat renders text-to-video.
 *
 * A GENERATED hero frame (visualWorld.ts) is drawn from the reel's own subject,
 * so it keeps anchoring every beat, exactly as before.
 *
 * shortcut: matches the visual against the EXTERIOR vocabulary because every
 * real_shop_still hero today is a shop-front photo. When a bay or lift photo
 * becomes a hero, this needs the photo's own location (from the asset registry).
 */
const EXTERIOR_VISUAL =
  /\b(?:store\s?front|shop\s?front|bay doors?|garage doors?|(?:parking|shop|front|the) lot|exterior|outside the shop|fa[cç]ade)\b/i;
const IMAGE_URL = /\.(jpe?g|png|webp)([?#]|$)/i;

export function startImageForBeat(
  beat: { beatNumber: number; visual?: string | null },
  visualWorld: { style?: string | null; heroFrameUrl?: string | null } | null | undefined,
): string | undefined {
  const heroUrl = visualWorld?.heroFrameUrl;
  if (!heroUrl || !IMAGE_URL.test(heroUrl)) return undefined;
  if (visualWorld?.style !== "real_shop_still") return heroUrl;
  return EXTERIOR_VISUAL.test(beat.visual ?? "") ? heroUrl : undefined;
}
