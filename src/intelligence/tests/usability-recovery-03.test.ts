/**
 * DIGITALME-USABILITY-RECOVERY-03：取消必须结束正在等待的授权，
 * 工具之后的服务失败不得被写成「详细说明生成超时」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { currentTalkTurnSignal } from '../service';
import { classifyAuthorizedPaths, runReadFile } from '../mechanical-tools';
import { ManagedAiError } from '../../capability/managed-ai-client';

import type { TalkChatFn } from '../types';

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

test('取消会结束正在等待的文件夹授权，而不是记成主人拒绝或生成超时', { timeout: 15_000 }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-recovery-03-home-'));
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const prevHome = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-recovery-03-cancel-'));
  const ac = new AbortController();
  let entered = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call_folder',
            name: 'request_folder_access',
            arguments: JSON.stringify({ path: 'Desktop/TideNote' }),
          },
        ],
      }),
      async () => ({ text: '不应该继续问模型。' }),
    ]),
    requestFolderAccess: () =>
      new Promise((resolve, reject) => {
        entered = true;
        const signal = currentTalkTurnSignal();
        const stop = () => {
          const reason = signal?.reason;
          reject(reason instanceof Error ? reason : Object.assign(new Error('已取消。'), { name: 'TalkCancelled' }));
        };
        if (!signal) {
          resolve(false);
          return;
        }
        if (signal.aborted) stop();
        else signal.addEventListener('abort', stop, { once: true });
      }),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '取消',
      targetDir: path.join(root, 'pkg'),
    });
    runtime.setTalkAbortSignal(ac.signal);
    const pending = bus.invoke('talk', { text: '把稿子改写到桌面的 TideNote。' });
    const started = Date.now();
    while (!entered && Date.now() - started < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(entered, true);
    const reason = new Error('已取消。');
    reason.name = 'TalkCancelled';
    ac.abort(reason);
    const talked = await pending;
    const last = talked.view.turns[talked.view.turns.length - 1];
    const copy = String(last?.text || '');
    assert.match(copy, /已取消/);
    assert.equal(copy.includes('详细说明生成超时'), false);
    assert.equal(copy.includes('主人没有允许'), false);
    assert.equal(talked.view.outcome, 'CANCELLED');
    assert.equal(copy.includes('不应该继续问模型'), false);
  } finally {
    runtime.setTalkAbortSignal(null);
    if (prevHome === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prevHome;
    await runtime.stop();
  }
});

test('读取成功后的服务失败保留真实原因，不写成生成超时', { timeout: 15_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-recovery-03-notice-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'note.md'), '开头事实：杯子是蓝色的。', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call_read',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'note.md' }),
          },
        ],
      }),
      async () => {
        throw new ManagedAiError('PROVIDER_ERROR', '模型服务当前比较忙');
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '原因',
      targetDir: path.join(root, 'pkg'),
    });
    const talked = await bus.invoke('talk', {
      text: '看看这份材料。',
      contextPaths: [project],
    });
    const last = talked.view.turns[talked.view.turns.length - 1];
    const copy = String(last?.text || '');
    assert.match(copy, /已读取/);
    assert.match(copy, /模型服务当前比较忙/);
    assert.equal(copy.includes('详细说明生成超时'), false);
    assert.equal(last?.result, undefined);
  } finally {
    await runtime.stop();
  }
});

test('长文档按段读取，能区分全文、摘录和失败', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-recovery-03-read-'));
  const file = path.join(root, 'voyage.md');
  const start = '开头事实：码头的灯是绿色的。';
  const middle = '中间事实：仓库钥匙挂在第三颗钉子上。';
  const end = '结尾事实：船长把航线改到了北纬四十一度。';
  const pad = '甲板上只有风。'.repeat(2000);
  await fs.writeFile(file, `${start}\n${pad}\n${middle}\n${pad}\n${end}\n`, 'utf8');
  const auth = classifyAuthorizedPaths([file]);
  const first = JSON.parse(await runReadFile(auth, JSON.stringify({ path: file }))) as {
    coverage: string;
    complete: boolean;
    content: string;
    nextOffset?: number;
    total: number;
  };
  assert.equal(first.coverage, 'excerpt');
  assert.equal(first.complete, false);
  assert.match(first.content, /码头的灯是绿色的/);
  assert.equal(first.content.includes('第三颗钉子'), false);
  assert.equal(first.content.includes('北纬四十一度'), false);
  const mid = JSON.parse(
    await runReadFile(auth, JSON.stringify({ path: file, offset: first.nextOffset })),
  ) as { coverage: string; content: string; nextOffset?: number; complete: boolean };
  assert.equal(mid.coverage, 'excerpt');
  assert.match(mid.content, /第三颗钉子/);
  const lastRead = JSON.parse(
    await runReadFile(auth, JSON.stringify({ path: file, offset: mid.nextOffset })),
  ) as { coverage: string; complete: boolean; content: string };
  assert.match(lastRead.content, /北纬四十一度/);
  assert.equal(lastRead.complete, false);
  const tiny = path.join(root, 'tiny.md');
  await fs.writeFile(tiny, '全文事实：只有这一句。', 'utf8');
  const full = JSON.parse(await runReadFile(classifyAuthorizedPaths([tiny]), JSON.stringify({ path: tiny }))) as {
    coverage: string;
    complete: boolean;
  };
  assert.equal(full.coverage, 'full');
  assert.equal(full.complete, true);
  const failed = JSON.parse(
    await runReadFile(auth, JSON.stringify({ path: path.join(root, 'missing.md') })),
  ) as { coverage: string; ok: boolean };
  assert.equal(failed.ok, false);
  assert.equal(failed.coverage, 'failed');
});
