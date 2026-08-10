import {
  asReadOnlyLocateHook,
  locateWithReadonlyCodex,
  validateLocatePath,
  READONLY_CODEX_LOCATE_TIMEOUT_MS,
} from '../software-readonly-codex-locate';
import {
  buildSoftwareTaskUnderstanding,
  formatUnderstandingSummaryLines,
  isUnderstandingReliable,
} from '../software-task-understanding';
import { buildCodexExecArgs } from '../../capability/adapters/external-executor-codex';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
}

function gitInit(root: string): void {
  const r = spawnSync('git', ['init'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr || 'git init failed');
  spawnSync('git', ['add', '-A'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  spawnSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init', '--allow-empty'],
    { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
  );
}

describe('software-readonly-codex-locate', () => {
  it('buildCodexExecArgs defaults to workspace-write; read-only when requested', () => {
    const def = buildCodexExecArgs({
      codexJsPath: 'codex.js',
      workingDirectory: 'C:\\proj',
      lastMessagePath: 'C:\\tmp\\last.txt',
    });
    assert.equal(def[def.indexOf('--sandbox') + 1], 'workspace-write');

    const ro = buildCodexExecArgs({
      codexJsPath: 'codex.js',
      workingDirectory: 'C:\\proj',
      lastMessagePath: 'C:\\tmp\\last.txt',
      sandbox: 'read-only',
    });
    assert.equal(ro[ro.indexOf('--sandbox') + 1], 'read-only');
  });

  it('product default locate timeout is at least 120s (45s caused MUHUB false unreliable)', () => {
    assert.ok(READONLY_CODEX_LOCATE_TIMEOUT_MS >= 120_000);
  });

  it('short timeout returns null (simulates prior 45s product failure)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-to-'));
    await writeTree(root, {
      'package.json': '{}',
      'app/page.tsx': 'export default function Page(){return null}\n',
    });
    const hint = await locateWithReadonlyCodex({
      goal: '优化展示页面视觉层级',
      workingDirectory: root,
      timeoutMs: 40,
      execHook: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return JSON.stringify({
          files: [{ path: 'app/page.tsx', reason: '首页' }],
        });
      },
    });
    assert.equal(hint, null);
  });

  it('execHook valid JSON → hint contains existing file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-ok-'));
    await writeTree(root, {
      'package.json': '{}',
      'src/core/parser.ts': 'export function parseLine() {}\n',
    });

    const hint = await locateWithReadonlyCodex({
      goal: '改进解析逻辑',
      workingDirectory: root,
      execHook: async ({ argv }) => {
        assert.equal(argv[argv.indexOf('--sandbox') + 1], 'read-only');
        return JSON.stringify({
          files: [{ path: 'src/core/parser.ts', reason: '解析入口', symbols: ['parseLine'] }],
          symbols: ['parseLine'],
          proposedTests: [],
          rationale: 'parser 是核心',
          plan: ['阅读 parser.ts'],
        });
      },
    });

    assert.ok(hint);
    assert.ok(hint!.files?.some((f) => f.path === 'src/core/parser.ts'));
    assert.ok(hint!.symbols?.includes('parseLine'));
  });

  it('hallucinated path is dropped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-hallu-'));
    await writeTree(root, {
      'src/core/parser.ts': 'export function parseLine() {}\n',
    });

    const hint = await locateWithReadonlyCodex({
      goal: '改进解析',
      workingDirectory: root,
      execHook: async () =>
        JSON.stringify({
          files: [
            { path: 'src/core/parser.ts', reason: '真实' },
            { path: 'src/does-not-exist.ts', reason: '幻觉' },
          ],
          symbols: [],
          proposedTests: [],
          rationale: 'x',
          plan: [],
        }),
    });

    assert.ok(hint);
    assert.equal(hint!.files!.length, 1);
    assert.equal(hint!.files![0]!.path, 'src/core/parser.ts');
  });

  it('path escape ../outside.ts is dropped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-esc-'));
    await writeTree(root, {
      'src/a.ts': 'export const a = 1;\n',
    });

    const v = await validateLocatePath(root, '../outside.ts', '改 a.ts', 'evil');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, 'path_escape');

    const hint = await locateWithReadonlyCodex({
      goal: '改 a',
      workingDirectory: root,
      execHook: async () =>
        JSON.stringify({
          files: [
            { path: '../outside.ts', reason: '越界' },
            { path: 'src/a.ts', reason: '合法源码' },
          ],
          symbols: [],
          proposedTests: [],
          rationale: 'x',
          plan: [],
        }),
    });
    assert.ok(hint);
    assert.equal(
      hint!.files!.some((f) => f.path.includes('..') || f.path.includes('outside')),
      false,
    );
    assert.ok(hint!.files!.some((f) => f.path === 'src/a.ts'));
  });

  it('package.json dropped for unrelated goal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-pkg-'));
    await writeTree(root, {
      'package.json': '{"name":"x"}',
      'src/feature/widget.ts': 'export function renderWidget() { return 1; }\n',
    });

    const v = await validateLocatePath(root, 'package.json', '调整 renderWidget', '配置');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, 'config_noise');

    const hint = await locateWithReadonlyCodex({
      goal: '调整 renderWidget 的返回值',
      workingDirectory: root,
      execHook: async () =>
        JSON.stringify({
          files: [
            { path: 'package.json', reason: '依赖入口' },
            { path: 'src/feature/widget.ts', reason: '实现位置' },
          ],
          symbols: ['renderWidget'],
          proposedTests: [],
          rationale: 'x',
          plan: [],
        }),
    });
    assert.ok(hint);
    assert.equal(hint!.files!.some((f) => f.path === 'package.json'), false);
    assert.ok(hint!.files!.some((f) => f.path === 'src/feature/widget.ts'));
  });

  it('execHook throw → null', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-throw-'));
    await writeTree(root, { 'src/a.ts': 'export const a = 1;\n' });
    const hint = await locateWithReadonlyCodex({
      goal: '改 a',
      workingDirectory: root,
      execHook: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(hint, null);
  });

  it('execHook timeout simulation → null', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-to-'));
    await writeTree(root, { 'src/a.ts': 'export const a = 1;\n' });
    const hint = await locateWithReadonlyCodex({
      goal: '改 a',
      workingDirectory: root,
      timeoutMs: 40,
      execHook: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return JSON.stringify({
          files: [{ path: 'src/a.ts', reason: '晚到' }],
          symbols: [],
          proposedTests: [],
          rationale: 'x',
          plan: [],
        });
      },
    });
    assert.equal(hint, null);
  });

  it('readonly isolation: dirty after hook → null', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-dirty-'));
    await writeTree(root, {
      'src/a.ts': 'export const a = 1;\n',
    });
    gitInit(root);
    // commit tree so porcelain is clean
    spawnSync('git', ['add', '-A'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    spawnSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'files'],
      { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
    );

    const hint = await locateWithReadonlyCodex({
      goal: '改 a',
      workingDirectory: root,
      execHook: async () => {
        await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 2;\n', 'utf8');
        return JSON.stringify({
          files: [{ path: 'src/a.ts', reason: '却改了文件' }],
          symbols: [],
          proposedTests: [],
          rationale: 'x',
          plan: [],
        });
      },
    });
    assert.equal(hint, null);
  });

  it('validateLocatePath does not write the repo', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-val-'));
    await writeTree(root, { 'src/a.ts': 'export const a = 1;\n' });
    gitInit(root);
    spawnSync('git', ['add', '-A'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    spawnSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'files'],
      { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
    );
    const before = spawnSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }).stdout;
    await validateLocatePath(root, 'src/a.ts', '改 a', '源码');
    const after = spawnSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }).stdout;
    assert.equal(after, before);
  });

  it('asReadOnlyLocateHook + understanding summary includes real file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-hook-'));
    await writeTree(root, {
      'package.json': '{}',
      'src/domain/billing/taxRate.ts':
        'export function computeTaxRate(amount: number) { return amount * 0.1; }\n',
    });

    const hook = asReadOnlyLocateHook({
      execHook: async () =>
        JSON.stringify({
          files: [
            {
              path: 'src/domain/billing/taxRate.ts',
              reason: '税率计算实现',
              symbols: ['computeTaxRate'],
            },
          ],
          symbols: ['computeTaxRate'],
          proposedTests: ['npm test'],
          rationale: '嵌套实现命中',
          plan: ['阅读 taxRate.ts'],
        }),
    });

    const u = await buildSoftwareTaskUnderstanding({
      goal: '修正负数金额时的税率计算',
      workingDirectory: root,
      readOnlyLocate: hook,
    });

    assert.equal(u.reliability, 'reliable');
    assert.equal(isUnderstandingReliable(u), true);
    assert.ok(u.keyFiles.some((f) => f.path === 'src/domain/billing/taxRate.ts'));
    const summary = formatUnderstandingSummaryLines(u).join('\n');
    assert.match(summary, /src\/domain\/billing\/taxRate\.ts/);
  });
});
