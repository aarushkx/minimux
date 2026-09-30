import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { getVideoQueue } from "@/lib/queue";
import { dispatchTranscodeWorkflow } from "@/lib/github";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const videoQueue = getVideoQueue();
  const [video] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);

  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  if (video.status === "READY") return NextResponse.json(video);

  const jobId = `transcode-${video.id}`;
  const job = await videoQueue.getJob(jobId);
  if (!job) return NextResponse.json({ error: "Queue job no longer exists. Re-upload the video." }, { status: 400 });

  const state = await job.getState();
  if (state === "failed") {
    await job.retry("wait");
  } else if (!["waiting", "delayed", "active"].includes(state)) {
    return NextResponse.json({ error: `Job is in an unexpected state: ${state}` }, { status: 409 });
  }

  if (state !== "active") {
    await dispatchTranscodeWorkflow(jobId);
  }

  await db.update(videos).set({
    error: null,
    status: "QUEUED",
    currentStep: "Worker re-dispatched",
    updatedAt: new Date(),
  }).where(eq(videos.id, id));

  const [updated] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return NextResponse.json(updated);
}
