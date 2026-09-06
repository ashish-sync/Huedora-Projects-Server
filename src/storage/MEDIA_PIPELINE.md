# Media pipeline (uploads / Cloudflare R2)

Verified (Cloudflare docs, 2026): R2 supports **Standard** and **Infrequent Access** via S3 API `StorageClass` values `STANDARD` and `STANDARD_IA` on PutObject / CopyObject.

## Goals

- One optimized **master** per upload (no permanent thumbs/previews)
- Images → WebP Q90, max long edge 2500px, metadata stripped
- PDFs stay PDF (never WebP); light optimize only when smaller + same page count
- **Camp One execution documents** (not GPS selfies): 8-bit L grayscale → lossy WebP Q45 / grayscale JPEG-in-PDF Q45 @ ~1700px → R2 (see below)
- SHA-256 soft dedupe + `refCount`
- `lastAccessedAt` on `stored_files` (independent of entity 90-day retention)
- Idle 90 days → CopyObject to `STANDARD_IA` → verify → update DB → drop local disk copy
- Access → CopyObject back to `STANDARD` → **`lastAccessedAt = NOW`** (90-day clock resets; prevents archive↔restore oscillation)
- On-demand preview: `?preview=1&w=240` on signed file URL (disposable `uploads/cache/thumbs/`)

## Camp One — Execution Documents

Specialized path for Doctor Form / Patient Form / Other (not GPS Selfie):

| Step | Behavior |
|------|----------|
| Strip metadata | Sharp encode drops EXIF/GPS/profiles/thumbs |
| Blue stamp | Recomb heavily weights Red so cyan/blue stamps go dark |
| Contrast | `normalize` levels stretch paper→white, ink→black |
| Resize | Long edge 1700px (~150–200 DPI A4) |
| Images out | **8-bit single-channel (mode L)** lossy WebP **Q45** (effort 6) — never color PNG |
| PDFs out | Rasterize → grayscale JPEG Q45 embedded in PDF (needs libvips+poppler; else generic PDF fallback) |
| Target | Soft 150–300 KB/page (preferred 250–300 for handwriting); logged only |
| Storage | Same disk→validate→R2 finalize as other uploads |

Modules: `media/optimizeExecutionDoc.js`, `finalizeExecutionDocs.js`. GPS selfies keep the generic color photo pipeline.

## Key modules

| Path | Role |
|------|------|
| `media/processUpload.js` | Optimize + dedupe + register + R2 put |
| `media/optimizeExecutionDoc.js` | Execution-doc blue-stamp grayscale encode |
| `finalizeExecutionDocs.js` | Camp execution-document finalize → R2 |
| `media/mediaQueue.js` | Concurrency 1 retries / memory defer |
| `media/coldStorageJob.js` | 90-day IA transition |
| `media/ensureHotStorage.js` | Auto-restore on access |
| `modules/files/storedFile.model.js` | Registry collection `stored_files` |

## Admin APIs

- `POST /api/v1/system/media/retry-failed`
- `POST /api/v1/system/media/cold-archive` body `{ dryRun?, limit? }`

## Upload lifecycle (v1+)

1. Multer writes **local disk only** (no R2 yet).
2. Route validates business rules.
3. `finalizeRequestUploads` / `ensureUploadCommit` optimize + put R2.
4. On failure, `discardRequestUploads` removes local (+ R2 if present).

This avoids orphan R2 objects when validation rejects the request.
