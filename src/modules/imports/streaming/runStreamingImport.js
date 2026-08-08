import path from 'path';
import { AppError } from '../../../utils/helpers.js';
import { logMemory } from '../../../utils/memory.js';
import {
  MAX_IMPORT_ROWS,
  IMPORT_BATCH_SIZE,
} from '../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../utils/importErrors.js';
import { ImportJob } from '../importJob.model.js';
import { streamCsvFile } from './csvStream.js';
import { streamExcelFile } from './xlsbStream.js';
import { safeUnlink, validateUploadedImportFile } from './tempUpload.js';
import { withImportSlot } from './importSlot.js';

const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsb']);

function rowStreamFor(filePath, ext, maxRows) {
  if (ext === '.csv') return streamCsvFile(filePath, { maxRows });
  if (EXCEL_EXTS.has(ext)) return streamExcelFile(filePath, { maxRows });
  throw importAppError('BAD_EXTENSION');
}

/**
 * Process one import file from disk:
 * Stream → validate/process each row → batch callback every `batchSize` → clear batch → delete temp.
 */
export async function runStreamingImport(opts) {
  return withImportSlot(() => runStreamingImportInner(opts));
}

async function runStreamingImportInner(opts) {
  const {
    filePath,
    ext,
    originalName = '',
    jobId = null,
    batchSize = IMPORT_BATCH_SIZE,
    maxRows = MAX_IMPORT_ROWS,
    processRow,
  } = opts;

  if (typeof processRow !== 'function') {
    throw new AppError('processRow handler required', 500, 'SERVER_ERROR');
  }

  logMemory('import:stream:start', { file: originalName || path.basename(filePath), ext });

  let job = null;
  if (jobId) {
    job = await ImportJob.findById(jobId);
    if (job) {
      job.status = 'RUNNING';
      job.phase = 'streaming';
      job.startedAt = job.startedAt || new Date().toISOString();
      job.tempPath = filePath;
      job.fileName = originalName || job.fileName;
      await job.save();
    }
  }

  const errors = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let processed = 0;
  let headers = [];
  let batch = [];

  const persistProgress = async (phase = 'streaming') => {
    if (!job) return;
    job.processedRows = processed;
    job.totalRows = Math.max(job.totalRows || 0, processed);
    job.successRows = created + updated;
    job.errorRows = errors.length;
    job.phase = phase;
    job.percent = job.totalRows
      ? Math.min(99, Math.round((processed / Math.max(job.totalRows, maxRows)) * 100))
      : Math.min(99, Math.round((processed / maxRows) * 100));
    await job.save();
  };

  const clearBatch = () => {
    for (let i = 0; i < batch.length; i++) batch[i] = null;
    batch = [];
  };

  try {
    for await (const row of rowStreamFor(filePath, ext, maxRows)) {
      if (row.headers?.length && !headers.length) headers = row.headers;

      try {
        const result = await processRow({
          rowNum: row.rowNum,
          record: row.record,
          headers,
        });
        if (result?.skipped) skipped += 1;
        else if (result?.updated) updated += 1;
        else if (result?.ok === false) {
          /* counted via thrown / explicit error push */
        } else created += 1;
      } catch (err) {
        errors.push({
          row: row.rowNum,
          field: 'import',
          message: err.message || 'Import failed',
        });
      }

      processed += 1;
      batch.push(row.record);

      if (batch.length >= batchSize) {
        clearBatch();
        if (global.gc) {
          try {
            global.gc();
          } catch {
            /* ignore */
          }
        }
        await persistProgress('batch');
        logMemory('import:stream:batch', { processed, errors: errors.length });
      }
    }

    clearBatch();

    const summary = {
      totalRows: processed,
      created,
      updated,
      skipped,
      errorRows: errors.length,
      errors: errors.slice(0, 200),
      fileName: originalName,
      headers,
    };

    if (job) {
      job.status = errors.length && !created && !updated ? 'FAILED' : 'SUCCEEDED';
      job.phase = 'done';
      job.totalRows = processed;
      job.processedRows = processed;
      job.successRows = created + updated;
      job.errorRows = errors.length;
      job.rowErrors = errors.slice(0, 500);
      job.summary = {
        created,
        updated,
        skipped,
      };
      job.percent = 100;
      job.finishedAt = new Date().toISOString();
      job.tempPath = null;
      await job.save();
    }

    logMemory('import:stream:done', {
      processed,
      created,
      updated,
      errorRows: errors.length,
    });

    return summary;
  } catch (err) {
    if (job) {
      job.status = 'FAILED';
      job.phase = 'error';
      job.finishedAt = new Date().toISOString();
      job.rowErrors = [
        ...(job.rowErrors || []),
        { row: 0, field: 'system', message: err.message || 'Import failed' },
      ].slice(0, 500);
      job.tempPath = null;
      await job.save();
    }
    throw err;
  } finally {
    safeUnlink(filePath);
  }
}

/**
 * Create a job, validate upload, run streaming import (awaited).
 * Temp file is always deleted in runStreamingImport finally.
 */
export async function executeUploadedImport({ file, userId, importType, processRow, batchSize }) {
  const validated = validateUploadedImportFile(file);
  const job = await ImportJob.create({
    type: importType || 'TABULAR',
    mode: 'COMMIT',
    status: 'QUEUED',
    phase: 'queued',
    fileName: validated.originalname || '',
    tempPath: validated.path,
    startedBy: userId || null,
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    errorRows: 0,
    percent: 0,
    rowErrors: [],
    startedAt: new Date().toISOString(),
  });

  try {
    const summary = await runStreamingImport({
      filePath: validated.path,
      ext: validated.ext,
      originalName: validated.originalname,
      jobId: job._id,
      processRow,
      batchSize,
    });
    const fresh = await ImportJob.findById(job._id);
    return { job: fresh, summary };
  } catch (err) {
    safeUnlink(validated.path);
    throw err;
  }
}
