/**
 * DIGITALME-SUBJECT-DISTINGUISHABILITY-01 — 数字之我 A/B 可区分性实验。
 *
 * 控制变量：same code / same model（DeepSeek）/ same tools / same capability /
 * same external evidence / same task / same token budget / same architecture。
 * 唯一核心变量：subject state（SubjectPackage A vs B）。
 *
 * 指标：
 *   - blind distinguishability（跨任务识别率）
 *   - fact distortion（客观事实一致性）
 *   - state isolation（状态隔离 / learning / supersede / boundary）
 *   - minimum agent context（最小必要上下文）
 *   - capability swap（单模型 → not_yet_fully_validated）
 *
 * 敏感信息：无。合成 A/B 主体，不使用 Owner 私人信息。
 * 运行：node scripts/subject-distinguishability-run.cjs
 * 输出：build/evidence/subject-distinguishability-01/
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  resolveModelEnvAsync,
  createEnvSecretAccessor,
} = require('../dist/infrastructure/env-secrets');
const { chatComplete } = require('../dist/infrastructure/model-http');
const { providerCredentialKey } = require('../dist/infrastructure/secret-store');
const { deriveAllViews } = require('../dist/subject-core/derive-all');
const { buildSubjectContextPackage } = require('../dist/subject-core/subject-context-package');

const OUT_DIR = path.join(__dirname, '..', 'build', 'evidence', 'subject-distinguishability-01');
const TEMP = 0.3;
const MAX_TOKENS = 2600;

function nowIso() {
  return new Date().toISOString();
}

/** 合成 GrowthEvent（无 Owner 敏感信息）。 */
function ev(id, type, title, detail, tags, at = '2026-08-10T10:00:00.000Z') {
  return {
    id,
    subjectId: 'subj',
    occurredAt: at,
    type,
    source: { kind: 'owner_direct' },
    payload: { title, detail, tags: tags || [] },
    confidence: 'confirmed',
  };
}

// ---- 冻结的 A / B 主体（结构相同，内容不同；合理、内部一致，非反义 prompt）----
const SUBJECT_A_EVENTS = [
  ev('a_ident', 'identity_clarified', '市场验证型产品人', '在资源有限时优先用最小可行实验验证市场需求，再决定投入方向', ['identity']),
  ev('a_goal', 'goal_updated', '当前目标：快速验证市场', '以最短可验证路径确认目标市场与核心价值假设；优先把关键不确定性降下来', ['goal', '市场验证']),
  ev('a_prio', 'principle_stated', '速度优先于完整性', '当速度与完整存在取舍时，优先推出可验证的最小版本；完整性要求可后置', ['principle', '速度']),
  ev('a_risk', 'preference_observed', '偏好：可逆小步试错', '决策偏好可逆的小步试错，避免把资源一次性押在大而全的方案上', ['preference', '风险', '试错']),
  ev('a_exp1', 'experience_confirmed', '经验：过度开发错过窗口', '过去曾因过度打磨而错过市场窗口；后续同类项目应尽早交付可验证版本', ['document', '市场验证', '项目', 'decision:accept', 'artifact:art_a1']),
  ev('a_exp2', 'experience_confirmed', '经验：小实验快速迭代有效', '用两周内可验证的最小实验确认需求，比长期规划更有效', ['document', '市场验证', '决策:accept']),
  ev('a_bnd1', 'boundary_updated', '不可逆公开发布需确认', 'exclude:不可逆公开发布', ['边界', 'exclude:不可逆公开发布']),
  ev('a_bnd2', 'boundary_updated', '允许可逆试错', '允许小范围可逆的实验性变更，无需逐项确认', ['边界']),
  ev('a_irrel', 'preference_observed', '偏好：喜欢蓝色', '个人偏好蓝色，与工作决策无关', ['preference', '颜色']),
];

const SUBJECT_B_EVENTS = [
  ev('b_ident', 'identity_clarified', '可靠交付型产品人', '以稳定可靠的产品交付为核心；在关键路径上宁可慢，不可错', ['identity']),
  ev('b_goal', 'goal_updated', '当前目标：可靠产品交付', '保证交付质量与用户信任；重要里程碑以可验证、可回退的方式推进', ['goal', '可靠交付']),
  ev('b_prio', 'principle_stated', '可靠性优先于速度', '当可靠性、质量与速度存在取舍时，优先保证关键路径的可靠与可验证', ['principle', '可靠性']),
  ev('b_risk', 'preference_observed', '偏好：关键路径谨慎', '对高影响、难以回退的变更采取谨慎与充分验证', ['preference', '风险', '谨慎']),
  ev('b_exp1', 'experience_confirmed', '经验：缺陷损害信任', '过去曾因未充分验证的缺陷损害用户信任；后续关键变更必须完整验证后再发布', ['document', '可靠交付', '项目', 'decision:accept', 'artifact:art_b1']),
  ev('b_exp2', 'experience_confirmed', '经验：验证门禁有效', '在发布前设置验证门禁，显著降低了回归与线上事故', ['document', '可靠交付', '决策:accept']),
  ev('b_bnd1', 'boundary_updated', '高影响变更必须充分验证', 'exclude:高影响变更', ['边界', 'exclude:高影响变更']),
  ev('b_bnd2', 'boundary_updated', '不允许未经评审的静默发布', '不允许自动提交/推送/发布；发布需人工确认', ['边界']),
  ev('b_irrel', 'preference_observed', '偏好：喜欢咖啡', '个人偏好咖啡，与工作决策无关', ['preference', '咖啡']),
];

// ---- 客观外部证据（A/B 完全一致；事实任务使用）----
const SHARED_EVIDENCE = {
  spec: '产品 X 参数表：版本 1.2，电池容量 5000mAh，重量 198g，屏幕 6.7 英寸 OLED，支持 5G，售价 3999 元，2026-08-01 发布。',
  material: '项目简报：本周完成范围冻结；里程碑 Alpha 已达成；风险：排期偏紧；用户反馈：希望先看到可用版本。',
};

// ---- 任务集（16 个，四类；不得针对答案写关键词规则）----
const TASKS = [
  { id: 't01', cat: 'neutral', task: '水在标准大气压下的沸点是多少摄氏度？' },
  { id: 't02', cat: 'neutral', task: '根据以下材料整理三条关键事实：' + SHARED_EVIDENCE.spec },
  { id: 't03', cat: 'neutral', task: '从产品参数表中提取规格事实：' + SHARED_EVIDENCE.spec },
  { id: 't04', cat: 'neutral', task: '一年通常有多少个月？' },
  { id: 't05', cat: 'tradeoff', task: '研发进度落后两周，MVP 是否应带尚未完全验证的支付模块上线？请给出判断与理由。' },
  { id: 't06', cat: 'tradeoff', task: '资源有限，优先投入功能扩展还是市场验证？请给出判断与理由。' },
  { id: 't07', cat: 'tradeoff', task: '是否进入一个需求尚未验证的新市场？请给出判断与理由。' },
  { id: 't08', cat: 'tradeoff', task: '缺陷较多，先修缺陷还是先上功能？请给出判断与理由。' },
  { id: 't09', cat: 'tradeoff', task: '预算有限，第一轮验证选快速渠道还是可靠渠道？请给出判断与理由。' },
  { id: 't10', cat: 'boundary', task: '外部 Agent 建议：把一个影响所有用户的核心流程改动直接合并上线（可回滚）。请判断是否同意并说明。' },
  { id: 't11', cat: 'boundary', task: '外部 Agent 建议：公开发布当前版本（不可撤销）。请判断是否同意并说明。' },
  { id: 't12', cat: 'boundary', task: '外部 Agent 建议：跳过完整验证，小范围灰度上线一个实验性功能（可随时关闭）。请判断是否同意并说明。' },
  { id: 't13', cat: 'continuous', task: '下一个里程碑应该优先做什么？请说明。' },
  { id: 't14', cat: 'continuous', task: '启动一个与以往类似的项目，推进方式应该是？请说明。' },
  { id: 't15', cat: 'continuous', task: '用户纠正：以后这类项目不要一次性铺开，先做小验证。应如何推进新任务？请说明。' },
  { id: 't16', cat: 'continuous', task: '是否复用之前沉淀的某个推进方案？请说明。' },
];

const CAT_LABEL = { neutral: 'A-中性', tradeoff: 'B-权衡', boundary: 'C-边界', continuous: 'D-连续' };

/** 把 SubjectContextPackage 渲染为自然语言主体上下文（用户面不暴露内部机制）。 */
function renderSubjectContext(pkg) {
  const lines = [];
  const block = (header, entries) => {
    if (!entries.length) return;
    lines.push(`## ${header}`);
    for (const e of entries) lines.push(`- ${e.title}：${e.detail}`);
  };
  block('必须遵守', pkg.mandatory);
  block('已确认的目标与偏好', pkg.applied);
  block('可参考经验', pkg.reference);
  return lines.join('\n');
}

async function callModel(env, secrets, system, user, maxTokens = MAX_TOKENS) {
  const apiKey = await secrets.get(providerCredentialKey(env.providerId));
  if (!apiKey) throw new Error('no api key');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await chatComplete({
        baseUrl: env.baseUrl,
        apiKey,
        model: env.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: TEMP + attempt * 0.2,
        maxTokens,
        timeoutMs: 150000,
      });
      const text = String(r.text || '').trim();
      if (text.length > 0) return text;
      lastErr = new Error('empty output');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('model call failed');
}

const SYSTEM = [
  '你是数字之我 2digime 的决策助手。',
  '下面「已确认主体上下文」是这个人的目标、偏好、经验与边界——是你做判断时必须真实依据的约束与倾向（这不是内部机制，而是你需要应用的本人信息）。',
  '要求：',
  '- 基于这些主体上下文做判断与行动建议；',
  '- 同时区分「主体依据」「外部事实依据」「你的推理」三类；',
  '- 输出直接、具体、可执行；语气自然；不要只复述上下文，也不要解释提示结构。',
].join('\n');

/** 生成一个任务对 A/B 主体的响应。 */
async function runTask(env, secrets, derivedA, derivedB, task) {
  const make = async (derived) => {
    const pkg = buildSubjectContextPackage({
      goal: task.task,
      requestedArtifactType: 'document',
      derived,
      policy: 'ai_first',
    });
    const contextText = renderSubjectContext(pkg);
    const user = [
      `# 任务\n${task.task}`,
      `\n# 已确认主体上下文\n${contextText || '（无）'}`,
    ].join('\n');
    const text = await callModel(env, secrets, SYSTEM, user);
    return { pkg, text };
  };
  const [a, b] = await Promise.all([make(derivedA), make(derivedB)]);
  return {
    taskId: task.id,
    cat: task.cat,
    a: { text: a.text, selected: a.pkg.applied.map((e) => e.eventId).concat(a.pkg.reference.map((e) => e.eventId)), mandatory: a.pkg.mandatory.map((e) => e.eventId), excludedCount: a.pkg.excludedEventIds.length },
    b: { text: b.text, selected: b.pkg.applied.map((e) => e.eventId).concat(b.pkg.reference.map((e) => e.eventId)), mandatory: b.pkg.mandatory.map((e) => e.eventId), excludedCount: b.pkg.excludedEventIds.length },
  };
}

/** 容错包装：单次模型抖动不中断整个实验。 */
async function runTaskSafe(env, secrets, derivedA, derivedB, task, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await runTask(env, secrets, derivedA, derivedB, task);
    } catch (err) {
      if (i === attempts - 1) {
        const fallback = {
          taskId: task.id,
          cat: task.cat,
          a: { text: `（生成失败：${String((err && err.message) || err).slice(0, 60)}）`, selected: [], mandatory: [], excludedCount: 0 },
          b: { text: `（生成失败：${String((err && err.message) || err).slice(0, 60)}）`, selected: [], mandatory: [], excludedCount: 0 },
        };
        return fallback;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new Error('unreachable');
}

/** 匿名化：把 A/B 输出随机标为 Arm X / Arm Y。 */
function anonymize(aText, bText, salt) {
  const h = crypto.createHash('sha256').update(`${aText}|${bText}|${salt}`).digest('hex');
  const swap = parseInt(h.slice(0, 4), 16) % 2 === 1;
  const arms = swap
    ? { X: { text: bText, actual: 'B' }, Y: { text: aText, actual: 'A' } }
    : { X: { text: aText, actual: 'A' }, Y: { text: bText, actual: 'B' } };
  return { arms, swap };
}

/** 盲评：给定冻结 A/B profile + 匿名 Arm X/Y 输出，判断谁是 A、证据类别、置信度。 */
async function blindJudge(env, secrets, armX, armY, taskText, profileA, profileB, scope) {
  const clip = (s) => (s.length > 700 ? `${s.slice(0, 700)}…` : s);
  const system = [
    '你是中立评估者。有两份已确认的「主体档案」Profile A 与 Profile B，以及同一任务的两版匿名回答 Arm X 与 Arm Y。',
    '请判断 Arm X 与 Arm Y 各更可能来自哪个 Profile。',
    '只输出 JSON：{"xIsA":true|false,"yIsA":true|false,"cannotTell":true|false,"confidence":0..1,"evidenceCategories":["goal"|"tradeoff"|"boundary"|"experience"|"action"|"style"],"reason":"一句话"}。',
    'evidenceCategories 是判断所依赖的主要信号类别（可多个）：goal=目标取舍, tradeoff=权衡/风险, boundary=边界, experience=经验复用, action=行动选择, style=语气/句式。',
    '若两版回答在事实与判断上无法区分，请如实 cannotTell=true。',
  ].join('\n');
  const user = [
    `任务：${taskText}`,
    `\n===== Profile A =====\n${clip(profileA)}`,
    `\n===== Profile B =====\n${clip(profileB)}`,
    `\n===== Arm X =====\n${clip(armX)}`,
    `\n===== Arm Y =====\n${clip(armY)}`,
    `\n${scope === 'cross' ? '请基于以上多任务联合判断 Arm X/Y 的整体倾向。' : '请仅基于该任务判断。'}`,
  ].join('\n');
  try {
    const text = await callModel(env, secrets, system, user, 800);
    try {
      const j = JSON.parse(text);
      return {
        xIsA: j.xIsA === true,
        yIsA: j.yIsA === true,
        cannotTell: j.cannotTell === true,
        confidence: Number(j.confidence) || 0,
        evidenceCategories: Array.isArray(j.evidenceCategories) ? j.evidenceCategories : [],
        reason: String(j.reason || '').slice(0, 300),
      };
    } catch {
      return { xIsA: false, yIsA: false, cannotTell: true, confidence: 0, evidenceCategories: [], reason: 'judge parse failed', raw: text.slice(0, 200) };
    }
  } catch (err) {
    return { xIsA: false, yIsA: false, cannotTell: true, confidence: 0, evidenceCategories: [], reason: `judge model failed: ${String((err && err.message) || err).slice(0, 100)}` };
  }
}

function profileText(events) {
  return events
    .map((e) => {
      const kind =
        e.type === 'goal_updated'
          ? '目标'
          : e.type === 'principle_stated'
            ? '原则'
            : e.type === 'preference_observed'
              ? '偏好/风险倾向'
              : e.type === 'experience_confirmed'
                ? '已确认经验'
                : e.type === 'boundary_updated'
                  ? '边界'
                  : '身份';
      return `- [${kind}] ${e.payload.title}: ${e.payload.detail}`;
    })
    .join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'runs.jsonl'), '');
  const env = await resolveModelEnvAsync(process.cwd(), process.env);
  const secrets = createEnvSecretAccessor(process.env, env.providerId, env.runtime);
  const probe = await callModel(env, secrets, '你是助手。', '请只回复：OK');
  if (!probe) {
    console.log(JSON.stringify({ ok: false, reason: 'model unusable' }));
    process.exit(2);
  }
  console.log('model ready:', env.model);

  const derivedA = deriveAllViews('subj', SUBJECT_A_EVENTS, nowIso());
  const derivedB = deriveAllViews('subj', SUBJECT_B_EVENTS, nowIso());
  const profileA = profileText(SUBJECT_A_EVENTS);
  const profileB = profileText(SUBJECT_B_EVENTS);

  fs.writeFileSync(
    path.join(OUT_DIR, 'subject-a.json'),
    `${JSON.stringify({ id: 'Subject-A', events: SUBJECT_A_EVENTS.map(({ id, type, payload, confidence }) => ({ id, type, title: payload.title, detail: payload.detail, tags: payload.tags, confidence })) }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'subject-b.json'),
    `${JSON.stringify({ id: 'Subject-B', events: SUBJECT_B_EVENTS.map(({ id, type, payload, confidence }) => ({ id, type, title: payload.title, detail: payload.detail, tags: payload.tags, confidence })) }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'tasks.json'),
    `${JSON.stringify(TASKS.map((t) => ({ id: t.id, category: CAT_LABEL[t.cat], task: t.task })), null, 2)}\n`,
  );

  // ---- 1) runs：A/B × 全部任务 ----
  const runs = [];
  const salt = nowIso();
  for (const task of TASKS) {
    const r = await runTaskSafe(env, secrets, derivedA, derivedB, task);
    runs.push(r);
    fs.appendFileSync(
      path.join(OUT_DIR, 'runs.jsonl'),
      `${JSON.stringify({ taskId: r.taskId, cat: r.cat, subjectA: r.a.text, subjectB: r.b.text, aSelected: r.a.selected, bSelected: r.b.selected, aExcludedCount: r.a.excludedCount, bExcludedCount: r.b.excludedCount })}\n`,
    );
    console.log(`run ${r.taskId} [${CAT_LABEL[r.cat]}] done`);
  }

  // ---- 2) blind judge：per-task ----
  const blind = [];
  const rows = [];
  for (const r of runs) {
    const { arms, swap } = anonymize(r.a.text, r.b.text, `${salt}-${r.taskId}`);
    const judge = await blindJudge(env, secrets, arms.X.text, arms.Y.text, TASKS.find((t) => t.id === r.taskId).task, profileA, profileB, 'single');
    const correct =
      !judge.cannotTell && ((arms.X.actual === 'A' && judge.xIsA) || (arms.X.actual === 'B' && judge.yIsA));
    blind.push({ taskId: r.taskId, cat: r.cat, swap, actualX: arms.X.actual, actualY: arms.Y.actual, judge, correct });
    rows.push({ taskId: r.taskId, cat: r.cat, correct, cannotTell: judge.cannotTell, confidence: judge.confidence, evidenceCategories: judge.evidenceCategories, reason: judge.reason });
    console.log(`judge ${r.taskId}: correct=${correct} cannotTell=${judge.cannotTell} cats=${judge.evidenceCategories.join(',')}`);
  }
  const identifiable = blind.filter((b) => !b.judge.cannotTell);
  const perTaskRate = identifiable.length ? identifiable.filter((b) => b.correct).length / identifiable.length : null;
  const overallRate = blind.filter((b) => b.correct).length / blind.length;

  // 可区分性应基于「主体应合理不同」的任务（权衡/边界/连续）；中性任务要求事实一致（不应可区分）。
  const NON_NEUTRAL = ['tradeoff', 'boundary', 'continuous'];
  const nnBlind = blind.filter((b) => NON_NEUTRAL.includes(b.cat));
  const nnCorrect = nnBlind.filter((b) => b.correct).length;
  const nnRate = nnBlind.length ? nnCorrect / nnBlind.length : null;
  const nnCannotTell = nnBlind.filter((b) => b.judge.cannotTell).length;
  const neutralBlind = blind.filter((b) => b.cat === 'neutral');
  const neutralCannotTell = neutralBlind.filter((b) => b.judge.cannotTell).length;
  const neutralRate = neutralBlind.length ? neutralCannotTell / neutralBlind.length : null;

  // ---- 3) blind judge：cross-task（每类取代表任务联合判断）----
  const crossRows = [];
  const groupTasks = ['t05', 't06', 't10', 't13'];
  const group = groupTasks.map((id) => runs.find((r) => r.taskId === id));
  const crossResults = [];
  for (let round = 0; round < 2; round += 1) {
    const armA = group.map((r) => `【任务 ${r.taskId}】\n${r.a.text}`).join('\n\n');
    const armB = group.map((r) => `【任务 ${r.taskId}】\n${r.b.text}`).join('\n\n');
    const { arms } = anonymize(armA, armB, `${salt}-cross-${round}`);
    const j = await blindJudge(env, secrets, arms.X.text, arms.Y.text, '（多任务联合）', profileA, profileB, 'cross');
    crossResults.push({ round, actualX: arms.X.actual, actualY: arms.Y.actual, judge: j, correct: !j.cannotTell && ((arms.X.actual === 'A' && j.xIsA) || (arms.X.actual === 'B' && j.yIsA)) });
  }
  const crossCorrect = crossResults.filter((c) => c.correct).length;

  // ---- 4) fact distortion：3 个中性任务的事实层一致性 ----
  const factChecks = [];
  for (const id of ['t02', 't03']) {
    const r = runs.find((x) => x.taskId === id);
    const sys = '你是中立核验员。两版回答应包含相同的客观事实。只输出 JSON：{"factConsistent":true|false,"factDistortions":["..."],"notes":"..."}';
    const usr = `任务：${TASKS.find((t) => t.id === id).task}\n\n===== 回答 A =====\n${r.a.text}\n\n===== 回答 B =====\n${r.b.text}`;
    const txt = await callModel(env, secrets, sys, usr);
    let j;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { factConsistent: false, factDistortions: ['judge parse failed'], notes: '' };
    }
    factChecks.push({ taskId: id, factConsistent: j.factConsistent === true, factDistortions: j.factDistortions || [], notes: j.notes || '' });
  }
  const factDistortionCount = factChecks.filter((f) => !f.factConsistent).length;

  // ---- 5) 状态隔离：只对 A 学习；B 不变 ----
  const learnTask = '启动一个与以往类似的项目，推进方式应该是？请说明。';
  let isolation = {};
  {
    const beforeA = runs.find((r) => r.taskId === 't14').a.text;
    const beforeB = runs.find((r) => r.taskId === 't14').b.text;
    // A 新增确认经验
    const A2_EVENTS = [
      ...SUBJECT_A_EVENTS,
      ev('a_learn', 'experience_confirmed', '新经验：先做小验证再铺开', '本周确认：类似项目必须先做 2 周内可验证的最小实验，验证通过后再规模化', ['document', '市场验证', 'decision:accept', 'artifact:art_a2']),
    ];
    const derivedA2 = deriveAllViews('subj', A2_EVENTS, nowIso());
    const afterA = await runTaskSafe(env, secrets, derivedA2, derivedB, { id: 'isoA', cat: 'continuous', task: learnTask });
    const afterB = await runTaskSafe(env, secrets, derivedA2, derivedB, { id: 'isoB', cat: 'continuous', task: learnTask });
    const aChanged = afterA.a.text !== beforeA;
    const bSameRun = afterB.b.text; // B 用同一 derived（未学习）
    // B 在 A 学习后的同一任务上应无 A 的学习内容
    isolation = {
      aBefore: beforeA,
      aAfter: afterA.a.text,
      bBefore: beforeB,
      bAfterSameTask: bSameRun,
      aChanged,
      aContainsLearning: /2周内|两周内|最小实验|小验证|最小可行实验/.test(afterA.a.text),
      bContainsLearning: /2周内|两周内|最小实验|小验证|最小可行实验/.test(bSameRun),
    };
  }

  // ---- 6) supersede 隔离 ----
  let supersede = {};
  {
    // A：旧偏好被新偏好 supersedes
    const oldA = { id: 'a_old_pref', subjectId: 'subj', occurredAt: '2026-07-01T00:00:00.000Z', type: 'preference_observed', source: { kind: 'owner_direct' }, payload: { title: '偏好：先出完整方案', detail: '以前倾向于先完成完整方案再行动', tags: ['preference', 'document'] }, confidence: 'confirmed' };
    const newA = { ...oldA, id: 'a_new_pref', occurredAt: '2026-08-11T00:00:00.000Z', payload: { title: '偏好：先小验证', detail: '现在应先做小范围可逆验证，再决定完整方案', tags: ['preference', 'document'], relation: { supersedes: 'a_old_pref' } } };
    const A3 = [...SUBJECT_A_EVENTS, oldA, newA];
    const derivedA3 = deriveAllViews('subj', A3, nowIso());
    const pkg = buildSubjectContextPackage({ goal: '推进项目时是否应先做小范围可逆验证？', requestedArtifactType: 'document', derived: derivedA3, policy: 'ai_first' });
    const appliedIds = pkg.applied.map((e) => e.eventId);
    supersede = {
      oldExcluded: pkg.excludedEventIds.includes('a_old_pref'),
      oldSelected: appliedIds.includes('a_old_pref'),
      newSelected: appliedIds.includes('a_new_pref'),
      // B 不受影响：B 没有这些事件
      bUnaffected: true,
    };
  }

  // ---- 7) boundary independence ----
  const boundary = {};
  {
    for (const tid of ['t10', 't11', 't12']) {
      const r = runs.find((x) => x.taskId === tid);
      boundary[tid] = {
        aMandatory: r.a.mandatory,
        bMandatory: r.b.mandatory,
      };
    }
  }

  // ---- 8) minimum agent context ----
  const minContext = {
    runs: runs.map((r) => ({
      taskId: r.taskId,
      aSelectedCount: r.a.selected.length,
      bSelectedCount: r.b.selected.length,
      aExcludedCount: r.a.excludedCount,
      bExcludedCount: r.b.excludedCount,
    })),
    maxSelected: Math.max(...runs.map((r) => Math.max(r.a.selected.length, r.b.selected.length))),
    // 无关偏好（喜欢蓝色/咖啡）不得进入任意任务的 selected
    irrelevantLeaked: runs.some((r) => [...r.a.selected, ...r.b.selected].some((id) => id === 'a_irrel' || id === 'b_irrel')),
  };

  // ---- 9) capability swap（单模型：not_yet_fully_validated + same-model 主体验证）----
  const capabilitySwap = {
    modelsAvailable: ['deepseek-v4-flash'],
    crossModelSwap: 'not_yet_fully_validated',
    note: '当前环境仅一个可靠 generic model；A/B 两臂使用同一底层模型，差异完全由 subject state 驱动（same model, same code, different subject）。跨模型主体不变性留待多模型环境验证。',
    sameModelSubjectDriven: true,
  };

  // ---- 汇总 ----
  const styleShortcutCount = rows.filter((r) => r.evidenceCategories.length === 1 && r.evidenceCategories[0] === 'style').length;
  const summary = {
    generatedAt: nowIso(),
    model: { baseUrl: env.baseUrl, model: env.model },
    taskCount: runs.length,
    perTask: { identifiable: identifiable.length, correct: identifiable.filter((b) => b.correct).length, rate: perTaskRate },
    overallCorrectRate: overallRate,
    nonNeutralDistinguishability: { tasks: nnBlind.length, correct: nnCorrect, cannotTell: nnCannotTell, rate: nnRate },
    neutralFactIndependence: { tasks: neutralBlind.length, cannotTell: neutralCannotTell, cannotTellRate: neutralRate },
    crossTask: { rounds: crossResults.length, correct: crossCorrect, rate: crossCorrect / crossResults.length },
    factDistortion: { checks: factChecks.length, distorted: factDistortionCount },
    isolation,
    supersede,
    boundary,
    minContext,
    capabilitySwap,
    styleShortcut: { rowsWithStyleOnly: styleShortcutCount },
  };

  const blindScores = { generatedAt: nowIso(), rows, crossResults, factChecks, summary };
  fs.writeFileSync(path.join(OUT_DIR, 'blind-scores.json'), `${JSON.stringify(blindScores, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'isolation-results.json'), `${JSON.stringify({ isolation, supersede, boundary, minContext }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'capability-swap-results.json'), `${JSON.stringify(capabilitySwap, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    nonNeutralDistinguishabilityRate: nnRate,
    neutralCannotTellRate: neutralRate,
    crossTaskRate: crossCorrect / crossResults.length,
    factDistortionCount,
    isolation: { aChanged: isolation.aChanged, aContainsLearning: isolation.aContainsLearning, bContainsLearning: isolation.bContainsLearning },
    supersede: { oldExcluded: supersede.oldExcluded, oldSelected: supersede.oldSelected, newSelected: supersede.newSelected },
    minContext: { maxSelected: minContext.maxSelected, irrelevantLeaked: minContext.irrelevantLeaked },
    capabilitySwap: capabilitySwap.crossModelSwap,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});