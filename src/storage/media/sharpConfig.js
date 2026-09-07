/**
 * Global Sharp settings for Render free/starter (~512MB).
 * Cache + multi-thread libvips can retain large decode arenas across requests.
 */
import sharp from 'sharp';

let configured = false;

export function configureSharpForLowMemory() {
  if (configured) return;
  try {
    sharp.cache(false);
    sharp.concurrency(1);
    // Avoid SIMD paths holding larger scratch buffers on tiny instances when available.
    if (typeof sharp.simd === 'function') {
      try {
        sharp.simd(false);
      } catch {
        /* ignore */
      }
    }
    configured = true;
    console.warn('[media] Sharp low-memory mode: cache=false concurrency=1');
  } catch (err) {
    console.warn(`[media] Sharp low-memory configure failed: ${err?.message || err}`);
  }
}
