import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { getServerEnv } from "@/lib/env";
import { createUploadUrl } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    const body = bodySchema.parse(await request.json());

    if (body.sizeBytes > env.maxUploadMb * 1024 * 1024) {
      return NextResponse.json({ error: `Max upload size is ${env.maxUploadMb} MB.` }, { status: 413 });
    }

    const db = getDb();
    const pending = await db.select({ id: videos.id }).from(videos).where(eq(videos.status, "QUEUED"));
    const processing = await db.select({ id: videos.id }).from(videos).where(eq(videos.status, "PROCESSING"));
    if (pending.length || processing.length) {
      return NextResponse.json({ error: "This proof of concept allows one active job at a time. Wait for the current video to finish." }, { status: 409 });
    }

    const videoId = `vid_${randomUUID().replaceAll("-", "")}`;
    const safeName = body.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const originalKey = `videos/${videoId}/original/${safeName}`;

    await db.insert(videos).values({
      id: videoId,
      filename: body.filename,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      originalKey,
      status: "UPLOADING",
      progress: 0,
      currentStep: "Waiting for upload",
    });

    const uploadUrl = await createUploadUrl(originalKey, body.contentType);
    return NextResponse.json({ videoId, uploadUrl, originalKey });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bad request" }, { status: 400 });
  }
}
