# Media pipeline (uploads / Cloudflare R2)

Verified (Cloudflare docs, 2026): R2 supports **Standard** and **Infrequent Access** via S3 API `StorageClass` values `STANDARD` and `STANDARD_IA` on PutObject / CopyObject.

## Goals

- One optimized **master** per upload (no permanent thumbs/previews)
- **Standard images** (all upload surfaces except Camp DF/PF/Other): indexed full-color lossless WebP, 8–16 colour palette, long edge **1280px** — same rule as GPS Selfie
- PDFs stay PDF (never WebP); light optimize only when smaller + same page count
- **Camp One execution documents** (DF / PF / Other only): 8-bit L grayscale → lossy WebP Q45 / grayscale JPEG-in-PDF Q45 @ ~1700px → R2 (see below)
- **Camp One GPS Selfie (GS):** same standard indexed-color lossless WebP path
- SHA-256 soft dedupe + `refCount`
- `lastAccessedAt` on `stored_files` (independent of entity 90-day retention)
- Idle 90 days → CopyObject to `STANDARD_IA` → verify → update DB → drop local disk copy
- Access → CopyObject back to `STANDARD` → **`lastAccessedAt = NOW`** (90-day clock resets; prevents archive↔restore oscillation)
- On-demand preview: `?preview=1&w=240` on signed file URL (disposable `uploads/cache/thumbs/`)

## Camp One — Execution Documents

### File nomenclature (canonical)

| Layer | Pattern | Example |
|-------|---------|---------|
| Display / `fileName` | `{DOCTOR}{CODE}.ext` | `ADIPF.webp` |
| Stored / R2 key | `{campId}__{DOCTOR}{CODE}.ext` | `26-10-0001__ADIPF.webp` |

Codes: **DF** doctor form · **PF** patient form · **GS** GPS selfie · **OT** other.  
No camp-date numeric suffix. Collisions use `-2`, `-3`, … before the extension.  
Implemented only in `modules/campOps/executionDocumentName.js` (upload route + QA stubs).

### Optimize path

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

Modules: `media/optimizeExecutionDoc.js`, `media/optimizeGpsSelfie.js` / `media/optimizeImage.js` (shared standard), `finalizeExecutionDocs.js`.

### Standard images + GPS Selfie (GS)

Used for **all image uploads** except Camp DF/PF/Other scans (via `optimizeImageToWebp` → same encoder as GPS Selfie):

| Step | Behavior |
|------|----------|
| Strip metadata | Sharp encode drops EXIF/GPS/profiles/thumbs |
| Resize | Long edge 1280px |
| Color | Quantize to **8–16 colour indexed palette** (prefers 16; may use 8 if still large) |
| Output | Lossless **Indexed Color WebP** (full-color, not grayscale L, not lossy Q45) |

Signature Master / Org Master logo & signature data-URLs use `optimizeImageDataUrl` with the same rule.

## Key modules

| Path | Role |
|------|------|
| `media/processUpload.js` | Optimize + dedupe + register + R2 put |
| `media/optimizeImage.js` | **Standard** indexed full-color lossless WebP (all images except DF/PF/Other) |
| `media/optimizeExecutionDoc.js` | Execution-doc blue-stamp grayscale encode (DF/PF/Other only) |
| `media/optimizeGpsSelfie.js` | Shared indexed-color WebP encoder (GPS Selfie + standard images); already-suitable WebP passthrough |
| `finalizeExecutionDocs.js` | Camp execution-document finalize → R2 |
| `media/mediaQueue.js` | Concurrency 1 retries / memory defer |
| `media/coldStorageJob.js` | 90-day IA transition |
| `media/ensureHotStorage.js` | Auto-restore on access |
| `modules/files/storedFile.model.js` | Registry collection `stored_files` |

## Admin APIs

- `GET /api/v1/system/object-storage` — R2 probe + `mediaQueue` + `storedFiles` counts (`pending` / `failed` / `ready`)
- `POST /api/v1/system/media/retry-failed` — re-put local masters for `failed` (and stuck `pending`) rows; never silently skips
- `POST /api/v1/system/media/requeue-stuck` — same recovery as boot (re-enqueue after process restart)
- `POST /api/v1/system/media/cold-archive` body `{ dryRun?, limit? }`

## Upload lifecycle (v1+)

1. Multer writes **local disk only** (no R2 yet).
2. Route validates business rules.
3. Optimize locally (sharp) + register `stored_files`.
4. **Camp One execution documents (DF/PF/GS/OT):** prefer **browser → R2 presigned PUT** (`/execution-documents/presign` + `/confirm`); multipart remains as fallback. After semantic rename, **await** PutObject with retries + HeadObject verify before `res.json` when the server still handles the file bytes.
5. **Memory (Render 512MB):** Sharp `cache=false` / `concurrency=1`; GPS WebP never palette-re-encoded (passthrough or resize-only); direct GPS WebP confirm uses R2 `CopyObject` only; process-wide image gate; ≤8MP / 10MB / 1 file per request; `[memory]` logs around each stage.
6. **Other uploads:** may still use `enqueueR2Put` (`pending` → `ready` / `failed`); boot/hourly sweep recovers stuck rows.
6. On request validation failure, `discardRequestUploads` removes local (+ R2 if present).

## Remaining performance debt (deferred)

- Full `global.css` monolith split (high regression risk).
- Deferring **sharp** off the request path (naming/extension coupling to on-path optimize).
- Cursor-based pagination UI (skip/limit is enough for current page controls).
- Render free cold starts / 512MB host limits (ops, not code alone).
- Predicate camp-list branches still load all matching projected rows before in-memory filter/page (cheaper than full hydrate + URL signing, but not Mongo skip/limit).
