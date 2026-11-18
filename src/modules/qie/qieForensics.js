/**
 * QIE visual authenticity & forensic helpers (sharp-based).
 * Findings are evidence for human review — never sole grounds for fraud.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export const QIE_ASSESSMENT = Object.freeze({
  LOW_RISK: 'low_risk',
  REVIEW_REQUIRED: 'review_required',
  HIGH_RISK: 'high_risk',
  VERIFIED: 'verified',
});

const AI_TOOL_MARKERS = [
  { id: 'gemini', label: 'Google Gemini', patterns: [/gemini/i, /google\s*ai/i, /bard/i] },
  { id: 'chatgpt', label: 'ChatGPT / OpenAI', patterns: [/chatgpt/i, /openai/i, /dall[-\s]?e/i] },
  { id: 'copilot', label: 'Microsoft Copilot', patterns: [/copilot/i, /microsoft\s*designer/i] },
  { id: 'firefly', label: 'Adobe Firefly', patterns: [/firefly/i, /adobe\s*firefly/i] },
  { id: 'midjourney', label: 'Midjourney', patterns: [/midjourney/i] },
  // Avoid bare /\bsd\b/ — it false-positives inside JPEG/PNG binary noise.
  { id: 'stable_diffusion', label: 'Stable Diffusion', patterns: [/stable\s*diffusion/i, /\bsd[-_\s]?xl\b/i] },
];

function finding({
  code,
  category,
  severity = 'medium',
  confidence = 0.5,
  message,
  location = {},
  evidence = {},
  recommendedAction = 'manual_review',
}) {
  return {
    code,
    category,
    severity,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    message,
    location: {
      page: location.page || 1,
      region: location.region || 'document',
      bboxNorm: location.bboxNorm || null,
    },
    evidence,
    recommendedAction,
  };
}

function readBinarySnippet(absPath, maxBytes = 256_000) {
  try {
    const buf = fs.readFileSync(absPath);
    return buf.subarray(0, Math.min(buf.length, maxBytes)).toString('latin1');
  } catch {
    return '';
  }
}

/**
 * Extract readable ASCII/UTF-ish runs from binary so marker scans do not
 * false-positive on random JPEG entropy (e.g. bare "sd" bytes).
 */
function readableAsciiRuns(raw = '', minLen = 4) {
  const runs = String(raw || '').match(/[\x20-\x7E]{4,}/g) || [];
  return runs.filter((run) => run.length >= minLen).join('\n');
}

/** Scan metadata / readable embedded strings for AI tool watermarks and editor traces. */
export function detectAiToolMarkersFromBytes(absPath, meta = {}) {
  const findings = [];
  const readable = [
    readableAsciiRuns(readBinarySnippet(absPath)),
    JSON.stringify(meta || {}),
  ].join('\n');

  for (const tool of AI_TOOL_MARKERS) {
    if (tool.patterns.some((re) => re.test(readable))) {
      findings.push(finding({
        code: 'AI_TOOL_WATERMARK_TEXT',
        category: 'ai_generation',
        severity: 'medium',
        confidence: 0.72,
        message: `Possible ${tool.label} watermark / generator marker detected in document metadata or embedded text`,
        location: { region: 'metadata_or_embedded_text' },
        evidence: { toolId: tool.id, toolLabel: tool.label, source: 'readable_byte_scan' },
        recommendedAction: 'manual_verify_ai_origin',
      }));
    }
  }

  const editorHints = [
    { re: /photoshop/i, label: 'Photoshop' },
    { re: /\bgimp\b/i, label: 'GIMP' },
    { re: /\bcanva\b/i, label: 'Canva' },
    { re: /affinity\s*photo/i, label: 'Affinity' },
  ];
  for (const hint of editorHints) {
    if (hint.re.test(readable)) {
      findings.push(finding({
        code: 'IMAGE_EDITOR_TRACE',
        category: 'manipulation',
        severity: 'low',
        confidence: 0.55,
        message: `Editor trace mentioning ${hint.label} found in embedded metadata/text`,
        location: { region: 'metadata' },
        evidence: { editor: hint.label },
        recommendedAction: 'review_edit_history',
      }));
    }
  }

  return findings;
}

/**
 * Detect a faint multi-point "sparkle" (Gemini-like) in the bottom-right corner.
 * Looks for 3–5 bright local peaks on a relatively dark local background.
 */
export async function detectCornerSparkleWatermark(imageBuffer) {
  const findings = [];
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (w < 40 || h < 40) return findings;

  // Bottom-right 18% × 18% window (where Gemini sparkles commonly sit).
  const x0 = Math.floor(w * 0.82);
  const y0 = Math.floor(h * 0.82);
  const regionW = w - x0;
  const regionH = h - y0;

  const luminances = [];
  for (let y = y0; y < h; y += 1) {
    for (let x = x0; x < w; x += 1) {
      luminances.push(data[y * w + x]);
    }
  }
  if (!luminances.length) return findings;

  const avg = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const sorted = [...luminances].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const maxLuma = sorted[sorted.length - 1] || 0;
  // Sparse watermarks barely move p90; use peak-vs-background contrast instead.
  const peakThreshold = Math.max(avg + 40, p90 + 30, 90);

  // Pixel-level local maxima in the corner (sparkles are only a few px wide).
  const nmsRadius = 4;
  const mergeDistance = 10;
  const peaks = [];
  for (let y = y0 + nmsRadius; y < h - nmsRadius; y += 1) {
    for (let x = x0 + nmsRadius; x < w - nmsRadius; x += 1) {
      const v = data[y * w + x];
      if (v < peakThreshold) continue;
      let isPeak = true;
      for (let dy = -nmsRadius; dy <= nmsRadius && isPeak; dy += 1) {
        for (let dx = -nmsRadius; dx <= nmsRadius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (data[(y + dy) * w + (x + dx)] > v) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ x, y, v });
    }
  }

  // Merge nearby peaks into distinct sparkle points.
  const merged = [];
  for (const peak of peaks.sort((a, b) => b.v - a.v)) {
    if (merged.some((m) => Math.hypot(m.x - peak.x, m.y - peak.y) < mergeDistance)) continue;
    merged.push(peak);
  }

  const sparkleCount = merged.length;
  const peakContrast = maxLuma - avg;
  const sparseSparkleCue = p99 - avg >= 25 || peakContrast >= 80;
  if (sparkleCount >= 3 && sparkleCount <= 6 && sparseSparkleCue) {
    const bboxNorm = {
      x: +(x0 / w).toFixed(4),
      y: +(y0 / h).toFixed(4),
      w: +(regionW / w).toFixed(4),
      h: +(regionH / h).toFixed(4),
    };
    findings.push(finding({
      code: 'AI_TOOL_WATERMARK_SPARKLE',
      category: 'ai_generation',
      severity: 'medium',
      confidence: Math.min(0.92, 0.55 + sparkleCount * 0.08),
      message:
        'Faint multi-point sparkle pattern detected in the bottom-right corner (resembles Google Gemini watermark). Requires manual verification.',
      location: {
        region: 'bottom_right_corner',
        bboxNorm,
      },
      evidence: {
        toolHint: 'Google Gemini',
        peakCount: sparkleCount,
        regionAverage: Math.round(avg),
        peakThreshold: Math.round(peakThreshold),
        peakContrast: Math.round(peakContrast),
        peaks: merged.slice(0, 6).map((p) => ({
          xNorm: +(p.x / w).toFixed(4),
          yNorm: +(p.y / h).toFixed(4),
          luminance: p.v,
        })),
      },
      recommendedAction: 'manual_verify_ai_watermark',
    }));
  }

  return findings;
}

/** Simple ELA-style recompression residual energy for copy-paste / edit hotspots. */
export async function detectCompressionAnomalies(imageBuffer) {
  const findings = [];
  const base = sharp(imageBuffer).rotate().resize({ width: 900, withoutEnlargement: true });
  const { data: original, info } = await base.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  const recompressed = await sharp(imageBuffer)
    .rotate()
    .resize({ width: info.width, height: info.height, fit: 'fill' })
    .jpeg({ quality: 75 })
    .greyscale()
    .raw()
    .toBuffer();

  const w = info.width;
  const h = info.height;
  const block = 32;
  let hotBlocks = 0;
  let maxEnergy = 0;
  let hotBBox = null;

  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      let energy = 0;
      let count = 0;
      for (let y = by; y < Math.min(h, by + block); y += 1) {
        for (let x = bx; x < Math.min(w, bx + block); x += 1) {
          const i = y * w + x;
          const d = Math.abs(original[i] - recompressed[i]);
          energy += d * d;
          count += 1;
        }
      }
      const mean = count ? energy / count : 0;
      if (mean > maxEnergy) {
        maxEnergy = mean;
        hotBBox = {
          x: +(bx / w).toFixed(4),
          y: +(by / h).toFixed(4),
          w: +(Math.min(block, w - bx) / w).toFixed(4),
          h: +(Math.min(block, h - by) / h).toFixed(4),
        };
      }
      if (mean > 180) hotBlocks += 1;
    }
  }

  if (hotBlocks >= 3) {
    findings.push(finding({
      code: 'COMPRESSION_INCONSISTENCY',
      category: 'manipulation',
      severity: hotBlocks >= 8 ? 'high' : 'medium',
      confidence: Math.min(0.9, 0.45 + hotBlocks * 0.04),
      message: 'Localized compression inconsistencies suggest possible image editing or compositing',
      location: { region: 'image_blocks', bboxNorm: hotBBox },
      evidence: { hotBlocks, maxResidualEnergy: Math.round(maxEnergy) },
      recommendedAction: 'inspect_highlighted_regions',
    }));
  }

  return findings;
}

export async function inspectMarginsAndBackground(imageBuffer) {
  const findings = [];
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .resize({ width: 640, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const band = Math.max(4, Math.floor(Math.min(w, h) * 0.04));

  function bandStats(predicate) {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!predicate(x, y)) continue;
        sum += data[y * w + x];
        n += 1;
      }
    }
    return n ? sum / n : 0;
  }

  const margins = {
    top: bandStats((x, y) => y < band),
    bottom: bandStats((x, y) => y >= h - band),
    left: bandStats((x, y) => x < band),
    right: bandStats((x, y) => x >= w - band),
  };
  const values = Object.values(margins);
  const spread = Math.max(...values) - Math.min(...values);
  if (spread > 55) {
    findings.push(finding({
      code: 'MARGIN_BACKGROUND_INCONSISTENCY',
      category: 'layout',
      severity: 'low',
      confidence: 0.5,
      message: 'Corner/margin backgrounds differ significantly — possible crop, pad, or pasted border',
      location: { region: 'margins' },
      evidence: { margins: Object.fromEntries(Object.entries(margins).map(([k, v]) => [k, Math.round(v)])), spread: Math.round(spread) },
      recommendedAction: 'review_document_edges',
    }));
  }
  return findings;
}

async function loadRasterBuffer(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const input = fs.readFileSync(absPath);
  if (['.pdf'].includes(ext)) {
    // pdf-lib/pdfkit cannot rasterize; attempt sharp (works for some single-image PDFs).
    try {
      return await sharp(input, { density: 150 }).png().toBuffer();
    } catch {
      return null;
    }
  }
  try {
    return await sharp(input).rotate().png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * Full forensic pass. Returns structured findings + scores.
 * AI watermark alone must NOT force a fraudulent/high-risk-only verdict.
 */
export async function runVisualForensics(absPath) {
  const started = Date.now();
  const findings = [];
  let meta = {};
  let width = 0;
  let height = 0;

  if (!absPath || !fs.existsSync(absPath)) {
    return {
      engine: 'tylo-qie-forensics-v2',
      durationMs: Date.now() - started,
      findings: [finding({
        code: 'FILE_MISSING',
        category: 'integrity',
        severity: 'high',
        confidence: 1,
        message: 'Stored file not found for forensic analysis',
        recommendedAction: 'reupload_document',
      })],
      previewRegions: [],
      authenticityScore: 0,
    };
  }

  try {
    meta = await sharp(absPath).metadata();
    width = meta.width || 0;
    height = meta.height || 0;
  } catch {
    meta = {};
  }

  findings.push(...detectAiToolMarkersFromBytes(absPath, meta));

  const raster = await loadRasterBuffer(absPath);
  if (raster) {
    try {
      findings.push(...await detectCornerSparkleWatermark(raster));
      findings.push(...await detectCompressionAnomalies(raster));
      findings.push(...await inspectMarginsAndBackground(raster));
    } catch (err) {
      findings.push(finding({
        code: 'VISUAL_PIPELINE_ERROR',
        category: 'integrity',
        severity: 'low',
        confidence: 0.4,
        message: `Visual inspection partially failed: ${err?.message || 'unknown error'}`,
        recommendedAction: 'manual_review',
      }));
    }
  } else {
    findings.push(finding({
      code: 'RASTERIZATION_UNAVAILABLE',
      category: 'integrity',
      severity: 'low',
      confidence: 0.45,
      message: 'Could not rasterize document for full visual inspection; byte/metadata checks only',
      recommendedAction: 'manual_visual_review',
    }));
  }

  // Soft size / resolution cues
  const stat = fs.statSync(absPath);
  if (stat.size < 800) {
    findings.push(finding({
      code: 'FILE_TOO_SMALL',
      category: 'integrity',
      severity: 'high',
      confidence: 0.85,
      message: 'File unusually small for a certificate image/PDF',
      recommendedAction: 'request_higher_quality_scan',
    }));
  }
  if (width && height && (width < 400 || height < 400)) {
    findings.push(finding({
      code: 'LOW_RESOLUTION',
      category: 'quality',
      severity: 'medium',
      confidence: 0.7,
      message: 'Low-resolution image may hide seals, signatures, or watermarks',
      location: { region: 'full_page' },
      evidence: { width, height },
      recommendedAction: 'request_higher_resolution',
    }));
  }

  const previewRegions = findings
    .filter((f) => f.location?.bboxNorm)
    .map((f) => ({
      code: f.code,
      severity: f.severity,
      bboxNorm: f.location.bboxNorm,
      label: f.message,
    }));

  // Authenticity score: 100 minus weighted severities; AI watermark capped impact.
  let penalty = 0;
  let aiWatermarkOnly = true;
  for (const f of findings) {
    const isAiMark = f.code.startsWith('AI_TOOL_WATERMARK');
    if (!isAiMark && f.severity !== 'low') aiWatermarkOnly = false;
    const weight = f.severity === 'high' ? 28 : f.severity === 'medium' ? 14 : 6;
    const capped = isAiMark ? Math.min(weight, 12) : weight;
    penalty += capped * (f.confidence || 0.5);
  }
  const authenticityScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    engine: 'tylo-qie-forensics-v2',
    durationMs: Date.now() - started,
    width,
    height,
    findings,
    previewRegions,
    authenticityScore,
    aiWatermarkOnly: aiWatermarkOnly && findings.some((f) => f.code.startsWith('AI_TOOL_WATERMARK')),
    meta: {
      format: meta.format || '',
      space: meta.space || '',
      hasAlpha: Boolean(meta.hasAlpha),
      density: meta.density || null,
    },
  };
}

/**
 * Map extraction + independent verification signals to assessment outcomes.
 * Verified requires authoritative confirmation (never from forensic score alone).
 * AI watermark / forensic suspicion alone => review_required (never fraud solely on that).
 * Failed OCR / inconclusive identity => review_required (not automatic high-risk fraud).
 */
export function deriveAssessmentOutcome({
  authenticityScore = 100,
  findings = [],
  credentialPassed = false,
  authoritativeVerified = false,
  extractionQuality = null,
  identityStatus = '',
  authenticityStatus = '',
} = {}) {
  if (authoritativeVerified && credentialPassed) return QIE_ASSESSMENT.VERIFIED;

  const qualityStatus = String(extractionQuality?.status || '');
  const forensicHigh = findings.filter((f) => f.severity === 'high' && f.category !== 'extraction').length;
  const extractionHigh = findings.filter((f) => f.category === 'extraction' && f.severity === 'high').length;
  const forensicMedium = findings.filter((f) => f.severity === 'medium' && f.category !== 'extraction').length;
  const aiOnly = findings.length > 0
    && findings.every((f) => f.code.startsWith('AI_TOOL_WATERMARK') || f.severity === 'low' || f.category === 'extraction');
  const resolvedAuthenticityStatus = authenticityStatus
    || (forensicHigh || forensicMedium ? 'review' : 'clear');

  // High risk only with converging serious signals — never AI watermark alone.
  if (
    (identityStatus === 'mismatch' && (forensicHigh >= 1 || qualityStatus === 'failed'))
    || forensicHigh >= 2
    || (resolvedAuthenticityStatus === 'concerns' && authenticityScore < 45 && qualityStatus === 'failed')
  ) {
    return QIE_ASSESSMENT.HIGH_RISK;
  }

  // Extraction / identity / AI watermark / medium forensic → human review.
  if (
    !credentialPassed
    || aiOnly
    || qualityStatus === 'failed'
    || qualityStatus === 'degraded'
    || identityStatus === 'inconclusive'
    || identityStatus === 'mismatch'
    || resolvedAuthenticityStatus === 'review'
    || resolvedAuthenticityStatus === 'concerns'
    || forensicMedium >= 1
    || extractionHigh >= 1
    || authenticityScore < 75
  ) {
    return QIE_ASSESSMENT.REVIEW_REQUIRED;
  }

  if (credentialPassed && resolvedAuthenticityStatus === 'clear' && forensicHigh === 0 && authenticityScore >= 75) {
    return QIE_ASSESSMENT.LOW_RISK;
  }

  return QIE_ASSESSMENT.REVIEW_REQUIRED;
}
