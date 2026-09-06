# Stored file naming (uploads / Cloudflare R2)

Canonical helpers live in `uploadKeys.js`:
`buildStoredUploadFileName`, `multerStoredUploadFileName`, `multerStoredUploadFileNameWithPurpose`.

## Pattern

```text
{moduleFolder}/[{subfolder}/][{purpose}__]{yyyyMMdd}-{id8}__{safeOriginal}
```

| Part | Meaning |
|------|---------|
| `moduleFolder` | From `uploadDir(...)` — e.g. `logistics/products`, `contacts`, `camp-ops`, `finance` |
| `purpose` | Optional kind tag when one folder holds many types — `po`, `ctf`, `signed`, `preview`, `filled` |
| `yyyyMMdd` | Upload date (UTC) |
| `id8` | First 8 hex chars of a UUID |
| `safeOriginal` | Sanitized original filename (max 80 chars) |

## Examples

```text
logistics/products/20260906-a1b2c3d4__device_photo.jpg
contacts/20260906-9f8e7d6c__pan_card.pdf
camp-ops/po__20260906-11223344__brand_approval.pdf
finance/20260906-aabbccdd__Tax_Invoice.pdf
agreements/signed__20260906-deadbeef__Lease-signed.pdf
```

## Rules

1. **One convention for all new uploads** — use the helpers; do not invent new timestamp/uuid styles.
2. **DB keeps the human name** — `name` / `originalName` / `fileName` for UI; the stored key is for storage/search.
3. **Never rewrite old keys** — existing objects and DB URLs remain valid.
4. **Imports temp** (`import-temp/`) may stay ephemeral and skip R2.
5. **Exception:** Camp execution documents may still be renamed to `{campId}__{doctor…}{date}.ext` for field identification after upload.
6. **Media pipeline:** New uploads are optimized/registered per `MEDIA_PIPELINE.md` (images→WebP, PDFs stay PDF, 90-day R2 Infrequent Access).

## R2 console search tips

- By module: prefix `contacts/` or `logistics/products/`
- By day: `20260906-`
- By original name fragment: `__pan_card` or `__Tax_Invoice`
- By purpose: `po__` / `signed__`
