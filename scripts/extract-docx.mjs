import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";

// Auto-discovers the .docx inside source-materials/books to avoid
// argv encoding issues with non-ASCII filenames on Windows consoles.
const booksDir = join(process.cwd(), "source-materials", "books");
const docx = readdirSync(booksDir).find((f) => f.toLowerCase().endsWith(".docx"));
if (!docx) {
  console.error("no .docx found in " + booksDir);
  process.exit(1);
}
const input = join(booksDir, docx);
const output = join(process.cwd(), "build", "book-renxing.txt");
console.log("Input:", input);

const buf = readFileSync(input);

// Locate End Of Central Directory record (signature 0x06054b50).
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
if (eocd < 0) throw new Error("EOCD not found; not a valid zip/docx");

const cdCount = buf.readUInt16LE(eocd + 10);
let cdOffset = buf.readUInt32LE(eocd + 16);

function readEntry(name) {
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const fname = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (fname === name) {
      // Parse local header to find data start.
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? raw : inflateRawSync(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("entry not found: " + name);
}

let xml = readEntry("word/document.xml").toString("utf8");

xml = xml
  .replace(/<w:p[ >]/g, "\n<w:p ")
  .replace(/<w:br\s*\/>/g, "\n")
  .replace(/<w:tab\s*\/>/g, "\t");

let text = "";
const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|\n/g;
let m;
while ((m = re.exec(xml)) !== null) {
  if (m[0] === "\n") text += "\n";
  else text += m[1];
}

text = text
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

writeFileSync(output, text, "utf8");
console.log("Extracted chars:", text.length);
console.log("Output:", output);
