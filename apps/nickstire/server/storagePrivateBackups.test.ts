/**
 * The public /generated/* proxy streams ANY bucket key through storageGetStream.
 * Database backups live in the same bucket under backups/, so without a refusal
 * https://nickstire.org/generated/backups/tidb/<date>/customers.jsonl.gz would
 * hand the customer table to anyone who guesses a date. These tests pin the
 * refusal at the storage layer, where every reader inherits it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sent: Array<{ name: string; input: Record<string, unknown> }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) { this.input = input; }
  }
  class GetObjectCommand extends Cmd {}
  class PutObjectCommand extends Cmd {}
  class S3Client {
    async send(cmd: Cmd) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return { Body: { pipe() {}, on() {} }, ContentType: "application/gzip" };
    }
  }
  return { S3Client, GetObjectCommand, PutObjectCommand };
});

const ENV_KEYS = ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLOUDFRONT_DOMAIN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  sent.length = 0;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.S3_BUCKET = "bucket-x";
  process.env.S3_ENDPOINT = "https://bucket.example.invalid";
  process.env.S3_ACCESS_KEY_ID = "test-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  delete process.env.CLOUDFRONT_DOMAIN;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("storage · backups/ is never served by the public /generated proxy", () => {
  it("positive control: an ordinary media key is fetched from the bucket", async () => {
    const { storageGetStream } = await import("./storage");
    const obj = await storageGetStream("reels/reel-1.mp4");
    expect(obj).not.toBeNull();
    expect(sent).toEqual([{ name: "GetObjectCommand", input: { Bucket: "bucket-x", Key: "reels/reel-1.mp4" } }]);
  });

  it("a backup key returns null without touching the bucket, in every spelling the route can produce", async () => {
    const { storageGetStream } = await import("./storage");
    for (const key of [
      "backups/tidb/2026-10-18/customers.jsonl.gz",
      "/backups/tidb/2026-10-18/manifest.json",
      "//backups/tidb/2026-10-18/manifest.json",
      "backups\\tidb\\2026-10-18\\manifest.json",
    ]) {
      expect(await storageGetStream(key), key).toBeNull();
    }
    expect(sent).toHaveLength(0);
  });

  it("storageGet refuses to presign a backup key", async () => {
    const { storageGet } = await import("./storage");
    await expect(storageGet("backups/tidb/2026-10-18/customers.jsonl.gz")).rejects.toThrow(/private/i);
  });
});
