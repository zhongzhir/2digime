'use strict';
// 用法：node diff-suite.cjs <before.txt> <after.txt>  对比两次 node --test 输出里失败的用例名（只看末尾 "failing tests" 汇总段）。
const fs = require('node:fs');

function failing(file) {
  const buf = fs.readFileSync(file);
  // PowerShell 的 *> 重定向写出 UTF-16LE。
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const at = text.lastIndexOf('failing tests:');
  const tail = at >= 0 ? text.slice(at) : text;
  const names = new Set();
  for (const line of tail.split(/\r?\n/)) {
    const m = /^✖ (.+?) \(\d+(\.\d+)?ms\)/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

const [a, b] = process.argv.slice(2);
const before = failing(a);
const after = failing(b);
console.log(`before=${before.size} after=${after.size}`);
console.log('--- 新增失败（before 通过/不存在，after 失败）');
for (const n of after) if (!before.has(n)) console.log('  + ' + n);
console.log('--- 已不再失败');
for (const n of before) if (!after.has(n)) console.log('  - ' + n);
