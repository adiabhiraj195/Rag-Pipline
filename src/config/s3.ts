import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION || "us-east-1";

export function getS3BucketName(): string {
  const bucket = process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return "rag-pipeline-bucket";
  }
  return bucket;
}

const s3ClientConfig: any = {
  region,
};

const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "test-access-key-id";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "test-secret-access-key";

s3ClientConfig.credentials = {
  accessKeyId,
  secretAccessKey,
  ...(process.env.AWS_SESSION_TOKEN && {
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }),
};

if (process.env.AWS_ENDPOINT) {
  s3ClientConfig.endpoint = process.env.AWS_ENDPOINT;
}

if (process.env.AWS_S3_FORCE_PATH_STYLE === "true") {
  s3ClientConfig.forcePathStyle = true;
}

export const s3Client = new S3Client(s3ClientConfig);

export interface PresignedUploadUrlOptions {
  key: string;
  contentType?: string;
  expiresIn?: number; // In seconds, default 3600
  bucket?: string;
}

export interface PresignedUrlResult {
  presignedUrl: string;
  s3Key: string;
  bucket: string;
  expiresIn: number;
}

/**
 * Generates a presigned PUT URL allowing clients to upload a file directly to S3.
 */
export async function generatePresignedUploadUrl({
  key,
  contentType = "text/plain",
  expiresIn = 3600,
  bucket = getS3BucketName(),
}: PresignedUploadUrlOptions): Promise<PresignedUrlResult> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });

  return {
    presignedUrl,
    s3Key: key,
    bucket,
    expiresIn,
  };
}

/**
 * Downloads a file's content directly as a UTF-8 string from S3.
 */
export async function downloadFileContentFromS3(
  s3Key: string,
  bucket = getS3BucketName()
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`S3 response body is empty for key: ${s3Key}`);
  }

  return await response.Body.transformToString("utf-8");
}
