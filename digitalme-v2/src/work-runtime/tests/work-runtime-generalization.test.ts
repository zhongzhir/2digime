/**
 * DIGITALME-V2-WORK-RUNTIME-GENERALIZATION-01 — 单元覆盖
 * intentKind / selectForNeed / outcome dispatch / 禁止写作伪装
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../../capability/registry';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import type { CapabilityRegistration } from '../../capability/registration';
import {
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_REPO_ANALYSIS_CAPABILITY_ID,
  buildCodeRepoAnalysisRegistration,
} from '../../capability/adapters/code-repo-analysis-contract';
import { deriveWorkIntentSync } from '../work-intent';
import { checkBundleOutcome, dispatchOutcomeCheck } from '../outcome-dispatch';

function stubFromRegistration(registration: CapabilityRegistration) {
  return asLocalCapabilityAdapter({
    registration,
    async execute() {
      return {
        artifact: {
          type: registration.outputArtifactTypes[0] || 'document',
          title: 'stub',
          payload: { kind: 'text', text: 'x', format: 'markdown' },
        },
      };
    },
  });
}

function documentRegistration(
  availability: CapabilityRegistration['availability'] = 'available',
): CapabilityRegistration {
  return {
    id: 'cap_document_openai',
    kind: 'model',
    displayName: '文档生成',
    description: '写作',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network', 'secret_access'],
    cost: { estimate: 'tokens' },
    latencyEstimate: 'seconds',
    location: 'local',
    availability,
    adapter: { type: 'openai-compatible-model', adapterId: 'document' },
  };
}

test('deriveWorkIntentSync: 代码材料+分析目标 → analyze_code', () => {
  const intent = deriveWorkIntentSync({
    goal: '分析这个代码仓库的问题清单',
    contextRefs: [{ kind: 'folder', path: 'D:/repo' }],
    materialKinds: ['code_repo'],
  });
  assert.equal(intent.intentKind, 'analyze_code');
  assert.equal(intent.expectedOutputFamily, 'code-analysis');
  assert.ok(intent.userFacingNotice);
  assert.equal(intent.highConfidence, true);
});

test('deriveWorkIntentSync: 写作目标 → create_document', () => {
  const intent = deriveWorkIntentSync({
    goal: '写一篇周报总结本周进展',
    contextRefs: [],
  });
  assert.equal(intent.intentKind, 'create_document');
  assert.equal(intent.expectedOutputFamily, 'document');
});

test('deriveWorkIntentSync: 模糊词不单独切能力', () => {
  const intent = deriveWorkIntentSync({
    goal: '看看这个',
    contextRefs: [{ kind: 'folder', path: 'D:/repo' }],
    materialKinds: ['code_repo'],
  });
  assert.equal(intent.intentKind, 'general');
});

test('deriveWorkIntentSync: 显式外部研究能力', () => {
  const intent = deriveWorkIntentSync({
    goal: '研究竞品',
    contextRefs: [],
    explicitCapabilityId: 'cap_a2a_research_analysis',
  });
  assert.equal(intent.intentKind, 'external_research');
});

test('selectForNeed: 显式优先；analyze_code 不回退写作', () => {
  const registry = new CapabilityRegistry();
  registry.register(stubFromRegistration(documentRegistration()));
  registry.register(
    stubFromRegistration(buildCodeRepoAnalysisRegistration('needs_setup')),
  );

  const explicit = registry.selectForNeed({
    explicitCapabilityId: 'cap_document_openai',
    intentKind: 'analyze_code',
  });
  assert.equal(explicit.reason, 'explicit');
  assert.equal(explicit.adapter?.registration.id, 'cap_document_openai');

  const denied = registry.selectForNeed({
    intentKind: 'analyze_code',
    expectedOutputFamily: CODE_ANALYSIS_ARTIFACT_TYPE,
    materialKinds: ['code_repo'],
  });
  assert.equal(denied.reason, 'none');
  assert.ok(denied.actionable && /不会改用普通写作冒充/.test(denied.actionable));
  assert.equal(denied.adapter, undefined);

  const viaCompat = registry.selectFor('document');
  assert.equal(viaCompat?.registration.id, 'cap_document_openai');
});

test('selectForNeed: 意图+材料命中代码分析', () => {
  const registry = new CapabilityRegistry();
  registry.register(stubFromRegistration(documentRegistration()));
  registry.register(stubFromRegistration(buildCodeRepoAnalysisRegistration('available')));
  const hit = registry.selectForNeed({
    intentKind: 'analyze_code',
    expectedOutputFamily: CODE_ANALYSIS_ARTIFACT_TYPE,
    materialKinds: ['code_repo'],
  });
  assert.equal(hit.reason, 'intent_material');
  assert.equal(hit.adapter?.registration.id, CODE_REPO_ANALYSIS_CAPABILITY_ID);
});

test('checkBundleOutcome: 缺 evidence 则 blocked', () => {
  const bad = checkBundleOutcome([{ role: 'report' }, { role: 'manifest' }]);
  assert.equal(bad.verdict, 'blocked');
  assert.ok(bad.defects.some((d) => /evidence/.test(d)));

  const ok = checkBundleOutcome([
    { role: 'report' },
    { role: 'manifest' },
    { role: 'evidence' },
  ]);
  assert.equal(ok.verdict, 'pass');
});

test('dispatchOutcomeCheck: file 显式 not_applicable，不套用文本检查', () => {
  const result = dispatchOutcomeCheck({
    goal: '打开文件',
    output: {
      artifact: {
        type: 'binary',
        title: 'file',
        payload: {
          kind: 'file',
          mediaType: 'application/pdf',
          sourcePath: 'x.pdf',
        },
      },
    },
  });
  assert.equal(result.checkKind, 'not_applicable');
  assert.equal(result.verdict, 'pass');
});

test('dispatchOutcomeCheck: bundle 完整性', () => {
  const result = dispatchOutcomeCheck({
    goal: '分析代码',
    output: {
      artifact: {
        type: CODE_ANALYSIS_ARTIFACT_TYPE,
        title: 'analysis',
        payload: {
          kind: 'bundle',
          entries: [
            { role: 'report', mediaType: 'text/markdown', sourcePath: 'r.md' },
            { role: 'manifest', mediaType: 'application/json', sourcePath: 'm.json' },
            { role: 'evidence', mediaType: 'application/json', sourcePath: 'e.json' },
          ],
        },
      },
    },
  });
  assert.equal(result.checkKind, 'bundle');
  assert.equal(result.verdict, 'pass');
});
