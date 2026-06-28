import fs from "fs";
import path from "path";

async function getS3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const region = process.env.AWS_REGION || "us-east-1";
  return new S3Client({ region });
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
    const localDir = path.join(process.cwd(), "data", "generated");
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const filename = path.basename(key);
    const localPath = path.join(localDir, filename);
    const body = typeof data === "string" ? Buffer.from(data) : data;
    fs.writeFileSync(localPath, body);

    const siteUrl = process.env.SITE_URL || "https://nickstire.org";
    const url = `${siteUrl}/generated/${filename}`;
    return { key, url };
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

  const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
  if (cdnDomain) {
    return { key, url: `https://${cdnDomain}/${key}` };
  }
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });

  return { key, url };
}
