/**
 * What the S3_ENDPOINT client (the Railway bucket branch of storage.ts) puts on
 * the wire, proven against the REAL @aws-sdk/client-s3 and a loopback server.
 *
 * Why (finding C1.7, 2026-10-17): since @aws-sdk/client-s3 3.729.0 the SDK sends a
 * CRC32 checksum on every PutObject and asks for checksum validation on every
 * GetObject by default (requestChecksumCalculation / responseChecksumValidation
 * both default to WHEN_SUPPORTED). Several S3-compatible stores reject those
 * headers. pnpm-lock resolves 3.1048.0 (package.json says ^3.693.0), so the
 * defaults apply to us.
 *
 * DECISION (2026-10-17): keep the SDK defaults for the Railway bucket. Evidence
 * the bucket accepts them: docs/operations/REEL-PIPELINE.md ("verified
 * 2026-08-05") records two assembled reel masters (12.36 MB and 15.06 MB)
 * written by storagePut and still returning 200 video/mp4 after three redeploys;
 * storagePut is a PutObjectCommand with a Buffer body through this exact client,
 * and the lockfile resolved client-s3@3.1048.0 from 2026-05-17 (commit 859cffb7c)
 * through that day (582884a79), so those writes carried the CRC32 header below.
 * Setting WHEN_REQUIRED would change a path production already proves.
 *
 * What this test adds: the dependency is no longer implicit. If an SDK bump
 * changes what is sent (a different default algorithm, a streaming trailer), this
 * fails and someone re-checks the bucket instead of finding out from a failed
 * upload. Loopback only: no external request leaves the test.
 *
 * NOT covered: TLS (prod is https; this is http on 127.0.0.1, which only changes
 * x-amz-content-sha256) and a live Railway call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32 } from "node:zlib";
import { storageGetStream, storagePut } from "./storage";

type Seen = { method: string; url: string; headers: IncomingHttpHeaders };

describe("S3_ENDPOINT client: checksum headers on the wire", () => {
  const seen: Seen[] = [];
  let server: Server;
  let endpoint = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        seen.push({ method: String(req.method), url: String(req.url), headers: req.headers });
        if (req.method === "GET") {
          res.writeHead(200, { "content-type": "video/mp4", "content-length": "4", etag: '"abc"' });
          res.end("abcd");
        } else {
          res.writeHead(200, { etag: '"abc"' });
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv("S3_BUCKET", "media-bucket");
    vi.stubEnv("S3_ENDPOINT", endpoint);
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("CLOUDFRONT_DOMAIN", "");
  });

  it("PutObject (storagePut) sends x-amz-checksum-crc32 for the body, path-style, signed with the explicit credentials", async () => {
    const body = Buffer.from("hello reel master");
    await storagePut("reels/probe.mp4", body, "video/mp4");
    expect(seen).toHaveLength(1);
    const put = seen[0];
    expect(put.method).toBe("PUT");
    expect(new URL(put.url, endpoint).pathname).toBe("/media-bucket/reels/probe.mp4"); // path-style: bucket in the path, not the host
    const want = Buffer.alloc(4);
    want.writeUInt32BE(crc32(body));
    expect(put.headers["x-amz-checksum-crc32"]).toBe(want.toString("base64"));
    expect(put.headers["x-amz-sdk-checksum-algorithm"]).toBe("CRC32");
    // A plain Buffer body is not sent as an aws-chunked stream with a trailer.
    expect(put.headers["content-encoding"]).toBeUndefined();
    expect(put.headers["x-amz-trailer"]).toBeUndefined();
    expect(String(put.headers.authorization)).toContain("Credential=test-access-key/");
  });

  it("GetObject (storageGetStream) asks for checksum validation with x-amz-checksum-mode: ENABLED", async () => {
    const got = await storageGetStream("reels/probe.mp4");
    expect(got).not.toBeNull();
    for await (const _chunk of got!.body) void _chunk; // drain the loopback body
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].headers["x-amz-checksum-mode"]).toBe("ENABLED");
  });
});
