// S3-compatible storage helpers (replaces Manus Forge storage proxy)
// Uses AWS SDK v3 for direct S3 uploads/downloads
// LAZY-LOADED: AWS SDK is ~60MB — only imported when storage is used
import { createLogger } from "./lib/logger";

const log = createLogger("storage");

async function getS3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const region = process.env.AWS_REGION || "us-east-1";
  // AWS SDK v3 auto-reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from env
  return new S3Client({ region });
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET environment variable is not configured");
  }
  return bucket;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/** Is durable object storage (S3) configured? Local disk on Railway is
 *  ephemeral — a deploy/restart wipes it, and prod already lost clips this
 *  way. */
export function durableStorageConfigured(): boolean {
  return !!process.env.S3_BUCKET;
}

/**
 * Precondition for anything that SPENDS money to produce media (Veo clips,
 * paid image gen): refuse to start unless the result can be durably kept.
 * Otherwise the pipeline pays for a clip, writes it to ephemeral disk, and a
 * restart loses it — exactly the failure prod recorded. Operators who
 * knowingly want ephemeral behavior (local testing) set
 * REEL_ALLOW_EPHEMERAL_STORAGE=true.
 */
export function assertDurableStorageForGeneration(context: string): void {
  if (durableStorageConfigured()) return;
  if (process.env.REEL_ALLOW_EPHEMERAL_STORAGE === "true") return;
  throw new Error(
    `${context}: refusing to spend generation credits without durable storage — S3_BUCKET is not configured, so the output would land on ephemeral disk and be lost on the next deploy/restart. Configure S3_BUCKET (+ CLOUDFRONT_DOMAIN for permanent URLs), or set REEL_ALLOW_EPHEMERAL_STORAGE=true to accept ephemeral output.`,
  );
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const bucket = process.env.S3_BUCKET;
  const key = normalizeKey(relKey);

  if (!bucket) {
    const path = await import("path");
    const fs = await import("fs");
    const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    const filename = path.basename(key) || "file.jpg";

    // Primary: write to local data/generated/ (Express serves at /generated/)
    try {
      const genDir = path.join(process.cwd(), "data", "generated");
      if (!fs.existsSync(genDir)) {
        fs.mkdirSync(genDir, { recursive: true });
      }
      const localPath = path.join(genDir, filename);
      fs.writeFileSync(localPath, body);
      const siteUrl = process.env.SITE_URL || "https://nickstire.org";
      const url = `${siteUrl}/generated/${filename}`;
      log.info("storagePut: saved locally", { filename, bytes: body.length });
      return { key, url };
    } catch (localErr) {
      const detail = localErr instanceof Error ? localErr.message : String(localErr);
      // Fallback: Catbox.moe — an ANONYMOUS third-party free host. Shipping
      // business media (customer footage, shop content) there is a provenance +
      // availability liability, and the URL it returns passes
      // assertPermanentPublicMediaUrl despite being untrusted. Off by default;
      // opt in only with eyes open.
      if (process.env.STORAGE_CATBOX_FALLBACK_ENABLED !== "true") {
        log.error("Local storage write failed and Catbox fallback is disabled — failing closed", { filename, detail });
        throw new Error(
          `Storage write failed and no durable fallback is configured (${detail}). Configure S3_BUCKET, or set STORAGE_CATBOX_FALLBACK_ENABLED=true to allow the anonymous Catbox host.`,
        );
      }
      log.warn("Local file write failed, falling back to Catbox", { err: detail });
    }

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    const blob = new Blob([body as any], { type: contentType });
    formData.append("fileToUpload", blob, filename);

    try {
      const response = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Catbox HTTP error: ${response.statusText}`);
      }
      const url = (await response.text()).trim();
      if (!url.startsWith("http")) {
        throw new Error("Catbox upload failed: " + url);
      }
      return { key, url };
    } catch (e) {
      log.error("Catbox upload also failed:", e);
      throw e;
    }
  }

  const { PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = await getS3Client();

  const body = typeof data === "string" ? Buffer.from(data) : data;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  // If CloudFront is configured, use it; otherwise generate a presigned URL
  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  if (cdnDomain) {
    return { key, url: `https://${cdnDomain}/${key}` };
  }
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const bucket = process.env.S3_BUCKET;
  const key = normalizeKey(relKey);

  if (!bucket) {
    const path = await import("path");
    const filename = path.basename(key);
    const siteUrl = process.env.SITE_URL || "https://nickstire.org";
    const url = `${siteUrl}/generated/${filename}`;
    return { key, url };
  }

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = await getS3Client();

  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  if (cdnDomain) {
    return { key, url: `https://${cdnDomain}/${key}` };
  }
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}
