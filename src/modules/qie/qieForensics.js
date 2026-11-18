/**
 * QIE visual authenticity & forensic helpers (sharp-based).
 * Findings are evidence for human review — never sole grounds for fraud.
 *
 * Detection channels are independent:
 * - visual watermark (no provider claim)
 * - AI provider attribution (structured metadata only)
 * - SynthID (official verification only → NOT_CHECKED without it)
 * - AI-related metadata
 * - C2PA provenance presence vs claim verification
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

/** Explicit check outcomes — unsupported tech must use NOT_CHECKED, not NOT_DETECTED. */
export const QIE_CHECK = Object.freeze({
  DETECTED: 'DETECTED',
  NOT_DETECTED: 'NOT_DETECTED',
  NOT_CHECKED: 'NOT_CHECKED',
  NOT_ATTRIBUTED: 'NOT_ATTRIBUTED',
});

/**
 * Provider attribution patterns — applied ONLY to structured metadata corpora.
 * Never scan raw JPEG/PNG entropy. No bare "sd" / incidental binary tokens.
 */
const AI_PROVIDER_METADATA_MARKERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    patterns: [
      /\bgoogle\s*gemini\b/i,
      /\bcreated\s+with\s+google\s+gemini\b/i,
      /\bimagen\b/i,
      /\bbard\b/i,
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT / OpenAI',
    patterns: [
      /\bchatgpt\b/i,
      /\bopenai\b/i,
      /\bdall[-\s]?e\b/i,
    ],
  },
  {
    id: 'copilot',
    label: 'Microsoft Copilot',
    patterns: [/\bcopilot\b/i, /\bmicrosoft\s*designer\b/i],
  },
  {
    id: 'firefly',
    label: 'Adobe Firefly',
    patterns: [/\badobe\s*firefly\b/i, /\bfirefly\b/i],
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    patterns: [/\bmidjourney\b/i],
  },
  {
    id: 'stable_diffusion',
    label: 'Stable Diffusion',
    patterns: [
      /\bstable\s*diffusion\b/i,
      /\bstability\s*ai\b/i,
      /\bautomatic1111\b/i,
      /\bcomfyui\b/i,
    ],
  },
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

function bufferToUtfish(buf) {
  if (!buf) return '';
  try {
    return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  } catch {
    return '';
  }
}

function extractXmpPacket(raw = '') {
  const text = String(raw || '');
  const start = text.search(/<x:xmpmeta[\s>]/i);
  if (start < 0) return '';
  const end = text.indexOf('</x:xmpmeta>', start);
  if (end < 0) return text.slice(start, start + 50_000);
  return text.slice(start, end + '</x:xmpmeta>'.length);
}

/**
 * Build a structured metadata corpus from EXIF / IPTC / XMP / comments only.
 * Deliberately excludes raw image entropy / incidental JPEG ASCII runs.
 */
export function extractStructuredMetadataCorpus(absPath, meta = {}) {
  const parts = [];
  const sources = [];

  if (meta?.exif) {
    parts.push(bufferToUtfish(meta.exif));
    sources.push('exif');
  }
  if (meta?.iptc) {
    parts.push(bufferToUtfish(meta.iptc));
    sources.push('iptc');
  }
  if (meta?.xmp) {
    parts.push(bufferToUtfish(meta.xmp));
    sources.push('xmp');
  }
  if (Array.isArray(meta?.comments) && meta.comments.length) {
    parts.push(meta.comments.map((c) => c?.text || c).join('\n'));
    sources.push('comments');
  }

  // Pull XMP packet from file header/trailer without treating full binary as text.
  try {
    const buf = fs.readFileSync(absPath);
    const latin = buf.toString('latin1');
    const xmp = extractXmpPacket(latin);
    if (xmp) {
      parts.push(xmp);
      if (!sources.includes('xmp')) sources.push('xmp');
    }
    // C2PA JUMBF marker presence is handled separately; do not dump entropy here.
  } catch {
    // ignore
  }

  // sharp metadata JSON keys that are human labels (not pixel buffers)
  const safeMeta = {
    format: meta.format,
    space: meta.space,
    density: meta.density,
    hasProfile: meta.hasProfile,
    orientation: meta.orientation,
  };
  parts.push(JSON.stringify(safeMeta));

  const corpus = parts.join('\n').replace(/\u0000/g, ' ');
  return { corpus, sources };
}

function checkChannel({ status, confidence = null, providers = [], evidence = {}, note = '' }) {
  return {
    status,
    confidence,
    providers,
    evidence,
    note,
  };
}

/**
 * Metadata / provider attribution — structured metadata only.
 * Kept export name for compatibility; no longer scans JPEG entropy.
 */
export function detectAiToolMarkersFromBytes(absPath, meta = {}) {
  const { findings } = classifyAiMetadataAndProviders(absPath, meta);
  return findings;
}

/**
 * Independent AI-metadata + provider attribution from structured corpora.
 */
export function classifyAiMetadataAndProviders(absPath, meta = {}) {
  const findings = [];
  const { corpus, sources } = extractStructuredMetadataCorpus(absPath, meta);
  const attributed = [];

  for (const tool of AI_PROVIDER_METADATA_MARKERS) {
    const matched = tool.patterns.find((re) => re.test(corpus));
    if (!matched) continue;
    attributed.push({ id: tool.id, label: tool.label, pattern: String(matched) });
    findings.push(finding({
      code: 'AI_PROVIDER_METADATA',
      category: 'ai_metadata',
      severity: 'medium',
      confidence: 0.84,
      message: `Structured metadata references ${tool.label}. Provider attribution is based on metadata text only — not a visual watermark identity.`,
      location: { region: 'structured_metadata' },
      evidence: {
        toolId: tool.id,
        toolLabel: tool.label,
        source: 'structured_metadata',
        metadataSources: sources,
      },
      recommendedAction: 'manual_verify_ai_origin',
    }));
  }

  const editorHints = [
    { re: /\badobe\s*photoshop\b/i, label: 'Photoshop' },
    { re: /\bgimp\b/i, label: 'GIMP' },
    { re: /\bcanva\b/i, label: 'Canva' },
    { re: /\baffinity\s*photo\b/i, label: 'Affinity' },
  ];
  for (const hint of editorHints) {
    if (hint.re.test(corpus)) {
      findings.push(finding({
        code: 'IMAGE_EDITOR_TRACE',
        category: 'manipulation',
        severity: 'low',
        confidence: 0.55,
        message: `Editor trace mentioning ${hint.label} found in structured metadata`,
        location: { region: 'structured_metadata' },
        evidence: { editor: hint.label, metadataSources: sources },
        recommendedAction: 'review_edit_history',
      }));
    }
  }

  const providerAttribution = attributed.length
    ? checkChannel({
      status: QIE_CHECK.DETECTED,
      confidence: 0.84,
      providers: attributed.map((a) => a.id),
      evidence: { attributed, metadataSources: sources },
      note: 'Provider names found in structured metadata only',
    })
    : checkChannel({
      status: QIE_CHECK.NOT_ATTRIBUTED,
      confidence: null,
      providers: [],
      evidence: { metadataSources: sources },
      note: 'No explicit AI provider attribution in structured metadata',
    });

  const aiRelatedMetadata = attributed.length || findings.some((f) => f.code === 'IMAGE_EDITOR_TRACE')
    ? checkChannel({
      status: QIE_CHECK.DETECTED,
      confidence: attributed.length ? 0.84 : 0.55,
      providers: attributed.map((a) => a.id),
      evidence: { metadataSources: sources },
      note: 'AI-related or editor metadata strings were present',
    })
    : checkChannel({
      status: sources.length ? QIE_CHECK.NOT_DETECTED : QIE_CHECK.NOT_CHECKED,
      confidence: sources.length ? 0.7 : null,
      evidence: { metadataSources: sources },
      note: sources.length
        ? 'Structured metadata inspected; no AI-related strings found'
        : 'No structured metadata available to inspect',
    });

  return { findings, providerAttribution, aiRelatedMetadata, metadataSources: sources };
}

/**
 * C2PA: detect manifest container presence only.
 * Cryptographic claim verification is NOT_CHECKED without an official verifier.
 */
export function classifyC2paProvenance(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    const latin = buf.toString('latin1');
    const head = latin.slice(0, Math.min(latin.length, 512_000));
    // Require stronger provenance markers than a bare 4-letter token in JPEG entropy.
    const hasJumbf = /jumb/i.test(head) && (/c2pa/i.test(head) || /c2ma/i.test(head) || /c2cl/i.test(head));
    const hasC2paXmp = /c2pa\.(claim|assertion|manifest)/i.test(head);
    if (hasJumbf || hasC2paXmp) {
      return {
        presence: checkChannel({
          status: QIE_CHECK.DETECTED,
          confidence: 0.7,
          evidence: { marker: 'c2pa_or_jumbf' },
          note: 'C2PA/JUMBF-like container marker found',
        }),
        verification: checkChannel({
          status: QIE_CHECK.NOT_CHECKED,
          note: 'C2PA claim verification requires an official C2PA verifier (not available in this engine)',
        }),
        findings: [finding({
          code: 'C2PA_MANIFEST_PRESENT',
          category: 'provenance',
          severity: 'low',
          confidence: 0.7,
          message: 'A C2PA/JUMBF-like provenance container appears present. Claim verification was not performed.',
          location: { region: 'provenance' },
          evidence: { verification: QIE_CHECK.NOT_CHECKED },
          recommendedAction: 'manual_review',
        })],
      };
    }
    return {
      presence: checkChannel({
        status: QIE_CHECK.NOT_DETECTED,
        confidence: 0.65,
        note: 'No C2PA/JUMBF container marker found',
      }),
      verification: checkChannel({
        status: QIE_CHECK.NOT_CHECKED,
        note: 'C2PA claim verification requires an official C2PA verifier (not available in this engine)',
      }),
      findings: [],
    };
  } catch {
    return {
      presence: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'Could not read file for C2PA scan' }),
      verification: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'C2PA verifier not available' }),
      findings: [],
    };
  }
}

/** SynthID requires Google's official verification technology — never invent a result. */
export function classifySynthId() {
  return checkChannel({
    status: QIE_CHECK.NOT_CHECKED,
    confidence: null,
    note: 'SynthID verification is not performed — official Google SynthID verification technology is not integrated',
  });
}

/**
 * Detect a faint multi-point sparkle pattern in the bottom-right corner.
 * Visual detection only — does NOT attribute a provider (Gemini/etc.).
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
      code: 'VISUAL_WATERMARK_SPARKLE',
      category: 'visual_watermark',
      severity: 'medium',
      confidence: Math.min(0.9, 0.55 + sparkleCount * 0.08),
      message:
        'Faint multi-point sparkle pattern detected in the bottom-right corner. This is a visual watermark indicator only — provider identity is not attributed from this pattern alone. Manual verification required.',
      location: {
        region: 'bottom_right_corner',
        bboxNorm,
      },
      evidence: {
        providerAttribution: QIE_CHECK.NOT_ATTRIBUTED,
        visualOnly: true,
        resemblesKnownStyles: ['gemini_style_sparkle'],
        peakCount: sparkleCount,
        regionAverage: Math.round(avg),
        peakThreshold: Math.round(peakThreshold),
        peakContrast: Math.round(peakContrast),
        peaks: merged.slice(0, 6).map((p) => ({
          xNorm: +(p.x / w).toFixed(4),
          yNorm: +(p.y / h).toFixed(4),
          luminance: p.v,
        })),
        // Backward-compatible alias for older report consumers.
        legacyCode: 'AI_TOOL_WATERMARK_SPARKLE',
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

function isAiIndicatorFinding(f) {
  return f.code === 'VISUAL_WATERMARK_SPARKLE'
    || f.code === 'AI_PROVIDER_METADATA'
    || f.code === 'AI_TOOL_WATERMARK_SPARKLE'
    || f.code === 'AI_TOOL_WATERMARK_TEXT'
    || f.category === 'visual_watermark'
    || f.category === 'ai_metadata'
    || f.category === 'ai_generation';
}

/**
 * Full forensic pass with separated detection channels.
 * AI watermark / metadata alone must NOT force a fraudulent verdict.
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
      channels: {
        visualWatermark: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'File missing' }),
        providerAttribution: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'File missing' }),
        synthId: classifySynthId(),
        aiRelatedMetadata: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'File missing' }),
        c2paPresence: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'File missing' }),
        c2paVerification: checkChannel({ status: QIE_CHECK.NOT_CHECKED, note: 'C2PA verifier not available' }),
      },
    };
  }

  try {
    meta = await sharp(absPath).metadata();
    width = meta.width || 0;
    height = meta.height || 0;
  } catch {
    meta = {};
  }

  const metaClass = classifyAiMetadataAndProviders(absPath, meta);
  findings.push(...metaClass.findings);

  const c2pa = classifyC2paProvenance(absPath);
  findings.push(...c2pa.findings);

  const synthId = classifySynthId();

  let visualWatermark = checkChannel({
    status: QIE_CHECK.NOT_DETECTED,
    confidence: 0.6,
    note: 'No visual watermark pattern detected in scanned regions',
  });

  const raster = await loadRasterBuffer(absPath);
  if (raster) {
    try {
      const sparkleFindings = await detectCornerSparkleWatermark(raster);
      findings.push(...sparkleFindings);
      if (sparkleFindings.length) {
        visualWatermark = checkChannel({
          status: QIE_CHECK.DETECTED,
          confidence: sparkleFindings[0].confidence,
          providers: [],
          evidence: {
            codes: sparkleFindings.map((f) => f.code),
            providerAttribution: QIE_CHECK.NOT_ATTRIBUTED,
          },
          note: 'Visual watermark pattern detected without provider attribution',
        });
      }
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
      visualWatermark = checkChannel({
        status: QIE_CHECK.NOT_CHECKED,
        note: `Visual watermark scan incomplete: ${err?.message || 'error'}`,
      });
    }
  } else {
    findings.push(finding({
      code: 'RASTERIZATION_UNAVAILABLE',
      category: 'integrity',
      severity: 'low',
      confidence: 0.45,
      message: 'Could not rasterize document for full visual inspection; structured metadata checks only',
      recommendedAction: 'manual_visual_review',
    }));
    visualWatermark = checkChannel({
      status: QIE_CHECK.NOT_CHECKED,
      note: 'Rasterization unavailable — visual watermark not checked',
    });
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

  // Authenticity score: 100 minus weighted severities; AI indicators capped (never fraud alone).
  let penalty = 0;
  let aiWatermarkOnly = true;
  for (const f of findings) {
    const isAiMark = isAiIndicatorFinding(f);
    if (!isAiMark && f.severity !== 'low') aiWatermarkOnly = false;
    const weight = f.severity === 'high' ? 28 : f.severity === 'medium' ? 14 : 6;
    const capped = isAiMark ? Math.min(weight, 12) : weight;
    penalty += capped * (f.confidence || 0.5);
  }
  const authenticityScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const channels = {
    visualWatermark,
    providerAttribution: metaClass.providerAttribution,
    synthId,
    aiRelatedMetadata: metaClass.aiRelatedMetadata,
    c2paPresence: c2pa.presence,
    c2paVerification: c2pa.verification,
    detectionConfidence: {
      visual: visualWatermark.confidence,
      provider: metaClass.providerAttribution.confidence,
      metadata: metaClass.aiRelatedMetadata.confidence,
    },
  };

  return {
    engine: 'tylo-qie-forensics-v2',
    durationMs: Date.now() - started,
    width,
    height,
    findings,
    previewRegions,
    authenticityScore,
    aiWatermarkOnly: aiWatermarkOnly && findings.some((f) => isAiIndicatorFinding(f)),
    channels,
    meta: {
      format: meta.format || '',
      space: meta.space || '',
      hasAlpha: Boolean(meta.hasAlpha),
      density: meta.density || null,
      metadataSources: metaClass.metadataSources || [],
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
    && findings.every((f) => isAiIndicatorFinding(f) || f.severity === 'low' || f.category === 'extraction');
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
