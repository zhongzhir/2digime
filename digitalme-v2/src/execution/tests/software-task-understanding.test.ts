/**
 * software-task-understanding — 目标相关只读定位与不可靠时的诚实失败。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSoftwareTaskUnderstanding,
  extractGoalHints,
  formatUnderstandingSummaryLines,
  isUnderstandingReliable,
} from '../software-task-understanding';
import {
  USER_FACING_LABELS,
  userFacingLabelFromLatestJob,
  type SoftwareOutcomeHint,
} from '../../work-runtime/derive';
import { deriveTaskDisplayState } from '../../work-runtime/task-display-state';
import { buildExecutionConfirmPreview } from '../task-package';
import type { ExecutionJob } from '../../work-runtime/execution-job';
import type { Task } from '../../work-runtime/task';

async function writeTree(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
}

describe('software-task-understanding relevance', () => {
  it('A: clampString goal locates src/shared/ids.ts and related test path, not package.json/README as core', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-clamp-'));
    await writeTree(root, {
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'node --test' },
      }),
      'README.md': '# Demo product\n',
      'src/shared/ids.ts':
        'export function newId(prefix: string) { return prefix; }\nexport function nowIso() { return ""; }\n',
      'src/infrastructure/tests/ids-clamp-string.test.ts':
        "import { describe, it } from 'node:test';\n",
      'src/index.ts': 'export * from "./shared/ids.js";\n',
    });

    const goal =
      '修改 digitalme-v2 项目文件：在 src/shared/ids.ts 实现并导出纯函数 clampString(s: string, max: number): string。当 s 长度超过 max 时截断到 max（max<=0 时返回空字符串），否则返回原字符串。添加单元测试。';
    const u = await buildSoftwareTaskUnderstanding({
      goal,
      workingDirectory: root,
      subjectDecisionBriefs: ['偏好：改动保持最小', '边界：不要升级依赖'],
    });

    assert.equal(u.reliability, 'reliable');
    assert.equal(isUnderstandingReliable(u), true);
    const idsHit = u.keyFiles.find((f) => f.path === 'src/shared/ids.ts');
    assert.ok(idsHit, 'must identify src/shared/ids.ts');
    assert.match(idsHit!.reason, /路径|文件|符号|clampString|ids/i);
    assert.ok(
      await fs
        .access(path.join(root, 'src/shared/ids.ts'))
        .then(() => true)
        .catch(() => false),
    );
    assert.ok(
      u.keyFiles.some((f) => /ids.*test|test.*ids|clamp/i.test(f.path)),
      'should suggest related test location',
    );
    assert.ok(u.subjectConstraints.some((c) => /最小|依赖/.test(c)));
    assert.ok(u.planSteps.some((s) => /最小|依赖|边界|偏好/.test(s)));

    const top = u.keyFiles[0]!.path;
    assert.notEqual(top, 'package.json');
    assert.notEqual(top.toLowerCase(), 'readme.md');
    assert.equal(
      u.keyFiles.some((f) => f.path === 'package.json' || f.path.toLowerCase() === 'readme.md'),
      false,
      'package.json/README must not appear as core key files for this goal',
    );

    const summary = formatUnderstandingSummaryLines(u).join('\n');
    assert.match(summary, /src\/shared\/ids\.ts/);
    assert.equal(/将重点查看：.*package\.json/i.test(summary), false);
  });

  it('B: nested util goal locates implementation and test without hardcoding clampString', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-nested-'));
    await writeTree(root, {
      'package.json': JSON.stringify({ name: 'nested', scripts: { test: 'node --test' } }),
      'README.md': '# Nested\n',
      'src/domain/billing/taxRate.ts':
        'export function computeTaxRate(amount: number) { return amount * 0.1; }\n',
      'src/domain/billing/tests/taxRate.test.ts':
        "import { describe, it } from 'node:test';\ndescribe('taxRate', () => {});\n",
      'src/domain/billing/invoice.ts': 'export function invoiceTotal() { return 0; }\n',
    });

    const u = await buildSoftwareTaskUnderstanding({
      goal:
        '请修正 src/domain/billing/taxRate.ts 中的 computeTaxRate：对负数金额返回 0，并补充对应单元测试。',
      workingDirectory: root,
      subjectDecisionBriefs: ['边界：不要改动支付网关配置'],
    });

    assert.equal(u.reliability, 'reliable');
    assert.ok(u.keyFiles.some((f) => f.path === 'src/domain/billing/taxRate.ts'));
    assert.ok(
      u.keyFiles.some((f) => f.path.includes('taxRate') && /test/i.test(f.path)),
      'nested related test should be found',
    );
    assert.ok(u.symbols.includes('computeTaxRate') || /computeTaxRate/.test(JSON.stringify(u)));
    assert.equal(u.keyFiles[0]?.path === 'package.json', false);
    assert.ok(u.planSteps.some((s) => /支付网关|边界/.test(s)));
  });

  it('C: package.json and README must not win by fixed priority alone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-noise-'));
    await writeTree(root, {
      'package.json': JSON.stringify({ name: 'noise', scripts: { test: 'node --test' } }),
      'README.md': '# Lots of marketing text about features\n',
      'src/feature/widget.ts': 'export function renderWidget() { return 1; }\n',
    });

    const u = await buildSoftwareTaskUnderstanding({
      goal: '调整 renderWidget 的返回值为 2',
      workingDirectory: root,
    });

    assert.equal(u.reliability, 'reliable');
    assert.ok(u.keyFiles.some((f) => f.path === 'src/feature/widget.ts'));
    assert.equal(
      u.keyFiles.some((f) => f.path === 'package.json' || /^readme/i.test(f.path)),
      false,
    );
  });

  it('unreliable understanding does not fake success or deterministic confirm copy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-miss-'));
    await writeTree(root, {
      'package.json': JSON.stringify({ name: 'emptyish', scripts: { test: 'node --test' } }),
      'README.md': '# Hi\n',
      'src/a.ts': 'export const x = 1;\n',
    });

    const u = await buildSoftwareTaskUnderstanding({
      goal: '把量子纠缠路由器的 frobulator 协议改成紫色',
      workingDirectory: root,
    });

    assert.equal(u.reliability, 'unreliable');
    assert.equal(isUnderstandingReliable(u), false);
    assert.equal(u.keyFiles.length, 0);
    assert.match(u.reliabilityMessage || '', /尚未定位到可靠改动位置/);
    const summary = formatUnderstandingSummaryLines(u);
    assert.ok(summary.some((l) => /尚未定位到可靠改动位置/.test(l)));
    assert.equal(summary.some((l) => /将重点查看：.*package\.json/i.test(l)), false);

    const preview = buildExecutionConfirmPreview({
      goal: u.goal,
      workingDirectory: root,
      executorDisplayName: '代码执行能力',
      understandingSummary: summary,
      understandingReliable: false,
    });
    assert.match(preview.title, /尚未定位到可靠改动位置/);
    assert.match(preview.notice, /不能确定|不会把 package\.json/i);
    assert.equal(/将重点查看/.test(preview.notice), false);
  });

  it('extractGoalHints parses path and symbol from natural language', () => {
    const h = extractGoalHints(
      '在 src/shared/ids.ts 实现 clampString(s, max) 并写测试',
    );
    assert.ok(h.paths.some((p) => p.includes('src/shared/ids.ts')));
    assert.ok(h.basenames.includes('ids.ts'));
    assert.ok(h.symbols.includes('clampString'));
  });

  it('readOnlyLocate hints merge when files exist; ignores missing paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-locate-'));
    await writeTree(root, {
      'package.json': '{}',
      'src/core/parser.ts': 'export function parseLine() {}\n',
    });
    const u = await buildSoftwareTaskUnderstanding({
      goal: '改进解析',
      workingDirectory: root,
      readOnlyLocate: async () => ({
        files: [
          { path: 'src/core/parser.ts', reason: '只读分析命中' },
          { path: 'src/does-not-exist.ts', reason: '幻觉路径' },
        ],
        symbols: ['parseLine'],
      }),
    });
    assert.equal(u.reliability, 'reliable');
    assert.ok(u.keyFiles.some((f) => f.path === 'src/core/parser.ts'));
    assert.equal(u.keyFiles.some((f) => f.path.includes('does-not-exist')), false);
  });

  it('fuzzy goal without path/symbol + readOnlyLocate nested impl → reliable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-fuzzy-ro-'));
    await writeTree(root, {
      'package.json': JSON.stringify({ name: 'nested', scripts: { test: 'node --test' } }),
      'README.md': '# Nested\n',
      'src/domain/billing/taxRate.ts':
        'export function computeTaxRate(amount: number) { return amount * 0.1; }\n',
      'src/domain/billing/tests/taxRate.test.ts':
        "import { describe, it } from 'node:test';\ndescribe('taxRate', () => {});\n",
      'src/domain/billing/invoice.ts': 'export function invoiceTotal() { return 0; }\n',
    });

    // 无路径、无明确符号的模糊目标；本地扫描可能 unreliable，Codex 只读命中应抬到 reliable
    const u = await buildSoftwareTaskUnderstanding({
      goal: '修正负数金额时的计税行为并补测试',
      workingDirectory: root,
      readOnlyLocate: async () => ({
        files: [
          { path: 'src/domain/billing/taxRate.ts', reason: '只读分析命中计税实现' },
          { path: 'src/domain/billing/tests/taxRate.test.ts', reason: '对应测试' },
        ],
        symbols: ['computeTaxRate'],
        rationale: '嵌套计税模块',
      }),
    });

    assert.equal(u.reliability, 'reliable');
    assert.equal(isUnderstandingReliable(u), true);
    assert.ok(u.keyFiles.some((f) => f.path === 'src/domain/billing/taxRate.ts'));
    const summary = formatUnderstandingSummaryLines(u).join('\n');
    assert.match(summary, /taxRate\.ts/);
  });

  it('readOnlyLocate file outside walk window still merges when on disk', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-u-trunc-ro-'));
    const files: Record<string, string> = {
      'package.json': '{}',
      'README.md': '# pad\n',
      'zzz/deep/hiddenImpl.ts': 'export function fixHiddenBug() { return 1; }\n',
    };
    // 填满有界 walk（220），使 zzz/... 落在窗口外
    for (let i = 0; i < 230; i += 1) {
      files[`aaa/pad_${String(i).padStart(3, '0')}.ts`] = `export const pad${i} = ${i};\n`;
    }
    await writeTree(root, files);

    const u = await buildSoftwareTaskUnderstanding({
      goal: '修复隐藏缺陷',
      workingDirectory: root,
      readOnlyLocate: async () => ({
        files: [{ path: 'zzz/deep/hiddenImpl.ts', reason: '只读分析命中实现' }],
        symbols: ['fixHiddenBug'],
      }),
    });

    assert.equal(u.reliability, 'reliable');
    assert.ok(u.keyFiles.some((f) => f.path === 'zzz/deep/hiddenImpl.ts'));
    assert.equal(u.keyFiles.some((f) => f.path === 'package.json'), false);
  });

  it('degraded quality grade must not show awaiting-confirm label', () => {
    const job: ExecutionJob = {
      id: 'job_1',
      taskId: 'task_1',
      capabilityId: 'cap_code_repo_analysis',
      status: 'succeeded',
      createdAt: '2026-08-10T00:00:00.000Z',
      artifactId: 'art_1',
    };
    const soft: SoftwareOutcomeHint = { qualityGrade: 'degraded_scan_only' };
    const label = userFacingLabelFromLatestJob([job], { softwareOutcome: soft });
    assert.equal(label, USER_FACING_LABELS.attention);

    const task: Task = {
      id: 'task_1',
      subjectId: 'sub_1',
      goal: '分析仓库',
      createdAt: '2026-08-10T00:00:00.000Z',
      intentKind: 'analyze_code',
      requestedArtifactType: 'code-analysis',
      contextRefs: [],
    };
    const display = deriveTaskDisplayState({
      task,
      jobsForTask: [job],
      artifacts: [
        {
          id: 'art_1',
          taskId: 'task_1',
          jobId: 'job_1',
          subjectId: 'sub_1',
          type: 'code-analysis',
          title: '分析',
          createdAt: '2026-08-10T00:00:00.000Z',
          headVersionId: 'v1',
          storageDir: path.join(os.tmpdir(), 'dm-art'),
          versions: [
            {
              versionId: 'v1',
              createdAt: '2026-08-10T00:00:00.000Z',
              author: 'capability',
              content: { kind: 'bundle', entries: [] },
            },
          ],
        },
      ],
      softwareOutcome: soft,
    });
    assert.equal(display.label, USER_FACING_LABELS.attention);
    assert.notEqual(display.displayId, 'awaiting_confirm');
  });
});
