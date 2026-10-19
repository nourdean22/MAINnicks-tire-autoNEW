/**
 * srcset for a /photos/ webp that ships with -small (320 px wide) and
 * -medium (560 px wide) siblings, the variant naming the site already uses.
 * site-real-photos.test.tsx fails if any candidate file is missing.
 */
export function photoSrcSet(src: string, fullWidth = 1440): string {
  return `${phoneSrcSet(src)}, ${src} ${fullWidth}w`;
}

/** Only the -small and -medium candidates, for a phone-only <source>: with the
 *  full file in the list, a 2x or 3x phone picks it. */
export function phoneSrcSet(src: string): string {
  const base = src.replace(/\.webp$/, "");
  return `${base}-small.webp 320w, ${base}-medium.webp 560w`;
}
