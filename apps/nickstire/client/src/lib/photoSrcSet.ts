/**
 * srcset for a /photos/ webp that ships with -small (320 px wide) and
 * -medium (560 px wide) siblings, the variant naming the site already uses.
 * site-real-photos.test.tsx fails if any candidate file is missing.
 */
export function photoSrcSet(src: string, fullWidth = 1440): string {
  const base = src.replace(/\.webp$/, "");
  return `${base}-small.webp 320w, ${base}-medium.webp 560w, ${src} ${fullWidth}w`;
}
