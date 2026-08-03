import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodeRepoAnalysisRegistration,
  resolveCodeAnalysisAvailability,
  CODE_BUNDLE_ROLES,
  CODE_ANALYSIS_ARTIFACT_TYPE,
  CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
  CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
  CODE_ANALYSIS_CONTEXT_POLICY,
  REQUESTED_ARTIFACT_TYPES,
  EVIDENCE_EXCERPT_MAX_CHARS,
  type CodeAnalysisBundleManifest,
  type CodeAnalysisEvidenceFile,
} from '../code-repo-analysis-contract';
import { isAdapterType } from '../../registration';
import { buildOpenAiCompatibleRegistration } from '../openai-compatible';
import {
  isSensitivePath,
  DEFAULT_CONTEXT_INGESTION_POLICY,
  RECURSIVE_INGESTION_BUDGET,
} from '../../../work-runtime/context-policy';

test('P2.0 注册契约:模型型能力,权限仅 network+secret_access,无 filesystem_read', () => {
  const reg = buildCodeRepoAnalysisRegistration('available');
  assert.ok(isAdapterType(reg.adapter.type), 'adapter.type 必须在既有白名单内');
  assert.equal(reg.adapter.type, 'openai-compatible-model');
  assert.deepEqual([...reg.permissions].sort(), ['network', 'secret_access']);
  assert.ok(!reg.permissions.includes('filesystem_read'), 'Adapter 不得直接读文件系统');
  assert.ok(!reg.permissions.includes('filesystem_write'));
  assert.deepEqual(reg.outputArtifactTypes, [CODE_ANALYSIS_ARTIFACT_TYPE]);
});

test('P2.0 contextPolicy:通用策略,无代码专用字段;文档能力缺省不变', () => {
  const reg = buildCodeRepoAnalysisRegistration('available');
  assert.ok(reg.contextPolicy, 'code 能力必须声明 contextPolicy');
  assert.equal(reg.contextPolicy.folderTraversal, 'recursive');
  assert.equal(reg.contextPolicy.excludeSensitivePaths, true);
  assert.deepEqual(reg.contextPolicy.budget, RECURSIVE_INGESTION_BUDGET);
  const keys = JSON.stringify(Object.keys(CODE_ANALYSIS_CONTEXT_POLICY)).toLowerCase();
  assert.ok(!keys.includes('code') && !keys.includes('repo'), '策略键名不得含场景专用词');

  const docReg = buildOpenAiCompatibleRegistration({
    baseUrl: 'https://example.invalid/v1',
    model: 'm',
  });
  assert.equal(docReg.contextPolicy, undefined, '文档能力不声明策略,行为不变');
  assert.equal(DEFAULT_CONTEXT_INGESTION_POLICY.folderTraversal, 'top-level');
  assert.equal(DEFAULT_CONTEXT_INGESTION_POLICY.excludeSensitivePaths, false);
});

test('P2.0 可用性:无模型凭证时 needs_setup,不生成本地替代成果', () => {
  assert.equal(resolveCodeAnalysisAvailability(true), 'available');
  assert.equal(resolveCodeAnalysisAvailability(false), 'needs_setup');
});

test('P2.0 任务页显式成果类型封闭表', () => {
  assert.deepEqual([...REQUESTED_ARTIFACT_TYPES], ['document', 'code-analysis']);
});

test('P2.0 敏感路径排除(Snapshot 构建期):凭证/密钥/生成目录命中,普通源码不命中', () => {
  const sensitive = [
    '.env',
    '.env.local',
    'config/.env.production',
    'deploy/server.pem',
    'certs/tls.key',
    '.ssh/id_rsa',
    'id_ed25519.pub',
    'secrets.json',
    'secrets.v2.json',
    '.runtime-model-credential.json',
    '.npmrc',
    'credentials',
    'node_modules/lodash/index.js',
    '.git/config',
    'packages/app/dist/main.js',
    '.vscode/settings.json',
  ];
  for (const p of sensitive) {
    assert.equal(isSensitivePath(p), true, `应排除: ${p}`);
  }
  const normal = [
    'src/index.ts',
    'README.md',
    'package.json',
    'src/keyboard.ts',
    'docs/environment.md',
    'src/distance.ts',
  ];
  for (const p of normal) {
    assert.equal(isSensitivePath(p), false, `不应排除: ${p}`);
  }
});

test('P2.0 摄取预算:常量为正且单文件上限小于总量上限', () => {
  assert.ok(RECURSIVE_INGESTION_BUDGET.maxFiles > 0);
  assert.ok(RECURSIVE_INGESTION_BUDGET.maxDepth > 0);
  assert.ok(RECURSIVE_INGESTION_BUDGET.maxScanMs > 0);
  assert.ok(RECURSIVE_INGESTION_BUDGET.maxFileBytes < RECURSIVE_INGESTION_BUDGET.maxTotalBytes);
});

test('P2.0 manifest 契约:角色封闭表 + 示例结构可通过类型检查', () => {
  assert.deepEqual([...CODE_BUNDLE_ROLES], ['report', 'manifest', 'evidence']);
  const manifest: CodeAnalysisBundleManifest = {
    schemaVersion: CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repo: {
      rootName: 'demo',
      fileCountScanned: 3,
      totalBytesScanned: 1024,
      truncated: false,
      skippedSensitiveCount: 1,
      skippedBudgetCount: 0,
    },
    languages: [{ language: 'TypeScript', files: 3, bytes: 1024 }],
    entries: [
      { role: 'report', path: 'report.md', mediaType: 'text/markdown' },
      { role: 'manifest', path: 'manifest.json', mediaType: 'application/json' },
    ],
    warnings: ['已跳过 1 个敏感或凭证类文件'],
  };
  assert.equal(manifest.schemaVersion, 'code-analysis/1');
  assert.ok(manifest.entries.every((e) => !e.path.includes(':') && !e.path.startsWith('/')));
});

test('P2.0 evidence 契约:确定性引用结构,无绝对路径,摘录有界', () => {
  const evidence: CodeAnalysisEvidenceFile = {
    schemaVersion: CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
    items: [
      {
        claimId: 'claim_1',
        path: 'src/job-runner.ts',
        contentDigest: 'sha256:abc',
        span: { startLine: 10, endLine: 24 },
        excerpt: 'async runJob(...) { /* ... */ }',
      },
      { claimId: 'claim_2', path: 'package.json', contentDigest: 'sha256:def' },
    ],
  };
  assert.equal(evidence.schemaVersion, 'code-analysis-evidence/1');
  for (const item of evidence.items) {
    assert.ok(!item.path.startsWith('/') && !/^[a-zA-Z]:/.test(item.path), '禁止绝对路径');
    if (item.excerpt !== undefined) {
      assert.ok(item.excerpt.length <= EVIDENCE_EXCERPT_MAX_CHARS, '摘录必须有界');
    }
  }
});
