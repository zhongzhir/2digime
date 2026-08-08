/**
 * REMOTE-CLIENT-COMMAND-EXPOSURE-FIX-01
 * 证明 renderer 所用 subject.communicate 在 preload / main / CommandBus 同步可达，
 * 且 configureRelay 可写入 SubjectPackage collaboration/peers.json（含 HTTPS）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { COMMAND_NAMES } from '../commands';
import { createTestCommCipher } from '../../subject-comm/identity-store';
import { setCommCipher } from '../../subject-comm/transport-factory';

function extractCommandArray(source: string, marker: string): string[] {
  const idx = source.indexOf(marker);
  assert.ok(idx >= 0, `missing marker ${marker}`);
  const slice = source.slice(idx);
  // preload: ];  |  main Set: ]);
  const endSet = slice.indexOf(']);');
  const endArr = slice.indexOf('];');
  const end =
    endSet >= 0 && (endArr < 0 || endSet < endArr) ? endSet : endArr;
  assert.ok(end >= 0, `missing array end after ${marker}`);
  const block = slice.slice(0, end);
  const out: string[] = [];
  const re = /"([a-z]+\.[a-zA-Z]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[1]!);
  return out;
}

test('preload / main / COMMAND_NAMES 均暴露 subject.communicate', async () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const preloadSrc = await fs.readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const mainSrc = await fs.readFile(path.join(root, 'electron', 'main.cjs'), 'utf8');

  const preloadCmds = extractCommandArray(preloadSrc, 'const COMMAND_NAMES = [');
  const mainCmds = extractCommandArray(mainSrc, 'const COMMAND_NAMES = new Set([');

  assert.ok(
    preloadCmds.includes('subject.communicate'),
    'preload allowlist missing subject.communicate',
  );
  assert.ok(mainCmds.includes('subject.communicate'), 'main allowlist missing subject.communicate');
  assert.ok(
    (COMMAND_NAMES as readonly string[]).includes('subject.communicate'),
    'COMMAND_NAMES missing subject.communicate',
  );

  assert.deepEqual([...preloadCmds].sort(), [...mainCmds].sort());
  assert.deepEqual([...preloadCmds].sort(), [...COMMAND_NAMES].sort());

  const appJs = await fs.readFile(path.join(root, 'electron', 'renderer', 'app.js'), 'utf8');
  assert.match(appJs, /api\.invoke\(\s*"subject\.communicate"/);
  assert.match(appJs, /action:\s*"configureRelay"/);
});

test('configureRelay 写入 peers.json 且接受 HTTPS Relay URL', async () => {
  setCommCipher(createTestCommCipher());
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-relay-cfg-'));
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '中继配置主体',
      targetDir: pkgDir,
    });

    const relayUrl = 'https://relay.muhub.cn';
    const result = await bus.invoke('subject.communicate', {
      action: 'configureRelay',
      relayUrl,
    });
    assert.equal(result.ok, true);
    assert.ok(typeof result.reachable === 'boolean');
    assert.ok(result.connectionLabel);

    const peersPath = path.join(pkgDir, 'collaboration', 'peers.json');
    const raw = await fs.readFile(peersPath, 'utf8');
    const peers = JSON.parse(raw) as {
      self?: { relayUrl?: string; endpointId?: string; subjectId?: string };
    };
    assert.ok(peers.self);
    assert.equal(peers.self!.relayUrl, relayUrl);
    assert.ok(peers.self!.endpointId);
    assert.ok(peers.self!.subjectId);
    assert.doesNotMatch(JSON.stringify(result), /command not exposed/i);
  } finally {
    await runtime.stop();
    setCommCipher(null);
  }
});
