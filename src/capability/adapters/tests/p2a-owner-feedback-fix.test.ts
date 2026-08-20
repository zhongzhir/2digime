/**
 * P2A Owner 反馈修复：换行规范化 + bundle 物化。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContentStore } from '../../../infrastructure/content-store';
import { JsonObjectStore } from '../../../infrastructure/json-store';
import { ArtifactWorkspace } from '../../../artifact-workspace/workspace';
import { InMemoryEventBus } from '../../../work-runtime/event-bus';
import type { Artifact } from '../../../work-runtime/artifact';
import type { SubjectService } from '../../../subject-core/subject-service';

function loadNormalizeNewlines(): (text: string) => string {
  const src = readFileSync(
    path.resolve(__dirname, '../../../../electron/renderer/text-normalize.js'),
    'utf8',
  );
  const mod = { exports: {} as { normalizeNewlines?: (text: string) => string } };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(mod, mod.exports);
  const fn = mod.exports.normalizeNewlines;
  if (!fn) throw new Error('normalizeNewlines missing');
  return fn;
}

type BundleQualityUi = {
  showBanner: boolean;
  className: string;
  bannerText: string;
  saveStatus: string;
};

function loadResolveBundleQualityUi(): (quality: { grade?: string; reasons?: string[] } | null | undefined) => BundleQualityUi {
  const src = readFileSync(
    path.resolve(__dirname, '../../../../electron/renderer/bundle-quality-ui.js'),
    'utf8',
  );
  const mod = { exports: {} as { resolveBundleQualityUi?: (quality: unknown) => BundleQualityUi } };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(mod, mod.exports);
  const fn = mod.exports.resolveBundleQualityUi;
  if (!fn) throw new Error('resolveBundleQualityUi missing');
  return fn;
}

const normalizeNewlines = loadNormalizeNewlines();
const resolveBundleQualityUi = loadResolveBundleQualityUi();

test('clipboard normalize only rewrites CRLF/CR to LF', () => {
  const sample =
    '分析 Digital Me V2 当前代码架构，说明 Subject、Work、Capability。\r\n指出风险。\r下一步建议。';
  const out = normalizeNewlines(sample);
  assert.equal(
    out,
    '分析 Digital Me V2 当前代码架构，说明 Subject、Work、Capability。\n指出风险。\n下一步建议。',
  );
  assert.equal(normalizeNewlines('already\nfine'), 'already\nfine');
  assert.equal(out.includes('Subject、Work、Capability'), true);
});

test('clipboard text, textarea value, and Task.goal stay consistent after normalize', () => {
  const clipboardText =
    '分析 Digital Me V2 当前代码架构，说明 Subject、Work、Capability、Artifact 与 Collaboration 的模块边界。\r\n给出三项风险。';
  const textareaValue = normalizeNewlines(clipboardText);
  const taskGoal = textareaValue.trim();
  assert.equal(textareaValue, normalizeNewlines(clipboardText));
  assert.equal(taskGoal, textareaValue.trim());
  assert.equal(taskGoal.includes('Subject、Work、Capability、Artifact 与 Collaboration'), true);
  assert.equal(/\r/.test(taskGoal), false);
});

test('revealInFolder materializes report.md manifest.json evidence.json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2a-reveal-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
  const storageDir = path.join(root, 'artifact-files', 'art_1');
  const srcDir = path.join(root, 'src-bundle');
  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(srcDir, { recursive: true });

  const reportBody = '# 报告\n\n正文';
  const manifestBody = JSON.stringify({
    schemaVersion: 'code-analysis/1',
    quality: { grade: 'usable', reasons: [] },
  });
  const evidenceBody = JSON.stringify({ schemaVersion: 'code-analysis-evidence/1', items: [] });
  await fs.writeFile(path.join(srcDir, 'report.md'), reportBody, 'utf8');
  await fs.writeFile(path.join(srcDir, 'manifest.json'), manifestBody, 'utf8');
  await fs.writeFile(path.join(srcDir, 'evidence.json'), evidenceBody, 'utf8');

  const bundleContent = await contentStore.putBundle([
    { sourcePath: path.join(srcDir, 'report.md'), mediaType: 'text/markdown', role: 'report' },
    {
      sourcePath: path.join(srcDir, 'manifest.json'),
      mediaType: 'application/json',
      role: 'manifest',
    },
    {
      sourcePath: path.join(srcDir, 'evidence.json'),
      mediaType: 'application/json',
      role: 'evidence',
    },
  ]);

  const artifact: Artifact = {
    id: 'art_1',
    taskId: 'task_1',
    subjectId: 'sub_1',
    jobId: 'job_1',
    type: 'code-analysis',
    title: '代码项目分析',
    createdAt: new Date().toISOString(),
    storageDir,
    headVersionId: 'ver_1',
    versions: [
      {
        versionId: 'ver_1',
        createdAt: new Date().toISOString(),
        author: 'capability',
        content: bundleContent,
      },
    ],
  };
  await artifactStore.put(artifact);

  const workspace = new ArtifactWorkspace({
    artifactStore,
    contentStore,
    subjectService: {
      appendGrowthEvent: async () => undefined,
    } as unknown as SubjectService,
    eventBus: new InMemoryEventBus(),
  });

  await workspace.revealInFolder('art_1');
  const names = await fs.readdir(storageDir);
  assert.ok(names.includes('report.md'));
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.includes('evidence.json'));
  assert.equal(await fs.readFile(path.join(storageDir, 'report.md'), 'utf8'), reportBody);
});

test('revealInFolder materializes document result.md + manifest; idempotent; latest version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b4-doc-'));
  const contentStore = new ContentStore(path.join(root, 'content'));
  const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
  const storageDir = path.join(root, 'artifact-files', 'art_doc');
  await fs.mkdir(storageDir, { recursive: true });

  const v1 = await contentStore.putText('第一版正文', 'markdown');
  const artifact: Artifact = {
    id: 'art_doc',
    taskId: 'task_doc',
    subjectId: 'sub_1',
    jobId: 'job_doc',
    type: 'document',
    title: '文档成果',
    createdAt: new Date().toISOString(),
    storageDir,
    headVersionId: 'ver_1',
    versions: [
      {
        versionId: 'ver_1',
        createdAt: new Date().toISOString(),
        author: 'capability',
        content: v1.content,
      },
    ],
  };
  await artifactStore.put(artifact);

  const workspace = new ArtifactWorkspace({
    artifactStore,
    contentStore,
    subjectService: {
      appendGrowthEvent: async () => undefined,
    } as unknown as SubjectService,
    eventBus: new InMemoryEventBus(),
  });

  await workspace.revealInFolder('art_doc');
  let names = await fs.readdir(storageDir);
  assert.ok(names.includes('result.md'));
  assert.ok(names.includes('manifest.json'));
  assert.equal(await fs.readFile(path.join(storageDir, 'result.md'), 'utf8'), '第一版正文');
  const manifest1 = JSON.parse(await fs.readFile(path.join(storageDir, 'manifest.json'), 'utf8')) as {
    primaryFile: string;
    headVersionId: string;
    schemaVersion: string;
  };
  assert.equal(manifest1.primaryFile, 'result.md');
  assert.equal(manifest1.headVersionId, 'ver_1');
  assert.equal(manifest1.schemaVersion, 'document-delivery/1');
  // 敏感扫描：交付 manifest 不得含凭证/userData 路径线索
  const manifestRaw = await fs.readFile(path.join(storageDir, 'manifest.json'), 'utf8');
  assert.equal(/SecretStore|userData|sk-[a-zA-Z0-9]{10,}/i.test(manifestRaw), false);

  await workspace.revealInFolder('art_doc');
  names = await fs.readdir(storageDir);
  assert.equal(names.filter((n) => n === 'result.md').length, 1);
  assert.equal(names.filter((n) => n === 'manifest.json').length, 1);

  const v2 = await contentStore.putText('第二版正文-最新', 'markdown');
  artifact.headVersionId = 'ver_2';
  artifact.versions.push({
    versionId: 'ver_2',
    createdAt: new Date().toISOString(),
    author: 'user',
    content: v2.content,
  });
  await artifactStore.put(artifact);
  await workspace.revealInFolder('art_doc');
  assert.equal(await fs.readFile(path.join(storageDir, 'result.md'), 'utf8'), '第二版正文-最新');
  const manifest2 = JSON.parse(await fs.readFile(path.join(storageDir, 'manifest.json'), 'utf8')) as {
    headVersionId: string;
  };
  assert.equal(manifest2.headVersionId, 'ver_2');
});

test('resolveBundleQualityUi maps usable / missing / degraded / needs_attention distinctly', () => {
  const usable = resolveBundleQualityUi({ grade: 'usable' });
  assert.equal(usable.showBanner, false);
  assert.equal(usable.saveStatus, '代码项目分析结果（只读）');
  assert.match(usable.className, /usable/);

  const missing = resolveBundleQualityUi(null);
  assert.equal(missing.showBanner, false);
  assert.equal(missing.saveStatus, '代码项目分析结果（只读）');

  const degraded = resolveBundleQualityUi({ grade: 'degraded_scan_only' });
  assert.equal(degraded.showBanner, true);
  assert.match(degraded.className, /bundle-quality/);
  assert.match(degraded.className, /degraded-scan/);
  assert.equal(degraded.bannerText.includes('需要处理'), true);
  assert.equal(degraded.bannerText.includes('本次仅完成结构扫描，未完成深度分析'), true);
  assert.equal(degraded.bannerText.includes('degraded_scan_only'), false);
  assert.equal(degraded.saveStatus, '代码项目分析（需要处理）');

  const attention = resolveBundleQualityUi({ grade: 'needs_attention' });
  assert.equal(attention.showBanner, true);
  assert.match(attention.className, /needs-attention/);
  assert.notEqual(attention.className, degraded.className);
  assert.notEqual(attention.bannerText, degraded.bannerText);
  assert.equal(attention.bannerText.includes('需要处理'), true);
  assert.equal(attention.bannerText.includes('degraded_scan_only'), false);
  assert.equal(attention.bannerText.includes('needs_attention'), false);
});

function loadResolveCopyPayload(): (input: {
  kind?: 'document' | 'bundle';
  reportText?: string;
  editorText?: string;
  qualityGrade?: string | null;
  qualityBannerText?: string;
  failed?: boolean;
}) => {
  ok: boolean;
  text?: string;
  error?: string;
  copyEnabled: boolean;
} {
  const src = readFileSync(
    path.resolve(__dirname, '../../../../electron/renderer/bundle-copy.js'),
    'utf8',
  );
  const mod = {
    exports: {} as {
      resolveCopyPayload?: (input: {
        kind?: 'document' | 'bundle';
        reportText?: string;
        editorText?: string;
        qualityGrade?: string | null;
        qualityBannerText?: string;
        failed?: boolean;
      }) => {
        ok: boolean;
        text?: string;
        error?: string;
        copyEnabled: boolean;
      };
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(mod, mod.exports);
  const fn = mod.exports.resolveCopyPayload;
  if (!fn) throw new Error('resolveCopyPayload missing');
  return fn;
}

const resolveCopyPayload = loadResolveCopyPayload();

test('resolveCopyPayload: document non-empty matches editor text', () => {
  const body = '这是一篇文档成果正文。\n第二段。';
  const out = resolveCopyPayload({ kind: 'document', editorText: body });
  assert.equal(out.ok, true);
  assert.equal(out.copyEnabled, true);
  assert.equal(out.text, body);
});

test('resolveCopyPayload: bundle copies report only, not manifest/evidence', () => {
  const report = '# 报告\n\n结论与建议';
  const out = resolveCopyPayload({
    kind: 'bundle',
    reportText: report,
    editorText: '{"schemaVersion":"should-not-copy"}',
    qualityGrade: 'usable',
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, report);
  assert.equal(out.text!.includes('schemaVersion'), false);
  assert.equal(out.text!.includes('evidence'), false);
});

test('resolveCopyPayload: degraded includes scan notice without raw grade', () => {
  const report = '# 结构概览\n\n模块列表';
  const out = resolveCopyPayload({
    kind: 'bundle',
    reportText: report,
    qualityGrade: 'degraded_scan_only',
    qualityBannerText: '需要处理：本次仅完成结构扫描，未完成深度分析',
  });
  assert.equal(out.ok, true);
  assert.ok(out.text!.includes('本次仅完成结构扫描，未完成深度分析'));
  assert.ok(out.text!.includes('模块列表'));
  assert.equal(out.text!.includes('degraded_scan_only'), false);
});

test('resolveCopyPayload: failed disables copy; empty body errors', () => {
  const failed = resolveCopyPayload({
    kind: 'bundle',
    reportText: 'x',
    failed: true,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.copyEnabled, false);
  assert.ok(failed.error);

  const empty = resolveCopyPayload({ kind: 'document', editorText: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.copyEnabled, true);
  assert.equal(empty.error, '没有可复制的内容');
});
