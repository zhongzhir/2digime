"use strict";
const fs = require("fs");
const path = require("path");
const appPath = path.join(__dirname, "..", "src", "renderer", "app.js");
const fragPath = path.join(__dirname, "cognition_ui_fragment.js");
let s = fs.readFileSync(appPath, "utf8");
const frag = fs.readFileSync(fragPath, "utf8");
const start = s.indexOf("function renderMeOverview()");
const end = s.indexOf("function openLifeEditor(ev)");
if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}
s = s.slice(0, start) + frag + "\n\n" + s.slice(end);
fs.writeFileSync(appPath, s, "utf8");
console.log("ok", start, end);
