'use strict';
// Real product, isolated Package and userData. No stub and no credential export.
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchDigitalMeElectron,skipWelcomeAndEnterShell}=require('../dist/runtime/tests/electron-harness');
const out=path.resolve(__dirname,'../build/evidence/core-link-01');
const ud=path.join(out,'private-user-data'), pkg=path.join(out,'package');
const phase=process.argv[2]||'discover';
async function save(name,data){await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(data,null,2));console.log(name+' saved');}
(async()=>{
 await fs.mkdir(ud,{recursive:true});
 if(phase==='discover'){
   const source=process.env.DIGITALME_LIVE_SOURCE_UD || 'C:/Users/46554/AppData/Roaming/digitalme-v2';
   for(const name of ['model-config.json','secrets.v2.json','Local State','ai-capability.json','install-capability-token.json','web-discovery.json']){
     try{await fs.copyFile(path.join(source,name),path.join(ud,name));}catch(e){if(e.code!=='ENOENT')throw e;}
   }
 }
 if(phase==='byok-discover')await fs.writeFile(path.join(ud,'web-discovery.json'),JSON.stringify({version:1,enabled:true,path:'byok'}));
 let h=await launchDigitalMeElectron({userData:ud,realProduct:true});
 try{
  await skipWelcomeAndEnterShell(h.page);
  const status=await h.page.evaluate(()=>window.digitalMe.getModelStatus());
  await save('model-ready',{modelReady:status.modelReady,electronTest:status.electronTest,geminiSearchConfigured:status.status?.geminiSearchConfigured,phase});
  if(!status.modelReady)throw Error('Real model unavailable');
  const command=(name,input)=>h.page.evaluate(({name,input})=>window.digitalMe.invoke(name,input),{name,input});
  if(phase==='discover')await command('subject.createPackage',{displayName:'隔离联动任务',targetDir:pkg});
  else await command('subject.openPackage',{dir:pkg});
  if(phase==='diagnose') {
    const token=JSON.parse(await fs.readFile(path.join(ud,'install-capability-token.json'),'utf8')).token;
    const gateway=require('../electron/brand.cjs').loadBrand().webDiscoveryGatewayUrl;
    const {createManagedWebDiscoveryConnector}=require('../dist/capability/web-discovery-client');
    let search;
    try { const hits=await createManagedWebDiscoveryConnector({gatewayUrl:gateway,installToken:token}).search('AI 产品落地 课程');search={count:hits.length,status:'AVAILABLE'}; }
    catch(e){ search={status:e.status,httpStatus:e.httpStatus,kind:e.kind,message:e.message}; }
    await save('search-diagnosis',{search,geminiSearchConfigured:status.status?.geminiSearchConfigured});
    console.log(JSON.stringify(search));
  } else if(phase==='discover' || phase==='byok-discover'){
    await h.page.locator('#nav-discover').click();
    const query='近期少看剧，每天有一小时，希望学习 AI 产品落地。找两门可跟着动手做产品的具体课程，优先中文或有中文字幕，保留课程链接、课时和费用未知项。';
    await h.page.evaluate(q=>window.ContentDiscoverPage.seek(q),query);
    const result=await command('content',{action:'asked'});
    await save('01-discover',result.view);
    await h.page.screenshot({path:path.join(out,'01-discover.png')});
    console.log(JSON.stringify({cards:result.view.cards.map(c=>({id:c.itemId,title:c.title,url:c.url,text:c.text,reason:c.reason})),notice:result.view.notice}));
  } else {
    const ids=process.argv.slice(3);
    async function send(label,text,selected){
      await h.page.locator('#nav-chat').click();
      if(selected)await h.page.evaluate(ids=>window.TalkPage.setContentContext({contentIds:ids,title:'比较所选两门课程'}),selected);
      await h.page.locator('#chat-input').fill(text);await h.page.locator('#btn-chat-send').click();
      await h.page.locator('#btn-chat-send:not([disabled])').waitFor({state:'visible',timeout:610000});
      const result=await command('talk',{});await save(label,result.view);
      await h.page.screenshot({path:path.join(out,label+'.png')});
      console.log(label+': '+String(result.view.turns.at(-1)?.text).slice(0,1300));
      return result.view;
    }
    if(phase==='cancel-before' || phase==='cancel-after'){
      const target=path.join(out,'artifacts',phase+'.md');
      await fs.rm(target,{force:true});
      await h.app.evaluate(({app},args)=>{
        const f=process.getBuiltinModule('fs').promises;global.__relGate={reached:false};
        const method=args.phase==='cancel-before'?'stat':'writeFile',original=f[method];
        f[method]=async function(p,...rest){
          let value,error;try{value=await original.call(f,p,...rest)}catch(e){error=e;}
          if(String(p)===args.target&&!global.__relGate.reached){
            global.__relGate.reached=true;await new Promise(resolve=>{global.__relGate.release=resolve});
          }
          if(error)throw error;return value;
        };
      },{phase,target});
      await h.page.locator('#nav-chat').click();
      await h.page.locator('#chat-input').fill(`明确委托：写一个约50字的中性测试说明，保存到已授权目录的 ${phase}.md。请实际写文件，不需要联网。`);
      await h.page.locator('#btn-chat-send').click();
      let reached=false;
      for(let i=0;i<120;i++){reached=await h.app.evaluate(()=>global.__relGate.reached);if(reached)break;await new Promise(r=>setTimeout(r,500));}
      if(!reached)throw Error('Real model did not reach requested file boundary');
      await h.page.locator('#btn-chat-cancel').click();
      await h.app.evaluate(()=>global.__relGate.release());
      await h.page.locator('#btn-chat-send:not([disabled])').waitFor({state:'visible',timeout:120000});
      const view=(await command('talk',{})).view;
      const exists=await fs.stat(target).then(()=>true,()=>false);
      const threadFiles=await fs.readdir(path.join(pkg,'intelligence/threads'));
      let matching=[];for(const f of threadFiles.filter(f=>f.endsWith('.json'))){const t=JSON.parse(await fs.readFile(path.join(pkg,'intelligence/threads',f),'utf8'));matching.push(...t.executions.filter(e=>e.outputPath===target));}
      if(exists !== (phase==='cancel-after'))throw Error('Unexpected file mutation across cancellation boundary');
      await save('rel-'+phase,{kind:'real model + formal Electron Talk; controlled filesystem boundary; real cancellation click',reached,fileExists:exists,executions:matching,view});
      console.log(JSON.stringify({phase,fileExists:exists,lastAssistant:view.turns.at(-1)?.text}));
    } else if(phase==='office-regression'){
      for(const format of ['docx','pptx']){
        const name='talk-office.'+format;
        await send('rel-office-'+format,`明确委托：制作一个中性测试说明${format==='docx'?'文档':'演示文稿'}，保存到已授权目录的 ${name}。只需一个标题和两个简短要点，请用 export_file 实际导出，不需要联网。`);
        const bytes=await fs.readFile(path.join(out,'artifacts',name));
        if(bytes.subarray(0,2).toString()!=='PK')throw Error('Office export is not a ZIP container');
        await save('rel-office-'+format+'-file',{name,bytes:bytes.length,zipSignature:true});
      }
    } else if(phase==='document-diagnose'){
      await fs.mkdir(path.join(out,'artifacts'),{recursive:true});
      const {saveFilesystemGrant}=require('../dist/authorization/filesystem-grant');
      const overview=await command('subject.getOverview',{});
      await saveFilesystemGrant({packageRoot:pkg,subjectId:overview.subjectId,folder:path.join(out,'artifacts'),now:new Date().toISOString()});
      await send('rel-current-talk','明确委托：写一份约150字的本地优先数字主体介绍，保存到已授权目录的 talk-document.md，然后用 read_file 回读确认。此任务不需要联网。');
      const submitted=await command('work.submitTask',{goal:'写一份 150 字左右关于本地优先数字主体概念的介绍。',contextRefs:[],requestedArtifactType:'document'});
      await save('rel-legacy-submit',submitted);
      if(submitted.taskId){
        let task;
        for(let i=0;i<90;i++){
          task=await command('work.getTask',{taskId:submitted.taskId});
          if(['succeeded','failed','cancelled'].includes(task.latestJob?.status))break;
          await new Promise(r=>setTimeout(r,2000));
        }
        await save('rel-legacy-terminal',task);
      }
    } else if(phase==='compare'){
      if(ids.length!==2)throw Error('Select exactly two actual returned course ids');
      // Exercise the real card selection UI before sending.
      const found=JSON.parse(await fs.readFile(path.join(out,'01-discover.json'),'utf8'));
      await h.page.locator('#nav-discover').click();
      await h.page.evaluate(v=>window.ContentDiscoverPage.renderView(v),found);
      for(const id of ids)await h.page.locator(`[data-item-id="${id}"]`).getByRole('button',{name:'选择 / 取消比较'}).click();
      await h.page.locator('#content-discover-selection').getByRole('button',{name:'一起比较'}).click();
      await send('02-compare','请比较这两门课程，保留我从发现表达的目标和时间约束。区分来源证实和未知，判断哪门更适合落地 AI 产品，不要报名或付费。');
      // Test grants only authorize this isolated output directory.
      await fs.mkdir(path.join(out,'artifacts'),{recursive:true});
      const {saveFilesystemGrant}=require('../dist/authorization/filesystem-grant');
      const overview=await command('subject.getOverview',{});
      await saveFilesystemGrant({packageRoot:pkg,subjectId:overview.subjectId,folder:path.join(out,'artifacts'),now:new Date().toISOString()});
      await send('03-plan','我明确委托你根据这两门课制定两周可用学习计划。每天一小时，列出每次练习和小项目成果，保留链接与课时费用未知项。请写入已授权目录的 learning-plan.md 并用 read_file 回读后交付。');
      await send('04-correct','更正同一个学习目标：工作日只有半小时，周末仍有一小时。请保留其它目标，保存新条件供下一次发现和做事使用；现在先不写新文件。');
    } else if(phase==='after-restart') {
      await h.page.locator('#nav-discover').click();
      await h.page.evaluate(()=>window.ContentDiscoverPage.refresh());
      const result=await command('content',{action:'asked'});await save('05-recommend-after-restart',result.view);
      console.log('latest adjustment: '+JSON.stringify(result.view.adjustment));
      await send('06-revised-plan','根据同一目标的最新条件再次生成两周计划，保存为 learning-plan-revised.md，回读确认。说明采用了什么纠正，不要按旧每天一小时分配工作日。');
      const sessions=await h.page.evaluate(()=>window.digitalMe.conversation.listSessions());
      const newSession=await h.page.evaluate(()=>window.digitalMe.conversation.createSession());
      await save('07-other-session',{session:newSession,view:(await command('content',{action:'asked'})).view});
      await h.page.evaluate(id=>window.digitalMe.conversation.openSession(id),sessions.currentId);
      await command('content',{action:'adjustRevoke'});
      await save('08-revoked',{view:(await command('content',{action:'asked'})).view});
    }
  }
 }finally{await h.close();}
})().catch(async e=>{console.error(e.message);await save('failure-'+phase,{error:e.message,at:new Date().toISOString()}).catch(()=>{});process.exitCode=1});
