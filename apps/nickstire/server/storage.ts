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

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const bucket = process.env.S3_BUCKET;
  const key = normalizeKey(relKey);

  if (!bucket) {
    const path = await import("path");
    const body = typeof data === "string" ? Buffer.from(data) : data;
    const filename = path.basename(key) || "file.jpg";
    
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    const blob = new Blob([body as any], { type: contentType });
    formData.append("fileToUpload", blob, filename);

    try {
      const response = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: formData,
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
      log.error("Catbox upload failed:", e);
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
