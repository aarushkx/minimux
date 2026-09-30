"use client";

import { useEffect, useState } from "react";
import VideoPlayer from "@/components/VideoPlayer";

interface Video {
    id: string;
    filename: string;
    status: string;
    progress: number;
    currentStep: string | null;
    error: string | null;
    playbackUrl: string | null;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    sizeBytes: number;
    createdAt: string;
}

const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 500);

export default function HomePage() {
    const [file, setFile] = useState<File | null>(null);
    const [video, setVideo] = useState<Video | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(
        "Pick a video to test the complete pipeline.",
    );

    useEffect(() => {
        if (!video || ["READY", "FAILED"].includes(video.status)) return;
        const timer = setInterval(async () => {
            const res = await fetch(`/api/videos/${video.id}`, {
                cache: "no-store",
            });
            if (res.ok) setVideo(await res.json());
        }, 2000);
        return () => clearInterval(timer);
    }, [video]);

    // async function start() {
    //     if (!file) return;
    //     if (!file.type.startsWith("video/")) {
    //         setMessage("Please choose a video file.");
    //         return;
    //     }
    //     if (file.size > MAX_MB * 1024 * 1024) {
    //         setMessage(`File is larger than ${MAX_MB} MB.`);
    //         return;
    //     }

    //     setBusy(true);
    //     setMessage("Creating upload session…");

    //     try {
    //         setMessage("Uploading to Neon Object Storage…");

    //         const formData = new FormData();
    //         formData.append("file", file);

    //         const uploadResponse = await fetch("/api/uploads", {
    //             method: "POST",
    //             body: formData,
    //         });

    //         const upload = await uploadResponse.json();

    //         if (!uploadResponse.ok) {
    //             throw new Error(upload.error || "Failed to upload video");
    //         }

    //         setMessage("Upload complete. Queuing FFmpeg job…");
    //         const complete = await fetch(
    //             `/api/videos/${upload.videoId}/complete`,
    //             {
    //                 method: "POST",
    //             },
    //         );
    //         const completed = await complete.json();
    //         if (!complete.ok)
    //             throw new Error(completed.error || "Failed to queue job");

    //         setVideo(completed);
    //         setMessage(
    //             "Queued. GitHub is starting an ephemeral transcoder runner…",
    //         );
    //     } catch (error) {
    //         setMessage(
    //             error instanceof Error
    //                 ? error.message
    //                 : "Something went wrong.",
    //         );
    //     } finally {
    //         setBusy(false);
    //     }
    // }
    async function start() {
        if (!file) return;

        if (!file.type.startsWith("video/")) {
            setMessage("Please choose a video file.");
            return;
        }

        if (file.size > MAX_MB * 1024 * 1024) {
            setMessage(`File is larger than ${MAX_MB} MB.`);
            return;
        }

        setBusy(true);

        try {
            // --------------------------------------------------
            // 1. Ask Next.js for a presigned upload URL
            //    IMPORTANT: the video itself is NOT sent here.
            // --------------------------------------------------

            setMessage("Creating upload session…");

            const create = await fetch("/api/uploads", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type || "video/mp4",
                    sizeBytes: file.size,
                }),
            });

            const upload = await create.json();

            if (!create.ok) {
                throw new Error(upload.error || "Failed to create upload");
            }

            // --------------------------------------------------
            // 2. Upload the actual video DIRECTLY to Neon
            // --------------------------------------------------

            setMessage("Uploading directly to Neon Object Storage…");

            const put = await fetch(upload.uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type || "video/mp4",
                },
                body: file,
            });

            if (!put.ok) {
                throw new Error(
                    `Neon Object Storage upload failed (${put.status})`,
                );
            }

            // --------------------------------------------------
            // 3. Tell our backend the upload completed
            // --------------------------------------------------

            setMessage("Upload complete. Queuing FFmpeg job…");

            const complete = await fetch(
                `/api/videos/${upload.videoId}/complete`,
                {
                    method: "POST",
                },
            );

            const completed = await complete.json();

            if (!complete.ok) {
                throw new Error(completed.error || "Failed to queue job");
            }

            setVideo(completed);

            setMessage(
                "Queued. GitHub is starting an ephemeral transcoder runner…",
            );
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : "Something went wrong.",
            );
        } finally {
            setBusy(false);
        }
    }

    async function dispatchAgain() {
        if (!video) return;
        setMessage("Re-dispatching worker…");
        const res = await fetch(`/api/videos/${video.id}/dispatch`, {
            method: "POST",
        });
        const data = await res.json();
        if (!res.ok) setMessage(data.error || "Dispatch failed");
        else setMessage("Worker dispatched again.");
    }

    return (
        <main className="page">
            <section className="hero">
                <div className="eyebrow">
                    Video infrastructure proof of concept
                </div>
                <h1>Mini Mux Pipeline</h1>
                <p className="subtitle">
                    Direct Neon Object Storage upload → BullMQ/Upstash → GitHub
                    ephemeral runner → your Node worker → FFprobe + FFmpeg → HLS
                    → Video.js.
                </p>
            </section>

            <section className="grid">
                <div className="panel">
                    <h2>1. Upload a video</h2>
                    <div className="upload">
                        <div>Select a small MP4/MOV/WebM file.</div>
                        <input
                            type="file"
                            accept="video/*"
                            onChange={(e) =>
                                setFile(e.target.files?.[0] ?? null)
                            }
                        />
                        <button
                            className="button"
                            disabled={!file || busy}
                            onClick={start}
                        >
                            {busy ? "Working…" : "Upload & Process"}
                        </button>
                        <div
                            className={`status ${message.toLowerCase().includes("failed") ? "error" : ""}`}
                        >
                            {message}
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <h2>2. Pipeline status</h2>
                    {!video ? (
                        <div className="empty">No video yet.</div>
                    ) : (
                        <div className="meta">
                            <div className="meta-row">
                                <span>File</span>
                                <strong>{video.filename}</strong>
                            </div>
                            <div className="meta-row">
                                <span>Status</span>
                                <strong>{video.status}</strong>
                            </div>
                            <div className="meta-row">
                                <span>Step</span>
                                <strong>{video.currentStep ?? "—"}</strong>
                            </div>
                            <div className="meta-row">
                                <span>Size</span>
                                <strong>
                                    {(video.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
                                    MB
                                </strong>
                            </div>
                            {video.width && video.height && (
                                <div className="meta-row">
                                    <span>Video</span>
                                    <strong>
                                        {video.width}×{video.height} ·{" "}
                                        {video.videoCodec ?? "—"}
                                    </strong>
                                </div>
                            )}
                            {video.durationSeconds && (
                                <div className="meta-row">
                                    <span>Duration</span>
                                    <strong>
                                        {video.durationSeconds.toFixed(1)}s
                                    </strong>
                                </div>
                            )}
                            <div className="progress">
                                <div style={{ width: `${video.progress}%` }} />
                            </div>
                            {video.status === "FAILED" && (
                                <button
                                    className="button"
                                    onClick={dispatchAgain}
                                >
                                    Retry worker
                                </button>
                            )}
                            {video.status === "READY" && (
                                <div className="success">
                                    HLS package is ready.
                                </div>
                            )}
                            {video.error && (
                                <div className="error">{video.error}</div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {video?.playbackUrl && video.status === "READY" && (
                <section className="panel" style={{ marginTop: 20 }}>
                    <h2>3. Playback</h2>
                    <VideoPlayer src={video.playbackUrl} />
                    <div className="footer-note">
                        The playback URL is a short-lived Neon Object Storage
                        presigned URL. For this proof of concept it lasts 7
                        days.
                    </div>
                </section>
            )}

            <p className="footer-note">
                This demo intentionally has no auth, no CDN, no managed
                transcoding, and one active encoding job at a time. It is meant
                to prove that the media pipeline works before you invest in the
                full platform.
            </p>
        </main>
    );
}
