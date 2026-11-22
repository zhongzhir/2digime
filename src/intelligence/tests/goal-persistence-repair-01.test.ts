import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { readThread, writeThread, talkThreadFilePath } from '../store';
import { readDigitalSelf, writeDigitalSelf } from '../../subject-core/digital-self/store';
import { parseInterpretResult } from '../../subject-core/digital-self/interpret';
const request='学习AI产品落地；工作日30分钟、周末60分钟；分次学习，观看笔记练习合计受限；无可靠时间戳不编造停点';
async function fixture(opts: Parameters<typeof createDigitalMeRuntime>[0]) {
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'dm-goal-save-'));const pkg=path.join(base,'pkg');const runtime=createDigitalMeRuntime({...opts,searchCapability:false,documentCapability:'fake',registerOpenAiStub:false});await runtime.createPackage({displayName:'隔离保存',targetDir:pkg});const t=await readThread(pkg,new Date().toISOString());t.discoveryGoal={originalRequest:'每天一小时学习AI产品落地',request:'每天一小时学习AI产品落地',scope:'session',objects:[{contentId:'old',title:'历史对象',url:'https://example.org/course',source:'历史来源',summary:'历史摘要'}]};await writeThread(pkg,t);return{runtime,pkg,before:t};
}
test('model understands mixed lasting fact and same-goal correction; disk precedes final, restart and Discover read same goal',async()=>{
 let talkCalls=0;let pkg='';const opts={digitalSelfChat:async()=>({text:JSON.stringify({understandings:[{text:'用户是一名产品经理',facet:'about_me',aboutUser:true,origin:'user_statement',lasting:true,scope:'self'}],goalUpdate:{request}})}),talkChat:async({messages}:any)=>{talkCalls++;assert.equal((await readThread(pkg,new Date().toISOString())).discoveryGoal?.request,request);assert.match(messages[0].content,/回读核实/);assert.ok(messages[0].content.includes(request));return{text:'按保存后的条件安排。'};}};
 let f=await fixture(opts);pkg=f.pkg;await f.runtime.talk({text:'我是一名产品经理；更正本次目标为工作日半小时、周末一小时，并支持分次学习。'});let t=await readThread(pkg,new Date().toISOString());assert.equal(t.discoveryGoal?.request,request);assert.deepEqual(t.discoveryGoal?.objects,f.before.discoveryGoal?.objects);assert.equal(t.discoveryGoal?.originalRequest,f.before.discoveryGoal?.originalRequest);assert.ok(t.executions.some(x=>x.capabilityId==='update_discovery_goal'&&x.ok));let self=await readDigitalSelf(pkg,'',new Date().toISOString());assert.ok(self.understandings.some(x=>x.text==='用户是一名产品经理'));assert.ok(!self.understandings.some(x=>/30分钟|分次/.test(x.text)));await f.runtime.stop();const restored=createDigitalMeRuntime({...opts,searchCapability:false,registerOpenAiStub:false});await restored.openPackage({dir:pkg});assert.equal((await restored.content({action:'asked'})).view.adjustment?.text,request);assert.equal(talkCalls,1);await restored.stop();
});
test('goal atomic rename failure stops before success model reply, disk retains old goal',async(t)=>{
 let calls=0;const f=await fixture({digitalSelfChat:async()=>({text:JSON.stringify({understandings:[],goalUpdate:{request}})}),talkChat:async()=>{calls++;return{text:'已保存'};}});const rename=fs.rename.bind(fs),file=talkThreadFilePath(f.pkg,f.before.threadId);t.mock.method(fs,'rename',async(a:any,b:any)=>{if(String(b)===file)throw Object.assign(new Error('injected save failure'),{code:'EACCES'});return rename(a,b);});const out=await f.runtime.talk({text:'纠正本目标'});assert.equal(calls,0);assert.equal(out.view.outcome,'FAILED');assert.match(out.view.turns.at(-1)?.text||'',/保存失败/);assert.deepEqual((await readThread(f.pkg,new Date().toISOString())).discoveryGoal,f.before.discoveryGoal);await f.runtime.stop();
});
test('native update tool does not return success before disk; write failure stops continuation',async(t)=>{
 let calls=0;const f=await fixture({talkChat:async()=>{calls++;return{text:'',toolCalls:[{id:'save',name:'update_discovery_goal',arguments:JSON.stringify({request})}]};}});const rename=fs.rename.bind(fs),file=talkThreadFilePath(f.pkg,f.before.threadId);t.mock.method(fs,'rename',async(a:any,b:any)=>{if(String(b)===file)throw new Error('injected save failure');return rename(a,b);});const out=await f.runtime.talk({text:'纠正'});assert.equal(calls,1);assert.equal(out.view.outcome,'FAILED');assert.match(out.view.turns.at(-1)?.text||'',/保存失败/);assert.deepEqual((await readThread(f.pkg,new Date().toISOString())).discoveryGoal,f.before.discoveryGoal);await f.runtime.stop();
});
test('invalid goal update is rejected; no explicit action remains absent',()=>{assert.throws(()=>parseInterpretResult('{"understandings":[],"goalUpdate":{"request":""}}'));assert.equal(parseInterpretResult('{"understandings":[],"goalUpdate":null}').goalUpdate,undefined);});

test('Self save failure also preserves old authority and stops Goal update and success reply',async(t)=>{
 let calls=0;const f=await fixture({digitalSelfChat:async()=>({text:JSON.stringify({understandings:[],goalUpdate:{request}})}),talkChat:async()=>{calls++;return{text:'已保存'};}});const selfFile=path.join(f.pkg,'digital-self','self.json');await writeDigitalSelf(f.pkg,await readDigitalSelf(f.pkg,'',new Date().toISOString()));const bytes=await fs.readFile(selfFile);const rename=fs.rename.bind(fs);t.mock.method(fs,'rename',async(a:any,b:any)=>{if(String(b)===selfFile)throw Object.assign(new Error('injected Self save failure'),{code:'EACCES'});return rename(a,b);});const out=await f.runtime.talk({text:'纠正'});assert.equal(out.view.outcome,'FAILED');assert.equal(calls,0);assert.deepEqual(await fs.readFile(selfFile),bytes);assert.deepEqual((await readThread(f.pkg,new Date().toISOString())).discoveryGoal,f.before.discoveryGoal);await f.runtime.stop();
});

test('cancel after a verified goal save preserves the saved effect instead of claiming rollback',async()=>{
 const f=await fixture({digitalSelfChat:async()=>({text:JSON.stringify({understandings:[],goalUpdate:{request}})}),talkChat:async()=>{throw Object.assign(new Error('cancelled'),{name:'TalkCancelled'});}});const out=await f.runtime.talk({text:'纠正本目标'});assert.equal(out.view.outcome,'CANCELLED');assert.equal((await readThread(f.pkg,new Date().toISOString())).discoveryGoal?.request,request);assert.match(out.view.turns.at(-1)?.text||'',/已经保存/);await f.runtime.stop();
});

test('task-scope contract rejects unclassified self proposals while preserving independent lasting learning',()=>{
 assert.throws(()=>parseInterpretResult(JSON.stringify({understandings:[{text:'本次任务边界',lasting:true}],goalUpdate:{request}}),true),/未明确区分/);
 const parsed=parseInterpretResult(JSON.stringify({understandings:[{text:'职业产品经理',scope:'self',lasting:true},{text:'本次边界',scope:'current_goal',lasting:true}],goalUpdate:{request}}),true);
 assert.deepEqual(parsed.understandings.map(x=>x.text),['职业产品经理']);assert.equal(parsed.goalUpdate?.request,request);
});
