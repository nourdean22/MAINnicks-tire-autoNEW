// S3-compatible storage helpers (replaces Manus Forge storage proxy)
// Uses AWS SDK v3 — lazy-loaded to save ~60MB memory at startup

let _s3Client: any = null;

async function getS3Client() {
  if (!_s3Client) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const region = process.env.AWS_REGION || "us-east-1";
    _s3Client = new S3Client({ region });
  }
  return _s3Client;
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
  const { PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const s3 = await getS3Client();
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

  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  const url = cdnDomain
    ? `https://${cdnDomain}/${key}`
    : await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const s3 = await getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  const url = cdnDomain
    ? `https://${cdnDomain}/${key}`
    : await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}
