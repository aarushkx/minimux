import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { promises as fs, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { getCommonEnv } from "../lib/env.js";
import { getDb } from "../lib/db.js";
import { videos } from "../lib/schema.js";
import { redisConnection } from "../lib/redis.js";
import { getS3, putFile } from "../lib/storage.js";
import { VIDEO_QUEUE_NAME, getVideoQueue } from "../lib/queue.js";

const exec = promisify(execFile);
const TARGET_JOB_ID = process.env.TARGET_JOB_ID;
if (!TARGET_JOB_ID) throw new Error("TARGET_JOB_ID is required");

const targetQueueJob = await getVideoQueue().getJob(TARGET_JOB_ID);
if (!targetQueueJob) throw new Error(`BullMQ job ${TARGET_JOB_ID} was not found`);
const targetState = await targetQueueJob.getState();
if (targetState === "completed") process.exit(0);
if (!["waiting", "delayed", "active"].includes(targetState)) {
  throw new Error(`BullMQ job ${TARGET_JOB_ID} is in state ${targetState}`);
}

async function run(binary: string, args: string[]) {
  const result = await exec(binary, args, { maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}

async function downloadObject(key: string, destination: string) {
  const env = getCommonEnv();
  const result = await getS3().send(new GetObjectCommand({ Bucket: env.storageBucket, Key: key }));
  if (!result.Body) throw new Error("Neon Object Storage returned an empty body");
  await pipeline(result.Body as unknown as NodeJS.ReadableStream, createWriteStream(destination));
}

function contentType(file: string) {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function signedUrl(key: string) {
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: getCommonEnv().storageBucket, Key: key }),
    { expiresIn: 7 * 24 * 60 * 60 },
  );
}

async function updateVideo(videoId: string, patch: Partial<typeof videos.$inferInsert>) {
  const db = getDb();
  await db.update(videos).set({ ...patch, updatedAt: new Date() }).where(eq(videos.id, videoId));
}

async function transcode(job: Job<{ videoId: string; originalKey: string }>) {
  if (String(job.id) !== TARGET_JOB_ID) {
    throw new Error(`This runner was dispatched for ${TARGET_JOB_ID}, but BullMQ handed it ${job.id}`);
  }

  const { videoId, originalKey } = job.data;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mini-mux-"));
  const input = path.join(tempRoot, path.basename(originalKey));
  const hlsRoot = path.join(tempRoot, "hls");

  try {
    await updateVideo(videoId, { status: "PROCESSING", progress: 5, currentStep: "Downloading source", error: null });
    await job.updateProgress({ phase: "download", percent: 5 });
    await fs.mkdir(hlsRoot, { recursive: true });
    await downloadObject(originalKey, input);

    await updateVideo(videoId, { progress: 15, currentStep: "Running FFprobe" });
    const probeJson = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input]);
    const probe = JSON.parse(probeJson) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };

    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
    if (!videoStream?.width || !videoStream.height) throw new Error("No video stream found");

    await updateVideo(videoId, {
      durationSeconds: probe.format?.duration ? Number(probe.format.duration) : null,
      width: videoStream.width,
      height: videoStream.height,
      videoCodec: videoStream.codec_name ?? null,
      audioCodec: audioStream?.codec_name ?? null,
    });

    const profiles = [
      { name: "360p", width: 640, height: 360, bitrate: "800k", bandwidth: 900000 },
      { name: "720p", width: 1280, height: 720, bitrate: "2800k", bandwidth: 3000000 },
    ].filter((profile) => profile.height <= videoStream.height!);

    if (!profiles.length) {
      profiles.push({
        name: "source",
        width: Math.max(2, videoStream.width - (videoStream.width % 2)),
        height: Math.max(2, videoStream.height - (videoStream.height % 2)),
        bitrate: "700k",
        bandwidth: 800000,
      });
    }

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const percent = 20 + Math.round((i / Math.max(1, profiles.length)) * 55);
      await updateVideo(videoId, { progress: percent, currentStep: `Encoding ${profile.name}` });
      await job.updateProgress({ phase: "encode", rendition: profile.name, percent });

      const renditionDir = path.join(hlsRoot, profile.name);
      await fs.mkdir(renditionDir, { recursive: true });
      const segmentPattern = path.join(renditionDir, "segment_%03d.ts");
      const playlistPath = path.join(renditionDir, "index.m3u8");

      await run("ffmpeg", [
        "-y", "-i", input,
        "-vf", `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-maxrate", profile.bitrate,
        "-bufsize", profile.name === "720p" ? "5600k" : "1600k",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-hls_time", "4", "-hls_playlist_type", "vod",
        "-hls_segment_filename", segmentPattern,
        playlistPath,
      ]);

      const files = await fs.readdir(renditionDir);
      for (const file of files) {
        const localPath = path.join(renditionDir, file);
        const data = await fs.readFile(localPath);
        const key = `videos/${videoId}/hls/${profile.name}/${file}`;
        await putFile(
          key,
          data,
          contentType(file),
          file.endsWith(".ts") ? "public,max-age=31536000,immutable" : "public,max-age=60",
        );
      }
    }

    await updateVideo(videoId, { progress: 80, currentStep: "Signing HLS playlists" });
    await job.updateProgress({ phase: "hls", percent: 80 });

    for (const profile of profiles) {
      const localPlaylist = path.join(hlsRoot, profile.name, "index.m3u8");
      const raw = await fs.readFile(localPlaylist, "utf8");
      const lines = raw.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line || line.startsWith("#")) continue;
        const key = `videos/${videoId}/hls/${profile.name}/${line}`;
        lines[i] = await signedUrl(key);
      }
      const key = `videos/${videoId}/hls/${profile.name}/index.m3u8`;
      await putFile(key, Buffer.from(lines.join("\n")), "application/vnd.apple.mpegurl", "public,max-age=60");
    }

    const masterLines: string[] = ["#EXTM3U", "#EXT-X-VERSION:3"];
    for (const profile of profiles) {
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${profile.bandwidth},RESOLUTION=${profile.width}x${profile.height},CODECS="avc1.64001f,mp4a.40.2"`,
      );
      masterLines.push(await signedUrl(`videos/${videoId}/hls/${profile.name}/index.m3u8`));
    }

    const masterKey = `videos/${videoId}/hls/master.m3u8`;
    await putFile(masterKey, Buffer.from(masterLines.join("\n") + "\n"), "application/vnd.apple.mpegurl", "public,max-age=60");
    const playbackUrl = await signedUrl(masterKey);

    await updateVideo(videoId, { status: "READY", progress: 100, currentStep: "Ready", playbackUrl, error: null });
    await job.updateProgress({ phase: "complete", percent: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateVideo(videoId, { status: "FAILED", progress: 100, currentStep: "Failed", error: message });
    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

const worker = new Worker(
  VIDEO_QUEUE_NAME,
  async (job) => transcode(job),
  {
    connection: redisConnection(),
    concurrency: 1,
    lockDuration: 5 * 60 * 1000,
    maxStalledCount: 1,
  },
);

worker.on("ready", () => console.log(`Transcoder worker ready for target job ${TARGET_JOB_ID}`));
worker.on("completed", async (job) => {
  if (String(job.id) === TARGET_JOB_ID) {
    console.log(`Transcode completed: ${job.id}`);
    await worker.close();
    process.exit(0);
  }
});
worker.on("failed", async (job, error) => {
  console.error("Transcode job failed", job?.id, error);
  if (job && String(job.id) === TARGET_JOB_ID && job.attemptsMade >= 2) {
    await worker.close();
    process.exit(1);
  }
});
worker.on("error", (error) => console.error("BullMQ worker error", error));
