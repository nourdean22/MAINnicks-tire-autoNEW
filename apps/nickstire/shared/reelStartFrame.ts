/**
 * Which beats start from the hero photo (2026-10-16, reel 2100001).
 *
 * Image conditioning used to hand EVERY beat the same hero start image. The
 * hero was a shop-front photo, so the underbody, lift and road beats each began
 * on the storefront and morphed into their shot (the caption at 8.2 s sat on
 * the morphing shop sign). A start image only helps a beat whose camera stands
 * where the photo was taken; every other beat renders text-to-video.
 *
 * shortcut: matches the visual against the EXTERIOR vocabulary because every
 * hero today is a shop-front photo. When a bay or lift photo becomes a hero,
 * this needs the photo's own location (from the asset registry) instead.
 */
const EXTERIOR_VISUAL =
  /\b(?:store\s?front|shop\s?front|bay doors?|garage doors?|(?:parking|shop|front|the) lot|exterior|outside the shop|fa[cç]ade)\b/i;
const IMAGE_URL = /\.(jpe?g|png|webp)([?#]|$)/i;

export function startImageForBeat(
  beat: { beatNumber: number; visual?: string | null },
  heroUrl: string | null | undefined,
): string | undefined {
  if (!heroUrl || !IMAGE_URL.test(heroUrl)) return undefined;
  return EXTERIOR_VISUAL.test(beat.visual ?? "") ? heroUrl : undefined;
}
