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
