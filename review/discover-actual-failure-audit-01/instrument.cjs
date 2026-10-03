/**
 * 主进程埋点（审计用，--require 预加载，不改产品代码）：
 * 包装 ipcMain.handle，记录每次命令的入参摘要、耗时、返回视图的终态字段；并包装 fetch。
 * 输出：AUDIT_IPC_LOG（ndjson）
 */
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const OUT = process.env.AUDIT_IPC_LOG;
if (OUT) {
  const T0 = Date.now();
  let seq = 0;
  const w = (o) => { try { fs.appendFileSync(OUT, JSON.stringify(Object.assign({ t: Date.now() - T0 }, o)) + '\n'); } catch { /* ignore */ } };
  const cut = (s, n = 200) => { const x = typeof s === 'string' ? s : JSON.stringify(s); return x && x.length > n ? x.slice(0, n) + '…' : x; };
  const viewSum = (v) => v && ({
    feedMode: v.feedMode, reason: v.reasonCode, replenishing: v.replenishing, gen: v.searchGenerationId,
    cards: (v.cards || []).length, related: (v.relatedCards || []).length, unjudged: (v.unjudgedCards || []).length,
    notice: cut(v.notice || '', 90), titles: (v.cards || []).slice(0, 3).map((c) => cut(c.title, 28)),
  });
  const origLoad = Module._load;
  Module._load = function patched(request) {
    const mod = origLoad.apply(this, arguments);
    if (request === 'electron' && mod && mod.ipcMain && !mod.ipcMain.__auditPatched) {
      const ipc = mod.ipcMain; const orig = ipc.handle.bind(ipc);
      ipc.handle = (channel, fn) => orig(channel, async (evt, ...args) => {
        const id = ++seq; const s = Date.now();
        const isContent = channel === 'command:invoke' && args[0] === 'content';
        if (isContent) w({ k: 'ipc.start', id, name: args[0], input: cut(args[1], 180) });
        else if (channel === 'command:invoke') w({ k: 'ipc.start', id, name: args[0] });
        try {
          const r = await fn(evt, ...args);
          if (isContent) w({ k: 'ipc.end', id, ms: Date.now() - s, view: viewSum(r && (r.view || r.result && r.result.view || r)) });
          else if (channel === 'command:invoke') w({ k: 'ipc.end', id, name: args[0], ms: Date.now() - s });
          return r;
        } catch (e) {
          w({ k: 'ipc.throw', id, ms: Date.now() - s, name: args[0], msg: cut(e && e.message, 200) });
          throw e;
        }
      });
      ipc.__auditPatched = true;
    }
    return mod;
  };
  const rf = globalThis.fetch;
  if (rf) {
    let fid = 0;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const id = ++fid; const s = Date.now();
      w({ k: 'fetch.start', id, url: cut(url, 140) });
      // 故障注入：AUDIT_FAIL_FETCH_HOSTS=a.com,b.com 立即失败；AUDIT_HANG_FETCH_HOSTS 一直挂起直到被 abort
      const hostOf = (() => { try { return new URL(url).host; } catch { return ''; } })();
      const failHosts = String(process.env.AUDIT_FAIL_FETCH_HOSTS || '').split(',').filter(Boolean);
      const hangHosts = String(process.env.AUDIT_HANG_FETCH_HOSTS || '').split(',').filter(Boolean);
      if (failHosts.includes(hostOf)) { w({ k: 'fetch.injected-fail', id, host: hostOf }); throw new TypeError('fetch failed (injected)'); }
      if (hangHosts.includes(hostOf)) {
        w({ k: 'fetch.injected-hang', id, host: hostOf });
        return new Promise((_, reject) => {
          const sig = init && init.signal;
          if (sig) {
            const onAbort = () => { w({ k: 'fetch.aborted', id, ms: Date.now() - s }); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
            if (sig.aborted) onAbort(); else sig.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
      try { const r = await rf(input, init); w({ k: 'fetch.end', id, ms: Date.now() - s, status: r.status }); return r; }
      catch (e) { w({ k: 'fetch.err', id, ms: Date.now() - s, name: e && e.name }); throw e; }
    };
  }
  const https = require('node:https');
  const rg = https.get; let gid = 0;
  https.get = function (...a) {
    const o = a[0] && typeof a[0] === 'object' ? a[0] : {}; const id = ++gid; const s = Date.now();
    w({ k: 'get.start', id, host: o.hostname });
    const req = rg.apply(this, a);
    req.on('response', (res) => w({ k: 'get.res', id, ms: Date.now() - s, status: res.statusCode, host: o.hostname }));
    req.on('error', (e) => w({ k: 'get.err', id, ms: Date.now() - s, host: o.hostname, msg: cut(e && e.message, 80) }));
    return req;
  };
  w({ k: 'instrument.ready' });
}
