/**
 * BLOCKER-05：同 userData 磁盘级恢复验收（不启动 Electron UI）。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';

const nodeRequire = createRequire(__filename);
const {
  countSubjectPackages,
  ensureDefaultPackageAttached,
  resolveDefaultSubjectDir,
} = nodeRequire('../../../electron/default-package.cjs') as {
  countSubjectPackages: (userDataPath: string) => number;
  ensureDefaultPackageAttached: (opts: {
    runtime: unknown;
    userDataPath: string;
    displayName?: string;
  }) => Promise<{ ok: boolean; created?: boolean; dir?: string }>;
  resolveDefaultSubjectDir: (userDataPath: string) => string;
};

describe('software-dev-blocker-05-resume-disk', () => {
  it('同 userData 重开后 package ID 不变且不新建第二 default', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-resume-ud-'));

    const rt1 = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
    });
    const attach1 = await ensureDefaultPackageAttached({
      runtime: rt1,
      userDataPath: userData,
      displayName: '我的数字之我',
    });
    assert.equal(attach1.ok, true);
    assert.equal(attach1.created, true);
    assert.equal(countSubjectPackages(userData), 1);

    const pkgDir = resolveDefaultSubjectDir(userData);
    const manifest1 = JSON.parse(await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8'));
    const packageId = manifest1.id as string;
    assert.ok(packageId);

    const listed1 = await rt1.listTasks({ limit: 50 });
    const taskIds = (listed1.tasks || [])
      .map((t: { taskId: string }) => t.taskId)
      .sort();

    const rt2 = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
    });
    const attach2 = await ensureDefaultPackageAttached({
      runtime: rt2,
      userDataPath: userData,
      displayName: '我的数字之我',
    });
    assert.equal(attach2.ok, true);
    assert.equal(attach2.created, false, 'resume 不得新建 default package');
    assert.equal(countSubjectPackages(userData), 1, '不得出现第二 subject package');

    const manifest2 = JSON.parse(await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest2.id, packageId);

    const listed2 = await rt2.listTasks({ limit: 50 });
    const taskIds2 = (listed2.tasks || [])
      .map((t: { taskId: string }) => t.taskId)
      .sort();
    assert.deepEqual(taskIds2, taskIds);

    const modelConfigPath = path.join(userData, 'model-config.json');
    await fs.writeFile(
      modelConfigPath,
      `${JSON.stringify(
        {
          providerPreset: 'deepseek',
          providerId: 'openai-compatible',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-flash',
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const cfgText = await fs.readFile(modelConfigPath, 'utf8');
    assert.ok(!/apiKey|sk-/i.test(cfgText));
    const cfg2 = JSON.parse(cfgText);
    assert.equal(cfg2.model, 'deepseek-v4-flash');
  });
});
