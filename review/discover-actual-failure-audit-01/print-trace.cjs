// 用法: node print-trace.cjs <run-name> [--llm] [--noevents]
const fs = require('fs'), path = require('path');
const DATA = require('./data-root.cjs');
const name = process.argv[2];
const llm = process.argv.includes('--llm');
const t = JSON.parse(fs.readFileSync(path.join(DATA, 'runs', name, 'trace.json'), 'utf8'));
console.log(`scenario=${t.scenario} totalMs=${t.totalMs}`);
const starts = new Map();
for (const e of t.trace) {
  const sec = (e.t / 1000).toFixed(1).padStart(6);
  switch (e.kind) {
    case 'boot': console.log(sec, 'BOOT', JSON.stringify(e)); break;
    case 'input': console.log(sec, 'INPUT', JSON.stringify(e.raw)); break;
    case 'content.call': console.log(sec, '>> CALL', e.label, e.payload); break;
    case 'content.return': {
      const v = e.view || {};
      console.log(sec, `<< RET ${e.label} +${e.ms}ms mode=${v.feedMode} reason=${v.reasonCode} replenishing=${v.replenishing} cards=${(v.cards || []).length} related=${v.related} unjudged=${v.unjudged} access=${v.access}`);
      console.log('        notice:', v.notice);
      for (const c of v.cards || []) console.log('        card', [c.type, c.consumption, c.host, c.pub, c.media ? 'M' : '-', c.thumb ? 'T' : '-', c.title].join(' | '));
      break;
    }
    case 'content.throw': console.log(sec, '!! THROW', e.label, e.ms, e.msg); break;
    case 'fetch.start': {
      starts.set(e.id, e);
      if (llm && e.reqSummary && e.reqSummary.lastUser) {
        console.log(sec, `FETCH#${e.id} ${e.method} ${e.url}`);
        console.log('        system:', e.reqSummary.system);
        console.log('        user  :', e.reqSummary.lastUser);
        console.log('        fmt/max/tools:', JSON.stringify(e.reqSummary.responseFormat), e.reqSummary.maxTokens, e.reqSummary.tools);
      } else console.log(sec, `FETCH#${e.id} ${e.method} ${e.url}`, typeof e.reqSummary === 'string' ? e.reqSummary : '');
      break;
    }
    case 'fetch.end': console.log(sec, `  end#${e.id} ${e.status} ${e.ms}ms ${e.bytes}B`, llm ? e.body : (e.body || '').slice(0, 160)); break;
    case 'fetch.error': console.log(sec, `  ERR#${e.id} ${e.ms}ms ${e.name} ${e.msg}`); break;
    case 'https.start': console.log(sec, `GET#${e.id} ${e.target}`); break;
    case 'https.response': console.log(sec, `  got#${e.id} ${e.status} ${e.ms}ms`); break;
    case 'https.error': console.log(sec, `  GETERR#${e.id} ${e.ms}ms ${e.msg}`); break;
    case 'https.timeout': console.log(sec, `  TIMEOUT#${e.id} ${e.ms}ms ${e.target}`); break;
    case 'event': if (!process.argv.includes('--noevents')) console.log(sec, 'EVENT', e.data); break;
    default: console.log(sec, e.kind.toUpperCase(), JSON.stringify(e));
  }
}
