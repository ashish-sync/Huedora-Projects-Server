import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import {
  parseDocxBlocks,
  loadDocxImageMap,
  isLetterheadTable,
  isDocumentTitleText,
  paragraphAlign,
} from './docxPlaceholders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('parseDocxBlocks does not leak drawing offsets into letterhead text', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
    <w:p>
      <w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:posOffset>79375</wp:posOffset><a:blip r:embed="rId5"/></wp:anchor></w:drawing>
      <w:r><w:t>Tylo Care Private Limited</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>SERVICE AGREEMENT</w:t></w:r></w:p>
  </w:body></w:document>`;
  const fakePng = Buffer.from([137, 80, 78, 71]);
  const blocks = parseDocxBlocks(xml, { rId5: fakePng });
  assert.equal(blocks[0].text, 'Tylo Care Private Limited');
  assert.equal(blocks[0].image, fakePng);
  assert.doesNotMatch(blocks[0].text, /79375/);
  assert.equal(blocks[1].text, 'SERVICE AGREEMENT');
  assert.equal(blocks[1].align, 'center');
  assert.equal(isDocumentTitleText(blocks[1].text), true);
});

test('letterhead tables are two-column company headers, not data grids', () => {
  assert.equal(
    isLetterheadTable([
      [{ text: 'TYLO' }, { text: 'Tylo Care Private Limited, Mumbai' }],
    ]),
    true
  );
  assert.equal(
    isLetterheadTable([
      [{ text: 'Activity', bold: true }, { text: 'Compensation', bold: true }],
      [{ text: 'Overtime' }, { text: '₹500' }],
    ]),
    false
  );
});

test('paragraphAlign maps Word jc values', () => {
  assert.equal(paragraphAlign('<w:pPr><w:jc w:val="center"/></w:pPr>'), 'center');
  assert.equal(paragraphAlign('<w:pPr><w:jc w:val="right"/></w:pPr>'), 'right');
  assert.equal(paragraphAlign('<w:pPr><w:jc w:val="both"/></w:pPr>'), 'left');
});

test('Service Agreement template letterhead includes the logo image', async () => {
  const file = path.resolve(
    __dirname,
    '../../../uploads/templates/49d6c427-dbb4-494f-aac4-a928a7059ce5-Service_Agreement.docx'
  );
  if (!fs.existsSync(file)) return;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('word/document.xml').async('string');
  const images = await loadDocxImageMap(zip);
  const blocks = parseDocxBlocks(xml, images);
  const letterhead = blocks.find((b) => b.image || /tylo care/i.test(b.text || ''));
  assert.ok(letterhead, 'letterhead paragraph missing');
  assert.ok(letterhead.image, 'logo was not attached to the letterhead');
  assert.match(letterhead.text, /Tylo Care Private Limited/);
  assert.doesNotMatch(letterhead.text, /79375/);
});
