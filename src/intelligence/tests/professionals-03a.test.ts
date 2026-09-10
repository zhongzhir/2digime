import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import { CapabilityRegistry } from '../../capability/registry';
import type { CapabilityInput, CapabilityOutput } from '../../capability/adapter';
import type { CapabilityRegistration } from '../../capability/registration';
import { agentsFromRegistry, describeProfessionals, resolveAuthorizedWorkingDirectory } from '../professionals';

function stubAdapter(reg: CapabilityRegistration, execute?: (input: CapabilityInput) => Promise<CapabilityOutput>) {
  return asLocalCapabilityAdapter({
    registration: reg,
    execute: async (input) => {
      if (execute) return execute(input);
      return {
        artifact: {
          type: reg.outputArtifactTypes[0] || 'document',
          title: 'ok',
          payload: { kind: 'text', format: 'plain', text: 'ok' },
        },
      };
    },
  });
}

function baseReg(
  patch: Partial<CapabilityRegistration> &
    Pick<CapabilityRegistration, 'id' | 'kind' | 'displayName' | 'adapter' | 'outputArtifactTypes' | 'permissions'>,
): CapabilityRegistration {
  return {
    description: 'desc',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    cost: { estimate: 'x' },
    latencyEstimate: 'x',
    location: 'local',
    availability: 'available',
    ...patch,
  };
}

test('agentsFromRegistry 不再按 document 预筛选，也不把通用模型当专业 Agent', async () => {
  const registry = new CapabilityRegistry();
  const captured: { input?: CapabilityInput } = {};
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_model_openai_compatible',
        kind: 'model',
        displayName: '对话模型',
        outputArtifactTypes: ['document'],
        permissions: ['network', 'secret_access'],
        adapter: { type: 'openai-compatible-model', adapterId: 'openai-compatible-chat' },
      }),
    ),
  );
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_fake_document',
        kind: 'tool',
        displayName: '测试文档能力',
        outputArtifactTypes: ['document'],
        permissions: [],
        adapter: { type: 'local-tool', adapterId: 'fake-document' },
      }),
    ),
  );
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_code_repo_analysis',
        kind: 'agent',
        displayName: '对话模型',
        outputArtifactTypes: ['document'],
        permissions: ['network', 'secret_access'],
        adapter: { type: 'openai-compatible-model', adapterId: 'code-repo-analysis' },
      }),
    ),
  );
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_gemini_web_search',
        kind: 'tool',
        displayName: '联网搜索',
        outputArtifactTypes: ['document'],
        permissions: ['network'],
        adapter: { type: 'local-tool', adapterId: 'baseline-bing-search' },
      }),
    ),
  );
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_external_executor_codex',
        kind: 'agent',
        displayName: '代码执行能力',
        outputArtifactTypes: ['code-change'],
        permissions: ['filesystem_read', 'filesystem_write', 'network'],
        adapter: { type: 'external-executor-cli', adapterId: 'adapter_external_executor_codex' },
      }),
      async (input) => {
        captured.input = input;
        await fs.mkdir(input.executionAuthorization?.workingDirectory || os.tmpdir(), { recursive: true });
        const readme = path.join(input.executionAuthorization!.workingDirectory, 'README.md');
        await fs.writeFile(readme, 'gate', 'utf8');
        return {
          artifact: {
            type: 'code-change',
            title: 'README',
            payload: { kind: 'bundle', entries: [{ sourcePath: readme, mediaType: 'text/markdown' }] },
          },
        };
      },
    ),
  );

  const withoutProject = agentsFromRegistry(registry, { subjectId: 'sub_1' });
  assert.deepEqual(withoutProject.map((a) => a.id).sort(), ['cap_gemini_web_search']);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-'));
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const ids = agents.map((a) => a.id).sort();
  assert.deepEqual(ids, ['cap_external_executor_codex', 'cap_gemini_web_search']);
  const blob = describeProfessionals(agents);
  assert.match(blob, /id: cap_external_executor_codex/);
  assert.match(blob, /需要本次已授权工作目录/);
  assert.equal(/适合复杂代码改动/.test(blob), false);
  assert.equal(/不能做什么/.test(blob), false);
  assert.equal(/真实效果/.test(blob), false);
  assert.equal(/WorkIntent|outputFamily/.test(blob), false);
  assert.equal(blob.includes('对话模型'), false);

  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '创建一个 README.md',
    workDir: path.join(workDir, 'run-evidence'),
    signal: new AbortController().signal,
  });
  assert.equal(captured.input?.artifactType, 'code-change');
  assert.equal(captured.input?.executionAuthorization?.confirmed, true);
  assert.equal(captured.input?.executionAuthorization?.workingDirectory, workDir);
  assert.equal(captured.input?.executionAuthorization?.projectOrigin, 'digitalme_created');
  const readme = path.join(workDir, 'README.md');
  assert.equal(await fs.readFile(readme, 'utf8'), 'gate');
  assert.equal(result.outputPath, readme);

  const search = agents.find((a) => a.id === 'cap_gemini_web_search');
  assert.ok(search);
  const searchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-search-'));
  const evidence = await search.run({
    instruction: 'OpenAI 今天发布的新模型叫什么名字？',
    workDir: searchDir,
    signal: new AbortController().signal,
  });
  assert.equal(evidence.evidenceOnly, true);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.producedOutputs?.length || 0, 0);
  assert.equal(evidence.outputPath, undefined);
  const searchFiles = await fs.readdir(searchDir);
  assert.equal(searchFiles.includes('result.md'), false);
  assert.equal(/后续分析为准/.test(evidence.summary), false);
  assert.match(blob, /id: cap_gemini_web_search/);
});

test('声明会写工作目录的能力：stdout 完成但无真实文件变化必须 ok=false', async () => {
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_external_executor_codex',
        kind: 'agent',
        displayName: '代码执行能力',
        outputArtifactTypes: ['code-change'],
        permissions: ['filesystem_read', 'filesystem_write', 'network'],
        adapter: { type: 'external-executor-cli', adapterId: 'adapter_external_executor_codex' },
      }),
      async () => ({
        artifact: {
          type: 'code-change',
          title: '已完成',
          payload: { kind: 'text', format: 'plain', text: 'Done. Files written.' },
        },
      }),
    ),
  );
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-empty-'));
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '写一个 hello.txt',
    workDir,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, false);
  assert.match(String(result.failureReason || result.summary), /真实的用户文件|没有在授权目录/);
  const names = await fs.readdir(workDir);
  assert.equal(names.includes('result.md'), false);
});

test('写目录能力执行抛错时，不得把已有文件当成成功', async () => {
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_external_executor_codex',
        kind: 'agent',
        displayName: '代码执行能力',
        outputArtifactTypes: ['code-change'],
        permissions: ['filesystem_read', 'filesystem_write', 'network'],
        adapter: { type: 'external-executor-cli', adapterId: 'adapter_external_executor_codex' },
      }),
      async () => {
        throw new Error('代码执行能力当前不可用');
      },
    ),
  );
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-lie-'));
  for (let i = 0; i < 10; i += 1) {
    await fs.writeFile(path.join(workDir, `old-${i}.txt`), `keep-${i}`, 'utf8');
  }
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '补一个筛选函数',
    workDir,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, false);
  assert.match(String(result.failureReason || result.summary), /不可用/);
  assert.equal(/已产生文件/.test(String(result.summary || '')), false);
  assert.equal(result.producedOutputs?.length || 0, 0);
  assert.equal(/old-0\.txt/.test(String(result.summary || '')), false);
});

function writeCodingReg() {
  return baseReg({
    id: 'cap_external_executor_codex',
    kind: 'agent',
    displayName: '代码执行能力',
    outputArtifactTypes: ['code-change'],
    permissions: ['filesystem_read', 'filesystem_write', 'network'],
    adapter: { type: 'external-executor-cli', adapterId: 'adapter_external_executor_codex' },
  });
}

function bundleResult(
  title = '已经完成修改并检查通过。',
  entries: Array<{ sourcePath: string; mediaType: string; role?: string }> = [],
): CapabilityOutput {
  return {
    artifact: {
      type: 'code-change',
      title,
      payload: { kind: 'bundle', entries },
    },
  };
}

test('Result Truth A：已有文件被修改必须报告 modified，不得把未改文件当成本次成果', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-truth-a-'));
  await fs.writeFile(path.join(workDir, 'a.txt'), 'hello', 'utf8');
  await fs.writeFile(path.join(workDir, 'keep.txt'), 'unchanged', 'utf8');
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(writeCodingReg(), async (input) => {
      const root = input.executionAuthorization!.workingDirectory;
      await fs.writeFile(path.join(root, 'a.txt'), 'hello world', 'utf8');
      return bundleResult();
    }),
  );
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '改 a.txt',
    workDir: path.join(workDir, 'run'),
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  assert.match(String(result.summary), /modified: a\.txt/);
  assert.equal(/keep\.txt/.test(String(result.summary)), false);
  assert.equal(/已产生文件/.test(String(result.summary)), false);
  assert.deepEqual(
    (result.producedOutputs || []).map((p) => path.basename(p)),
    ['a.txt'],
  );
});

test('Result Truth B：新增文件必须报告 created', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-truth-b-'));
  await fs.writeFile(path.join(workDir, 'keep.txt'), 'unchanged', 'utf8');
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(writeCodingReg(), async (input) => {
      await fs.writeFile(path.join(input.executionAuthorization!.workingDirectory, 'b.txt'), 'new', 'utf8');
      return bundleResult();
    }),
  );
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '新增 b.txt',
    workDir: path.join(workDir, 'run'),
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  assert.match(String(result.summary), /created: b\.txt/);
  assert.equal(/keep\.txt/.test(String(result.summary)), false);
  assert.deepEqual(
    (result.producedOutputs || []).map((p) => path.basename(p)),
    ['b.txt'],
  );
});

test('Result Truth C：删除文件必须报告 deleted', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-truth-c-'));
  await fs.writeFile(path.join(workDir, 'gone.txt'), 'bye', 'utf8');
  await fs.writeFile(path.join(workDir, 'keep.txt'), 'unchanged', 'utf8');
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(writeCodingReg(), async (input) => {
      await fs.unlink(path.join(input.executionAuthorization!.workingDirectory, 'gone.txt'));
      return bundleResult();
    }),
  );
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '删掉 gone.txt',
    workDir: path.join(workDir, 'run'),
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  assert.match(String(result.summary), /deleted: gone\.txt/);
  assert.equal(/keep\.txt/.test(String(result.summary)), false);
});

test('Result Truth D：执行前后都存在且未变化，不得报告为本次成果', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-truth-d-'));
  await fs.writeFile(path.join(workDir, 'keep.txt'), 'same', 'utf8');
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(writeCodingReg(), async () => bundleResult('已经完成修改并检查通过。')),
  );
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '不要改文件',
    workDir: path.join(workDir, 'run'),
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, false);
  assert.match(String(result.summary), /没有改动授权目录中的文件/);
  assert.equal(/已产生文件/.test(String(result.summary)), false);
  assert.equal(/keep\.txt/.test(String(result.summary)), false);
  assert.equal(result.producedOutputs?.length || 0, 0);
});

test('Result Truth：成功 observation 包含执行摘要和本次 delta，而不是目录清单', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-truth-obs-'));
  await fs.mkdir(path.join(workDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(workDir, 'src', 'app.js'), 'old', 'utf8');
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(writeCodingReg(), async (input) => {
      const root = input.executionAuthorization!.workingDirectory;
      await fs.writeFile(path.join(root, 'src', 'app.js'), 'new', 'utf8');
      const summaryPath = path.join(os.tmpdir(), `dm-truth-sum-${Date.now()}.md`);
      await fs.writeFile(summaryPath, '# 代码修改摘要\n\nnpm test\n10 passed / 0 failed\n', 'utf8');
      return bundleResult('已经完成修改并检查通过。', [
        { sourcePath: summaryPath, mediaType: 'text/markdown', role: 'execution-summary' },
      ]);
    }),
  );
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1', authorizedWorkingDirectory: workDir });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '改 src',
    workDir: path.join(workDir, 'run'),
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  assert.match(String(result.summary), /10 passed \/ 0 failed/);
  assert.match(String(result.summary), /modified: src\/app\.js/);
  assert.equal(/已产生文件/.test(String(result.summary)), false);
});

test('附上文件不得猜父目录为授权项目', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-auth-'));
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'x');
  assert.equal(resolveAuthorizedWorkingDirectory([file]), undefined);
  assert.equal(resolveAuthorizedWorkingDirectory([dir]), path.resolve(dir));
});
