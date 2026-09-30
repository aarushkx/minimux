import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { objectExists } from "@/lib/storage";
import { getVideoQueue } from "@/lib/queue";
import { dispatchTranscodeWorkflow } from "@/lib/github";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const videoQueue = getVideoQueue();
  const [video] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  if (video.status !== "UPLOADING") return NextResponse.json(video);

  try {
    await objectExists(video.originalKey);
  } catch {
    return NextResponse.json({ error: "Original file was not found in Neon Object Storage." }, { status: 400 });
  }

  const job = await videoQueue.add("transcode", {
    videoId: video.id,
    originalKey: video.originalKey,
  }, { jobId: `transcode-${video.id}` });

  await db.update(videos).set({
    status: "QUEUED",
    progress: 1,
    currentStep: "Queued for transcoding",
    error: null,
    updatedAt: new Date(),
  }).where(eq(videos.id, id));

  try {
    await dispatchTranscodeWorkflow(String(job.id));
  } catch (error) {
    await db.update(videos).set({
      status: "QUEUED",
      currentStep: "Queued; GitHub dispatch failed",
      error: error instanceof Error ? error.message : "Dispatch failed",
      updatedAt: new Date(),
    }).where(eq(videos.id, id));
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub dispatch failed" }, { status: 502 });
  }

  const [updated] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return NextResponse.json(updated);
}
