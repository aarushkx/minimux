"use client";

import { useEffect, useRef } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";

export default function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    playerRef.current = videojs(videoRef.current, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: "metadata",
      sources: [{ src, type: "application/x-mpegURL" }],
    });

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [src]);

  return (
    <div className="video-shell">
      <video ref={videoRef} className="video-js vjs-big-play-centered" playsInline />
    </div>
  );
}
