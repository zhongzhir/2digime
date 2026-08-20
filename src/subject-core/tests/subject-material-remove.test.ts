import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { collectInactiveEventIds } from '../derive-all';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-mat-rm-${prefix}-`));
}

test('removeMaterial: deletes package copy, invalidates refs, keeps source file', async () => {
  const root = await tempDir('basic');
  const sourcePath = path.join(root, 'source-notes.txt');
  await fs.writeFile(sourcePath, '我在做产品验收，边界是不公开融资细节。\n', 'utf8');

  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  const pkgDir = path.join(root, 'pkg');
  await runtime.createPackage({
    displayName: '移除验收主体',
    targetDir: pkgDir,
  });

  const imported = await runtime.importSubjectMaterial({
    sourcePath,
    distillCandidates: true,
  });
  assert.ok(imported.materialRef.startsWith('materials/'));
  const packageCopy = path.join(pkgDir, ...imported.materialRef.split('/'));
  assert.equal(await fs.stat(packageCopy).then((s) => s.isFile()), true);

  const before = await runtime.getOverview();
  assert.ok((before.materials || []).some((m) => m.materialRef === imported.materialRef));

  const relatedBefore = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.payload?.relation?.materialRef === imported.materialRef,
  );
  assert.ok(relatedBefore.length >= 1);

  const removed = await runtime.removeSubjectMaterial({ materialRef: imported.materialRef });
  assert.equal(removed.removed, true);
  await assert.rejects(() => fs.stat(packageCopy), (err: NodeJS.ErrnoException) => err.code === 'ENOENT');
  assert.equal(await fs.stat(sourcePath).then((s) => s.isFile()), true);

  const after = await runtime.getOverview();
  assert.equal(
    (after.materials || []).some((m) => m.materialRef === imported.materialRef),
    false,
  );

  const events = await runtime.subject.listGrowthEvents();
  const inactive = new Set(collectInactiveEventIds(events));
  for (const event of relatedBefore) {
    assert.ok(inactive.has(event.id), `related event ${event.id} should be inactive`);
  }

  // 后续任务仍可提交，且不应再把已移除资料当有效资产注入前提（列表与派生已清理）
  const submitted = await runtime.submitTask({
    goal: '写一句验收说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  assert.ok(submitted.taskId);
  assert.ok(submitted.jobId);
});
