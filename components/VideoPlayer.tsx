// "use client";

// import { useEffect, useRef } from "react";
// import videojs from "video.js";
// import "video.js/dist/video-js.css";

// export default function VideoPlayer({ src }: { src: string }) {
//   const videoRef = useRef<HTMLVideoElement | null>(null);
//   const playerRef = useRef<ReturnType<typeof videojs> | null>(null);

//   useEffect(() => {
//     if (!videoRef.current) return;

//     playerRef.current = videojs(videoRef.current, {
//       controls: true,
//       responsive: true,
//       fluid: true,
//       preload: "metadata",
//       sources: [{ src, type: "application/x-mpegURL" }],
//     });

//     return () => {
//       playerRef.current?.dispose();
//       playerRef.current = null;
//     };
//   }, [src]);

//   return (
//     <div className="video-shell">
//       <video ref={videoRef} className="video-js vjs-big-play-centered" playsInline />
//     </div>
//   );
// }

"use client";

import { useEffect, useRef } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";

type VideoPlayerProps = {
  src: string;
};

export default function VideoPlayer({ src }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create the video element ourselves so Video.js owns it.
    const videoElement = document.createElement("video-js");

    videoElement.classList.add(
      "vjs-big-play-centered",
      "video-js"
    );

    videoElement.setAttribute("playsinline", "true");

    containerRef.current.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: "metadata",
      sources: [
        {
          src,
          type: "application/x-mpegURL",
        },
      ],
    });

    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [src]);

  return (
    <div
      ref={containerRef}
      className="video-shell"
      data-vjs-player
    />
  );
}