import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import { CapabilityRegistry } from '../../capability/registry';
import type { CapabilityInput, CapabilityOutput } from '../../capability/adapter';
import type { CapabilityRegistration } from '../../capability/registration';
import { agentsFromRegistry, describeProfessionals } from '../professionals';

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
        id: 'cap_baseline_web_search',
        kind: 'tool',
        displayName: '基础搜索',
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

  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1' });
  const ids = agents.map((a) => a.id).sort();
  assert.deepEqual(ids, ['cap_baseline_web_search', 'cap_external_executor_codex']);
  const blob = describeProfessionals(agents);
  assert.match(blob, /代码执行能力/);
  assert.match(blob, /不能做什么/);
  assert.match(blob, /真实效果/);
  assert.match(blob, /真实创建或修改文件/);
  assert.equal(/WorkIntent|outputFamily/.test(blob), false);
  assert.equal(blob.includes('对话模型'), false);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-'));
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const result = await coding.run({
    instruction: '创建一个 README.md',
    workDir,
    signal: new AbortController().signal,
  });
  assert.equal(captured.input?.artifactType, 'code-change');
  assert.equal(captured.input?.executionAuthorization?.confirmed, true);
  assert.equal(captured.input?.executionAuthorization?.workingDirectory, workDir);
  assert.equal(captured.input?.executionAuthorization?.projectOrigin, 'digitalme_created');
  const readme = path.join(workDir, 'README.md');
  assert.equal(await fs.readFile(readme, 'utf8'), 'gate');
  assert.equal(result.outputPath, readme);

  const search = agents.find((a) => a.id === 'cap_baseline_web_search');
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
  assert.match(blob, /检索公开网页/);
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
  const agents = agentsFromRegistry(registry, { subjectId: 'sub_1' });
  const coding = agents.find((a) => a.id === 'cap_external_executor_codex');
  assert.ok(coding);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prof-empty-'));
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
