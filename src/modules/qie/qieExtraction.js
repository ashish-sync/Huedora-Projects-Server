/**
 * QIE structured OCR / field extraction.
 * Rejects binary garbage, scores field confidence, and never invents a name match.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const BINARY_MARKERS = /\b(JFIF|Exif|IHDR|IDAT|IEND|PNG\r\n|%\PDF-|ftyp|RIFF|WEBP)\b/i;
const NOISE_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

const QUALIFICATION_RE = /\b((?:certified\s+)?(?:diabetes\s+)?educator|bachelor(?:\s+of\s+[a-z\s]+)?|master(?:\s+of\s+[a-z\s]+)?|diploma(?:\s+in\s+[a-z\s]+)?|certificate(?:\s+in\s+[a-z\s]+)?|b\.?\s?sc\.?(?:\s+[a-z\s]+)?|m\.?\s?sc\.?(?:\s+[a-z\s]+)?|mbbs|bds|b\.?\s?pharm|nursing|phd|doctorate|post\s*graduate(?:\s+diploma)?|pg\s*diploma)(?:\s+[A-Za-z][A-Za-z\s&/-]{0,60})?/i;

const INSTITUTION_RE = /\b([A-Z][A-Za-z0-9&.''\-\s]{2,70}(?:University|College|Institute|Board|Academy|Association|Council|Society|School|Centre|Center|Organisation|Organization))\b/;

const PROGRAMME_RE = /\b(?:programme|program|course|speciali[sz]ation|stream)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9\s&/-]{2,80})/i;

const CERT_NO_RE = /\b(?:reg(?:istration)?|roll|cert(?:ificate)?(?:\s*(?:no|number|#))?|ref(?:erence)?|credential)\s*(?:no\.?|number|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})\b/i;

const YEAR_RE = /\b((?:19|20)\d{2})\b/g;

const NAME_LABEL_RE = /\b(?:this\s+(?:is\s+)?to\s+certify\s+that|awarded\s+to|presented\s+to|name\s*[:\-]|candidate\s*[:\-]|student\s*[:\-])\s*([A-Z][A-Za-z.'\-\s]{2,60})/i;

export function printableRatio(text = '') {
  const raw = String(text || '');
  if (!raw.length) return 0;
  const printable = (raw.match(/[\x09\x0A\x0D\x20-\x7E]/g) || []).length;
  return printable / raw.length;
}

export function isLikelyBinaryGarbage(text = '') {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  if (BINARY_MARKERS.test(raw)) return true;
  if (printableRatio(raw) < 0.75) return true;
  const alnum = (raw.match(/[A-Za-z0-9]/g) || []).length;
  if (raw.length > 40 && alnum / raw.length < 0.35) return true;
  // Dense symbol soup common in JPEG/PNG misread as text
  const symbols = (raw.match(/[^\w\s.,:;/'()-]/g) || []).length;
  if (raw.length > 40 && symbols / raw.length > 0.25) return true;
  return false;
}

export function sanitizeOcrText(text = '') {
  let cleaned = String(text || '').replace(NOISE_RE, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (isLikelyBinaryGarbage(cleaned)) return '';
  return cleaned;
}

export function isReadableField(value = '', { minLen = 2 } = {}) {
  const text = String(value || '').trim();
  if (text.length < minLen) return false;
  if (isLikelyBinaryGarbage(text)) return false;
  const letters = (text.match(/[A-Za-z0-9]/g) || []).length;
  return letters / text.length >= 0.55;
}

function clipField(value = '', max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function yearFromFilename(originalName = '') {
  const name = String(originalName || '');
  // Prefer explicit award/year tokens; ignore WhatsApp-style capture dates as high confidence.
  const awardish = name.match(/\b(?:year|batch|class(?:\s+of)?|awarded|pass(?:ed)?)\D{0,8}((?:19|20)\d{2})\b/i);
  if (awardish) return { value: awardish[1], confidence: 0.7, source: 'filename_labeled' };
  const years = [...name.matchAll(YEAR_RE)].map((m) => m[1]);
  if (!years.length) return { value: '', confidence: 0, source: '' };
  // WhatsApp Image 2026-11-13… → low confidence date, not certificate year.
  if (/whatsapp|img[-_]|dsc|screenshot|image\s+\d{4}/i.test(name)) {
    return { value: years[0], confidence: 0.2, source: 'filename_capture_date' };
  }
  return { value: years[0], confidence: 0.45, source: 'filename_year' };
}

function extractPdfText(buf) {
  try {
    const latin = buf.toString('latin1');
    if (!/%PDF-/i.test(latin.slice(0, 16))) return '';
    const chunks = [];
    const re = /\((?:\\.|[^\\)]){2,200}\)/g;
    let match;
    while ((match = re.exec(latin)) && chunks.length < 400) {
      const inner = match[0]
        .slice(1, -1)
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/\\[0-7]{1,3}/g, ' ');
      if (isReadableField(inner, { minLen: 3 })) chunks.push(inner);
    }
    // Also harvest uncompressed TJ-like readable runs
    const streams = latin.match(/BT[\s\S]{0,4000}?ET/g) || [];
    for (const block of streams.slice(0, 40)) {
      const words = block.match(/[A-Za-z][A-Za-z0-9.'\-]{2,}/g) || [];
      if (words.length) chunks.push(words.join(' '));
    }
    return sanitizeOcrText(chunks.join(' '));
  } catch {
    return '';
  }
}

async function extractImageMetadataText(absPath) {
  try {
    const meta = await sharp(absPath).metadata();
    const parts = [
      meta?.exif ? Buffer.from(meta.exif).toString('utf8') : '',
      meta?.iptc ? Buffer.from(meta.iptc).toString('utf8') : '',
      meta?.xmp ? Buffer.from(meta.xmp).toString('utf8') : '',
      meta?.comments?.map((c) => c?.text || c).join(' ') || '',
    ];
    return sanitizeOcrText(parts.join(' '));
  } catch {
    return '';
  }
}

/**
 * Optional OCR via tesseract.js when installed. Soft-fails if unavailable.
 */
async function tryTesseractOcr(absPath) {
  try {
    const mod = await import('tesseract.js');
    const Tesseract = mod.default || mod;
    // Preprocess for contrast before OCR.
    const prepared = await sharp(absPath)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: false })
      .greyscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    const result = await Tesseract.recognize(prepared, 'eng', {
      logger: () => {},
    });
    const text = sanitizeOcrText(result?.data?.text || '');
    const conf = Number(result?.data?.confidence);
    return {
      text,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf / 100)) : (text ? 0.55 : 0),
      engine: 'tesseract.js',
    };
  } catch {
    return { text: '', confidence: 0, engine: '' };
  }
}

function scoreField(value, baseConfidence) {
  if (!isReadableField(value)) return { value: '', confidence: 0 };
  return { value: clipField(value), confidence: Math.max(0, Math.min(1, baseConfidence)) };
}

/**
 * Structured extraction from OCR/filename text with per-field confidence.
 */
export function extractCertificateFields(text = '', originalName = '', { ocrConfidence = 0 } = {}) {
  const fileName = String(originalName || '').trim();
  const cleanText = sanitizeOcrText(text);
  const issues = [];
  const blob = [cleanText, sanitizeOcrText(fileName.replace(/[_\-.]+/g, ' '))].filter(Boolean).join('\n');

  if (!cleanText && fileName) {
    issues.push({
      code: 'OCR_TEXT_UNAVAILABLE',
      severity: 'high',
      message: 'Readable certificate text could not be extracted from the file',
      recommendedAction: 'manual_review',
    });
  }
  if (text && !cleanText) {
    issues.push({
      code: 'OCR_CORRUPTED_OR_BINARY',
      severity: 'high',
      message: 'Extracted content looked like binary/image noise rather than certificate text',
      recommendedAction: 'request_higher_quality_scan',
    });
  }

  const qualMatch = cleanText.match(QUALIFICATION_RE) || blob.match(QUALIFICATION_RE);
  const instMatch = cleanText.match(INSTITUTION_RE) || blob.match(INSTITUTION_RE);
  const progMatch = cleanText.match(PROGRAMME_RE);
  const certMatch = cleanText.match(CERT_NO_RE);
  const nameMatch = cleanText.match(NAME_LABEL_RE);

  const qualification = scoreField(qualMatch?.[0] || '', qualMatch ? 0.55 + ocrConfidence * 0.35 : 0);
  const institution = scoreField(instMatch?.[1] || '', instMatch ? 0.55 + ocrConfidence * 0.35 : 0);
  const programme = scoreField(progMatch?.[1] || '', progMatch ? 0.5 + ocrConfidence * 0.3 : 0);
  const referenceNo = scoreField(certMatch?.[1] || '', certMatch ? 0.6 + ocrConfidence * 0.3 : 0);
  const holderName = scoreField(nameMatch?.[1] || '', nameMatch ? 0.55 + ocrConfidence * 0.35 : 0);

  // Award year: prefer in-document years near award wording; demote filename capture dates.
  let awardYear = { value: '', confidence: 0, source: '' };
  const textYears = [...cleanText.matchAll(YEAR_RE)].map((m) => m[1]);
  const labeledYear = cleanText.match(/\b(?:year|dated|awarded|issued|completed|passing)\D{0,12}((?:19|20)\d{2})\b/i);
  if (labeledYear) {
    awardYear = { value: labeledYear[1], confidence: 0.7 + ocrConfidence * 0.2, source: 'document_labeled' };
  } else if (textYears.length) {
    // Prefer years that are not "this year + far future" noise; keep first plausible academic year.
    const nowY = new Date().getFullYear();
    const plausible = textYears.find((y) => {
      const n = Number(y);
      return n >= 1970 && n <= nowY + 1;
    }) || textYears[0];
    awardYear = { value: plausible, confidence: 0.45 + ocrConfidence * 0.25, source: 'document_year' };
  } else {
    awardYear = yearFromFilename(fileName);
  }
  if (awardYear.value && !isReadableField(awardYear.value, { minLen: 4 })) {
    awardYear = { value: '', confidence: 0, source: '' };
  }

  // Contradictions / low confidence flags
  if (qualification.value && qualification.confidence < 0.45) {
    issues.push({
      code: 'LOW_CONFIDENCE_QUALIFICATION',
      severity: 'medium',
      message: 'Qualification text was extracted with low confidence',
      recommendedAction: 'manual_review',
    });
  }
  if (institution.value && institution.confidence < 0.45) {
    issues.push({
      code: 'LOW_CONFIDENCE_INSTITUTION',
      severity: 'medium',
      message: 'Institution text was extracted with low confidence',
      recommendedAction: 'manual_review',
    });
  }
  if (awardYear.source === 'filename_capture_date') {
    issues.push({
      code: 'AWARD_YEAR_FROM_CAPTURE_DATE',
      severity: 'medium',
      message: 'Award year was inferred from a photo/file capture date and may be wrong',
      recommendedAction: 'manual_review',
    });
  }
  if (!holderName.value) {
    issues.push({
      code: 'CANDIDATE_NAME_NOT_EXTRACTED',
      severity: 'high',
      message: 'Candidate name could not be read from the certificate',
      recommendedAction: 'manual_review',
    });
  }
  if (!qualification.value && !institution.value && !referenceNo.value) {
    issues.push({
      code: 'CORE_FIELDS_MISSING',
      severity: 'high',
      message: 'Core certificate fields (qualification, institution, certificate number) were not found',
      recommendedAction: 'manual_review',
    });
  }

  const fieldScores = [
    holderName.confidence,
    qualification.confidence,
    institution.confidence,
    programme.confidence,
    referenceNo.confidence,
    awardYear.confidence,
  ];
  const presentCount = [
    holderName.value,
    qualification.value,
    institution.value,
    programme.value,
    referenceNo.value,
    awardYear.value && awardYear.confidence >= 0.4 ? awardYear.value : '',
  ].filter(Boolean).length;

  let accuracyScore = Math.round(
    (fieldScores.reduce((a, b) => a + b, 0) / fieldScores.length) * 70
    + Math.min(30, presentCount * 5)
    + (cleanText.length > 40 ? 10 : 0)
    + ocrConfidence * 15,
  );
  if (!cleanText) accuracyScore = Math.min(accuracyScore, 25);
  if (issues.some((i) => i.code === 'OCR_CORRUPTED_OR_BINARY')) accuracyScore = Math.min(accuracyScore, 15);
  accuracyScore = Math.max(0, Math.min(100, accuracyScore));

  let qualityStatus = 'good';
  if (accuracyScore < 35 || issues.some((i) => i.severity === 'high')) qualityStatus = 'failed';
  else if (accuracyScore < 65 || issues.some((i) => i.severity === 'medium')) qualityStatus = 'degraded';

  const classification = qualification.value || /certificate|diploma|degree/i.test(cleanText || fileName)
    ? 'educational_certificate'
    : 'unknown_document';

  const urlMatch = cleanText.match(/https?:\/\/[^\s)]+/i);
  const qrOrVerifyCue = /\b(qr|verify|verification\s*url|scan\s*to\s*verify)\b/i.test(cleanText);

  return {
    holderName: holderName.value,
    institution: institution.value,
    qualification: qualification.value,
    programme: programme.value,
    awardYear: awardYear.confidence >= 0.35 ? awardYear.value : '',
    referenceNo: referenceNo.value,
    classification,
    verificationUrl: urlMatch ? urlMatch[0] : '',
    qrOrVerifyCue,
    rawTextSnippet: (cleanText || '').slice(0, 600),
    sourceFileName: fileName,
    fieldConfidence: {
      holderName: holderName.confidence,
      institution: institution.confidence,
      qualification: qualification.confidence,
      programme: programme.confidence,
      awardYear: awardYear.confidence,
      referenceNo: referenceNo.confidence,
    },
    fieldSources: {
      awardYear: awardYear.source || '',
    },
    extractionIssues: issues,
    extractionQuality: {
      status: qualityStatus,
      score: accuracyScore,
      readableText: Boolean(cleanText),
      presentFieldCount: presentCount,
    },
    ocrAccuracyScore: accuracyScore,
  };
}

/**
 * Full document text acquisition + structured extraction.
 */
export async function runDocumentExtraction(absPath, originalName = '') {
  const started = Date.now();
  const ext = path.extname(originalName || absPath || '').toLowerCase();
  let rawText = '';
  let engine = 'tylo-qie-extract-v3';
  let ocrConfidence = 0;
  const sources = [];

  if (!absPath || !fs.existsSync(absPath)) {
    const extracted = extractCertificateFields('', originalName, { ocrConfidence: 0 });
    extracted.extractionIssues.unshift({
      code: 'FILE_MISSING',
      severity: 'high',
      message: 'Stored file not found for text extraction',
      recommendedAction: 'reupload_document',
    });
    extracted.extractionQuality = { status: 'failed', score: 0, readableText: false, presentFieldCount: 0 };
    extracted.ocrAccuracyScore = 0;
    return {
      extracted,
      ocr: {
        accuracyScore: 0,
        engine,
        textLength: 0,
        confidence: 0,
        sources,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
    };
  }

  const buf = fs.readFileSync(absPath);

  if (ext === '.pdf' || buf.slice(0, 5).toString() === '%PDF-') {
    const pdfText = extractPdfText(buf);
    if (pdfText) {
      rawText = pdfText;
      sources.push('pdf_text');
      ocrConfidence = 0.7;
      engine = 'tylo-qie-pdf-text-v3';
    }
  }

  const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
  if (!rawText && (imageExts.has(ext) || !ext)) {
    const metaText = await extractImageMetadataText(absPath);
    if (metaText) {
      rawText = metaText;
      sources.push('image_metadata');
      ocrConfidence = Math.max(ocrConfidence, 0.25);
    }
    const tess = await tryTesseractOcr(absPath);
    if (tess.text) {
      rawText = [rawText, tess.text].filter(Boolean).join('\n');
      sources.push('tesseract');
      ocrConfidence = Math.max(ocrConfidence, tess.confidence || 0.55);
      engine = tess.engine || engine;
    } else if (!rawText) {
      sources.push('filename_only');
      ocrConfidence = 0.1;
      engine = 'tylo-qie-filename-fallback-v3';
    }
  }

  // Never fall back to raw binary decode as "OCR text".
  const extracted = extractCertificateFields(rawText, originalName, { ocrConfidence });
  return {
    extracted,
    ocr: {
      accuracyScore: extracted.ocrAccuracyScore,
      engine,
      textLength: (extracted.rawTextSnippet || '').length,
      confidence: ocrConfidence,
      sources,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    },
  };
}

export function namesLikelyMatch(a, b) {
  const normalize = (value = '') => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = (value = '') => normalize(value).split(' ').filter((t) => t.length > 1);
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t));
  const shorter = Math.min(ta.length, tb.length);
  return overlap.length >= Math.max(1, Math.ceil(shorter * 0.6));
}
