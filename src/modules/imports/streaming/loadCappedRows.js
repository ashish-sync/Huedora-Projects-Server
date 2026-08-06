import { validateUploadedImportFile, safeUnlink } from './tempUpload.js';
import { parseTabularFile } from '../../campOps/communications/utils/tabularFileParse.js';
import { withImportSlot } from './importSlot.js';

/**
 * Validate disk upload, stream-parse ≤ MAX_IMPORT_ROWS into memory, delete temp.
 * For handlers that still need a full (capped) row array. Prefer executeUploadedImport
 * for true batch insert with progressive GC.
 */
export async function loadCappedRowsFromUpload(file) {
  return withImportSlot(async () => {
    const validated = validateUploadedImportFile(file);
    try {
      const parsed = await parseTabularFile(validated.path, {
        originalName: validated.originalname,
      });
      return {
        rows: parsed.rows,
        headers: parsed.headers,
        fileName: validated.originalname || '',
        totalRows: parsed.totalRows,
      };
    } finally {
      safeUnlink(validated.path);
    }
  });
}
