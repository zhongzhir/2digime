/**
 * 确认卡产品链接线：job-runner 注入 readOnlyLocate + unreliable 文案。
 * 真实 Codex×MUHUB 由 scripts/run-fix-real-runtime-locate-03.cjs 回归。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { READONLY_CODEX_LOCATE_TIMEOUT_MS } from '../software-readonly-codex-locate';
import {
  buildSoftwareTaskUnderstanding,
  formatUnderstandingSummaryLines,
  isUnderstandingReliable,
} from '../software-task-understanding';
import { buildExecutionConfirmPreview } from '../task-package';

describe('fix-real-runtime-locate-03 product chain', () => {
  it('exports product timeout >= 120s used by confirm-card path', () => {
    assert.ok(READONLY_CODEX_LOCATE_TIMEOUT_MS >= 120_000);
  });

  it('job-runner source wires asReadOnlyLocateHook with product timeout constant', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../src/work-runtime/job-runner.ts'),
      'utf8',
    );
    assert.match(src, /asReadOnlyLocateHook/);
    assert.match(src, /READONLY_CODEX_LOCATE_TIMEOUT_MS/);
    assert.equal(/timeoutMs:\s*45_000/.test(src), false);
  });

  it('submitTask confirm card surfaces unreliable copy when locate yields nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-rt-loc-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}', 'utf8');
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-rt-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await rt.createPackage({ displayName: 'rt', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '把量子纠缠路由器的 frobulator 协议改成紫色并优化展示',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(result.needsExecutionConfirm);
    assert.equal(result.needsExecutionConfirm!.understandingReliable, false);
    assert.match(
      (result.needsExecutionConfirm!.understandingSummary || []).join('\n'),
      /尚未定位到可靠改动位置/,
    );
    assert.match(result.needsExecutionConfirm!.title || '', /尚未定位到可靠改动位置/);
  });

  it('same confirm-card understanding merge path lists page impl without package.json core', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-rt-ok-'));
    await fs.mkdir(path.join(dir, 'app'), { recursive: true });
    await fs.mkdir(path.join(dir, 'components', 'home'), { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"ui"}', 'utf8');
    await fs.writeFile(path.join(dir, 'README.md'), '# ui\n', 'utf8');
    await fs.writeFile(
      path.join(dir, 'app', 'page.tsx'),
      'export default function HomePage(){ return null; }\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'components', 'home', 'hero.tsx'),
      'export function Hero(){ return null; }\n',
      'utf8',
    );

    // 与 job-runner 一致：buildSoftwareTaskUnderstanding + readOnlyLocate → confirm preview
    const understanding = await buildSoftwareTaskUnderstanding({
      goal: '优化展示页面信息层级与视觉品质，保持核心功能',
      workingDirectory: dir,
      readOnlyLocate: async () => ({
        files: [
          { path: 'app/page.tsx', reason: '首页实现' },
          { path: 'components/home/hero.tsx', reason: '首屏组件' },
        ],
        symbols: ['HomePage', 'Hero'],
        rationale: '展示页入口',
      }),
    });
    assert.equal(isUnderstandingReliable(understanding), true);
    assert.ok(understanding.keyFiles.some((f) => f.path === 'app/page.tsx'));
    assert.equal(
      understanding.keyFiles.some((f) => /package\.json|readme/i.test(f.path)),
      false,
    );
    const summary = formatUnderstandingSummaryLines(understanding);
    const preview = buildExecutionConfirmPreview({
      goal: understanding.goal,
      workingDirectory: dir,
      executorDisplayName: '代码执行能力',
      understandingSummary: summary,
      understandingReliable: true,
    });
    assert.equal(preview.understandingReliable, true);
    assert.equal(/尚未定位到可靠改动位置/.test(preview.title), false);
    assert.match(summary.join('\n'), /app\/page\.tsx/);
  });
});
