/**
 * 2DIGIME-BUILD-01-AI-CTO-CONTRACT-RELIABILITY-FIX-25
 * 输出合同：围栏/杂文提取、字段类型、截断诊断、精准 repair、双失败降级；
 * 降级 CTO 不得通过 Owner 闸门。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  buildAiCtoEvidencePack,
  buildAiDigitalMeCtoReview,
  buildCtoRepairUserMessage,
  diagnoseAiCtoParse,
  parseAiCtoReviewOutput,
  CTO_CONTRACT_DEGRADED_MARKER,
} from '../ai-cto-review';
import { buildOwnerAcceptanceSummaryAsync } from '../acceptance-summary';
import { extractUnderstandingPaths } from '../execution-verifier';
import {
  ctoConclusionLooksDegraded,
  ownerGateRejectsDegradedCto,
} from '../../work-runtime/revision-completion';

const root = path.resolve(__dirname, '../../..');

const input = {
  userGoal: '把 start 的返回值改成 done，并同步测试',
  originalTaskGoal: '使 start 返回 start-processing，并运行测试',
  revisionRequest: '把 start 的返回值改成 done，并同步测试',
  currentRoundAuthority: 'owner_revision' as const,
  artifactVersionId: 'ver_2',
  jobId: 'job_2',
  testResults: [{ command: 'npm test', passed: true, summary: 'ok' }],
  changedFileExcerpts: [
    { path: 'formatLabel.js', excerpt: '+  if (input === "start") return "done";' },
  ],
  verification: {
    overall: 'satisfied' as const,
    digitalMeVerified: true,
    agentClaimedSuccess: true,
    checks: [
      { id: 'file_changes', title: '文件变化', verdict: 'satisfied' as const, detail: '1 个文件' },
      { id: 'tests_passed', title: '测试', verdict: 'satisfied' as const, detail: '通过' },
      { id: 'scope_boundary', title: '范围', verdict: 'satisfied' as const, detail: '已核对' },
      { id: 'git_integrity', title: '版本状态', verdict: 'satisfied' as const, detail: '已核对' },
      { id: 'build_check', title: '构建', verdict: 'satisfied' as const, detail: '已通过' },
    ],
  },
  changedFileCount: 1,
  changedFiles: ['formatLabel.js'],
};

const validPayload = {
  decision: 'meets_plan',
  canUse: '可以试用当前版本。',
  goalAttained: '已按本轮要求改为 done，并完成测试。',
  needChange: '不是必须再改。',
  nextStep: '建议采用这一版成果。',
  userSummary: 'formatLabel 已改为 done，测试通过。',
  completed: ['返回值改为 done', '测试通过'],
  gaps: [],
  evidenceRefs: ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
  risks: ['不会自动提交或发布'],
  nextAction: '你可以确认采用这一版成果。',
};

describe('ai-cto-contract-reliability-fix-25', () => {
  it('提取 Markdown 围栏 JSON', () => {
    const parsed = parseAiCtoReviewOutput(
      `请看结论：\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n`,
      ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
    );
    assert.ok(parsed);
    assert.equal(parsed!.decision, 'meets_plan');
    assert.match(parsed!.goalAttained, /done/);
  });

  it('提取前后杂文中的 JSON', () => {
    const parsed = parseAiCtoReviewOutput(
      `下面是验收结论，请查收。\n${JSON.stringify(validPayload)}\n以上仅供核对。`,
      ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
    );
    assert.ok(parsed);
    assert.equal(parsed!.canUse, '可以试用当前版本。');
  });

  it('risks 为字符串时仍可解析', () => {
    const parsed = parseAiCtoReviewOutput(
      JSON.stringify({ ...validPayload, risks: '不会自动提交、推送或发布。' }),
      ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
    );
    assert.ok(parsed);
    assert.equal(parsed!.risks.length, 1);
    assert.match(parsed!.risks[0]!, /不会自动提交/);
  });

  it('截断输出记录 finish_reason 且 failStep 为 json_parse_error', () => {
    const diag = diagnoseAiCtoParse(
      '{"decision":"meets_plan","canUse":"可以试用',
      ['check:file_changes'],
      { attempt: 1, finishReason: 'length', truncated: true },
    );
    assert.equal(diag.truncated, true);
    assert.equal(diag.finishReason, 'length');
    assert.equal(diag.foundJson, false);
    assert.equal(diag.jsonParseOk, false);
    assert.equal(diag.failStep, 'json_parse_error');
    assert.match(buildCtoRepairUserMessage(diag, ['check:file_changes']), /截断|合法 JSON/);
  });

  it('缺失字段诊断指向具体字段，repair 不是泛化重试', () => {
    const diag = diagnoseAiCtoParse(
      JSON.stringify({ decision: 'meets_plan', evidenceRefs: ['check:file_changes'] }),
      ['check:file_changes'],
    );
    assert.equal(diag.failStep, 'missing_or_invalid_fields');
    assert.ok(diag.missingOrTypedWrong.includes('canUse'));
    const repair = buildCtoRepairUserMessage(diag, ['check:file_changes']);
    assert.match(repair, /canUse/);
    assert.doesNotMatch(repair, /上一次输出无法验收。请只输出一个合法 JSON 对象；evidenceRefs 只能使用证据包中的引用/);
  });

  it('illegal decision 单独诊断', () => {
    const diag = diagnoseAiCtoParse(
      JSON.stringify({ ...validPayload, decision: 'ship_it' }),
      ['check:file_changes', 'check:tests_passed', 'file:formatLabel.js'],
    );
    assert.equal(diag.illegalDecision, true);
    assert.equal(diag.failStep, 'illegal_decision');
  });

  it('第一次失败后按具体错误 repair，第二次成功', async () => {
    const calls: Array<{ content: string }> = [];
    const review = await buildAiDigitalMeCtoReview(input, async ({ messages }) => {
      calls.push({ content: String(messages[messages.length - 1]?.content || '') });
      if (calls.length === 1) {
        return { text: '{"decision":"meets_plan","evidenceRefs":["check:file_changes"]}' };
      }
      return { text: JSON.stringify(validPayload) };
    });
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.content, /缺少或类型错误的字段/);
    assert.equal(review.ctoContractDegraded, undefined);
    assert.equal(review.decision, 'meets_plan');
    assert.equal(review.primaryAction, 'confirm_adopt');
    assert.equal(review.ctoParseDiagnosis?.length, 2);
    assert.equal(review.ctoParseDiagnosis?.[0]?.failStep, 'missing_or_invalid_fields');
  });

  it('两次都失败则合同降级：保留五项但不建议采用，不冒充通过', async () => {
    const summary = await buildOwnerAcceptanceSummaryAsync(input, async () => ({
      text: 'not-json',
      finishReason: 'stop',
    }));
    assert.equal(summary.ctoContractDegraded, true);
    assert.equal(summary.canAdoptSuggested, false);
    assert.equal(summary.recommendation, '请重新验证');
    assert.match(String(summary.ctoReport || ''), new RegExp(CTO_CONTRACT_DEGRADED_MARKER));
    assert.match(String(summary.ctoReport || ''), /现在能不能用/);
    assert.equal(summary.ctoReview?.decision, 'insufficient_evidence');
    assert.notEqual(summary.headline, '工程已达到规划，可以试用');
    const gate = ownerGateRejectsDegradedCto({
      ...(summary.ctoReport ? { ctoText: summary.ctoReport } : {}),
      ctoContractDegraded: true,
      canAdoptSuggested: false,
    });
    assert.equal(gate.pass, false);
    assert.equal(gate.reason, 'cto_contract_degraded');
  });

  it('降级 CTO 不得通过 Owner 闸门', () => {
    assert.equal(ctoConclusionLooksDegraded('这是验收合同失败，不是完整的专业判断。'), true);
    assert.equal(
      ctoConclusionLooksDegraded('现在能不能用：可以试用。\n是否达到目标：已改为 done。'),
      false,
    );
    const rejected = ownerGateRejectsDegradedCto({
      ctoText: '这是暂时性判断，还不是完整的 AI CTO 分析。',
      canAdoptSuggested: true,
    });
    assert.equal(rejected.pass, false);
    assert.equal(rejected.reason, 'degraded_template');
    assert.equal(ownerGateRejectsDegradedCto({ ctoText: '可以试用当前版本。' }).pass, true);
  });

  it('证据包含本轮权威目标、v2、测试与摘录，并滤掉过期 locate 失败', () => {
    const pack = buildAiCtoEvidencePack({
      ...input,
      unresolvedItems: ['无需修改，当前代码已满足目标', '仍有范围外文件'],
      agentSummaryExcerpt: [
        '## 目标',
        '使 start 返回 start-processing',
        '## 发生了什么',
        '已把 formatLabel 改为 done，并同步测试。',
        '## 风险',
        '- 无需修改',
      ].join('\n'),
    });
    assert.equal(pack.goal, input.userGoal);
    assert.equal(pack.artifactVersionId, 'ver_2');
    assert.equal(pack.jobId, 'job_2');
    assert.equal(pack.testResults?.[0]?.passed, true);
    assert.equal(pack.changedFileExcerpts?.[0]?.path, 'formatLabel.js');
    assert.ok(!pack.unresolvedItems.some((item) => /无需修改/.test(item)));
    assert.match(String(pack.agentSummary || ''), /改为 done/);
    assert.doesNotMatch(String(pack.agentSummary || ''), /start-processing/);
  });

  it('裸文件名 formatLabel.js 可被路径抽取命中', () => {
    const paths = extractUnderstandingPaths('请修改 formatLabel.js 并同步测试');
    assert.ok(paths.includes('formatLabel.js'));
  });

  it('源码：结构化输出、精准 repair、闸门拒绝降级；不恢复 parsed=null 执行', async () => {
    const reviewSrc = await fs.readFile(path.join(root, 'src/execution/ai-cto-review.ts'), 'utf8');
    const runtime = await fs.readFile(path.join(root, 'src/runtime/digitalme-runtime.ts'), 'utf8');
    const gate = await fs.readFile(
      path.join(root, 'scripts/electron-cto-real-main-gate-20a-entry.cjs'),
      'utf8',
    );
    const converse = await fs.readFile(path.join(root, 'src/work-runtime/work-converse.ts'), 'utf8');
    assert.match(reviewSrc, /AI_CTO_JSON_SCHEMA/);
    assert.match(reviewSrc, /buildCtoRepairUserMessage/);
    assert.match(reviewSrc, /ctoContractDegraded:\s*true/);
    assert.match(runtime, /json_schema/);
    assert.match(runtime, /finishReason/);
    assert.match(gate, /revision_cto_not_degraded/);
    assert.match(gate, /ownerGateRejectsDegradedCto/);
    assert.doesNotMatch(
      converse,
      /parsed[\s\S]{0,200}isClearOwnerDirectedRevision[\s\S]{0,200}startAuthorized:\s*true/,
    );
  });
});
