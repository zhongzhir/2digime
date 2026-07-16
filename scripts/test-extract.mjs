// Quick smoke test for builder text extraction (no API calls).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const b = require("../digitalme-app/src/builder.js");

const samples = [
  "source-materials/articles/在北信毕业班上的讲话20180912.pptx",
  "source-materials/articles/《版权金融》约稿函-张总.pdf",
  "source-materials/articles/张元林 演讲题目与提纲.docx",
];

for (const fp of samples) {
  try {
    const text = await b.extractText(fp);
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    console.log("OK", fp, "→", text.length, "chars |", preview, "…");
  } catch (e) {
    console.error("FAIL", fp, "→", e.message);
    process.exitCode = 1;
  }
}
