import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";
import { getServerEnv } from "@/lib/env";
import { putFile } from "@/lib/storage";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
    try {
        const env = getServerEnv();
        const formData = await request.formData();

        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "No video file provided." },
                { status: 400 },
            );
        }

        const filename = file.name;
        const contentType = file.type || "video/mp4";
        const sizeBytes = file.size;

        if (!contentType.startsWith("video/")) {
            return NextResponse.json(
                { error: "Only video uploads are allowed." },
                { status: 415 },
            );
        }

        if (sizeBytes > env.maxUploadMb * 1024 * 1024) {
            return NextResponse.json(
                { error: `Max upload size is ${env.maxUploadMb} MB.` },
                { status: 413 },
            );
        }

        const db = getDb();

        const pending = await db
            .select({ id: videos.id })
            .from(videos)
            .where(eq(videos.status, "QUEUED"));

        const processing = await db
            .select({ id: videos.id })
            .from(videos)
            .where(eq(videos.status, "PROCESSING"));

        if (pending.length || processing.length) {
            return NextResponse.json(
                {
                    error: "This proof of concept allows one active job at a time. Wait for the current video to finish.",
                },
                { status: 409 },
            );
        }

        const videoId = `vid_${randomUUID().replaceAll("-", "")}`;

        const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");

        const originalKey = `videos/${videoId}/original/${safeName}`;

        await db.insert(videos).values({
            id: videoId,
            filename,
            contentType,
            sizeBytes,
            originalKey,
            status: "UPLOADING",
            progress: 0,
            currentStep: "Uploading to Neon Object Storage",
        });

        const buffer = Buffer.from(await file.arrayBuffer());

        await putFile(originalKey, buffer, contentType);

        return NextResponse.json({
            videoId,
            originalKey,
            filename,
            sizeBytes,
        });
    } catch (error) {
        console.error("Upload failed:", error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Upload failed",
            },
            { status: 500 },
        );
    }
}
