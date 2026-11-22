import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { saveFilesystemGrant } from '../../authorization/filesystem-grant';
import { readThread } from '../store';
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

test('import binds the package copy to the current talk thread, not a desktop lookalike', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-import-bind-'));
  const sourcePath = path.join(root, 'stabilization-01-material.txt');
  await fs.writeFile(sourcePath, '这是指定导入材料 STABILIZATION-01-MARKER。\n不得用其它桌面文稿替代。\n', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  const pkgDir = path.join(root, 'pkg');
  await runtime.createPackage({
    displayName: '材料绑定验收',
    targetDir: pkgDir,
  });
  const imported = await runtime.importSubjectMaterial({
    sourcePath,
    distillCandidates: false,
  });
  const dest = path.join(pkgDir, ...imported.materialRef.split('/'));
  assert.equal(await fs.readFile(dest, 'utf8').then((text) => text.includes('STABILIZATION-01-MARKER')), true);
  const thread = await readThread(pkgDir, new Date().toISOString());
  assert.ok(
    (thread.materialPaths || []).includes(dest),
    `expected ${dest} in ${JSON.stringify(thread.materialPaths || [])}`,
  );
  await runtime.stop();
});

test('imported materials stay on one conversation, survive restart, and grants do not unlock other drafts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-import-iso-'));
  const pkgDir = path.join(root, 'pkg');
  const tidal = path.join(root, 'note-tidal.txt');
  const spectra = path.join(root, 'note-spectra.txt');
  const decoyDir = path.join(root, 'granted');
  const decoy = path.join(decoyDir, 'other-authorized-draft.txt');
  await fs.mkdir(decoyDir, { recursive: true });
  await fs.writeFile(tidal, '这份文稿只讨论潮汐锁定，卫星总是同一面朝向主星。\n', 'utf8');
  await fs.writeFile(spectra, '这份文稿只讨论光谱分类，按吸收线划分恒星类型。\n', 'utf8');
  await fs.writeFile(decoy, 'DECOY-DRAFT-SHOULD-NOT-BE-READ\n这是授权夹里的另一份文稿。\n', 'utf8');

  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await runtime.createPackage({
    displayName: '材料隔离验收',
    targetDir: pkgDir,
  });
  const first = await runtime.importSubjectMaterial({ sourcePath: tidal, distillCandidates: false });
  const second = await runtime.importSubjectMaterial({ sourcePath: spectra, distillCandidates: false });
  const firstDest = path.join(pkgDir, ...first.materialRef.split('/'));
  const secondDest = path.join(pkgDir, ...second.materialRef.split('/'));
  const threadA = await readThread(pkgDir, new Date().toISOString());
  assert.deepEqual(
    [...(threadA.materialPaths || [])].sort(),
    [firstDest, secondDest].sort(),
  );

  const created = runtime.createConversationSession();
  const threadB = await readThread(pkgDir, new Date().toISOString(), created.session.id);
  assert.equal((threadB.materialPaths || []).length, 0);
  assert.equal((threadB.materialPaths || []).includes(firstDest), false);

  const listed = runtime.listConversationSessions();
  const firstSessionId = listed.sessions.find((row) => row.id !== created.session.id)?.id || '';
  runtime.openConversationSession(firstSessionId);
  const threadAAgain = await readThread(pkgDir, new Date().toISOString());
  assert.ok((threadAAgain.materialPaths || []).includes(firstDest));
  assert.ok((threadAAgain.materialPaths || []).includes(secondDest));
  await runtime.stop();

  const restarted = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
  });
  await restarted.openPackage({ dir: pkgDir });
  const afterRestart = await readThread(pkgDir, new Date().toISOString());
  assert.ok((afterRestart.materialPaths || []).includes(firstDest));
  assert.ok((afterRestart.materialPaths || []).includes(secondDest));
  await restarted.stop();

  const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8')) as { id?: string };
  await saveFilesystemGrant({
    packageRoot: pkgDir,
    subjectId: pkg.id || 'default',
    folder: decoyDir,
    now: new Date().toISOString(),
  });

  let listedGrant = false;
  let readDecoy = false;
  let readSpecified = false;
  const specified = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        const names = (tools || []).map((row) => row.function.name);
        assert.equal(names.includes('list_directory'), false);
        assert.equal(names.includes('read_file'), true);
        return {
          text: '',
          toolCalls: [
            { id: 'l1', name: 'list_directory', arguments: JSON.stringify({ path: '' }) },
            { id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: decoy }) },
          ],
        };
      },
      async ({ messages }) => {
        const tools = messages.filter((row) => row.role === 'tool').map((row) => String(row.content || ''));
        listedGrant = tools.some((row) => /actualSuccess":true/.test(row) && /other-authorized-draft/.test(row));
        readDecoy = tools.some((row) => /DECOY-DRAFT-SHOULD-NOT-BE-READ/.test(row));
        return { text: '没有指定材料时不会去翻授权夹里的其它文稿。' };
      },
    ]),
    talkProfessionals: [],
  });
  const unspecifiedBus = createCommandBus(specified);
  await unspecifiedBus.invoke('subject.openPackage', { dir: pkgDir });
  await unspecifiedBus.invoke('talk', { text: '先别读材料，只告诉我你现在能写到哪里。' });
  assert.equal(listedGrant, false);
  assert.equal(readDecoy, false);
  await specified.stop();

  const reader = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal((tools || []).some((row) => row.function.name === 'read_file'), true);
        return {
          text: '',
          toolCalls: [{ id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: firstDest }) }],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((row) => row.role === 'tool').pop()?.content || '');
        readSpecified = /潮汐锁定/.test(tool) && !/光谱分类/.test(tool) && !/DECOY-DRAFT/.test(tool);
        return { text: '按潮汐锁定那份整理：卫星总是同一面朝向主星。' };
      },
    ]),
    talkProfessionals: [],
  });
  const readerBus = createCommandBus(reader);
  await readerBus.invoke('subject.openPackage', { dir: pkgDir });
  const talked = await readerBus.invoke('talk', {
    text: '按讲潮汐锁定的那份整理要点，不要用另一份。',
  });
  const last = [...talked.view.turns].reverse().find((row) => row.role === 'assistant');
  assert.equal(readSpecified, true);
  assert.match(String(last?.text || ''), /潮汐锁定/);
  assert.equal(/DECOY-DRAFT/.test(String(last?.text || '')), false);
  await reader.stop();
});
