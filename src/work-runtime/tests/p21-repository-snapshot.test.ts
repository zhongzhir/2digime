import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal, waitForTaskState } from '../job-runner';
import { JsonObjectStore } from '../../infrastructure/json-store';
import type { ContextSnapshot } from '../context-snapshot';
import { CODE_ANALYSIS_CONTEXT_POLICY } from '../../capability/adapters/code-repo-analysis-contract';
import { ContextSnapshotBuilder } from '../snapshot-builder';
import { ContentStore } from '../../infrastructure/content-store';
import { isSensitivePath } from '../context-policy';
import type { Task } from '../task';
import { createDeterministicCodeAnalysisAdapter } from '../../capability/adapters/deterministic-code-analysis';
import type { CapabilityInput, ExecutionContext } from '../../capability/adapter';

async function tempRoot(prefix = 'dmv2-p21-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

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

async function boot(root: string) {
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_p21',
    registerDeterministicCodeAnalysis: true,
  });
  await runtime.recoverOnStartup();
  runtime.start();
  return runtime;
}

test('P2.1 文档能力未声明策略:行为与既有抽取一致', async () => {
  const root = await tempRoot();
  const materials = path.join(root, 'docs');
  await writeTree(materials, {
    'a.txt': 'hello',
    'nested/b.md': '# nested',
    'skip.bin': 'x',
  });
  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build({
    id: 'task_doc',
    subjectId: 's',
    goal: 'g',
    createdAt: new Date().toISOString(),
    contextRefs: [{ kind: 'folder', path: materials }],
    requestedArtifactType: 'document',
  } satisfies Task);
  assert.equal(snap.ingestion, undefined, '文档路径不写 ingestion');
  assert.ok(snap.items.some((i) => i.sourcePath.endsWith('a.txt') && i.status === 'ok'));
  assert.ok(snap.items.some((i) => i.sourcePath.endsWith('b.md') && i.status === 'ok'));
});

test('P2.1 敏感目录与凭证文件不进入 Snapshot 且不打开句柄', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'repo');
  await writeTree(repo, {
    'src/index.ts': 'export const n = 1;\n',
    'node_modules/lodash/index.js': 'module.exports=1',
    '.git/config': '[core]\n',
    'dist/out.js': 'console.log(1)',
    'release-staging/app.exe': 'binary',
    '.env': 'SECRET=should-not-read',
    'secrets.v2.json': '{"k":"v"}',
    'id_rsa': '-----BEGIN PRIVATE KEY-----',
    'server.pem': 'PEM',
    'credentials.json': '{}',
  });

  // 把敏感文件设为不可读:若打开句柄会失败。Windows 上 chmod 效果有限,仍用内容探针。
  const envPath = path.join(repo, '.env');
  try {
    await fs.chmod(envPath, 0o000);
  } catch {
    // ignore on windows
  }

  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build(
    {
      id: 'task_sec',
      subjectId: 's',
      goal: 'scan',
      createdAt: new Date().toISOString(),
      contextRefs: [{ kind: 'folder', path: repo }],
      requestedArtifactType: 'code-analysis',
    } as never,
    CODE_ANALYSIS_CONTEXT_POLICY,
  );

  const rels = snap.items.map((i) => i.relativePath || '').filter(Boolean);
  assert.ok(rels.some((r) => r === 'src/index.ts' || r.endsWith('src/index.ts')));
  for (const bad of [
    'node_modules',
    '.git',
    'dist',
    'release-staging',
    '.env',
    'secrets.v2.json',
    'id_rsa',
    'server.pem',
    'credentials.json',
  ]) {
    assert.ok(
      !rels.some((r) => r === bad || r.startsWith(bad + '/') || r.endsWith('/' + bad)),
      `不应出现: ${bad}`,
    );
  }
  assert.ok((snap.ingestion?.skippedSensitiveCount ?? 0) >= 1);
  assert.ok(isSensitivePath('.env'));
  assert.ok(isSensitivePath('node_modules/x'));
});

test('P2.1 超预算产出部分结果而非失败;超时无僵死', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'big');
  const files: Record<string, string> = {};
  for (let i = 0; i < 80; i += 1) {
    files[`f${String(i).padStart(3, '0')}.ts`] = `export const x${i} = ${i};\n`;
  }
  await writeTree(repo, files);

  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build(
    {
      id: 'task_budget',
      subjectId: 's',
      goal: 'scan',
      createdAt: new Date().toISOString(),
      contextRefs: [{ kind: 'folder', path: repo }],
      requestedArtifactType: 'code-analysis',
    } as never,
    {
      folderTraversal: 'recursive',
      excludeSensitivePaths: true,
      budget: {
        maxFiles: 10,
        maxTotalBytes: 1024 * 1024,
        maxFileBytes: 64 * 1024,
        maxDepth: 8,
        maxScanMs: 30_000,
      },
    },
  );
  assert.equal(snap.ingestion?.truncated, true);
  assert.ok((snap.ingestion?.fileCountScanned ?? 0) <= 10);
  assert.ok((snap.ingestion?.skippedBudgetCount ?? 0) >= 1);
});

test('P2.1 路径围栏拒绝越界;symlink 跳过(若系统允许创建)', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside.txt');
  await writeTree(repo, { 'ok.ts': 'export {};\n' });
  await fs.writeFile(outside, 'secret-outside', 'utf8');
  const linkPath = path.join(repo, 'escape-link');
  let linked = false;
  try {
    await fs.symlink(outside, linkPath);
    linked = true;
  } catch {
    // Windows 无权限时跳过 symlink 断言
  }

  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build(
    {
      id: 'task_fence',
      subjectId: 's',
      goal: 'scan',
      createdAt: new Date().toISOString(),
      contextRefs: [{ kind: 'folder', path: repo }],
      requestedArtifactType: 'code-analysis',
    } as never,
    CODE_ANALYSIS_CONTEXT_POLICY,
  );
  const texts: string[] = [];
  for (const item of snap.items) {
    if (item.extractedTextRef) {
      texts.push((await contentStore.readBytes(item.extractedTextRef)).toString('utf8'));
    }
  }
  assert.ok(!texts.some((t) => t.includes('secret-outside')));
  if (linked) {
    assert.ok(!snap.items.some((i) => (i.relativePath || '').includes('escape-link')));
  }
});

test('P2.1 冻结性:快照后改/删/撤权不影响 Adapter 执行', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'repo');
  const target = path.join(repo, 'src', 'main.ts');
  await writeTree(repo, {
    'src/main.ts': 'export const marker = "BEFORE_FREEZE";\n',
    'package.json': JSON.stringify({ name: 'freeze-demo', scripts: { test: 'node -e 1' } }, null, 2),
  });

  const runtimeRoot = path.join(root, 'rt');
  const runtime = await boot(runtimeRoot);

  // 手动构建快照后破坏原文件,再让 Adapter 只吃冻结内容
  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(runtimeRoot, 'snapshots-manual'),
  });
  // 走完整 submit 路径更贴近真实:先提交,在 context 完成后破坏仓库困难;
  // 这里用 Builder + Adapter 直接证明冻结链。
  const contentStore = new ContentStore(path.join(root, 'content-freeze'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build(
    {
      id: 'task_freeze',
      subjectId: 's',
      goal: '分析仓库',
      createdAt: new Date().toISOString(),
      contextRefs: [{ kind: 'folder', path: repo }],
      requestedArtifactType: 'code-analysis',
    } as never,
    CODE_ANALYSIS_CONTEXT_POLICY,
  );

  await fs.writeFile(target, 'export const marker = "AFTER_MUTATION";\n', 'utf8');
  await fs.unlink(path.join(repo, 'package.json'));
  try {
    await fs.chmod(repo, 0o000);
  } catch {
    // windows
  }

  const adapter = createDeterministicCodeAnalysisAdapter();
  const texts = new Map<string, string>();
  for (const item of snap.items) {
    if (item.extractedTextRef) {
      texts.set(item.extractedTextRef, (await contentStore.readBytes(item.extractedTextRef)).toString('utf8'));
    }
  }
  const workDir = path.join(root, 'work');
  await fs.mkdir(workDir, { recursive: true });
  const output = await adapter.execute(
    {
      goal: '分析仓库',
      snapshot: snap,
      subjectContext: { subjectId: 's', derivedAt: new Date().toISOString(), entries: [] },
      artifactType: 'code-analysis',
    },
    {
      jobId: 'job_freeze',
      reportProgress: () => {},
      signal: new AbortController().signal,
      secrets: {
        get: async () => {
          throw new Error('deterministic adapter must not read secrets');
        },
      },
      workDir,
      readExtractedText: async (ref) => {
        const t = texts.get(ref);
        if (t === undefined) throw new Error('missing frozen text');
        return t;
      },
    },
  );

  assert.equal(output.artifact.payload.kind, 'bundle');
  const reportEntry = output.artifact.payload.kind === 'bundle'
    ? output.artifact.payload.entries.find((e) => e.role === 'report')
    : undefined;
  assert.ok(reportEntry);
  const report = await fs.readFile(reportEntry!.sourcePath, 'utf8');
  assert.ok(report.includes('代码项目结构扫描结果'));
  assert.ok(!report.includes('AFTER_MUTATION'));
  // 恢复权限便于清理
  try {
    await fs.chmod(repo, 0o755);
  } catch {
    // ignore
  }
  await runtime.stop();
});

test('P2.1 Adapter 不得依赖 sourcePath:清空路径后仍可执行', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'repo');
  await writeTree(repo, {
    'a.ts': 'export const a = 1;\n',
    'package.json': '{"name":"x","scripts":{"build":"tsc"}}',
  });
  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const builder = new ContextSnapshotBuilder(snapshotStore, contentStore);
  const snap = await builder.build(
    {
      id: 'task_nosrc',
      subjectId: 's',
      goal: 'g',
      createdAt: new Date().toISOString(),
      contextRefs: [{ kind: 'folder', path: repo }],
      requestedArtifactType: 'code-analysis',
    } as never,
    CODE_ANALYSIS_CONTEXT_POLICY,
  );
  // 破坏 sourcePath
  const scrubbed = {
    ...snap,
    items: snap.items.map((i) => ({ ...i, sourcePath: path.join(root, 'deleted', 'gone') })),
  };
  const texts = new Map<string, string>();
  for (const item of snap.items) {
    if (item.extractedTextRef) {
      texts.set(item.extractedTextRef, (await contentStore.readBytes(item.extractedTextRef)).toString('utf8'));
    }
  }
  const adapter = createDeterministicCodeAnalysisAdapter();
  const workDir = path.join(root, 'work');
  await fs.mkdir(workDir, { recursive: true });
  const out = await adapter.execute(
    {
      goal: 'g',
      snapshot: scrubbed,
      subjectContext: { subjectId: 's', derivedAt: new Date().toISOString(), entries: [] },
      artifactType: 'code-analysis',
    } satisfies CapabilityInput,
    {
      jobId: 'job_nosrc',
      reportProgress: () => {},
      signal: new AbortController().signal,
      secrets: { get: async () => null },
      workDir,
      readExtractedText: async (ref) => texts.get(ref) || '',
    } satisfies ExecutionContext,
  );
  assert.equal(out.artifact.payload.kind, 'bundle');
});

test('P2.1 端到端:小型 TS 仓库产出 bundle/manifest/evidence', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'mini-ts');
  await writeTree(repo, {
    'src/index.ts': 'export function main() { return 1; }\n',
    'src/util.ts': 'export const util = true;\n',
    'package.json': JSON.stringify(
      { name: 'mini-ts', scripts: { test: 'node --test', build: 'tsc' } },
      null,
      2,
    ),
    'tsconfig.json': '{"compilerOptions":{"strict":true}}',
    'README.md': '# mini\n',
    'src/leaky.ts': 'const k = "sk-abcdefghijklmnopqrstuvwxyz123456";\n',
  });
  const runtime = await boot(path.join(root, 'rt'));
  const submitted = await runtime.submitTask({
    goal: '扫描这个 TypeScript 小仓库',
    contextRefs: [{ kind: 'folder', path: repo }],
    requestedArtifactType: 'code-analysis',
  });
  const job = await waitForJobTerminal(runtime, submitted.jobId, 30_000);
  assert.equal(job.status, 'succeeded');
  await waitForTaskState(runtime, submitted.taskId, (v) => v.state === 'completed', 5_000);
  const task = await runtime.getTask({ taskId: submitted.taskId });
  assert.ok(task.artifactIds[0]);
  const artifact = await runtime.getArtifact(task.artifactIds[0]!);
  assert.ok(artifact);
  assert.equal(artifact!.type, 'code-analysis');
  const head = artifact!.versions.find((v) => v.versionId === artifact!.headVersionId);
  assert.equal(head?.content.kind, 'bundle');
  if (head?.content.kind !== 'bundle') throw new Error('expected bundle');
  const roles = head.content.entries.map((e) => e.role).sort();
  assert.deepEqual(roles, ['evidence', 'manifest', 'report']);

  // 读 content 验证 scrub + manifest
  const contentRoot = path.join(root, 'rt', 'content');
  const cs = new ContentStore(contentRoot);
  let report = '';
  let manifest: { repo: { fileCountScanned: number }; languages: Array<{ language: string }>; warnings: string[] } | null =
    null;
  let evidence: { items: Array<{ contentDigest: string; path: string; excerpt?: string }> } | null =
    null;
  for (const entry of head.content.entries) {
    const text = (await cs.readBytes(entry.ref)).toString('utf8');
    if (entry.role === 'report') report = text;
    if (entry.role === 'manifest') manifest = JSON.parse(text);
    if (entry.role === 'evidence') evidence = JSON.parse(text);
  }
  assert.ok(report.includes('代码项目结构扫描结果'));
  assert.ok(report.includes('不是完整架构审查'));
  assert.ok(report.includes('[redacted]') || !report.includes('sk-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(manifest);
  assert.ok((manifest!.repo.fileCountScanned ?? 0) >= 3);
  assert.ok(manifest!.languages.some((l) => l.language === 'TypeScript'));
  assert.ok(evidence && evidence.items.length >= 1);
  for (const item of evidence!.items) {
    assert.ok(!item.path.startsWith('/') && !/^[A-Za-z]:/.test(item.path));
    if (item.excerpt) assert.ok(item.excerpt.length <= 240);
  }
  await runtime.stop();
});

test('P2.1 cancel 扫描中无 Artifact', async () => {
  const root = await tempRoot();
  const repo = path.join(root, 'repo');
  const files: Record<string, string> = {};
  for (let i = 0; i < 40; i += 1) files[`f${i}.ts`] = `export const n=${i};\n`.repeat(20);
  await writeTree(repo, files);
  const runtime = await boot(path.join(root, 'rt'));
  const submitted = await runtime.submitTask({
    goal: 'cancel me',
    contextRefs: [{ kind: 'folder', path: repo }],
    requestedArtifactType: 'code-analysis',
  });
  await runtime.cancelJob({ jobId: submitted.jobId });
  const job = await waitForJobTerminal(runtime, submitted.jobId, 30_000);
  assert.equal(job.status, 'cancelled');
  assert.equal(await runtime.getArtifact(`art_${submitted.jobId.replace(/^job_/, '')}`), null);
  await runtime.stop();
});

test('P2.1 digitalme-v2 自身仓库识别事实(结构扫描,非质量结论)', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  // __dirname = dist/work-runtime/tests → 上三级 = digitalme-v2
  assert.ok(
    await fs
      .access(path.join(repoRoot, 'package.json'))
      .then(() => true)
      .catch(() => false),
    `expected package.json under ${repoRoot}`,
  );

  const root = await tempRoot();
  const runtime = await boot(path.join(root, 'rt'));
  const submitted = await runtime.submitTask({
    goal: '识别 digitalme-v2 仓库结构事实',
    contextRefs: [{ kind: 'folder', path: repoRoot }],
    requestedArtifactType: 'code-analysis',
  });
  const job = await waitForJobTerminal(runtime, submitted.jobId, 120_000);
  assert.equal(job.status, 'succeeded', `job failed: ${job.failure?.message}`);
  const task = await runtime.getTask({ taskId: submitted.taskId });
  const artifact = await runtime.getArtifact(task.artifactIds[0]!);
  assert.ok(artifact);
  const head = artifact!.versions.find((v) => v.versionId === artifact!.headVersionId);
  assert.equal(head?.content.kind, 'bundle');
  if (head?.content.kind !== 'bundle') throw new Error('bundle expected');
  const cs = new ContentStore(path.join(root, 'rt', 'content'));
  let report = '';
  let manifest: {
    repo: { skippedSensitiveCount: number; truncated: boolean };
    languages: Array<{ language: string; files: number }>;
  } | null = null;
  for (const entry of head.content.entries) {
    const text = (await cs.readBytes(entry.ref)).toString('utf8');
    if (entry.role === 'report') report = text;
    if (entry.role === 'manifest') manifest = JSON.parse(text);
  }
  assert.ok(report.includes('代码项目结构扫描结果'));
  assert.ok(manifest!.languages.some((l) => l.language === 'TypeScript'));
  assert.ok(/Electron/i.test(report) || /electron/i.test(report));
  for (const dir of ['src', 'electron']) {
    assert.ok(report.includes(`\`${dir}/\``) || report.includes(`${dir}/`), `应识别目录 ${dir}`);
  }
  // Subject / Work / Capability 目录常在 src 下
  assert.ok(
    /subject|work-runtime|capability|collaboration/i.test(report),
    '应识别主体相关目录线索',
  );
  assert.ok(/npm scripts|scripts|build|test|verify/i.test(report), '应识别 npm scripts');
  assert.ok(
    (manifest!.repo.skippedSensitiveCount ?? 0) >= 1 || report.includes('敏感'),
    '应反映敏感目录排除',
  );
  await runtime.stop();
});

test('P2.1 Work Runtime 经 selectForNeed 承接 code-analysis（禁止写作伪装）', async () => {
  const jobRunnerSrc = await fs.readFile(
    path.resolve(__dirname, '..', '..', '..', 'src', 'work-runtime', 'job-runner.ts'),
    'utf8',
  );
  assert.ok(/selectForNeed/.test(jobRunnerSrc), 'JobRunner 应使用 selectForNeed');
  assert.ok(/CODE_ANALYSIS_ARTIFACT_TYPE|code-analysis/.test(jobRunnerSrc));
  assert.ok(
    /不会改用普通写作冒充|无法进行代码分析/.test(jobRunnerSrc),
    '能力不可用时须给出可行动说明，不得伪装',
  );
  assert.ok(/contextPolicy/.test(jobRunnerSrc), 'JobRunner 应传递 contextPolicy');
});
