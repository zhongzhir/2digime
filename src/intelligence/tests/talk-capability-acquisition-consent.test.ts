import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { pendingCapabilityAcquisitionWorkspace } from '../loop';
import type { TalkChatFn, TalkThread } from '../types';

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let index = 0;
  return async (input) => {
    const reply = replies[index];
    index += 1;
    if (!reply) throw new Error(`talk chat script exhausted at ${index}`);
    return reply(input);
  };
}

test('第三方 runtime 必须跨用户轮次取得一次性同意后才执行', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acquire-consent-'));
  const pkg = path.join(root, 'pkg');
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'app.js'), 'module.exports = 1;\n', 'utf8');
  let runs = 0;
  let token = '';
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkProfessionals: [
      {
        id: 'cap_acquired_coding_runtime',
        label: '代码执行能力',
        description: '在授权目录修改代码并运行测试。',
        authNeeded: '需要本次已授权工作目录',
        runtimeStatus: 'acquirable',
        acquisition: {
          displayName: '成熟 Coding Runtime',
          version: '1.2.3',
          sources: ['https://example.invalid/runtime.zip'],
          expectedSha256: 'ab'.repeat(32),
          costNotice: '运行包下载本身不收费；沿用当前模型连接。',
          workingDirectory: project,
        },
        async run() {
          runs += 1;
          await fs.writeFile(path.join(project, 'app.js'), 'module.exports = 2;\n', 'utf8');
          return {
            ok: true,
            summary: '已修复并测试。',
            producedOutputs: [path.join(project, 'app.js')],
            outputPath: path.join(project, 'app.js'),
          };
        },
      },
    ],
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [{
          id: 'prepare',
          name: 'delegate',
          arguments: JSON.stringify({
            capabilityId: 'cap_acquired_coding_runtime',
            instruction: '修复 app.js 并测试。',
          }),
        }],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
        assert.match(tool, /confirmationRequired/);
        assert.match(tool, /尚未获取/);
        assert.equal(runs, 0);
        return { text: '需要先获取并校验第三方代码执行能力。运行包下载本身不收费，是否同意？' };
      },
      async () => ({ text: '需要先获取并校验第三方代码执行能力。运行包下载本身不收费，是否同意？' }),
      async ({ messages }) => {
        const system = String(messages[0]?.content || '');
        assert.match(system, /待确认第三方能力获取机械事实/);
        assert.match(system, /https:\/\/example\.invalid\/runtime\.zip/);
        token = /一次性 acquisitionConfirmationToken：([^\s]+)/.exec(system)?.[1] || '';
        assert.ok(token);
        return {
          text: '',
          toolCalls: [{
            id: 'execute',
            name: 'delegate',
            arguments: JSON.stringify({
              capabilityId: 'cap_acquired_coding_runtime',
              instruction: '修复 app.js 并测试。',
              acquisitionConfirmationToken: token,
            }),
          }],
        };
      },
      async () => ({ text: '已经完成修改并检查。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '获取同意', targetDir: pkg });

  const first = await bus.invoke('talk', {
    text: '请修复这个项目。',
    contextPaths: [project],
  });
  assert.equal(runs, 0);
  assert.match(String(first.view.turns.at(-1)?.text || ''), /是否同意/);
  assert.equal(await fs.readFile(path.join(project, 'app.js'), 'utf8'), 'module.exports = 1;\n');
  const afterFirst = JSON.parse(await fs.readFile(talkThreadFilePath(pkg), 'utf8')) as TalkThread;
  assert.equal(
    afterFirst.executions.some((exec) => exec.capabilityId === 'prepare_capability_acquisition'),
    true,
  );
  assert.equal(pendingCapabilityAcquisitionWorkspace(afterFirst), project);

  const second = await bus.invoke('talk', { text: '同意获取并继续。' });
  assert.equal(runs, 1);
  assert.equal(await fs.readFile(path.join(project, 'app.js'), 'utf8'), 'module.exports = 2;\n');
  assert.match(String(second.view.turns.at(-1)?.text || ''), /已经完成/);

  const thread = JSON.parse(await fs.readFile(talkThreadFilePath(pkg), 'utf8')) as TalkThread;
  const preview = thread.executions.find((exec) => exec.capabilityId === 'prepare_capability_acquisition');
  const executed = thread.executions.find((exec) => exec.capabilityId === 'cap_acquired_coding_runtime');
  assert.ok(preview?.ok);
  assert.ok(executed?.ok);
  assert.match(String(executed?.safeDetail || ''), /capability_acquisition_attempt_v1/);
  assert.match(String(executed?.safeDetail || ''), new RegExp(String(preview?.id || 'missing')));
  assert.equal(pendingCapabilityAcquisitionWorkspace(thread), undefined);
  await runtime.stop();
});

test('同一用户轮次拿到说明后不能立即绕过同意执行', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acquire-same-turn-'));
  const pkg = path.join(root, 'pkg');
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  let runs = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkProfessionals: [{
      id: 'cap_acquired_coding_runtime',
      label: '代码执行能力',
      description: '修改代码',
      runtimeStatus: 'acquirable',
      acquisition: {
        displayName: '成熟 Coding Runtime',
        sources: ['https://example.invalid/runtime.zip'],
        costNotice: '不新增费用。',
      },
      async run() {
        runs += 1;
        return { ok: true, summary: '不应执行', producedOutputs: [] };
      },
    }],
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [{
          id: 'prepare',
          name: 'delegate',
          arguments: JSON.stringify({ capabilityId: 'cap_acquired_coding_runtime', instruction: '执行' }),
        }],
      }),
      async () => ({
        text: '',
        toolCalls: [{
          id: 'bypass',
          name: 'delegate',
          arguments: JSON.stringify({
            capabilityId: 'cap_acquired_coding_runtime',
            instruction: '执行',
            acquisitionConfirmationToken: 'forged',
          }),
        }],
      }),
      async () => ({ text: '尚未执行。' }),
      async () => ({ text: '尚未执行。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '同轮拒绝', targetDir: pkg });
  await bus.invoke('talk', { text: '执行', contextPaths: [project] });
  assert.equal(runs, 0);
  await runtime.stop();
});
