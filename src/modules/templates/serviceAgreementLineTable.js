/**
 * Canonical Service Agreement “Asset Issued” line-item columns.
 * Older templates used Asset Name / Model / Serial No. / Issue Date / Remarks,
 * then Display Name / Per Camp Amt / Round Trip covered / Remarks.
 */

export const SERVICE_AGREEMENT_LINE_COLUMNS = [
  { inner: 'Device Name', label: 'Device Name' },
  { inner: 'Serial Number', label: 'Serial Number' },
  { inner: 'Per Camp (INR)', label: 'Per Camp (INR)' },
  { inner: 'Distance Covered (Km)', label: 'Distance Covered (Km)' },
  { inner: 'Additional Remarks', label: 'Additional Remarks' },
];

/** Map detected header / token labels to the canonical column text. */
export const LINE_COLUMN_LABEL_ALIASES = {
  'display name': 'Device Name',
  'device name': 'Device Name',
  'asset name': 'Device Name',
  'serial no': 'Serial Number',
  'serial no.': 'Serial Number',
  'serial number': 'Serial Number',
  'per camp amt': 'Per Camp (INR)',
  'per camp (inr)': 'Per Camp (INR)',
  'per camp inr': 'Per Camp (INR)',
  'round trip covered': 'Distance Covered (Km)',
  'kms covered': 'Distance Covered (Km)',
  'distance covered (km)': 'Distance Covered (Km)',
  'distance covered': 'Distance Covered (Km)',
  'issue date': 'Distance Covered (Km)',
  remarks: 'Additional Remarks',
  'additional remarks': 'Additional Remarks',
};

const TOKEN_REWRITE_PAIRS = [
  ['[Display Name]', '[Device Name]'],
  ['[Asset Name]', '[Device Name]'],
  ['[Serial No.]', '[Serial Number]'],
  ['[Per Camp Amt]', '[Per Camp (INR)]'],
  ['[Round Trip covered]', '[Distance Covered (Km)]'],
  ['[Round Trip Covered]', '[Distance Covered (Km)]'],
  ['[Kms Covered]', '[Distance Covered (Km)]'],
  ['[Remarks]', '[Additional Remarks]'],
];

/** Legacy 5-col table: Asset Name | Model | Serial Number | Issue Date | Remarks
 * Use placeholders so Model→Serial Number does not cascade into Serial Number→Per Camp.
 */
const LEGACY_HEADER_REWRITE_PAIRS = [
  ['Asset Name', 'Device Name'],
  ['Model', '\u0000SERIAL_PLACEHOLDER\u0000'],
  ['Serial Number', 'Per Camp (INR)'],
  ['\u0000SERIAL_PLACEHOLDER\u0000', 'Serial Number'],
  ['Issue Date', 'Distance Covered (Km)'],
  ['Remarks', 'Additional Remarks'],
];

const LEGACY_TOKEN_REWRITE_PAIRS = [
  ['[Asset Name]', '[Device Name]'],
  ['[Model]', '\u0000SERIAL_TOKEN_PLACEHOLDER\u0000'],
  ['[Serial No.]', '[Per Camp (INR)]'],
  ['\u0000SERIAL_TOKEN_PLACEHOLDER\u0000', '[Serial Number]'],
  ['[Issue Date]', '[Distance Covered (Km)]'],
  ['[Remarks]', '[Additional Remarks]'],
];

const HEADER_REWRITE_PAIRS = [
  ['Display Name', 'Device Name'],
  ['Asset Name', 'Device Name'],
  ['Per Camp Amt', 'Per Camp (INR)'],
  ['Round Trip covered', 'Distance Covered (Km)'],
  ['Round Trip Covered', 'Distance Covered (Km)'],
  ['Kms Covered', 'Distance Covered (Km)'],
  ['Serial No.', 'Serial Number'],
  ['Model', 'Serial Number'],
];

function tablePlain(xml = '') {
  return String(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:t[^>]*>/g, '')
    .replace(/<\/w:t>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .toLowerCase();
}

export function isLegacyServiceAgreementLineTable(plain = '') {
  const p = String(plain).toLowerCase();
  return p.includes('[asset name]') && p.includes('[model]') && p.includes('[issue date]');
}

export function isServiceAgreementAssetLineTable(plain = '') {
  const p = String(plain).toLowerCase();
  if (isLegacyServiceAgreementLineTable(p)) return true;
  return (
    (p.includes('display name') ||
      p.includes('device name') ||
      p.includes('asset name') ||
      p.includes('[device name]')) &&
    p.includes('serial') &&
    (p.includes('per camp') || p.includes('camp amt')) &&
    (p.includes('round trip') ||
      p.includes('kms covered') ||
      p.includes('distance covered') ||
      p.includes('issue date'))
  );
}

export function isCanonicalServiceAgreementLineTable(plain = '') {
  const p = String(plain).toLowerCase();
  return (
    (p.includes('device name') || p.includes('[device name]')) &&
    (p.includes('per camp (inr)') || p.includes('[per camp (inr)]')) &&
    (p.includes('distance covered (km)') || p.includes('[distance covered (km)]'))
  );
}

function applyRewritePairs(text, pairs) {
  let next = text;
  for (const [from, to] of pairs) {
    next = next.split(from).join(to);
  }
  return next;
}

/**
 * Rewrite the Asset Issued table headers and merge fields in Word XML.
 * Scoped to matching tables so compensation matrices are left alone.
 */
export function rewriteServiceAgreementLineTableXml(xml = '') {
  return String(xml).replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi, (tbl) => {
    const plain = tablePlain(tbl);
    if (plain.includes('additional additional remarks')) {
      return tbl.split('Additional Additional Remarks').join('Additional Remarks');
    }
    if (isCanonicalServiceAgreementLineTable(plain)) return tbl;
    if (!isServiceAgreementAssetLineTable(plain)) return tbl;

    let next = tbl;
    if (isLegacyServiceAgreementLineTable(plain)) {
      // Headers before tokens so "Serial Number" header rewrite cannot corrupt "[Serial Number]" tokens.
      next = applyRewritePairs(next, LEGACY_HEADER_REWRITE_PAIRS);
      next = applyRewritePairs(next, LEGACY_TOKEN_REWRITE_PAIRS);
    } else {
      next = applyRewritePairs(next, TOKEN_REWRITE_PAIRS);
      next = applyRewritePairs(next, HEADER_REWRITE_PAIRS);
    }
    next = next.split('[Remarks]').join('[Additional Remarks]');
    next = next.replace(/(?<!Additional )Remarks/g, 'Additional Remarks');
    next = next.split('Additional Additional Remarks').join('Additional Remarks');
    return next;
  });
}

export function canonicalLineColumnLabel(value = '') {
  const normalized = String(value)
    .replace(/\b(Additional\s+)+/gi, 'Additional ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return LINE_COLUMN_LABEL_ALIASES[normalized.toLowerCase()] || normalized;
}

export function normalizeLineColumnLabel(value = '') {
  return canonicalLineColumnLabel(value);
}

export function normalizeDetectedLineColumns(columns = []) {
  return (columns || []).map((col) => {
    const inner = canonicalLineColumnLabel(col.inner || col.label || '');
    const label = canonicalLineColumnLabel(col.label || col.inner || inner);
    if (!inner) return col;
    const key = inner
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const token = `[${inner}]`;
    return {
      ...col,
      inner,
      label,
      token,
      key: String(col.key || '').includes('additional_additional') ? key : col.key || key,
    };
  });
}

export function remapLineRowsToLiveTables(lineRows = {}, storedTables = [], liveTables = []) {
  const next = { ...lineRows };
  for (const live of liveTables || []) {
    const stored = (storedTables || []).find(
      (s) => s.id === live.id || Number(s.tableIndex) === Number(live.tableIndex)
    );
    const rows = lineRows[live.id] || (stored ? lineRows[stored.id] : null);
    if (!Array.isArray(rows)) continue;
    next[live.id] = rows.map((row) => {
      const out = { ...(row || {}) };
      Object.entries(row || {}).forEach(([k, v]) => {
        const nk = String(k).replace(/additional_additional/g, 'additional');
        if (nk !== k && !String(out[nk] || '').trim() && String(v || '').trim()) {
          out[nk] = v;
        }
      });
      const liveKeys = new Set((live.columns || []).map((c) => c.key));
      (live.columns || []).forEach((col, i) => {
        if (String(out[col.key] || '').trim()) return;
        const from = stored?.columns?.[i];
        const raw =
          (from && (row[from.key] ?? row[from.inner] ?? row[from.label])) ||
          row[col.inner] ||
          row[col.label] ||
          '';
        if (!String(raw).trim()) return;
        if (from?.key && liveKeys.has(from.key) && from.key !== col.key) return;
        out[col.key] = String(raw).trim();
      });
      // Backfill renamed keys (Display Name → Device Name, etc.)
      (live.columns || []).forEach((col) => {
        if (String(out[col.key] || '').trim()) return;
        for (const [alias, canonical] of Object.entries(LINE_COLUMN_LABEL_ALIASES)) {
          if (canonical !== col.label && canonical !== col.inner) continue;
          const aliasKey = alias.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          if (String(out[aliasKey] || '').trim()) {
            out[col.key] = String(out[aliasKey]).trim();
            break;
          }
        }
      });
      return out;
    });
  }
  return next;
}
