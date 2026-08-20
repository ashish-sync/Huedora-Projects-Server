/**
 * Patch word/document.xml while preserving the rest of the OOXML package.
 * Never force global DEFLATE — that shrinks/corrupts large templates.
 */
import JSZip from 'jszip';

/**
 * @param {Buffer} buffer
 * @param {string} nextXml
 * @returns {Promise<Buffer>}
 */
export async function repackDocxDocumentXml(buffer, nextXml) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid Word file: missing document.xml');
  const currentXml = await docFile.async('string');
  if (currentXml === nextXml) return buffer;

  zip.file('word/document.xml', nextXml);
  const out = await zip.generateAsync({ type: 'nodebuffer' });

  // Guard against JSZip global compression wiping binary parts (fonts/media/theme).
  if (buffer.length > 80_000 && out.length < buffer.length * 0.85) {
    throw new Error(
      `DOCX repack lost payload (${buffer.length} → ${out.length} bytes). Refusing corrupted output.`
    );
  }
  return out;
}
