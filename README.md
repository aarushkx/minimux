# Mini Mux Pipeline

A deliberately small proof-of-concept for the video infrastructure architecture discussed in chat.

The goal is to prove one thing before investing in the full platform:

> Can a user upload a video, have **our own FFmpeg worker** process it asynchronously on an ephemeral machine, store the HLS output, and play it back?

This repo does exactly that.

```text
                        CONTROL PLANE

Browser
   │
   ▼
Next.js / Vercel
   │
   ├──────────────► Neon PostgreSQL
   │                 metadata / status
   │
   ▼
BullMQ Queue
   │
   ▼
Upstash Redis
   │
   │ queued job
   ▼
GitHub Actions API
   │
   ▼
─────────────────────────────────────────────
         EPHEMERAL MEDIA WORKER
─────────────────────────────────────────────
GitHub-hosted runner
   │
   ▼
Your Node.js worker
   │
   ├── FFprobe → inspect source
   └── FFmpeg  → transcode + HLS
                    │
                    ▼
             Neon Object Storage
             (S3-compatible bucket)
                    │
                    ▼
                 Video.js
```

## What this proves

- The browser requests an upload gateway URL from Next.js.
- The browser uploads the original video directly to a **CORS-enabled Neon Function**, which streams it into Neon Object Storage. This avoids relying on an undocumented bucket CORS configuration for browser `PUT` requests.
- Neon Object Storage is declared as infrastructure in `neon.ts` and is branch-aware with the Neon database.
- Neon Object Storage exposes standard AWS S3 APIs, so the project uses `@aws-sdk/client-s3` and presigned URLs instead of a provider-specific media SDK.
- PostgreSQL metadata lives in Neon.
- BullMQ stores encoding jobs in Upstash Redis.
- Next.js dispatches an ephemeral GitHub Actions runner for the specific job.
- The runner executes **our own** Node.js worker, FFprobe, and FFmpeg.
- FFmpeg generates 360p and 720p HLS renditions for the demo.
- HLS manifests and segments are uploaded back into the same Neon Object Storage bucket.
- The worker creates signed playback URLs and marks the Neon row `READY`.
- Video.js plays the HLS master playlist.

Neon Object Storage is an S3-compatible, branch-aware object store integrated with Neon. The current Neon Free plan includes **5 GB of Object Storage per project**.

## Why Neon Object Storage instead of B2/R2

The storage layer is intentionally now part of the Neon backend:

```text
Neon
├── PostgreSQL
└── Object Storage
      └── minimux-bucket bucket
```

The bucket and database live on the same Neon branch, so a preview/test branch gets its own storage state instead of sharing the production bucket. Neon exposes standard S3 credentials as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION`.

The project uses the raw AWS SDK because Neon explicitly supports S3 clients and presigned URLs; Neon requires path-style addressing, so `forcePathStyle: true` is set in `lib/storage.ts`. The browser upload path uses a small Neon Function because the storage endpoint does not currently expose a documented bucket-CORS configuration for browser `PUT` preflights.

## Repository layout

```text
mini-mux-pipeline/
├── app/
│   ├── api/
│   │   ├── health/
│   │   ├── uploads/
│   │   └── videos/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
│
├── components/
│   └── VideoPlayer.tsx
│
├── db/
│   └── schema.sql
│
├── lib/
│   ├── db.ts
│   ├── env.ts
│   ├── github.ts
│   ├── queue.ts
│   ├── redis.ts
│   ├── schema.ts
│   └── storage.ts
│
├── functions/
│   └── upload.ts
│
├── worker/
│   └── index.ts
│
├── .github/
│   └── workflows/
│       └── transcode.yml
│
├── neon.ts
├── .env.example
├── package.json
└── README.md
```

## 1. Prerequisites

You need:

- Node.js 22+
- pnpm 10+
- a Neon account
- an Upstash Redis database
- a **public GitHub repository** so the GitHub-hosted standard runner is free
- a Vercel account if you want the production web app

GitHub's current standard Linux-hosted runner is 4 CPU / 16 GB RAM / 14 GB SSD, and standard hosted runners are free and unlimited for public repositories.

## 2. Create the Neon project

Create a Neon project and make sure Object Storage is available for the project.

Neon Object Storage is currently part of the GA Neon backend and is available on the Free plan. The current Free plan includes 5 GB of Object Storage per project.

### Install the Neon CLI

The current CLI is published as `neon`.

```bash
npm i -g neon
```

Neon documents the CLI as the entry point for managing projects, branches, Object Storage buckets, and `neon.ts` configuration.

### Link this repository to your Neon project

From the repository root:

```bash
neon link
```

### Install the config package

The repo already lists the config package:

```bash
pnpm install
```

`neon.ts` declares the bucket:

```ts
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  buckets: {
    "minimux-bucket": {
      access: "private",
    },
  },
});
```

Neon's current config-as-code tooling supports declaring Object Storage buckets in `neon.ts` and applying them with `neon deploy`.

### Provision the bucket

```bash
pnpm neon:deploy
```

or:

```bash
neon deploy
```

Then pull the branch-specific credentials locally:

```bash
pnpm neon:env
```

or:

```bash
neon env pull
```

When a bucket is declared, Neon supplies these standard S3 variables for the branch: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION`.

## 3. Configure local environment

Copy:

```bash
cp .env.example .env
```

After `neon env pull`, fill/verify:

```env
DATABASE_URL=...

UPSTASH_REDIS_URL=rediss://...

STORAGE_BUCKET=minimux-bucket
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_ENDPOINT_URL_S3=...
AWS_REGION=...

GITHUB_OWNER=your-github-user
GITHUB_REPO=mini-mux-pipeline
GITHUB_WORKFLOW_FILE=transcode.yml
GITHUB_REF=main
GITHUB_TOKEN=github_pat_...

NEXT_PUBLIC_MAX_UPLOAD_MB=500
```

`AWS_*` values are the branch-scoped Neon Object Storage credentials. Do not commit them.

## 4. Create the database table

Either use the SQL file in the Neon SQL editor:

```text
db/schema.sql
```

or run:

```bash
pnpm db:push
```

## 5. Create Upstash Redis

Create a Redis database and copy its TLS connection string into:

```env
UPSTASH_REDIS_URL=rediss://...
```

BullMQ uses this Redis instance for queue state.

## 6. GitHub Actions setup

The workflow is:

```text
Next.js API
    │
    │ workflow dispatch
    ▼
GitHub Actions
    │
    ▼
Ubuntu runner
    │
    └── pnpm worker
```

The repository must be public to use the standard GitHub-hosted runner at no charge under GitHub's current public-repository rules.

### GitHub token used by the Vercel API

Create a fine-grained GitHub token with access to this repository and **Actions: Read and write** permission.

The token is used only by the Next.js server to call the GitHub workflow-dispatch API.

Do not give the worker the GitHub token.

### GitHub Actions repository secrets

Go to:

```text
Repository
→ Settings
→ Secrets and variables
→ Actions
```

Create:

```text
DATABASE_URL
UPSTASH_REDIS_URL
STORAGE_BUCKET
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_ENDPOINT_URL_S3
AWS_REGION
```

These are the credentials the ephemeral runner needs to access Neon Object Storage and Neon PostgreSQL.

The workflow receives the BullMQ job ID as `TARGET_JOB_ID`.

## 7. Run locally

Install dependencies:

```bash
pnpm install
```

Start Next.js:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

The local Next.js process is only the **control plane**. Do not run the FFmpeg worker locally for the normal POC path; the worker is started by GitHub Actions.

## 8. End-to-end request flow

When you click **Upload & Process**:

```text
1. Browser selects source.mp4
          ↓
2. POST /api/uploads
          ↓
3. Next.js creates video row in Neon
          ↓
4. Next.js creates a presigned PUT URL
          ↓
5. Browser uploads directly to Neon Object Storage
          ↓
6. POST /api/videos/:id/complete
          ↓
7. API verifies the object exists
          ↓
8. BullMQ job is created in Upstash
          ↓
9. Next.js dispatches GitHub Actions
          ↓
10. GitHub starts an ephemeral runner
          ↓
11. Node worker claims the specific BullMQ job
          ↓
12. Worker downloads source from Neon Object Storage
          ↓
13. FFprobe extracts metadata
          ↓
14. Your rendition planner chooses outputs
          ↓
15. FFmpeg creates 360p/720p HLS
          ↓
16. Worker uploads HLS files to Neon Object Storage
          ↓
17. Worker signs the nested HLS URLs
          ↓
18. Worker marks the Neon video row READY
          ↓
19. Browser receives playback URL
          ↓
20. Video.js plays HLS
```

## 9. Storage layout

Everything stays under one prefix in the `minimux-bucket` bucket:

```text
videos/
└── {videoId}/
    ├── original/
    │   └── source.mp4
    │
    └── hls/
        ├── master.m3u8
        │
        ├── 360p/
        │   ├── index.m3u8
        │   ├── segment_000.ts
        │   └── ...
        │
        └── 720p/
            ├── index.m3u8
            ├── segment_000.ts
            └── ...
```

The database stores the original object key and the playback URL, while the bytes stay in Object Storage. This mirrors Neon's documented pattern of storing object keys in Postgres rather than binary data.

## 10. What the worker actually does

The worker is deliberately simple.

### FFprobe

It reads:

```text
duration
width
height
video codec
audio codec
```

### Rendition planner

For this POC:

```text
source >= 720p
    → 360p
    → 720p

source < 720p
    → source-sized rendition
```

### FFmpeg

The worker runs FFmpeg directly and generates:

```text
H.264 video
AAC audio
HLS
4-second segments
VOD playlists
```

No managed video transcoding service is involved.

## 11. Production deployment

### Deploy the web application

Push the repository to GitHub and import the project into Vercel.

Set these Vercel Production environment variables:

```text
DATABASE_URL
UPSTASH_REDIS_URL
STORAGE_BUCKET
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_ENDPOINT_URL_S3
AWS_REGION
GITHUB_OWNER
GITHUB_REPO
GITHUB_WORKFLOW_FILE=transcode.yml
GITHUB_REF=main
GITHUB_TOKEN
NEXT_PUBLIC_MAX_UPLOAD_MB=500
```

The `AWS_*` values must belong to the **production Neon branch** whose Object Storage bucket the Vercel app uses. Neon credentials are branch-scoped.

### Deploy database/storage configuration

Keep `neon.ts` in the repository.

When storage configuration changes:

```bash
neon deploy
```

Then refresh your local branch environment:

```bash
neon env pull
```

The same configuration can be used as the starting point for branch-specific preview environments because Neon Object Storage branches with the database.

### GitHub Actions

Make sure `.github/workflows/transcode.yml` is on the repository's default branch.

A job is launched from the web app by calling GitHub's workflow-dispatch endpoint. The current GitHub API supports workflow dispatch with input parameters, which is how the BullMQ job ID reaches the runner.

## 12. Manual GitHub smoke test

Before testing the browser flow, you can verify the worker independently.

Go to:

```text
GitHub → Actions → Transcode video → Run workflow
```

Provide the `job_id` of an existing BullMQ job.

The runner should:

```text
checkout
→ setup Node
→ setup pnpm
→ install dependencies
→ install FFmpeg
→ run pnpm worker
```

## 13. POC limitations

This is intentionally small:

- no authentication
- no CDN
- one active encoding job at a time
- max upload defaults to 500 MB
- H.264/AAC only
- up to 720p output
- one GitHub runner per dispatched job
- signed playback URLs are intentionally short-lived
- no resumable multipart upload yet
- no production-grade worker scheduler yet

The goal is to validate the core architecture before adding platform complexity.

## 14. Why this is resume-worthy

The valuable part isn't that GitHub or Neon exists. Your code owns the media-processing path:

```text
BullMQ job orchestration
        ↓
Ephemeral worker execution
        ↓
FFprobe metadata extraction
        ↓
Rendition planning
        ↓
FFmpeg encoding
        ↓
HLS packaging
        ↓
Object upload
        ↓
Signed playback
        ↓
Job/state transitions
```

The current architecture also keeps the worker independent from GitHub-specific code: later you can run the same Node/FFmpeg worker on a VM, Kubernetes job, container service, or another ephemeral compute backend without rewriting the media pipeline.

## 15. Free-tier expectation

The POC is designed around $0 infrastructure within current free-tier allowances:

| Component | Role | Target cost |
|---|---|---:|
| Vercel Hobby | Next.js control plane | $0 |
| Neon Free | PostgreSQL + Object Storage | $0 within limits |
| Upstash Free | BullMQ Redis backend | $0 within limits |
| GitHub public repository | Ephemeral FFmpeg compute | $0 on standard public-repo runners |
| FFmpeg | Encoding engine | $0 |
| Video.js | Playback | $0 |

Neon's current Free plan includes 100 CU-hours, 0.5 GB database storage, 10 branches, and 5 GB Object Storage per project.

The free tiers are quotas, not unlimited production capacity.

## 16. Smoke-test checklist

```text
[ ] Neon project created
[ ] minimux-bucket private bucket provisioned with neon deploy
[ ] neon env pull completed
[ ] DATABASE_URL works
[ ] Upstash Redis works
[ ] GitHub repository is public
[ ] GitHub Actions secret values added
[ ] Vercel production env values added
[ ] Next.js deployed
[ ] Upload URL created successfully
[ ] Original video appears in Neon Object Storage
[ ] BullMQ job created
[ ] GitHub runner starts
[ ] FFprobe succeeds
[ ] FFmpeg succeeds
[ ] HLS appears in Neon Object Storage
[ ] Neon video status becomes READY
[ ] Video.js plays the HLS stream
```

## Sources / current-platform notes

Neon Object Storage is GA and integrated into the Neon backend, with S3-compatible access and 5 GB included on the current Free plan.

Neon's current environment-variable documentation defines the Object Storage variables used here: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION`.

Neon's current Object Storage guidance states that the AWS SDK works directly, with `forcePathStyle: true`, and that presigned URLs are supported.
