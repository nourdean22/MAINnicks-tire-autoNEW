// S3-compatible storage helpers (replaces Manus Forge storage proxy)
// Uses AWS SDK v3 for direct S3 uploads/downloads

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client(): S3Client {
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
  const s3 = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

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
  const url = cdnDomain
    ? `https://${cdnDomain}/${key}`
    : await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const s3 = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  const url = cdnDomain
    ? `https://${cdnDomain}/${key}`
    : await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}
