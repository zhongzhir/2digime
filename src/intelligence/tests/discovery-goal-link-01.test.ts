import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { readThread } from '../store';
import { readDigitalSelf } from '../../subject-core/digital-self/store';
import { upsertContentPreference } from '../../subject-comm/content-preferences';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import type { TalkChatFn } from '../types';

test('discovery goal carries two canonical objects, corrections survive restart, session switch and revoke stay scoped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-goal-link-'));
  const pkg = path.join(root, 'pkg');
  let correction = false;
  let called = false;
  const chat: TalkChatFn = async ({ messages }) => {
    if (correction && !called) {
      called = true;
      return { text: '', toolCalls: [{ id: 'correct', name: 'update_discovery_goal', arguments: JSON.stringify({request:'近期学习 AI 产品落地；工作日半小时，周末一小时；少看剧只适用于本目标'}) }] };
    }
    const system = String(messages[0]?.content);
    assert.ok(system.includes('当前从发现进入的同一目标') || system.includes('当前没有有效的发现目标'));
    return {text:'已按当前目标处理。'};
  };
  const options = { documentCapability:'fake' as const, registerOpenAiStub:false, searchCapability:false, talkChat:chat };
  let runtime = createDigitalMeRuntime(options);
  await runtime.createPackage({displayName:'隔离联动',targetDir:pkg});
  const store = new FileNetworkItemStore(path.join(pkg,'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0,2)) await store.put(item);
  await runtime.content({action:'adjust',text:'近期少看剧，每天一小时，希望学习 AI 产品落地'});
  await runtime.talk({text:'比较这两个对象',contentIds:FEED_01_SEED_ITEMS.slice(0,2).map(i=>i.itemId)});
  const initial = await readThread(pkg,new Date().toISOString());
  assert.equal(initial.discoveryGoal?.objects.length,2);
  assert.match(initial.discoveryGoal?.originalRequest || '', /每天一小时/);
  assert.equal(initial.discoveryGoal?.objects[0]?.source,FEED_01_SEED_ITEMS[0]?.publisherDisplayName || FEED_01_SEED_ITEMS[0]?.publisherSubjectId);
  correction = true;
  await runtime.talk({text:'改为工作日半小时，周末一小时'});
  const corrected = await readThread(pkg,new Date().toISOString());
  assert.match(corrected.discoveryGoal?.request || '', /工作日半小时/);
  assert.equal((await readDigitalSelf(pkg,'',new Date().toISOString())).understandings.length,0);
  await runtime.stop();
  runtime = createDigitalMeRuntime(options);
  await runtime.openPackage({dir:pkg});
  const same = await runtime.content({action:'asked'});
  assert.match(same.view.adjustment?.text || '', /工作日半小时/);
  const firstId = runtime.listConversationSessions().currentId;
  runtime.createConversationSession();
  assert.equal((await runtime.content({action:'asked'})).view.adjustment,undefined);
  runtime.openConversationSession(firstId);
  await runtime.content({action:'adjustRevoke'});
  assert.equal((await readThread(pkg,new Date().toISOString())).discoveryGoal,undefined);
  await runtime.stop();
});

test('source block crosses Talk; single reduce remains item scoped; Digital Self import source is readable in current thread', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'dm-boundary-link-'));
  const pkg = path.join(root,'pkg');
  let seen = '';
  const runtime = createDigitalMeRuntime({ documentCapability:'fake', registerOpenAiStub:false, searchCapability:false,
    talkChat:async ({messages})=>{seen=String(messages[0]?.content);return {text:'边界已读取'};},
    digitalSelfChat:async ()=>({text:'{"understandings":[]}'}) });
  await runtime.createPackage({displayName:'隔离边界',targetDir:pkg});
  const source = path.join(root,'source.txt');
  await fs.writeFile(source,'IMPORT-ORIGINAL-MARKER: 必要原文可按任务读取。');
  await runtime.digitalSelf({action:'import',filePath:source});
  const thread = await readThread(pkg,new Date().toISOString());
  assert.ok(thread.materialPaths?.some(p=>p.includes('digital-self')));
  await upsertContentPreference(pkg,{kind:'block',targetType:'source',target:'source-a',text:'不再看来源 A'});
  await upsertContentPreference(pkg,{kind:'reduce',targetType:'item',target:'item-a',text:'不喜欢这条'});
  await runtime.talk({text:'按必要原文讨论并找下一条'});
  assert.match(seen,/IMPORT-ORIGINAL-MARKER/);
  assert.match(seen,/"targetType":"source"/);
  assert.match(seen,/单条 reduce 只指该对象/);
  assert.match(seen,/"targetType":"item"/);
  await runtime.stop();
});
