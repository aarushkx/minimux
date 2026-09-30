import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  buckets: {
    "minimux-bucket": {
      access: "private",
    },
  },

  functions: {
    videoupload: {
      name: "Video upload gateway",
      source: "./functions/upload.ts",
    },
  },
});