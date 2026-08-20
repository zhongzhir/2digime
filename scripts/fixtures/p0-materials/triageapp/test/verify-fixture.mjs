import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const htmlPath = join(root, 'triageapp.html');

let html;
try {
  html = readFileSync(htmlPath, 'utf8');
} catch (err) {
  console.error(`FAIL: cannot read ${htmlPath}`);
  process.exit(1);
}

const required = [
  ['TRIAGEAPP title', /<title>TRIAGEAPP/],
  ['triageapp root marker', /data-triageapp-root="true"/],
  ['triage textarea', /id="triage_input"/],
  ['triage list', /id="triage_items"/],
  ['description marker', /data-description=/],
  ['localStorage usage', /localStorage/],
  ['add button wiring', /triage_add/],
];

let failed = false;
for (const [name, re] of required) {
  if (!re.test(html)) {
    console.error(`FAIL: missing ${name}`);
    failed = true;
  }
}

if (failed) {
  console.error('FAIL: TRIAGEAPP fixture precondition not met');
  process.exit(1);
}

console.log('PASS: TRIAGEAPP fixture pre-registered verification');
process.exit(0);