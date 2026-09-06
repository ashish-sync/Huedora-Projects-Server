/**
 * Benchmark WebP Q90 (max 2500px) on a list of real images.
 * Usage:
 *   node scripts/benchmark-image-optimize.js [list.txt|dir] [--limit=100]
 * Default list: tmp-image-sample-list.txt (path\tsize lines or size\tpath)
 * Also always includes server/uploads/** images first when present.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeImageToWebp } from '../src/storage/media/optimizeImage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const uploadsRoot = path.join(root, 'uploads');

function parseArgs(argv) {
  let limit = 100;
  let input = path.join(root, 'tmp-image-sample-list.txt');
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Math.max(1, Number(a.slice(8)) || 100);
    else if (!a.startsWith('-')) input = a;
  }
  return { limit, input };
}

function collectUploadImages() {
  if (!fs.existsSync(uploadsRoot)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp)$/i.test(name) && st.size > 20_000) out.push(full);
    }
  };
  walk(uploadsRoot);
  return out;
}

function loadListFile(listPath) {
  if (!fs.existsSync(listPath)) return [];
  const lines = fs.readFileSync(listPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const paths = [];
  for (const line of lines) {
    const parts = line.split('\t');
    const p = parts.length >= 2 && /^\d+$/.test(parts[0]) ? parts[1] : parts[0];
    if (p && fs.existsSync(p)) paths.push(p);
  }
  return paths;
}

function loadFromDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile() && /\.(jpe?g|png|webp)$/i.test(name)) out.push(full);
  }
  return out;
}

function uniq(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const n = path.resolve(p);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function preferHandwrittenish(a, b) {
  const score = (p) => {
    const s = p.toLowerCase();
    let n = 0;
    if (s.includes(`${path.sep}uploads${path.sep}`)) n += 50;
    if (s.includes('camp-ops') || s.includes('whatsapp') || s.includes('hand') || s.includes('scan')) n += 30;
    if (s.includes('form') || s.includes('patil') || s.includes('po_')) n += 10;
    return n;
  };
  return score(b) - score(a);
}

async function main() {
  const { limit, input } = parseArgs(process.argv.slice(2));
  const fromUploads = collectUploadImages();
  const fromInput = fs.existsSync(input) && fs.statSync(input).isDirectory()
    ? loadFromDir(input)
    : loadListFile(input);
  const sample = uniq([...fromUploads, ...fromInput].sort(preferHandwrittenish)).slice(0, limit);

  if (!sample.length) {
    console.error('No images found to benchmark.');
    process.exit(1);
  }

  let originalTotal = 0;
  let optimizedTotal = 0;
  let keptOriginal = 0;
  let failed = 0;
  const rows = [];

  for (const abs of sample) {
    const before = fs.statSync(abs).size;
    originalTotal += before;
    try {
      const result = await optimizeImageToWebp(abs);
      const after = result.buffer.length;
      const used = after > 0 && after < before ? after : before;
      if (!(after > 0 && after < before)) keptOriginal += 1;
      optimizedTotal += used;
      rows.push({
        file: path.basename(abs),
        before,
        after: used,
        ratio: used / before,
        saved: before - used,
        dims: `${result.width}x${result.height}`,
      });
    } catch (err) {
      failed += 1;
      optimizedTotal += before;
      rows.push({
        file: path.basename(abs),
        before,
        after: before,
        ratio: 1,
        saved: 0,
        error: String(err?.message || err).slice(0, 120),
      });
    }
  }

  const saved = originalTotal - optimizedTotal;
  const pct = originalTotal > 0 ? (saved / originalTotal) * 100 : 0;

  console.log(JSON.stringify({
    files: sample.length,
    failed,
    keptOriginalWhenNotSmaller: keptOriginal,
    originalBytes: originalTotal,
    optimizedBytes: optimizedTotal,
    savedBytes: saved,
    percentSaved: Number(pct.toFixed(2)),
    meetsOverall50pct: pct >= 50,
    originalMB: Number((originalTotal / 1e6).toFixed(2)),
    optimizedMB: Number((optimizedTotal / 1e6).toFixed(2)),
  }, null, 2));

  const worst = [...rows].sort((a, b) => b.ratio - a.ratio).slice(0, 10);
  const best = [...rows].sort((a, b) => a.ratio - b.ratio).slice(0, 10);
  console.log('\nBest savings (lowest ratio):');
  for (const r of best) {
    console.log(`  ${(r.ratio * 100).toFixed(1)}% of original  ${r.before}→${r.after}  ${r.file}`);
  }
  console.log('\nWorst savings (highest ratio):');
  for (const r of worst) {
    console.log(`  ${(r.ratio * 100).toFixed(1)}% of original  ${r.before}→${r.after}  ${r.file}${r.error ? ` ERR:${r.error}` : ''}`);
  }

  const outPath = path.join(root, 'tmp-image-optimize-benchmark.json');
  fs.writeFileSync(outPath, JSON.stringify({ summary: { files: sample.length, originalTotal, optimizedTotal, percentSaved: pct }, rows }, null, 2));
  console.log(`\nWrote ${outPath}`);
  process.exit(pct >= 50 ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
