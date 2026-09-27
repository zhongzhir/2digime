'use strict';
// Packaged Discover 2.0 Trial Candidate smoke: launch the built win-unpacked exe on an isolated
// blank profile, confirm the window starts and no credential/config file is created.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const audit = 'docs/audits/evidence/real-user-candidate-09';

async function main() {
  const idx = process.argv.indexOf('--exe');
  const exe = idx >= 0 ? process.argv[idx + 1] : process.env.DIGITALME_PACKAGED_EXE;
  if (!exe || !fs.existsSync(exe)) throw new Error('packaged exe not found');
  const note = path.join(path.dirname(exe), '试用说明.txt');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-candidate-ud-'));
  const env = { ...process.env, DIGITALME_V2_USER_DATA: userData };
  for (const k of Object.keys(env)) if (/API_KEY|OPENAI|ANTHROPIC|DEEPSEEK|MINIMAX|GEMINI|DASHSCOPE/.test(k)) delete env[k];
  const child = spawn(exe, [`--user-data-dir=${userData}`], { cwd: path.dirname(exe), env, stdio: 'ignore', detached: true });
  child.unref();
  const deadline = Date.now() + 60000;
  let windowStarted = false;
  while (Date.now() < deadline && !windowStarted) {
    windowStarted = fs.existsSync(path.join(userData, 'Local State'));
    if (!windowStarted) await new Promise((r) => setTimeout(r, 700));
  }
  const secrets = fs.existsSync(path.join(userData, 'secrets.v2.json'));
  const modelCfg = fs.existsSync(path.join(userData, 'model-config.json'));
  let subjectExists = false;
  try { subjectExists = fs.readdirSync(path.join(userData, 'subjects')).length > 0; } catch { /* */ }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* */ }
  const out = {
    at: new Date().toISOString(), exe, userData, notePresent: fs.existsSync(note),
    windowStarted, blankSubjectCreated: subjectExists, noCredentialCreated: !secrets && !modelCfg,
  };
  fs.mkdirSync(audit, { recursive: true });
  fs.writeFileSync(`${audit}/packaged-smoke.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.log('PACKAGED SMOKE', JSON.stringify(out));
  if (!windowStarted || secrets || modelCfg || !out.notePresent) process.exitCode = 1;
}

main().catch((e) => { console.error('PACKAGED SMOKE FAIL', e.name, String(e.message).slice(0, 200)); process.exitCode = 1; });
