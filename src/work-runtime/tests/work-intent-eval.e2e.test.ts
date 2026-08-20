/**
 * D11-A 意图评测（真实模型 e2e；设计 v0.2 §16.2 退出标准）。
 * 无凭证时 skip，不伪造成功。
 *
 * 退出标准：
 * - ≥50 条真实风格输入；
 * - 非执行输入误判执行（导致 startAuthorized/adoptRequested）= 0；
 * - 低置信度必须澄清（策略层确定性保证，此处复核）；
 * - 总体意图判定正确率 ≥95%（ambiguous 样本澄清视为正确）；
 * - 模型不可用路径由单元测试覆盖（不得从自然语言创建 Job）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { chatComplete } from '../../infrastructure/model-http';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} from '../../infrastructure/env-secrets';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import {
  buildConverseMessages,
  decideConverseEffects,
  parseConverseModelOutput,
  LOW_CONFIDENCE_THRESHOLD,
  type ConverseTaskFacts,
} from '../work-converse';
import {
  WORK_INTENT_EVAL_CASES,
  WORK_INTENT_EVAL_MIN_ACCURACY,
  WORK_INTENT_EVAL_MIN_CASES,
  type WorkIntentEvalCase,
} from '../work-intent-eval-dataset';

const GOAL = '做一个能在浏览器里玩的打飞机小游戏';
const PLAN_CONTENT = '目标：打飞机小游戏\n交付：可在浏览器打开的网页版\n路径：先做移动、射击、敌机、计分的基础版\n边界：不联网、无广告';

function factsFor(c: WorkIntentEvalCase): { facts: ConverseTaskFacts; planStatus: 'draft' | 'confirmed' } {
  switch (c.context) {
    case 'pre_start':
      return { facts: { stageLabel: '等待开始', hasArtifact: false, jobRunning: false }, planStatus: 'draft' };
    case 'executing':
      return { facts: { stageLabel: '处理中', hasArtifact: false, jobRunning: true }, planStatus: 'confirmed' };
    case 'has_artifact':
      return { facts: { stageLabel: '需要你确认', hasArtifact: true, jobRunning: false }, planStatus: 'confirmed' };
    case 'failed':
      return {
        facts: {
          stageLabel: '执行失败',
          hasArtifact: false,
          jobRunning: false,
          lastFailure: '本轮执行未能完成：依赖安装失败。',
        },
        planStatus: 'confirmed',
      };
  }
}

test('D11-A 意图评测：≥50 条真实输入，误建执行=0，正确率≥95%', async (t) => {
  const modelEnv = await resolveModelEnvAsync(process.cwd(), process.env);
  const secrets = createEnvSecretAccessor(process.env, modelEnv.providerId, modelEnv.runtime);
  const apiKey = await secrets.get(providerCredentialKey(modelEnv.providerId));
  if (!apiKey) {
    t.skip('no model credential; eval requires real model (no fabricated success)');
    return;
  }

  assert.ok(WORK_INTENT_EVAL_CASES.length >= WORK_INTENT_EVAL_MIN_CASES);

  const results: Array<{
    id: string;
    text: string;
    context: string;
    expected: string[];
    predicted: string | null;
    confidence: number | null;
    needsClarification: boolean;
    correct: boolean;
    falseExecution: boolean;
  }> = [];

  const runCase = async (c: WorkIntentEvalCase) => {
    const { facts, planStatus } = factsFor(c);
    const messages = buildConverseMessages({
      goal: GOAL,
      facts,
      plan: {
        version: 1,
        status: planStatus,
        content: PLAN_CONTENT,
        updatedAt: new Date().toISOString(),
      },
      recentTurns: [
        { role: 'user', content: GOAL },
        { role: 'digital_me', content: '我理解你想要一个网页版打飞机小游戏，规划见右侧，可以随时补充。' },
      ],
      userText: c.text,
    });
    let parsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await chatComplete({
          baseUrl: modelEnv.baseUrl,
          apiKey,
          model: modelEnv.model,
          messages,
          temperature: 0,
          maxTokens: 768,
          timeoutMs: 90_000,
        });
        parsed = parseConverseModelOutput(out.text);
        if (parsed) break;
      } catch {
        parsed = null;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
      }
    }
    const decision = decideConverseEffects({
      parsed,
      modelAvailable: true,
      hasArtifact: facts.hasArtifact,
      jobRunning: facts.jobRunning,
    });
    const predicted = parsed ? parsed.intent : null;
    const clarified = decision.needsClarification;
    const correct =
      (predicted !== null && (c.expected as string[]).includes(predicted)) ||
      (c.ambiguous === true && clarified);
    const falseExecution =
      c.nonExecution === true && (decision.startAuthorized || decision.adoptRequested);
    results.push({
      id: c.id,
      text: c.text,
      context: c.context,
      expected: c.expected as string[],
      predicted,
      confidence: parsed ? parsed.confidence : null,
      needsClarification: clarified,
      correct,
      falseExecution,
    });
  };

  // 有限并发，避免触发模型侧限流导致解析失败假阴性
  const queue = [...WORK_INTENT_EVAL_CASES];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      if (!c) break;
      await runCase(c);
    }
  });
  await Promise.all(workers);

  const total = results.length;
  const correctCount = results.filter((r) => r.correct).length;
  const accuracy = correctCount / total;
  const falseExecutions = results.filter((r) => r.falseExecution);
  const lowConfNotClarified = results.filter(
    (r) => r.confidence !== null && r.confidence < LOW_CONFIDENCE_THRESHOLD && !r.needsClarification,
  );

  const evidenceDir = path.resolve(
    process.cwd(),
    'scripts',
    '_software-work-quality-loop-01-evidence',
  );
  await fs.mkdir(evidenceDir, { recursive: true });
  const summary = {
    task: '2DIGIME-BUILD-01-D11-A-AI-INTERACTION-KERNEL-12',
    generatedAt: new Date().toISOString(),
    model: { baseUrlHost: new URL(modelEnv.baseUrl).host, model: modelEnv.model },
    total,
    correctCount,
    accuracy: Number(accuracy.toFixed(4)),
    falseExecutionCount: falseExecutions.length,
    lowConfidenceNotClarified: lowConfNotClarified.length,
    thresholds: { minCases: WORK_INTENT_EVAL_MIN_CASES, minAccuracy: WORK_INTENT_EVAL_MIN_ACCURACY },
    mistakes: results.filter((r) => !r.correct),
    results,
  };
  await fs.writeFile(
    path.join(evidenceDir, 'work-intent-eval-latest.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );

  t.diagnostic(
    `intent eval: ${correctCount}/${total} correct (${(accuracy * 100).toFixed(1)}%), falseExecution=${falseExecutions.length}`,
  );

  assert.equal(falseExecutions.length, 0, `非执行输入误判执行: ${JSON.stringify(falseExecutions)}`);
  assert.equal(lowConfNotClarified.length, 0);
  assert.ok(
    accuracy >= WORK_INTENT_EVAL_MIN_ACCURACY,
    `accuracy ${(accuracy * 100).toFixed(1)}% < 95%; mistakes: ${JSON.stringify(summary.mistakes.map((m) => ({ id: m.id, predicted: m.predicted })))}`,
  );
});
