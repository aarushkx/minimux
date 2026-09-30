import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ forcePathStyle: true });
const bucket = "minimux-bucket";

function cors(origin: string | null) {
  const allowed = origin === "http://localhost:3000" || !!origin && origin.startsWith("https://");
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "http://localhost:3000",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-upload-key",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== "PUT") {
      return new Response("Method Not Allowed", { status: 405, headers: cors(origin) });
    }

    const key = request.headers.get("x-upload-key");
    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const contentLength = request.headers.get("content-length");

    if (!key || !/^videos\/vid_[a-f0-9]{32}\/original\/[A-Za-z0-9._-]+$/.test(key)) {
      return new Response("Invalid upload key", { status: 400, headers: cors(origin) });
    }

    if (contentLength && Number(contentLength) > 100 * 1024 * 1024) {
      return new Response("Upload exceeds 100 MB", { status: 413, headers: cors(origin) });
    }

    if (!contentType.startsWith("video/")) {
      return new Response("Only video uploads are allowed", { status: 415, headers: cors(origin) });
    }

    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: request.body ?? undefined,
        ContentType: contentType,
        ...(contentLength ? { ContentLength: Number(contentLength) } : {}),
      }));

      return new Response(JSON.stringify({ ok: true, key }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors(origin) },
      });
    } catch (error) {
      console.error(error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Upload failed" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors(origin) } },
      );
    }
  },
};
