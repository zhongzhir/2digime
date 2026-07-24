"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label) {
  for (let i = 0; i < 100; i += 1) { if (await check()) return; await sleep(50); }
  throw new Error(`timeout: ${label}`);
}
async function runCapabilityAcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  const output = process.env.DIGITALME_CAPABILITY_OUTPUT;
  fs.mkdirSync(output, { recursive: true });
  await waitFor(() => !win.webContents.isLoading(), "initial page load");
  await sleep(700);
  const records = [];
  const shot = async (name) => {
    const png = path.join(output, `${name}.png`);
    fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
    return png;
  };
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="extensions"]').click()`);
  await waitFor(() => win.webContents.executeJavaScript(`!document.getElementById('view-extensions').classList.contains('hidden')`), "capability view open");
  await waitFor(() => win.webContents.executeJavaScript(`document.getElementById('capability-now-list').innerText.trim().length > 0`), "capability surface load");
  const normal = await win.webContents.executeJavaScript(`(() => {
    const cardTitles = Array.from(document.querySelectorAll('#extensions-body > .output-card > h3, #extensions-body > .output-card .ext-store-head > h3')).map((x) => x.textContent.trim());
    const advanced = document.getElementById('extensions-developer-tools');
    const visibleNormal = Array.from(document.querySelectorAll('#extensions-body > :not(details)')).map((x) => x.innerText).join(' ');
    return { cardTitles, nowText: document.getElementById('capability-now-list').innerText, advancedClosed: !!advanced && !advanced.open, normalHasInternalTerms: /MCP|JSON|启动命令|进程|调试/.test(visibleNormal) };
  })()`);
  assert.deepEqual(normal.cardTitles, ["我现在能做什么", "可添加的公共能力 ?", "我的技能", "我的成果 / 可协作产出物"]);
  assert.equal(normal.advancedClosed, true, "advanced developer section is closed by default");
  assert.equal(normal.normalHasInternalTerms, false, "normal surface hides internal implementation terms");
  assert.ok(normal.nowText.trim().length > 0, "normal mode explains a usable next step or current capability");
  records.push({ step: "normal-mode", pass: true, ...normal, screenshot: await shot("normal-mode") });

  const empty = await win.webContents.executeJavaScript(`(async () => {
    const originalSkills = window.digitalMe.listSkills;
    const originalTasks = window.digitalMe.actBehalfList;
    window.digitalMe.listSkills = async () => [];
    window.digitalMe.actBehalfList = async () => ({ tasks: [] });
    document.getElementById('btn-ext-refresh').click();
    for (let i = 0; i < 40 && !/还没有添加能力、技能或任务/.test(document.getElementById('capability-now-list').innerText); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    const copy = document.getElementById('capability-now-list').innerText;
    const actions = document.getElementById('capability-empty-actions');
    window.digitalMe.listSkills = originalSkills;
    window.digitalMe.actBehalfList = originalTasks;
    return { copy, progress: document.getElementById('ext-progress').innerText, actionsHidden: actions.classList.contains('hidden'), actionable: /还没有添加能力、技能或任务/.test(copy) && !actions.classList.contains('hidden'), legacyNotReady: /能力未就绪/.test(copy) };
  })()`);
  assert.equal(empty.actionable, true, "empty state gives a next action");
  assert.equal(empty.legacyNotReady, false, "empty state does not claim capability is not ready");
  records.push({ step: "empty-state", pass: true, ...empty, screenshot: await shot("empty-state") });

  await win.webContents.executeJavaScript(`(async () => { await window.digitalMe.saveExtensionsConfig([{ id: 'qa-capability', name: '验收用公共能力', command: 'node', args: ['--version'], note: '仅用于本次 Electron 验收。' }]); document.getElementById('btn-ext-refresh').click(); })()`);
  await sleep(450);
  const enabled = await win.webContents.executeJavaScript(`(() => ({ text: document.getElementById('capability-now-list').innerText, hasDisable: !!document.querySelector('.btn-capability-disable') }))()`);
  assert.equal(enabled.hasDisable, true, "enabled ability has a normal-user disable action");
  assert.match(enabled.text, /验收用公共能力/);
  records.push({ step: "enabled-feedback", pass: true, ...enabled, screenshot: await shot("enabled-feedback") });

  await win.webContents.reload();
  await waitFor(() => !win.webContents.isLoading(), "restart renderer");
  await sleep(750);
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="extensions"]').click()`);
  await sleep(450);
  const restored = await win.webContents.executeJavaScript(`(() => ({ restored: /验收用公共能力/.test(document.getElementById('capability-now-list').innerText), advancedClosed: !document.getElementById('extensions-developer-tools').open }))()`);
  assert.equal(restored.restored, true, "enabled capability survives renderer restart");
  assert.equal(restored.advancedClosed, true, "advanced section remains closed after restart");
  records.push({ step: "restart-recovery", pass: true, ...restored, screenshot: await shot("restart-recovery") });

  const advanced = await win.webContents.executeJavaScript(`(() => { const panel = document.getElementById('extensions-developer-tools'); panel.open = true; return { open: panel.open, hasConnectionControls: !!panel.querySelector('.btn-ext-connect'), hasTechnicalContent: /工具试调用|启动命令/.test(panel.innerText) }; })()`);
  assert.equal(advanced.open, true, "advanced section can be opened deliberately");
  assert.equal(advanced.hasConnectionControls, true, "advanced section retains connection controls");
  assert.equal(advanced.hasTechnicalContent, true, "advanced section retains technical detail");
  records.push({ step: "advanced-mode", pass: true, ...advanced, screenshot: await shot("advanced-mode") });

  await win.webContents.executeJavaScript(`document.querySelector('#extensions-developer-tools .btn-ext-connect').click()`);
  await waitFor(() => win.webContents.executeJavaScript(`document.getElementById('ext-progress').innerText.includes('连接失败')`), "connection failure feedback");
  const failure = await win.webContents.executeJavaScript(`document.getElementById('ext-progress').innerText`);
  assert.match(failure, /连接失败/);
  records.push({ step: "failure-feedback", pass: true, feedback: failure, screenshot: await shot("failure-feedback") });

  await win.webContents.executeJavaScript(`document.querySelector('.btn-capability-disable').click()`);
  await sleep(400);
  const disabled = await win.webContents.executeJavaScript(`document.getElementById('ext-progress').innerText`);
  assert.match(disabled, /已停用.*验收用公共能力/);
  records.push({ step: "disable-feedback", pass: true, feedback: disabled, screenshot: await shot("disable-feedback") });
  fs.writeFileSync(path.join(output, "acceptance.json"), JSON.stringify(records, null, 2));
  console.log("PASS capability acceptance", JSON.stringify(records));
  return 0;
}
module.exports = { runCapabilityAcceptanceHarness };
