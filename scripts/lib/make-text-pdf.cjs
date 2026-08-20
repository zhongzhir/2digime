/**
 * 生成可被 pdf-parse 抽取的最小 PDF（含唯一标记句）。
 * @param {string} filePath
 * @param {string} marker
 */
'use strict';

const fs = require('node:fs');

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function makeTextPdf(filePath, marker) {
  const line = escapePdfText(marker);
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
  );
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  fs.writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function makeCorruptPdf(filePath) {
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\nnot a real pdf payload\x00\x01\x02', 'binary'));
  return filePath;
}

module.exports = { makeTextPdf, makeCorruptPdf };
