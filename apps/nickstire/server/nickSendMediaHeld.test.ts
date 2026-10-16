/**
 * Telegram alert diet, review round · the Nick media tool does not report a held send as delivered.
 *
 * handleSendMedia answered { success: <boolean> } where a send held by a class mute counted as true, so
 * Nick told the operator a photo was sent when a mute had swallowed it. It now answers success true only
 * for a delivery, and names the flag for a held send.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ result: { status: "delivered" } as { status: string; heldBy?: string } }));

vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegramPhotoResult: vi.fn(async () => h.result),
  sendTelegramVideoResult: vi.fn(async () => h.result),
  sendTelegramDocumentResult: vi.fn(async () => h.result),
  sendTelegramMediaGroupResult: vi.fn(async () => h.result),
}));

import { handleSendMedia } from "./routers/nick/chat";

describe("handleSendMedia", () => {
  const inputs = [
    { type: "photo" as const, url: "https://x.test/a.jpg" },
    { type: "video" as const, url: "https://x.test/a.mp4" },
    { type: "document" as const, url: "https://x.test/a.pdf" },
    { type: "album" as const, urls: ["https://x.test/a.jpg"] },
  ];

  it.each(inputs)("$type: delivered is success", async (input) => {
    h.result = { status: "delivered" };
    expect(await handleSendMedia(input)).toEqual({ success: true });
  });

  it.each(inputs)("$type: held is NOT success and names the flag", async (input) => {
    h.result = { status: "held", heldBy: "telegram_receipt (off)" };
    expect(await handleSendMedia(input)).toMatchObject({ success: false, held: true, error: "held by telegram_receipt (off)" });
  });

  it.each(inputs)("$type: failed is not success", async (input) => {
    h.result = { status: "failed" };
    expect(await handleSendMedia(input)).toEqual({ success: false });
  });
});
