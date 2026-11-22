import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import { readDigitalSelf } from '../../subject-core/digital-self/store';
import { contentSourceAllowed, upsertContentPreference, reverseContentPreference, listContentPreferences } from '../../subject-comm/content-preferences';
import { sourcePublisherId, normalizeCanonicalUrl } from '../../subject-comm/content-canonical';
import { ensurePersonalFeed, personalFeedCachePath } from '../../subject-comm/personal-feed';
import { classifySearchFailure, SEARCH_QUOTA_NOTICE } from '../../subject-comm/network-discovery-state';
import type { ContentPreferenceDirective } from '../../subject-comm/content-preferences';

test('mixed lasting self expression and task correction still reach the existing understanding model',async()=>{
 const pkg=path.join(await fs.mkdtemp(path.join(os.tmpdir(),'dm-learning-scope-')),'pkg');let scoped=false;
 const runtime=createDigitalMeRuntime({documentCapability:'fake',registerOpenAiStub:false,searchCapability:false,
  talkChat:async()=>({text:'收到'}),digitalSelfChat:async ({messages})=>{
   const prompt=messages.map(m=>m.content).join('\n');
   if(prompt.includes('本人持续信息')){
    assert.match(prompt,/TASK_CONTEXT_NOT_SELF_FACTS/);assert.match(prompt,/每天一小时/);scoped=true;
    return {text:JSON.stringify({understandings:[{text:'用户长期从事产品设计工作',facet:'context',aboutUser:true,origin:'user_statement',lasting:true,scope:'self'},{text:'本目标工作日半小时',facet:'goals',aboutUser:true,origin:'user_statement',lasting:false}]})};
   }
   return {text:'{"understandings":[]}'};
  }});
 await runtime.createPackage({displayName:'学习范围',targetDir:pkg});
 const store=new FileNetworkItemStore(path.join(pkg,'content'));await store.put(FEED_01_SEED_ITEMS[0]!);
 await runtime.content({action:'adjust',text:'本次学习 AI 产品，每天一小时'});
 await runtime.talk({text:'比较所选对象',contentIds:[FEED_01_SEED_ITEMS[0]!.itemId]});
 await runtime.talk({text:'本人持续信息：我长期从事产品设计工作；这个目标更正为工作日半小时。'});
 const self=await readDigitalSelf(pkg,'',new Date().toISOString());assert.equal(scoped,true);
 assert.ok(self.understandings.some(u=>u.text.includes('产品设计')));assert.ok(!self.understandings.some(u=>u.text.includes('半小时')));
 await runtime.stop();
});

test('external Talk search excludes blocked source aliases by evidenced host, without widening an item reduce',async()=>{
 const pkg=path.join(await fs.mkdtemp(path.join(os.tmpdir(),'dm-source-search-')),'pkg');let calls=0;
 const blockedUrl='https://sspai.com/post/known';let round=0;
 const runtime=createDigitalMeRuntime({documentCapability:'fake',registerOpenAiStub:false,searchCapability:false,
  contentSearch:async()=>{calls++;return [{title:'BLOCKED_SOURCE_CONTENT',url:'https://www.sspai.com/post/new'},{title:'ALLOWED_ITEM_CONTENT',url:'https://www.ithome.com/another'}];},
  talkChat:async({messages})=>{
   if(round++===0)return {text:'',toolCalls:[{id:'search',name:'web_search',arguments:'{"query":"学习课程"}'}]};
   const tools=messages.filter(m=>m.role==='tool').map(m=>m.content).join('\n');assert.doesNotMatch(tools,/BLOCKED_SOURCE_CONTENT/);assert.match(tools,/ALLOWED_ITEM_CONTENT/);return {text:'只交付允许来源的对象'};
  }});
 await runtime.createPackage({displayName:'来源边界',targetDir:pkg});
 const item={...FEED_01_SEED_ITEMS[0]!,itemId:'source-evidence',publisherSubjectId:sourcePublisherId(normalizeCanonicalUrl(blockedUrl)),publisherDisplayName:'sspai.com',content:{title:'Evidence',text:'source evidence',url:blockedUrl}};
 await new FileNetworkItemStore(path.join(pkg,'content')).put(item);
 await upsertContentPreference(pkg,{kind:'block',targetType:'source',target:item.publisherSubjectId,text:'屏蔽来源'});
 await upsertContentPreference(pkg,{kind:'reduce',targetType:'item',target:'one-ithome-item',text:'不喜欢这条'});
 await runtime.talk({text:'搜索相关课程'});assert.equal(calls,1);await runtime.stop();
});

test('source aliases include existing feed identity; exact domains do not widen to siblings or shared-platform authors',()=>{
 const directive=(target:string):ContentPreferenceDirective=>({id:target,kind:'block',targetType:'source',target,text:'屏蔽',origin:'user_action',updatedAt:''});
 const feed=sourcePublisherId(normalizeCanonicalUrl('https://sspai.com/feed'));
 const allowed=contentSourceAllowed([directive(feed)],[]);
 assert.equal(allowed({url:'https://www.sspai.com/post/new'}),false);
 assert.equal(allowed({url:'https://other.sspai.com/post/new'}),true);
 const author={...FEED_01_SEED_ITEMS[0]!,publisherSubjectId:'author-A',publisherDisplayName:'作者 A',content:{title:'video',text:'video',url:'https://video.example/watch/1'}};
 assert.equal(contentSourceAllowed([directive('author-A')],[author])({url:'https://video.example/watch/2',publisherSubjectId:'author-B'}),true);
});

test('linked cache open/more/reuse reuse a matching task projection without model/search calls',async()=>{
 const pkg=await fs.mkdtemp(path.join(os.tmpdir(),'dm-context-cache-'));await fs.mkdir(path.join(pkg,'content'));
 const items=FEED_01_SEED_ITEMS.slice(0,2),now=new Date().toISOString(),key=JSON.stringify(['thread-A','工作日半小时']);
 await fs.writeFile(personalFeedCachePath(pkg),JSON.stringify({version:1,selectionContextKey:key,personal:{itemIds:[items[0]!.itemId],generatedAt:now,mode:'personal'},lastView:{itemIds:[items[0]!.itemId],generatedAt:now,mode:'personal'},rankedIds:items.map(i=>i.itemId)}));
 const input={packageRoot:pkg,selectionContextKey:key,digitalSelf:{schemaVersion:1 as const,subjectId:'test',updatedAt:now,understandings:[]},items,preferences:[],feedbackFile:path.join(pkg,'feedback.jsonl'),networking:'AVAILABLE' as const,
 chatComplete:async()=>{throw Error('unchanged goal must not call model')},searchWeb:async()=>{throw Error('unchanged goal must not call search')}};
 for(const mode of ['open','more','reuse'] as const){const result=await ensurePersonalFeed({...input,mode});assert.equal(result.reasonCode,'CACHED_FEED');assert.ok(result.view.cards.length);}
});

test('provider package exhaustion and Gemini quota never promise installation-hour recovery',()=>{
 assert.equal(classifySearchFailure({status:'AUTH_FAILED',httpStatus:401,message:'iqs_Retrieval.PackageExhausted'}),'RATE_LIMITED');
 assert.equal(classifySearchFailure({kind:'quota',status:429,message:'RESOURCE_EXHAUSTED'}),'RATE_LIMITED');
 assert.doesNotMatch(SEARCH_QUOTA_NOTICE,/整点|这个小时|下个小时/);
 assert.match(SEARCH_QUOTA_NOTICE,/恢复时间尚未确认/);
});

test('source block reversal removes aliases without changing item reduction',async()=>{
 const pkg=await fs.mkdtemp(path.join(os.tmpdir(),'dm-source-revoke-'));
 const block=await upsertContentPreference(pkg,{kind:'block',targetType:'source',target:sourcePublisherId(normalizeCanonicalUrl('https://sspai.com/feed')),text:'屏蔽来源'});
 await upsertContentPreference(pkg,{kind:'reduce',targetType:'item',target:'one-item',text:'只减少这一条'});
 assert.equal(contentSourceAllowed(await listContentPreferences(pkg),[])({url:'https://sspai.com/post/new'}),false);
 assert.equal(await reverseContentPreference(pkg,block.id),true);
 const rows=await listContentPreferences(pkg);assert.equal(rows.length,1);assert.equal(rows[0]!.kind,'reduce');
 assert.equal(contentSourceAllowed(rows,[])({url:'https://sspai.com/post/new'}),true);
});

test('switch/revoke discards task projection while preserving the default personal cache',async()=>{
 const pkg=await fs.mkdtemp(path.join(os.tmpdir(),'dm-cache-revoke-'));await fs.mkdir(path.join(pkg,'content'));
 const items=FEED_01_SEED_ITEMS.slice(0,2),now=new Date().toISOString();
 await fs.writeFile(personalFeedCachePath(pkg),JSON.stringify({version:1,selectionContextKey:'old-task',personal:{itemIds:[items[0]!.itemId],generatedAt:now,mode:'personal'},lastView:{itemIds:[items[1]!.itemId],generatedAt:now,mode:'personal'},rankedIds:[items[1]!.itemId]}));
 const input={packageRoot:pkg,selectionContextKey:'',digitalSelf:{schemaVersion:1 as const,subjectId:'test',updatedAt:now,understandings:[]},items,preferences:[],feedbackFile:path.join(pkg,'feedback.jsonl'),networking:'DISABLED' as const,mode:'reuse' as const};
 const switched=await ensurePersonalFeed(input);assert.deepEqual(switched.view.cards.map(c=>c.itemId),[items[0]!.itemId]);
 const revoked=await ensurePersonalFeed({...input,preferPersonalCache:true});assert.deepEqual(revoked.view.cards.map(c=>c.itemId),[items[0]!.itemId]);
});
