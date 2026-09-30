function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function getCommonEnv() {
  return {
    databaseUrl: required("DATABASE_URL"),
    upstashRedisUrl: required("UPSTASH_REDIS_URL"),
    storageBucket: required("STORAGE_BUCKET"),
    storageRegion: required("AWS_REGION"),
    storageEndpoint: required("AWS_ENDPOINT_URL_S3"),
    storageAccessKeyId: required("AWS_ACCESS_KEY_ID"),
    storageSecretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
  };
}

export function getServerEnv() {
  return {
    ...getCommonEnv(),
    githubOwner: required("GITHUB_OWNER"),
    githubRepo: required("GITHUB_REPO"),
    githubWorkflowFile: process.env.GITHUB_WORKFLOW_FILE ?? "transcode.yml",
    githubRef: process.env.GITHUB_REF ?? "main",
    githubToken: required("GITHUB_TOKEN"),
    uploadFunctionUrl: required("NEON_FUNCTION_VIDEOUPLOAD_BASE_URL"),
    maxUploadMb: Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 500),
  };
}
