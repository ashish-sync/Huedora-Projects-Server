import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lines = [
  'LEASE AGREEMENT',
  '',
  'Party name: [name]',
  'Employee ID: [alphanumeric]',
  'Asset quantity: [number]',
  '',
  'The equipment is leased under the terms stated herein.',
];

const paras = lines
  .map((line) => {
    const safe = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  })
  .join('');

const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras}<w:sectPr/></w:body>
</w:document>`;

const zip = new JSZip();
zip.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
);
zip.folder('_rels').file(
  '.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
);
zip.folder('word').file('document.xml', xml);

const out = path.resolve(__dirname, '../../client/public/samples/Lease_Placeholder_Sample.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
console.log('wrote', out);
