/**
 * Ring token vault (Ring W1a, 2026-10-30): the rotating Ring token config lives
 * in the EXISTING Railway Redis, AES-256-GCM sealed with RING_TOKEN_KEY, never in
 * the prod DB, the repo or a log. Writes are a compare-and-swap (CAS_SCRIPT) and a
 * tick holds an NX lease (ring:lock), so two pollers cannot rotate one token twice.
 *
 * Speaks the Redis protocol over node:net (GET, SET NX PX, EVAL) instead of adding
 * an npm client: four commands do not justify a new dependency in the worker image.
 * Plain redis:// only (Railway's private network); rediss:// is refused, not ignored.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import net from "node:net";
import type { TokenVault } from "./ring-poller.js";

const TOKEN_KEY = "ring:auth";
const LOCK_KEY = "ring:lock";
const REDIS_TIMEOUT_MS = 10_000;

/** Set ARGV[2] only if the stored value still equals ARGV[1] ('' = nothing stored). */
export const CAS_SCRIPT =
  "if (redis.call('GET', KEYS[1]) or '') == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 else return 0 end";
/** Release the lease only if this poller still holds it. */
const UNLOCK_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

function aesKey(keyString: string): Buffer {
  if (!keyString) throw new Error("RING_TOKEN_KEY is empty");
  return createHash("sha256").update(keyString).digest();
}

export function sealToken(plain: string, keyString: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(keyString), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Throws on a wrong key, a tampered value or an unknown format: never returns garbage. */
export function openToken(sealed: string, keyString: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("unknown ring token format");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", aesKey(keyString), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function encodeCommand(args: string[]): string {
  return `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");
}

export type Reply = string | number | null | Error;

/** One reply from the front of `buf`, or null when more bytes are needed. */
export function parseReply(buf: Buffer): { value: Reply; rest: number } | null {
  const end = buf.indexOf("\r\n");
  if (end < 0) return null;
  const type = String.fromCharCode(buf[0]);
  const line = buf.subarray(1, end).toString("utf8");
  if (type === "+") return { value: line, rest: end + 2 };
  if (type === "-") return { value: new Error(line), rest: end + 2 };
  if (type === ":") return { value: Number(line), rest: end + 2 };
  if (type === "$") {
    const len = Number(line);
    if (len < 0) return { value: null, rest: end + 2 };
    const start = end + 2;
    if (buf.length < start + len + 2) return null;
    return { value: buf.subarray(start, start + len).toString("utf8"), rest: start + len + 2 };
  }
  throw new Error(`unsupported RESP reply type "${type}"`);
}

/** Open, AUTH, run `commands` pipelined, close. Any error reply rejects. */
function redisCall(url: URL, commands: string[][]): Promise<Reply[]> {
  const auth = url.password
    ? [["AUTH", ...(url.username ? [decodeURIComponent(url.username)] : []), decodeURIComponent(url.password)]]
    : [];
  const all = [...auth, ...commands];
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: url.hostname, port: Number(url.port || 6379) });
    const replies: Reply[] = [];
    let buf = Buffer.alloc(0);
    const fail = (err: Error) => {
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("redis timeout")), REDIS_TIMEOUT_MS);
    sock.on("connect", () => sock.write(all.map(encodeCommand).join("")));
    sock.on("error", fail);
    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        for (let r = parseReply(buf); r; r = parseReply(buf)) {
          replies.push(r.value);
          buf = buf.subarray(r.rest);
        }
      } catch (err) {
        fail(err as Error);
        return;
      }
      if (replies.length < all.length) return;
      clearTimeout(timer);
      sock.end();
      const error = replies.find((v): v is Error => v instanceof Error);
      if (error) reject(error);
      else resolve(replies.slice(auth.length));
    });
  });
}

export function createRedisVault(redisUrl: string, tokenKey: string): TokenVault {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:") throw new Error(`ring vault supports redis:// only, got ${url.protocol}`);
  // The CAS compares sealed strings, so remember the sealed form of the value last read.
  let lastRead: { plain: string; sealed: string } | null = null;
  return {
    async read() {
      const [sealed] = await redisCall(url, [["GET", TOKEN_KEY]]);
      if (typeof sealed !== "string") {
        lastRead = null;
        return null;
      }
      const plain = openToken(sealed, tokenKey);
      lastRead = { plain, sealed };
      return plain;
    },
    async swap(expected, next) {
      let expectedSealed = "";
      if (expected !== null) {
        if (!lastRead || lastRead.plain !== expected) return false;
        expectedSealed = lastRead.sealed;
      }
      const sealedNext = sealToken(next, tokenKey);
      const [won] = await redisCall(url, [["EVAL", CAS_SCRIPT, "1", TOKEN_KEY, expectedSealed, sealedNext]]);
      if (won === 1) lastRead = { plain: next, sealed: sealedNext };
      return won === 1;
    },
    async lock(owner, ttlMs) {
      const [ok] = await redisCall(url, [["SET", LOCK_KEY, owner, "NX", "PX", String(ttlMs)]]);
      return ok === "OK";
    },
    async unlock(owner) {
      await redisCall(url, [["EVAL", UNLOCK_SCRIPT, "1", LOCK_KEY, owner]]);
    },
  };
}
