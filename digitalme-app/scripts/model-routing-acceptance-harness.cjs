"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label) { for (let i = 0; i < 100; i += 1) { if (await check()) return; await sleep(50); } throw new Error(`timeout: ${label}`); }
async function runModelRoutingAcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0]; const output = process.env.DIGITALME_MODEL_ROUTING_OUTPUT; fs.mkdirSync(output, { recursive: true });
  await waitFor(() => !win.webContents.isLoading(), "initial load"); await sleep(600);
  const records = []; const shot = async (name) => { const file = path.join(output, `${name}.png`); fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); return file; };
  const routing = { providers: [{ id: "fake-primary", name: "Fake Primary", type: "fake", enabled: true, models: [{ id: "fake-primary/fail", model: "fail-primary", enabled: true }] }, { id: "fake-fallback", name: "Fake Fallback", type: "fake", enabled: true, models: [{ id: "fake-fallback/ok", model: "ok-fallback", enabled: true }] }], routes: { chat: { primary: "fake-primary/fail", fallbacks: ["fake-fallback/ok"] }, artifact: { primary: "fake-fallback/ok", fallbacks: [] }, review: { primary: "fake-fallback/ok", fallbacks: [] } } };
  await win.webContents.executeJavaScript(`window.digitalMe.saveModelRouting(${JSON.stringify({ routing })})`);
  await win.webContents.executeJavaScript(`document.getElementById('btn-settings').click()`); await waitFor(() => win.webContents.executeJavaScript(`!document.getElementById('settings-modal').classList.contains('hidden')`), "settings open");
  const normal = await win.webContents.executeJavaScript(`(() => ({ modal: !document.getElementById('settings-modal').classList.contains('hidden'), summary: document.getElementById('model-routing-summary').innerText, keyLeak: document.documentElement.innerHTML.includes('FAKE_MODEL_KEY_DO_NOT_LEAK') }))()`);
  assert.equal(normal.modal, true); assert.match(normal.summary, /当前对话模型/); assert.equal(normal.keyLeak, false); records.push({ case: "settings-redacted-routes", start: new Date().toISOString(), end: new Date().toISOString(), pass: true, provider: "fake-primary", model: "fail-primary", fallbackUsed: false, errorCode: null, screenshot: await shot("settings-redacted-routes"), failureReason: null });
  const fallback = await win.webContents.executeJavaScript(`window.digitalMe.testModelRouting({taskType:'chat'})`);
  assert.equal(fallback.ok, true); assert.equal(fallback.fallbackUsed, true); assert.equal(fallback.model, "ok-fallback"); records.push({ case: "sequential-fallback", start: new Date().toISOString(), end: new Date().toISOString(), pass: true, provider: fallback.provider, model: fallback.model, fallbackUsed: fallback.fallbackUsed, errorCode: null, screenshot: await shot("sequential-fallback"), failureReason: null });
  await win.webContents.executeJavaScript(`document.getElementById('btn-model-routing-test').click()`); await waitFor(() => win.webContents.executeJavaScript(`document.getElementById('model-routing-feedback').innerText.includes('ok-fallback')`), "visible routing result");
  const failRouting = JSON.parse(JSON.stringify(routing)); failRouting.routes.chat = { primary: "fake-primary/fail", fallbacks: [] };
  await win.webContents.executeJavaScript(`window.digitalMe.saveModelRouting(${JSON.stringify({ routing: failRouting })})`);
  const failed = await win.webContents.executeJavaScript(`window.digitalMe.testModelRouting({taskType:'chat'})`);
  assert.equal(failed.ok, false); assert.equal(failed.friendlyMessage, "当前模型不可用。可以检查模型设置，或切换到备用模型。"); records.push({ case: "all-failed-friendly-error", start: new Date().toISOString(), end: new Date().toISOString(), pass: true, provider: "fake-primary", model: "fail-primary", fallbackUsed: false, errorCode: failed.errorCode, screenshot: await shot("all-failed-friendly-error"), failureReason: null });
  await win.webContents.executeJavaScript(`window.digitalMe.saveModelRouting(${JSON.stringify({ routing })}); location.reload()`); await waitFor(() => !win.webContents.isLoading(), "renderer restart"); await sleep(650);
  const restored = await win.webContents.executeJavaScript(`window.digitalMe.getModelRouting()`); assert.equal(restored.routes.chat.fallbacks[0], "fake-fallback/ok"); assert.equal(JSON.stringify(restored).includes('FAKE_MODEL_KEY_DO_NOT_LEAK'), false); records.push({ case: "restart-recovery", start: new Date().toISOString(), end: new Date().toISOString(), pass: true, provider: "fake-primary", model: "fail-primary", fallbackUsed: false, errorCode: null, screenshot: await shot("restart-recovery"), failureReason: null });
  fs.writeFileSync(path.join(output, "acceptance.json"), JSON.stringify(records, null, 2)); console.log("PASS model routing acceptance", JSON.stringify(records)); return 0;
}
module.exports = { runModelRoutingAcceptanceHarness };
