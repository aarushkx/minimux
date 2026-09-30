import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getCommonEnv } from "./env";

let s3Instance: S3Client | undefined;

export function getS3() {
  if (!s3Instance) {
    const env = getCommonEnv();
    s3Instance = new S3Client({
      region: env.storageRegion,
      endpoint: env.storageEndpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.storageAccessKeyId,
        secretAccessKey: env.storageSecretAccessKey,
      },
    });
  }
  return s3Instance;
}

export async function createUploadUrl(key: string, contentType: string) {
  const env = getCommonEnv();
  return getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: env.storageBucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 15 * 60 },
  );
}

export async function createDownloadUrl(key: string, expiresIn = 60 * 60) {
  const env = getCommonEnv();
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: env.storageBucket, Key: key }),
    { expiresIn },
  );
}

export async function objectExists(key: string) {
  const env = getCommonEnv();
  await getS3().send(new HeadObjectCommand({ Bucket: env.storageBucket, Key: key }));
  return true;
}

export async function putFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  cacheControl?: string,
) {
  const env = getCommonEnv();
  await getS3().send(
    new PutObjectCommand({
      Bucket: env.storageBucket,
      Key: key,
      Body: Buffer.from(body),
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  );
}
