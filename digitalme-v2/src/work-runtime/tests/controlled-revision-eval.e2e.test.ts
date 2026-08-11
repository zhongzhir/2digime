/**
 * D11-D 真实模型抽样评测；无凭证时明确跳过，绝不伪造评测结果。
 * 验证：归因（AI 提示 + 规则校验）与第二次失败换方案的实质差异。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { chatComplete } from '../../infrastructure/model-http';
import { createEnvSecretAccessor, resolveModelEnvAsync } from '../../infrastructure/env-secrets';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import {
  REVISION_ATTRIBUTIONS,
  resolveAttribution,
  schemesSubstantiallyDifferent,
} from '../controlled-revision';
import {
  CONTROLLED_REVISION_EVAL_CASES,
  CONTROLLED_REVISION_EVAL_MIN_CASES,
} from '../controlled-revision-dataset';

test('D11-D 真实模型评测：归因与第二次失败换方案', async (t) => {
  const modelEnv = await resolveModelEnvAsync(process.cwd(), process.env);
  const secrets = createEnvSecretAccessor(process.env, modelEnv.providerId, modelEnv.runtime);
  const apiKey = await secrets.get(providerCredentialKey(modelEnv.providerId));
  if (!apiKey) {
    t.skip('no model credential; eval requires real model (no fabricated success)');
    return;
  }

  assert.ok(CONTROLLED_REVISION_EVAL_CASES.length >= CONTROLLED_REVISION_EVAL_MIN_CASES);
  const cases = CONTROLLED_REVISION_EVAL_CASES.filter((c) => c.expectedAction === 'auto_revise').slice(
    0,
    8,
  );
  const attributionList = REVISION_ATTRIBUTIONS.join(' | ');
  const results: Array<{
    id: string;
    expected: string;
    predicted: string | null;
    resolved: string;
    rewrittenPlan: string | null;
    substantiallyDifferent: boolean;
  }> = [];

  for (const c of cases) {
    let text = '';
    for (let attempt = 0; attempt < 2 && !text; attempt += 1) {
      try {
        const out = await chatComplete({
          baseUrl: modelEnv.baseUrl,
          apiKey,
          model: modelEnv.model,
          temperature: 0,
          maxTokens: 500,
          timeoutMs: 90_000,
          responseFormat: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是失败诊断助手。只输出一个 JSON 对象，字段：attribution、revisedPlan。' +
                `attribution 必须是以下之一：${attributionList}。` +
                'revisedPlan 必须是与前次方案实质不同的中文修订方向（改步骤/证据/切入点，不要同义改写）。不要输出推理过程。',
            },
            {
              role: 'user',
              content: `失败事实：${JSON.stringify(c.evidence)}\n前次方案：修复相关实现并重新运行检查。`,
            },
          ],
        });
        text = out.text;
      } catch {
        text = '';
      }
    }
    let parsed: { attribution?: unknown; revisedPlan?: unknown } = {};
    try {
      parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as typeof parsed;
    } catch {
      /* 记录解析失败 */
    }
    const predicted =
      typeof parsed.attribution === 'string' &&
      (REVISION_ATTRIBUTIONS as readonly string[]).includes(parsed.attribution)
        ? parsed.attribution
        : null;
    const rewrittenPlan =
      typeof parsed.revisedPlan === 'string' && parsed.revisedPlan.trim()
        ? parsed.revisedPlan.trim()
        : null;
    const resolved = resolveAttribution(predicted ?? undefined, c.evidence);
    results.push({
      id: c.id,
      expected: c.expectedAttribution,
      predicted,
      resolved,
      rewrittenPlan,
      substantiallyDifferent:
        !!rewrittenPlan &&
        schemesSubstantiallyDifferent('修复相关实现并重新运行检查。', rewrittenPlan),
    });
  }

  const evidenceDir = path.resolve(process.cwd(), 'scripts', '_software-work-quality-loop-01-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'controlled-revision-eval-latest.json');
  const attributionHits = results.filter((r) => r.resolved === r.expected).length;
  const differentSchemes = results.filter((r) => r.substantiallyDifferent).length;
  await fs.writeFile(
    evidencePath,
    JSON.stringify(
      {
        task: 'D11-D-controlled-revision',
        generatedAt: new Date().toISOString(),
        model: { baseUrlHost: new URL(modelEnv.baseUrl).host, model: modelEnv.model },
        attributionHits,
        attributionTotal: results.length,
        differentSchemes,
        results,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  t.diagnostic(
    `D11-D eval: attribution ${attributionHits}/${results.length}, differentSchemes=${differentSchemes}; wrote ${evidencePath}`,
  );
  assert.equal(results.length, 8);
  // 规则校验后的归因一致率；允许模型偶发空字段，但规则必须能从证据归出
  assert.ok(attributionHits / results.length >= 0.75, '规则校验后归因一致率应 ≥75%');
  assert.ok(differentSchemes >= 3, '至少 3 个第二次方案判定为实质不同');
});
