import { pgTable, text, bigint, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const videos = pgTable("videos", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  originalKey: text("original_key").notNull().unique(),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  currentStep: text("current_step"),
  error: text("error"),
  playbackUrl: text("playback_url"),
  durationSeconds: doublePrecision("duration_seconds"),
  width: integer("width"),
  height: integer("height"),
  videoCodec: text("video_codec"),
  audioCodec: text("audio_codec"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Video = typeof videos.$inferSelect;
