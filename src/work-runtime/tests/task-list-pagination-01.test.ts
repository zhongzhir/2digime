/**
 * 任务列表分页：超过 50 条不得永久隐藏更早任务。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';

test('listTasks 支持 offset/limit，超过 50 条可加载更多', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-task-page-'));
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '分页主体',
    targetDir: path.join(root, 'pkg'),
  });
  for (let i = 0; i < 62; i += 1) {
    await bus.invoke('work.converse', { text: `分页任务 ${String(i).padStart(3, '0')}` });
  }
  const first = await bus.invoke('work.listTasks', { limit: 50, offset: 0 });
  assert.equal(first.tasks.length, 50);
  assert.equal(first.total, 62);
  assert.equal(first.hasMore, true);
  const rest = await bus.invoke('work.listTasks', { limit: 50, offset: 50 });
  assert.equal(rest.tasks.length, 12);
  assert.equal(rest.hasMore, false);
  const ids = new Set([...first.tasks, ...rest.tasks].map((t) => t.taskId));
  assert.equal(ids.size, 62);
  await runtime.stop();
});
