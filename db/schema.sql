CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  original_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  error TEXT,
  playback_url TEXT,
  duration_seconds DOUBLE PRECISION,
  width INTEGER,
  height INTEGER,
  video_codec TEXT,
  audio_codec TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
