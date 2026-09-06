# Media pipeline (uploads / Cloudflare R2)

Verified (Cloudflare docs, 2026): R2 supports **Standard** and **Infrequent Access** via S3 API `StorageClass` values `STANDARD` and `STANDARD_IA` on PutObject / CopyObject.

## Goals

- One optimized **master** per upload (no permanent thumbs/previews)
- Images → WebP Q90, max long edge 2500px, metadata stripped
- PDFs stay PDF (never WebP); light optimize only when smaller + same page count
- SHA-256 soft dedupe + `refCount`
- `lastAccessedAt` on `stored_files` (independent of entity 90-day retention)
- Idle 90 days → CopyObject to `STANDARD_IA` → verify → update DB → drop local disk copy
- Access → CopyObject back to `STANDARD` → serve
- On-demand preview: `?preview=1&w=240` on signed file URL (disposable `uploads/cache/thumbs/`)

## Key modules

| Path | Role |
|------|------|
| `media/processUpload.js` | Optimize + dedupe + register + R2 put |
| `media/mediaQueue.js` | Concurrency 1 retries / memory defer |
| `media/coldStorageJob.js` | 90-day IA transition |
| `media/ensureHotStorage.js` | Auto-restore on access |
| `modules/files/storedFile.model.js` | Registry collection `stored_files` |

## Admin APIs

- `POST /api/v1/system/media/retry-failed`
- `POST /api/v1/system/media/cold-archive` body `{ dryRun?, limit? }`

## v1 scope

New uploads only — no historical backfill.
