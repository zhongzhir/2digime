'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PID_FILE = path.join(__dirname, '.agent.pid');

async function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('research-a2a-agent not running (no pid file)');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  const controlPort = meta.controlPort;
  if (controlPort) {
    await new Promise((resolve) => {
      const req = http.request(
        {
          host: meta.host || '127.0.0.1',
          port: controlPort,
          path: '/shutdown',
          method: 'POST',
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on('error', () => resolve());
      req.end();
    });
  }
  try {
    if (meta.pid) process.kill(meta.pid, 0);
    if (meta.pid) process.kill(meta.pid);
  } catch {
    /* 进程已不存在时仍删除失效 PID 文件 */
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  console.log('research-a2a-agent stop requested');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
