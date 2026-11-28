import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('个人名片复用 Subject identity 权威并随包持久化', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-identity-profile-'));
  const pkgDir = path.join(root, 'pkg');
  const avatar = path.join(root, 'avatar.png');
  await fs.writeFile(avatar, ONE_PIXEL_PNG);
  const runtime = createDigitalMeRuntime({ registerOpenAiStub: true });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '原名', targetDir: pkgDir });
    const saved = await bus.invoke('digitalSelf', {
      action: 'identityUpdate',
      displayName: '张三',
      username: 'zhangsan',
      bio: '愿意与可信伙伴协作。',
      phone: '138 0000 0000',
      email: 'zhangsan@example.com',
      avatarFilePath: avatar,
    });
    assert.equal(saved.identity?.username, 'zhangsan');
    assert.match(saved.identity?.avatarDataUrl || '', /^data:image\/png;base64,/);

    const overview = await bus.invoke('subject.getOverview', {});
    assert.equal(overview.displayName, '张三');
    assert.equal(overview.username, 'zhangsan');
    assert.equal(overview.phone, '138 0000 0000');
    assert.equal(overview.email, 'zhangsan@example.com');
    assert.match(overview.avatarDataUrl || '', /^data:image\/png;base64,/);

    const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8')) as {
      identity: { username?: string; avatarRef?: string };
    };
    assert.equal(manifest.identity.username, 'zhangsan');
    assert.equal(manifest.identity.avatarRef, 'identity/avatar.png');
    assert.deepEqual(await fs.readFile(path.join(pkgDir, 'identity', 'avatar.png')), ONE_PIXEL_PNG);
  } finally {
    await runtime.stop();
  }
});

test('个人名片不把本机登记冒充为已验证身份', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-identity-validation-'));
  const runtime = createDigitalMeRuntime({ registerOpenAiStub: true });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '原名', targetDir: path.join(root, 'pkg') });
    await assert.rejects(
      bus.invoke('digitalSelf', { action: 'identityUpdate', displayName: '张三', username: '符号 用户名' }),
      /用户名/,
    );
    await assert.rejects(
      bus.invoke('digitalSelf', { action: 'identityUpdate', displayName: '张三', email: 'not-an-email' }),
      /邮箱格式/,
    );
  } finally {
    await runtime.stop();
  }
});
