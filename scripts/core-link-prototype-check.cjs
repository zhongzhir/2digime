const {launchDigitalMeElectron}=require('../dist/runtime/tests/electron-harness');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const harness=await launchDigitalMeElectron({realProduct:false});
 try{
 const page=harness.page;
 await page.setViewportSize({width:1280,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../review/core-link-01/prototype.html')).href);
 await page.getByRole('button',{name:'重置审查状态'}).click();
 await page.locator('#request').fill('学习 AI 产品落地，优先中文，每天一小时');
 await page.locator('#find').click();
 assert.equal(await page.locator('article.card').count(),2);
 assert.equal(await page.locator('article a[target="_blank"]').count(),2);
 await page.locator('[data-select="ms"]').click();await page.locator('[data-select="dl"]').click();
 await page.locator('#compare').click();
 assert.match(await page.locator('#app').innerText(),/学习 AI 产品落地，优先中文，每天一小时/);
 await page.locator('#delegate').click();await page.locator('#readback').click();
 assert.match(await page.locator('#readback-text').innerText(),/每天一小时/);
 await page.locator('#correction').fill('工作日半小时，周末一小时');await page.locator('#correct').click();
 await page.reload();assert.match(await page.locator('#app').innerText(),/工作日半小时/);
 await page.locator('[data-view="talk"]').click();await page.locator('#delegate').click();await page.locator('#readback').click();
 assert.match(await page.locator('#readback-text').innerText(),/工作日半小时/);
 await fs.mkdir(path.resolve(__dirname,'../review/core-link-01'),{recursive:true});
 await page.screenshot({path:path.resolve(__dirname,'../review/core-link-01/prototype-desktop.png'),fullPage:true});
 await page.locator('#back').click();assert.equal(await page.locator('article.selected').count(),2);
 await page.locator('#revoke').click();assert.equal(await page.locator('article.selected').count(),0);
 await page.locator('#new-session').click();assert.equal(await page.locator('article.card').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('#find').click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.resolve(__dirname,'../review/core-link-01/prototype-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Prototype interactions passed: input, selection, official links, compare, explicit plan, readback, correction, reload, return, revoke, session switch, mobile width.');
 }finally{await harness.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
