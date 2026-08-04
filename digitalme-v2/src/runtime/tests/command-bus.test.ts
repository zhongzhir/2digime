import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { COMMAND_NAMES, COMMAND_COUNT_LIMIT } from '../commands';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-cmd-${prefix}-`));
}

test('CommandBus 覆盖全部命令且不超过上限', async () => {
  assert.equal(COMMAND_NAMES.length, 18);
  assert.ok(COMMAND_NAMES.length <= COMMAND_COUNT_LIMIT);
  assert.ok(COMMAND_NAMES.includes('work.reviseArtifact'));
  assert.ok(COMMAND_NAMES.includes('subject.importMaterial'));
  assert.ok(COMMAND_NAMES.includes('subject.captureInput'));

  const root = await tempDir('bus');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '命令面主体',
    targetDir: path.join(root, 'pkg'),
  });

  const overview = await bus.invoke('subject.getOverview', {});
  assert.ok(overview.subjectId);

  const submitted = await bus.invoke('work.submitTask', {
    goal: '写一句话说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  assert.ok(submitted.taskId);
  assert.ok(submitted.jobId);

  // 等待完成
  const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
  await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);

  const task = await bus.invoke('work.getTask', { taskId: submitted.taskId });
  assert.equal(task.state, 'completed');
  assert.ok(task.artifactIds[0]);

  const content = await bus.invoke('artifact.getContent', {
    artifactId: task.artifactIds[0] as string,
  });
  assert.ok((content.text || '').length > 0);
  assert.ok(content.headVersionId);

  await bus.invoke('artifact.saveEdit', {
    artifactId: task.artifactIds[0] as string,
    text: `${content.text}\n\n补充一句。\n`,
  });

  const exported = await bus.invoke('artifact.export', {
    artifactId: task.artifactIds[0] as string,
    format: 'md',
    targetPath: path.join(root, 'out.md'),
  });
  assert.ok(exported.path);

  const revealed = await bus.invoke('artifact.revealInFolder', {
    artifactId: task.artifactIds[0] as string,
  });
  assert.equal(revealed.opened, true);

  const caps = await bus.invoke('capability.list', {});
  assert.ok(caps.capabilities.length >= 1);

  const collab = await bus.invoke('collab.simulateInteraction', {
    granteeName: '协作方',
    scope: { actions: ['network'] },
    goal: '本地模拟',
  });
  assert.ok(collab.requestId);
  assert.ok(collab.grantId);

  const list = await bus.invoke('work.listTasks', {});
  assert.ok(list.tasks.length >= 1);

  await runtime.stop();
});
