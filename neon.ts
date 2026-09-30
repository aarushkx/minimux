import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Object Storage is S3-compatible and branch-aware.
  // Keep the media bucket private; the app uses presigned URLs for upload/playback.
  buckets: {
    "video-media": {
      access: "private",
    },
  },
});
