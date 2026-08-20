/**
 * DIGITALME-CONVERSATION-P95-BENCHMARK-01 — AI Judge（盲评）。
 * 独立模型 deepseek-v4-pro（参赛 arm 为 deepseek-v4-flash，实例不同）。
 * 输入：blind-input.json（匿名化，仅 Arm A/B）
 * 输出：blind-scores.json（增量写入，支持断点续跑）
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '_conversation-p95-benchmark-01-evidence');
const INPUT = require(path.join(OUT_DIR, 'blind-input.json'));
const OUT_FILE = path.join(OUT_DIR, 'blind-scores.json');

const CRED = (() => {
  const f = path.join(__dirname, '..', 'digitalme-v2', 'scripts', '_mvp-p14-real-capability-evidence', '.runtime-model-credential.json');
  if (fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j.baseUrl && j.apiKey) return { baseUrl: j.baseUrl, apiKey: j.apiKey, model: 'deepseek-v4-pro' };
  }
  return null;
})();

const RUBRIC = `
你是独立的评测评委。对给定题目下的两个匿名答案（Arm A 与 Arm B）分别评分。
评分维度与规则（每维 0-5 整数）：
correctness 事实正确性（重大事实错误=0）
freshness 时效性（是否反映2026-08-20可及的最新状态、是否明示发布时间；no_search常识题给3）
source_quality 来源质量（官方/权威>二手>UGC；无引用给0）
citation_entailment 引用是否实际支持每个主张（"答案对但引用不支持"不能高分；无引用给0）
citation_completeness 主要主张是否都有可核验引用（无引用给0）
coverage 覆盖度
contradiction_handling 冲突来源是否如实呈现（无冲突或不适用给3）
reasoning 推理/综合质量、事实vs推断的区分
research_depth 搜索轮次/交叉验证（无搜索给0-1）
personalization_usefulness 是否利用用户上下文给出更有用结果（无关任务给0）
irrelevant_personalization_penalty 负例任务是否仍给正常答案而非强行带入本人信息（正例任务给3）

要求：
- 只依据给出的答案与来源评分，不得臆测。
- 若答案为纯常识题(no_search)，source_quality/freshness 给3，citation_entailment/completeness 给0，research_depth 给0。
- 输出严格JSON，形如：
{"Arm A":{"scores":{"correctness":0,"freshness":0,"source_quality":0,"citation_entailment":0,"citation_completeness":0,"coverage":0,"contradiction_handling":0,"reasoning":0,"research_depth":0,"personalization_usefulness":0,"irrelevant_personalization_penalty":0},"comment":"一句话总评"},"Arm B":{...}}
- 只能输出JSON，不要输出JSON以外的任何文字。`;

function truncate(s, n) {
  if (!s) return '(无答案)';
  s = s.replace(/[\r\n]+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function extractJson(text) {
  // 去掉可能的围栏代码块
  let t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no braces: ' + t.slice(0, 120));
  const candidate = t.slice(start, end + 1);
  return JSON.parse(candidate);
}

async function judgeTask(task) {
  const prompt =
    '【题目】\n' +
    `问题：${task.question}\n` +
    `期望模式：${task.expectedMode}\n` +
    `用户上下文（可能为空）：${task.ownerContext ? JSON.stringify(task.ownerContext) : '(无)'}\n\n` +
    '【两个答案】\n\n' +
    Object.keys(task.arms)
      .map((label) => {
        const a = task.arms[label];
        return (
          `--- ${label} ---\n` +
          `模式：${a.mode}\n` +
          `回答：\n${truncate(a.answer, 1600)}\n\n` +
          `来源：\n${a.sources && a.sources.length ? a.sources.slice(0, 12).map((s) => `- ${s.title || ''} ${s.url}`).join('\n') : '(无来源)'}\n`
        );
      })
      .join('\n\n');
  const body = {
    model: CRED.model,
    messages: [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(CRED.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CRED.apiKey },
        body: JSON.stringify({
          ...body,
          temperature: attempt === 0 ? 0.2 : attempt === 1 ? 0.5 : 0.1,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(150000),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + JSON.stringify(j).slice(0, 200));
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      const content = msg && msg.content;
      const reasoning = msg && msg.reasoning_content;
      if (!content || !content.trim()) {
        throw new Error('empty judge content' + (reasoning ? ' (reasoning present, len ' + reasoning.length + ')' : ''));
      }
      const parsed = extractJson(content);
      // 校验结构
      if (!parsed['Arm A'] || !parsed['Arm B'] || !parsed['Arm A'].scores) throw new Error('bad shape: ' + JSON.stringify(parsed).slice(0, 120));
      return { raw: content, parsed };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function main() {
  if (!CRED) { console.error('no judge credential'); process.exitCode = 2; return; }
  let results = [];
  if (fs.existsSync(OUT_FILE)) {
    try { results = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch { results = []; }
  }
  const done = new Set(results.filter((r) => r.taskId && !r.error).map((r) => r.taskId));
  for (const task of INPUT) {
    if (done.has(task.taskId)) { console.log('skip', task.taskId); continue; }
    try {
      const j = await judgeTask(task);
      results = results.filter((r) => r.taskId !== task.taskId);
      results.push({ taskId: task.taskId, cat: task.cat, judgeModel: CRED.model, ...j.parsed });
      fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
      console.log('ok', task.taskId);
    } catch (e) {
      results = results.filter((r) => r.taskId !== task.taskId);
      results.push({ taskId: task.taskId, cat: task.cat, error: String(e.message).slice(0, 300) });
      fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
      console.log('ERR', task.taskId, e.message.slice(0, 120));
    }
  }
  console.log('done', results.length);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });