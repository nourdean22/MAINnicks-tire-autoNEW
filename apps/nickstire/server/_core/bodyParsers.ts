/**
 * Request body parsers, in the order that makes the photo limits real.
 *
 * body-parser skips a request another parser already read (req._body), and a body over the limit
 * is a 413 before anything later runs. The two photo routes carry base64 images (a 7.5 MB file is
 * about 10 MB of JSON), so their 12 MB parsers must run BEFORE the global 2 MB one. They were
 * mounted after it until 2026-10-19, so every photo over about 1.5 MB was refused with 413 on
 * booking.uploadPhoto, the Studio upload and Photo Check.
 */
import express, { type Express, type Request } from "express";

const PHOTO_UPLOAD_ROUTES = [
  "/api/trpc/booking.uploadPhoto",
  "/api/trpc/instagramStudio.uploadEvidencePhoto",
] as const;

export function registerBodyParsers(app: Express): void {
  for (const route of PHOTO_UPLOAD_ROUTES) app.use(route, express.json({ limit: "12mb" }));
  // Wave-104: capture raw body bytes for webhooks that need HMAC over the exact bytes the sender
  // signed (Capevace SMS Gateway, Messenger). Stashed on req.rawBody; handlers opt in.
  app.use(express.json({
    limit: "2mb",
    verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
}
