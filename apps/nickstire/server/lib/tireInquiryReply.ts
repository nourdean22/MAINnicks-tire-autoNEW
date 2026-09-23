/**
 * What the receptionist says after an ORDINARY tire inquiry — one that, since
 * the 2026-06-05 directive, persists nothing but the call record. It used to
 * say "I've sent the tire info to the shop", which was not true: the caller
 * walked in believing the counter had their size. It may say the size was
 * noted and echo it back (so a mis-heard size can be corrected on the spot);
 * it may not claim anything was sent. Pinned by vapiToolPromiseTruth.test.ts.
 */
export function ordinaryTireInquiryReply(tireSize?: string | null): string {
  const heard = tireSize ? `Got it — ${tireSize}, noted.` : "Got it, noted.";
  return `${heard} Walk in any day, we usually have most common sizes on the rack from $60 installed.`;
}
