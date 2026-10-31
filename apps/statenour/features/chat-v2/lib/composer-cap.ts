/**
 * U1 (2026-10-30) · how tall the chat composer may grow, given the visible viewport height.
 *
 * With the phone keyboard up the visible viewport is short, and a tall composer leaves the
 * message list a few pixels high: there the cap stays at a quarter (max 200 px), as before. On a
 * tall screen (desktop, or a phone without the keyboard) it may take 40% (max 400 px), so a long
 * message can be read and edited without scrolling inside a small box.
 */
export const TALL_VIEWPORT_PX = 700;

export function composerCap(visible: number): number {
  const tall = visible >= TALL_VIEWPORT_PX;
  return Math.max(44, Math.min(tall ? 400 : 200, Math.floor(visible * (tall ? 0.4 : 0.25))));
}
