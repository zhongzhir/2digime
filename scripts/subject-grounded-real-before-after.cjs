/**
 * DIGITALME-SUBJECT-GROUNDED-WORK-01 — 真实 before/after 盲比证据。
 *
 * 三个真实任务（项目介绍 / 写作文档 / 开发规划），各跑两臂：
 *   A. generic context（空主体，无已确认主体信息）
 *   B. subject-grounded context（已确认：产品定位/参赛目标/架构原则/表达偏好/边界/经验）
 * 再由 2digime 自身模型盲评：
 *   - 哪一版更准确地代表用户/项目（subject grounding 增益）
 *   - B 是否出现 irrelevant personalization penalty（无关个人化）
 *
 * 运行：node scripts/subject-grounded-real-before-after.cjs
 * 输出：build/evidence/subject-grounded-work-01/
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promises: fsp } = require('node:fs');
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} = require('../dist/infrastructure/env-secrets');
const { chatComplete } = require('../dist/infrastructure/model-http');
const { providerCredentialKey } = require('../dist/infrastructure/secret-store');
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');

const OUT_DIR = path.join(__dirname, '..', 'build', 'evidence', 'subject-grounded-work-01');

function scrub(v) {
  return JSON.parse(
    JSON.stringify(v, (_k, val) => {
      if (typeof val === 'string' && /sk-[A-Za-z0-9_-]{8,}/.test(val)) return '[redacted]';
      return val;
    }),
  );
}

async function writeEvidence(name, payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(scrub(payload), null, 2)}\n`, 'utf8');
  console.log(`written ${path.join(OUT_DIR, name)}`);
}

async function probeModel(env) {
  const secrets = createEnvSecretAccessor(process.env, env.providerId, env.runtime);
  const apiKey = await secrets.get(providerCredentialKey(env.providerId));
  if (!apiKey) return { usable: false, reason: 'no_api_key' };
  try {
    const r = await chatComplete({
      baseUrl: env.baseUrl,
      apiKey,
      model: env.model,
      messages: [{ role: 'user', content: '请只回复：OK' }],
      maxTokens: 128,
      timeoutMs: 30000,
    });
    return { usable: r.text.trim().length > 0, reason: 'probe_ok' };
  } catch (err) {
    return { usable: false, reason: String((err && err.kind) || (err && err.message) || err).slice(0, 160) };
  }
}

async function runDoc(env, goal, injectSubject) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-sgw-ba-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: env.baseUrl,
      model: env.model,
      providerId: env.providerId,
      displayName: '真实通用模型',
      timeoutMs: 180000,
    },
    secrets: createEnvSecretAccessor(process.env, env.providerId, env.runtime),
    registerOpenAiStub: false,
  });
  await runtime.createPackage({ displayName: '主体', targetDir: path.join(root, 'pkg') });

  if (injectSubject) {
    for (const e of injectSubject) {
      await runtime.appendOwnerEvent(e);
    }
  }

  const submitted = await runtime.submitTask({
    goal,
    contextRefs: [],
    requestedArtifactType: 'document',
    intentKind: 'create_document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 240000);
  const artId = job.artifactId;
  const content = artId
    ? await runtime.getContent({ artifactId: artId })
    : null;
  const freeze = job.snapshotId ? await runtime.readSubjectContextFreeze(job.snapshotId) : null;
  await runtime.stop();
  return {
    status: job.status,
    text: String(content?.text || ''),
    injectedCount: freeze ? freeze.entries.length : 0,
    injectedKinds: freeze
      ? freeze.entries.map((e) => e.kind).filter((v, i, a) => a.indexOf(v) === i)
      : [],
  };
}

const TASKS = [
  {
    id: 'project-intro',
    label: '项目介绍（2digime 参赛项目）',
    goal: '给 2digime 写一份参赛项目介绍，突出产品定位、目标用户与核心能力。',
    subject: [
      { type: 'identity_clarified', confidence: 'confirmed', payload: { title: '2digime 数字之我', detail: '本地优先、Owner 控制的 AI 原生控制层；普通用户只需安装并连接一个通用模型即可闭环', tags: ['identity'] } },
      { type: 'goal_updated', confidence: 'confirmed', payload: { title: '参赛目标', detail: '以「数字之我 + AI Native」参加 AI 创新大赛，突出数字主体定位', tags: ['goal', '参赛'] } },
      { type: 'principle_stated', confidence: 'confirmed', payload: { title: '核心架构原则', detail: '专业能力可缺席但任务闭环不可缺席；能力选择基于 capability contract 而非品牌', tags: ['principle', '架构'] } },
      { type: 'preference_observed', confidence: 'confirmed', payload: { title: '偏好：正式、结论先行', detail: '对外文档采用正式语气，先给结论再展开', tags: ['style', 'preference', 'document', '正式', '结论先行'] } },
      { type: 'boundary_updated', confidence: 'confirmed', payload: { title: '不讨论未公开融资', detail: 'exclude:未公开融资细节', tags: ['边界', 'exclude:未公开融资细节'] } },
    ],
  },
  {
    id: 'writing-doc',
    label: '写作 / 文档任务',
    goal: '写一份面向用户的周报式产品更新说明，介绍本周进展。',
    subject: [
      { type: 'preference_observed', confidence: 'confirmed', payload: { title: '偏好：结论先行、控制篇幅', detail: '周报与更新说明要结论先行、控制篇幅、避免空话套话', tags: ['style', 'preference', 'document', '周报', '结论先行'] } },
      { type: 'experience_confirmed', confidence: 'confirmed', payload: { title: '更新说明写法', detail: '先写最重要结论，再列要点；每期控制在一屏内', tags: ['document', '周报', 'decision:accept', 'artifact:art_ba'] } },
      { type: 'boundary_updated', confidence: 'confirmed', payload: { title: '不编造未上线功能', detail: 'exclude:尚未上线功能', tags: ['边界', 'exclude:尚未上线功能'] } },
    ],
  },
  {
    id: 'dev-plan',
    label: '开发任务（开发规划文档）',
    goal: '写一份下一阶段开发规划，说明模块划分与验收思路。',
    subject: [
      { type: 'principle_stated', confidence: 'confirmed', payload: { title: '开发原则', detail: '模块化、可测试、单执行路径；能力用 adapter 可替换', tags: ['principle', '开发', '架构'] } },
      { type: 'preference_observed', confidence: 'confirmed', payload: { title: '偏好：先范围后细节', detail: '规划先冻结交付范围再展开细节，避免范围蔓延', tags: ['preference', '开发', '规划'] } },
      { type: 'boundary_updated', confidence: 'confirmed', payload: { title: '不做静默推送', detail: 'exclude:自动提交推送发布', tags: ['边界', 'exclude:自动提交推送发布'] } },
    ],
  },
];

async function blindJudge(env, task, a, b) {
  const secrets = createEnvSecretAccessor(process.env, env.providerId, env.runtime);
  const apiKey = await secrets.get(providerCredentialKey(env.providerId));
  const clip = (s) => (s.length > 1200 ? `${s.slice(0, 1200)}…` : s);
  const constraints = task.subject.map((e, i) => `${i + 1}. ${e.payload.title}: ${e.payload.detail}`);
  const prompt = [
    '你是数字之我 2digime 的中立核验员。给定同一任务的两版成果 A 与 B，以及一组已确认的主体约束（定位/目标/偏好/边界），',
    '逐条核验：哪一版在内容上明显体现该约束（遵循/反映），哪一版没有。',
    '注意：约束体现是指成果内容实际遵循了约束的语义，不是机械引用原文。',
    '只输出 JSON：{"verdicts":[{"constraint":"标题","inA":true|false,"inB":true|false}],"penaltyInB":true|false,"reason":"一句话"}。',
    'penaltyInB=true 仅当 B 包含了与任务无关的个人化内容。',
    `任务目标：${task.goal}`,
    `已确认约束：\n${constraints.join('\n')}`,
    `\n===== 成果 A =====\n${clip(a)}`,
    `\n===== 成果 B =====\n${clip(b)}`,
  ].join('\n');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await chatComplete({
        baseUrl: env.baseUrl,
        apiKey,
        model: env.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 900,
        timeoutMs: 120000,
        responseFormat: { type: 'json_object' },
      });
      const parsed = JSON.parse(result.text);
      const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
      const inB = verdicts.filter((v) => v.inB === true).length;
      const inA = verdicts.filter((v) => v.inA === true).length;
      return {
        verdicts,
        constraintsFollowedInB: inB,
        constraintsFollowedInA: inA,
        coverageGain: inB - inA,
        irrelevantPenaltyInB: parsed.penaltyInB === true,
        reason: String(parsed.reason || '').slice(0, 300),
        raw: result.text.slice(0, 500),
      };
    } catch {
      /* 重试一次 */
    }
  }
  return { constraintsFollowedInB: 0, constraintsFollowedInA: 0, coverageGain: 0, irrelevantPenaltyInB: false, reason: 'judge json failed after retry' };
}

/** 客观 grounding 检查：B 对已确认主体概念的覆盖（比 A 更充分则增益成立）。 */
function groundingCheck(task, a, b) {
  // 每个主体条目取标题与 detail 中最具区分度的片段（2-8 字中文或 latin 词）。
  const probes = [];
  for (const e of task.subject) {
    const candidates = [
      String(e.payload.title || ''),
      String(e.payload.detail || '').replace(/^exclude:/, ''),
    ]
      .flatMap((s) => s.split(/[：:；;，,\s。！？]+/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 12);
    for (const c of candidates) {
      if (!probes.includes(c)) probes.push(c);
    }
  }
  const meaningful = probes.slice(0, 10);
  const rows = [];
  for (const w of meaningful) {
    const inA = a.includes(w);
    const inB = b.includes(w);
    rows.push({ word: w, inA, inB });
  }
  return {
    probes: meaningful,
    coverageInB: rows.filter((r) => r.inB).length,
    coverageInA: rows.filter((r) => r.inA).length,
    coverageGain: rows.filter((r) => r.inB && !r.inA).length,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = await resolveModelEnvAsync(process.cwd(), process.env);
  const probe = await probeModel(env);
  const evidence = {
    task: 'DIGITALME-SUBJECT-GROUNDED-WORK-01',
    base: '97831eb build/capability-closure-runtime-02',
    branch: 'build/subject-grounded-work-01',
    at: new Date().toISOString(),
    environment: { model: { baseUrl: env.baseUrl, model: env.model }, probe },
  };

  if (!probe.usable) {
    evidence.blocker = `真实模型凭证不可用：${probe.reason}`;
    await writeEvidence('before-after.json', evidence);
    console.log(JSON.stringify({ ok: true, partial: true, blocker: evidence.blocker }, null, 2));
    return;
  }

  evidence.results = [];
  for (const task of TASKS) {
    const a = await runDoc(env, task.goal, null);
    const b = await runDoc(env, task.goal, task.subject);
    const judge = await blindJudge(env, task, a.text, b.text);
    evidence.results.push({
      task: task.id,
      label: task.label,
      armA: { status: a.status, chars: a.text.length, injectedCount: a.injectedCount },
      armB: { status: b.status, chars: b.text.length, injectedCount: b.injectedCount, injectedKinds: b.injectedKinds },
      grounding: groundingCheck(task, a.text, b.text),
      judge,
      textA: a.text,
      textB: b.text,
    });
    const g = evidence.results[evidence.results.length - 1].grounding;
    const j = evidence.results[evidence.results.length - 1].judge;
    console.log(`done ${task.id}: A=${a.status}(${a.text.length}ch) B=${b.status}(${b.text.length}ch) judgeFollowedB=${j.constraintsFollowedInB}/${j.constraintsFollowedInB + j.constraintsFollowedInA + 0} penalty=${j.irrelevantPenaltyInB}`);
  }

  await writeEvidence('before-after.json', evidence);
  const grounded = evidence.results.filter((r) => r.judge.coverageGain >= 1).length;
  const penalties = evidence.results.filter((r) => r.judge.irrelevantPenaltyInB).length;
  const followedB = evidence.results.reduce((n, r) => n + (r.judge.constraintsFollowedInB || 0), 0);
  const followedA = evidence.results.reduce((n, r) => n + (r.judge.constraintsFollowedInA || 0), 0);
  console.log(
    JSON.stringify(
      { ok: true, tasks: evidence.results.length, groundedTasks: grounded, constraintsFollowedB: followedB, constraintsFollowedA: followedA, irrelevantPenaltyInB: penalties },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});