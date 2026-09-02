/**
 * B 在本进程自主 pull inbox；A 不得 drain / 打开 B。
 * 配对走 invite；传输走本地 Relay/E2EE。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import type { ProfessionalAgent, TalkChatFn } from '../types';
import {
  PUBLIC_CARD_SCHEMA_VERSION,
  listExchanges,
  writePublicCard,
  type PublicSubjectCard,
} from '../../subject-collab';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { LocalPackageTransport } from '../../collaboration/transport';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-two-owner-${prefix}-`));
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

function pickSubjectFromCards(sys: string, skillHint: string): string {
  const blocks = sys.split('- subjectId: ').slice(1);
  for (const block of blocks) {
    const id = (block.split('\n')[0] || '').trim();
    if (block.includes(skillHint)) return id;
  }
  throw new Error(`no public card mentioned ${skillHint}`);
}

function publicCard(input: {
  subjectId: string;
  displayName: string;
  skill: string;
  summary: string;
}): PublicSubjectCard {
  return {
    schemaVersion: PUBLIC_CARD_SCHEMA_VERSION,
    subjectId: input.subjectId,
    displayName: input.displayName,
    endpointRef: `local:${input.subjectId}`,
    publicSkills: [{ name: input.skill, summary: input.summary }],
    cooperationScope: '低风险知识与判断合作。',
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
}

async function seedSelf(
  rootDir: string,
  subjectId: string,
  items: Array<{ text: string; facet?: 'about_me' | 'boundaries' }>,
): Promise<void> {
  const now = new Date().toISOString();
  await writeDigitalSelf(rootDir, {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: items.map((item, index) => ({
      id: `u_${index + 1}`,
      text: item.text,
      facet: item.facet || 'about_me',
      status: 'current' as const,
      confirmed: true,
      provenance: { origin: 'user_statement' as const, actor: 'owner' as const, statedAt: now },
      updatedAt: now,
    })),
  });
}

function safetyAgent(onRun: () => void): ProfessionalAgent {
  return {
    id: 'cap_b_process_safety',
    label: '工艺安全笔记',
    description: '按对方请求写下工艺安全判断。',
    async run({ instruction, workDir }) {
      onRun();
      await fs.mkdir(workDir, { recursive: true });
      const outputPath = path.join(workDir, 'safety-note.md');
      await fs.writeFile(
        outputPath,
        `工艺安全初步判断：当前设想在低风险范围内可继续评估，需补齐物料平衡。\n\n${instruction}\n`,
        'utf8',
      );
      return {
        ok: true,
        summary: '已完成工艺安全初步判断：低风险范围内可继续，但需补齐物料平衡。',
        outputPath,
        producedOutputs: [outputPath],
      };
    },
  };
}

async function listenRelay(dataDir: string): Promise<{ server: Server; relayUrl: string }> {
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { server } = createRelayServer({ store, host: '127.0.0.1', port: 0 });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}` };
}

async function pair(
  aBus: ReturnType<typeof createCommandBus>,
  bBus: ReturnType<typeof createCommandBus>,
) {
  const inviteA = await aBus.invoke('subject.communicate', { action: 'createInvite' });
  assert.ok(inviteA.inviteJson);
  const accepted = await bBus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: inviteA.inviteJson!,
  });
  assert.ok(accepted.inviteJson);
  await aBus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: accepted.inviteJson!,
  });
}

function aChat(): TalkChatFn {
  return scriptedChat([
    async ({ messages }) => {
      const sys = String(messages[0]?.content || '');
      const subjectId = pickSubjectFromCards(sys, '工艺安全');
      return {
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'consult_subject',
            arguments: JSON.stringify({
              subjectId,
              goal: '判断工艺安全可行性',
              hopedContribution: '工艺安全意见',
              disclosure: '一份脱敏后的改造设想摘要。',
            }),
          },
        ],
      };
    },
    async ({ messages }) => {
      const sys = String(messages[0]?.content || '');
      if (/actualSuccess=false/.test(sys)) {
        return {
          text: JSON.stringify({
            deliver: true,
            userReply: '这次合作没有成立。我先自己继续看现有材料。',
            askUser: '',
            openGoal: '',
            revision: '',
          }),
        };
      }
      return {
        text: JSON.stringify({
          deliver: true,
          userReply: '我综合了补充判断：当前设想在低风险范围内可继续评估，但需补齐物料平衡。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      };
    },
  ]);
}

test('B 自主收件：A 不 drain B，经真实配对完成合作', { timeout: 30000 }, async () => {
  const root = await tempDir('ok');
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const aDir = path.join(root, 'a');
  const bDir = path.join(root, 'b');
  let bRuns = 0;
  const aRt = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: aChat(),
  });
  const bRt = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    autonomousCollabReceive: true,
    talkProfessionals: [safetyAgent(() => { bRuns += 1; })],
    talkChat: async () => ({
      text: JSON.stringify({
        decision: 'accept',
        reply: '可以提供工艺安全方面的补充判断。',
        contribution: '工艺安全初步判断：低风险范围内可继续，需补齐物料平衡。',
      }),
    }),
  });
  const aBus = createCommandBus(aRt);
  const bBus = createCommandBus(bRt);
  try {
    const createdA = await aBus.invoke('subject.createPackage', { displayName: '主体甲', targetDir: aDir });
    const createdB = await bRt.createPackage({ displayName: '主体乙', targetDir: bDir });
    await seedSelf(aDir, createdA.subjectId, [
      { text: '我在做化工厂局部改造，需要可行性判断，自己不是工艺安全专家。' },
    ]);
    await seedSelf(bDir, createdB.subjectId, [
      { text: '我长期做化工工艺安全评估，可做低风险技术可行性判断。' },
      { text: '私人住址是西湖区某某路88号，不得外发。', facet: 'boundaries' },
    ]);
    await writePublicCard(
      bDir,
      publicCard({
        subjectId: createdB.subjectId,
        displayName: '工艺安全协作者',
        skill: '工艺安全审阅',
        summary: '可做低风险工艺安全可行性判断。',
      }),
    );
    await aBus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
    await bBus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
    await pair(aBus, bBus);
    await new Promise((resolve) => setTimeout(resolve, 900));

    assert.equal(await new LocalPackageTransport(aRt).lookupPackageDir(`subject:${createdB.subjectId}`), null);

    const talked = await aBus.invoke('talk', {
      text: '帮我分析这个化工厂改造项目。如果需要，可以找懂工艺安全的人一起看看。',
    });
    const blob = talked.view.turns.map((turn) => turn.text).join('\n');
    assert.match(blob, /工艺安全|物料平衡/);
    assert.equal(blob.includes('西湖区某某路88号'), false);
    assert.equal(bRuns, 1);

    const aEx = await listExchanges(aDir);
    const bEx = await listExchanges(bDir);
    assert.ok(bEx.some((item) => item.kind === 'request_received'));
    assert.ok(aEx.some((item) => item.kind === 'response_received' && item.peerDecision === 'accept'));
    assert.equal(JSON.stringify([...aEx, ...bEx]).includes('NEGOTIATING'), false);

    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(aDir), 'utf8')) as {
      executions: unknown[];
    };
    assert.equal(rec.executions.length, 0);
  } finally {
    await aRt.stop();
    await bRt.stop();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('B 自主拒绝后，A 不得把失败改写成成功；A 仍不 drain B', { timeout: 30000 }, async () => {
  const root = await tempDir('decline');
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const aDir = path.join(root, 'a');
  const bDir = path.join(root, 'b');
  let bRuns = 0;
  const aRt = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: aChat(),
  });
  const bRt = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    autonomousCollabReceive: true,
    talkProfessionals: [safetyAgent(() => { bRuns += 1; })],
    talkChat: async () => ({
      text: JSON.stringify({
        decision: 'decline',
        reply: '这件事超出我目前愿意承担的范围。',
        contribution: '',
      }),
    }),
  });
  const aBus = createCommandBus(aRt);
  const bBus = createCommandBus(bRt);
  try {
    const createdA = await aBus.invoke('subject.createPackage', { displayName: '主体甲', targetDir: aDir });
    const createdB = await bRt.createPackage({ displayName: '主体乙', targetDir: bDir });
    await seedSelf(aDir, createdA.subjectId, [{ text: '我需要工艺安全意见。' }]);
    await seedSelf(bDir, createdB.subjectId, [
      { text: '我写现代诗，不处理工程安全评估。' },
      { text: '不承担工程安全合作。', facet: 'boundaries' },
    ]);
    await writePublicCard(
      bDir,
      publicCard({
        subjectId: createdB.subjectId,
        displayName: '工艺安全协作者',
        skill: '工艺安全审阅',
        summary: '可做低风险工艺安全可行性判断。',
      }),
    );
    await aBus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
    await bBus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
    await pair(aBus, bBus);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const talked = await aBus.invoke('talk', {
      text: '帮我分析这个项目。如果需要，可以找懂工艺安全的人一起看看。',
    });
    const blob = talked.view.turns.map((turn) => turn.text).join('\n');
    assert.match(blob, /这次合作没有成立|超出我目前愿意承担/);
    assert.equal(/合作已经完成，对方已经接受/.test(blob), false);
    assert.equal(bRuns, 0);
    const bEx = await listExchanges(bDir);
    assert.ok(bEx.some((item) => item.kind === 'request_received'));
    assert.ok(bEx.some((item) => item.kind === 'response_sent' && item.peerDecision === 'decline'));
  } finally {
    await aRt.stop();
    await bRt.stop();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
