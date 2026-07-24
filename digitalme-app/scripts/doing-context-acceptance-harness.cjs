"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(webContents, predicate, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`)) return;
    await sleep(80);
  }
  throw new Error(`等待超时：${label}`);
}

async function runDoingContextAcceptanceHarness({ BrowserWindow }) {
  let window = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DOING_CONTEXT_OUTPUT;
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-doing-context-package-"));
  const records = [];
  const rendererConsole = [];
  const pageNavigation = [];
  fs.mkdirSync(outputDir, { recursive: true });
  while (window.webContents.isLoading()) await sleep(50);
  const attachDiagnostics = (target) => {
    target.webContents.on("console-message", (_event, level, message, line, sourceId) => rendererConsole.push({ level, message, line, sourceId }));
    target.webContents.on("did-navigate", (_event, url) => pageNavigation.push({ url, at: new Date().toISOString() }));
  };
  attachDiagnostics(window);
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const write = () => fs.writeFileSync(path.join(outputDir, "acceptance.json"), JSON.stringify(records, null, 2));
  const record = async (name, fn) => {
    try { await fn(); records.push({ case: name, pass: true, failureReason: null }); }
    catch (error) { records.push({ case: name, pass: false, failureReason: error.message }); write(); throw error; }
  };
  const routing = { providers: [{ id: "fake", name: "Fake", type: "fake", enabled: true, models: [{ id: "fake/ok", model: "ok", enabled: true }] }], routes: { chat: { primary: "fake/ok", fallbacks: [] }, artifact: { primary: "fake/ok", fallbacks: [] }, review: { primary: "fake/ok", fallbacks: [] } } };
  const configure = async (dir) => {
    const config = await evaluate(`(async()=>{const cfg=await window.digitalMe.getConfig();await window.digitalMe.setConfig({...cfg,packageDir:${JSON.stringify(dir)}});await window.digitalMe.saveModelRouting(${JSON.stringify({ routing })});return window.digitalMe.getConfig()})()`);
    assert.equal(config.packageDir, dir);
  };
  const createConfirmedIdentity = async () => {
    const draft = await evaluate(`window.digitalMe.createDistillInput({text:'原始资料全文不得进入做事请求；李明是产品负责人。',sourceKind:'direct'})`);
    const generated = await evaluate(`window.digitalMe.generateIdentityExperienceFacts(${JSON.stringify(draft.id)})`);
    const identity = generated.items.find((item) => item.category === "identity");
    await evaluate(`window.digitalMe.transitionDistillItem(${JSON.stringify({ itemId: identity.id, action: "confirm" })})`);
    return identity;
  };
  const startDoingTaskByUi = async (intent) => {
    await waitFor(window.webContents, `() => Boolean(document.querySelector('.nav-item[data-view="do"]') && document.querySelector('#btn-do-new-task'))`, "做事导航和新建任务入口就绪");
    await evaluate(`document.querySelector('.nav-item[data-view="do"]').click()`);
    await waitFor(window.webContents, `() => { const view=document.querySelector('#view-do'); const hub=document.querySelector('#do-hub'); return view && hub && !view.classList.contains('hidden') && !hub.classList.contains('hidden'); }`, "做事首页打开");
    await evaluate(`document.querySelector('#btn-do-new-task').click()`);
    await waitFor(window.webContents, `() => document.querySelector('#do-act-behalf:not(.hidden)')`, "做事任务表单");
    await evaluate(`(()=>{const input=document.querySelector('#act-request');input.value=${JSON.stringify(intent)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#btn-act-auto-generate').click();})()`);
    await waitFor(window.webContents, `() => document.querySelector('#act-final-draft')?.value.includes('（测试）')`, "做事任务结果");
    return evaluate(`window.digitalMe.actBehalfList()`);
  };
  try {
    await configure(packageDir);
    const identity = await createConfirmedIdentity();
    const proposed = await evaluate(`window.digitalMe.getDistillMeSnapshot()`).then((snapshot) => snapshot.pending.find((item) => item.category === "experience"));
    const intent = "请为下周产品评审写一份完整议程，并保留这句任务原文。";
    let taskList;
    await record("confirmed-identity-enters-doing-context", async () => {
      taskList = await startDoingTaskByUi(intent);
      const audit = await evaluate(`window.digitalMe.getDoingContextAudit()`);
      const entry = audit[0];
      const requestText = entry.modelRequest.map((message) => message.content).join("\n");
      assert.ok(requestText.includes(identity.statement));
      assert.ok(entry.confirmedIdentityIds.includes(identity.id));
      assert.equal(entry.taskIntent, intent);
      assert.equal(entry.usedConfirmedContextCount, 1);
    });
    await record("unconfirmed-content-excluded", async () => {
      const entry = (await evaluate(`window.digitalMe.getDoingContextAudit()`))[0];
      const requestText = entry.modelRequest.map((message) => message.content).join("\n");
      assert.ok(!entry.confirmedIdentityIds.includes(proposed.id));
      assert.ok(!requestText.includes(proposed.statement));
      assert.ok(entry.excludedCount >= 1);
    });
    await record("task-intent-preserved", async () => {
      const entry = (await evaluate(`window.digitalMe.getDoingContextAudit()`))[0];
      assert.equal(entry.taskIntent, intent);
      assert.ok(entry.modelRequest.map((message) => message.content).join("\n").includes(intent));
    });
    await record("raw-material-not-leaked", async () => {
      const entry = (await evaluate(`window.digitalMe.getDoingContextAudit()`))[0];
      const serialized = JSON.stringify(entry);
      assert.ok(!serialized.includes("原始资料全文不得进入做事请求"));
    });
    await record("reload-retains-confirmed-context", async () => {
      const old = window; const url = old.webContents.getURL();
      window = new BrowserWindow({ width: 1100, height: 780, show: false, webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true, nodeIntegration: false } });
      attachDiagnostics(window);
      await window.loadURL(url); old.close();
      await startDoingTaskByUi("请基于本人信息写一段产品复盘开场。");
      const entry = (await evaluate(`window.digitalMe.getDoingContextAudit()`))[0];
      assert.ok(entry.confirmedIdentityIds.includes(identity.id));
      const requestText = entry.modelRequest.map((message) => message.content).join("\n");
      assert.ok(requestText.includes(identity.statement));
      assert.ok(!requestText.includes("原始资料全文不得进入做事请求"));
    });
    await record("no-context-degrades-gracefully", async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-doing-context-empty-"));
      await configure(emptyDir);
      await startDoingTaskByUi("请写一段不依赖本人信息的通用通知。");
      const entry = (await evaluate(`window.digitalMe.getDoingContextAudit()`))[0];
      assert.equal(entry.usedConfirmedContextCount, 0);
      assert.equal(entry.confirmedIdentityIds.length, 0);
      const progress = await evaluate(`document.querySelector('#act-progress')?.innerText || ''`);
      assert.match(progress, /本次未使用本人信息/);
    });
  } catch (error) {
    const panel = await evaluate(`(()=>{const nav=document.querySelector('.nav-item[data-view="do"]');const panel=document.querySelector('#do-act-behalf');return {url:location.href,viewDoClass:document.querySelector('#view-do')?.className||null,panelExists:!!panel,panelClass:panel?.className||null,panelHidden:panel?.classList.contains('hidden')??null,panelOuterHTML:panel?.outerHTML||null,navExists:!!nav,navVisible:!!(nav&&nav.offsetParent),navClass:nav?.className||null};})()`).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    fs.writeFileSync(path.join(outputDir, "reload-diagnostic.json"), JSON.stringify({ error: error.message, panel, rendererConsole, pageNavigation }, null, 2));
    throw error;
  } finally { write(); }
  console.log("PASS doing context acceptance");
  return 0;
}

module.exports = { runDoingContextAcceptanceHarness };
