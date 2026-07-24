"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(webContents, predicate, description, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`);
    if (ready) return;
    await sleep(80);
  }
  throw new Error(`等待超时：${description}`);
}

async function runDistillMeAcceptanceHarness({ BrowserWindow }) {
  let window = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DISTILL_OUTPUT;
  const records = [];
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-distill-package-"));
  const routeMeta = { provider: "fake", model: "ok", fallbackUsed: false };
  const rendererConsole = [];

  fs.mkdirSync(outputDir, { recursive: true });
  while (window.webContents.isLoading()) await sleep(50);
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2 || /error/i.test(String(message))) rendererConsole.push({ level, message, line, sourceId });
  });

  const screenshot = async (name) => {
    const file = path.join(outputDir, `${name}.png`);
    fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG());
    return file;
  };
  const writeRecords = () =>
    fs.writeFileSync(path.join(outputDir, "acceptance.json"), JSON.stringify(records, null, 2));
  const record = async (name, fn) => {
    const startedAt = new Date().toISOString();
    try {
      const result = await fn();
      records.push({
        case: name,
        pass: true,
        provider: result?.provider || routeMeta.provider,
        model: result?.model || routeMeta.model,
        fallbackUsed: result?.fallbackUsed ?? routeMeta.fallbackUsed,
        errorCode: result?.errorCode || null,
        screenshot: result?.screenshot || null,
        failureReason: null,
        startedAt,
        endedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      records.push({
        case: name,
        pass: false,
        provider: error.provider || routeMeta.provider,
        model: error.model || routeMeta.model,
        fallbackUsed: error.fallbackUsed ?? routeMeta.fallbackUsed,
        errorCode: error.code || "ACCEPTANCE_FAILURE",
        screenshot: error.screenshot || null,
        failureReason: error.message,
        startedAt,
        endedAt: new Date().toISOString(),
      });
      writeRecords();
      throw error;
    }
  };
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const showDistill = async () => {
    await evaluate(`document.querySelector('.nav-item[data-view="me"]').click()`);
    // switchView("me") finishes refreshMeView asynchronously and then intentionally
    // selects overview. Wait for that source-defined default before clicking distill.
    await waitFor(window.webContents, `() => {
      const view = document.querySelector('#view-me');
      const overview = document.querySelector('#me-panel-overview');
      return view && overview && !view.classList.contains('hidden') && !overview.classList.contains('hidden');
    }`, "我页面默认全貌加载");
    await sleep(700);
    await evaluate(`document.querySelector('#me-tabs [data-me-tab="distill"]').click()`);
    await waitFor(window.webContents, `() => {
      const tab = document.querySelector('#me-tabs [data-me-tab="distill"]');
      const panel = document.querySelector('#me-panel-distill');
      return tab?.classList.contains('active') && panel && !panel.classList.contains('hidden');
    }`, "蒸馏我页面打开");
  };
  const saveRouting = async (routing) =>
    evaluate(`window.digitalMe.saveModelRouting(${JSON.stringify({ routing })})`);
  const successRouting = {
    providers: [{ id: "fake", name: "Fake", type: "fake", enabled: true, models: [{ id: "fake/ok", model: "ok", enabled: true }] }],
    routes: { chat: { primary: "fake/ok", fallbacks: [] }, artifact: { primary: "fake/ok", fallbacks: [] }, review: { primary: "fake/ok", fallbacks: [] } },
  };

  try {
    const configured = await evaluate(`(async()=>{const cfg=await window.digitalMe.getConfig();await window.digitalMe.setConfig({...cfg,packageDir:${JSON.stringify(packageDir)}});return window.digitalMe.getConfig()})()`);
    assert.equal(configured.packageDir, packageDir, "distill acceptance must use isolated packageDir");
    await saveRouting(successRouting);
    await showDistill();

    await record("empty-state", async () => {
      const text = await evaluate(`document.querySelector('#distill-me-summary').innerText`);
      assert.match(text, /还没有形成你的主体档案/);
      return { screenshot: await screenshot("empty-state") };
    });

    await record("input-material", async () => {
      await evaluate(`(()=>{const input=document.querySelector('#distill-me-text');input.focus();input.value='李明在星河团队负责产品。';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await evaluate(`document.querySelector('#distill-me-text').value`), "李明在星河团队负责产品。");
      return { screenshot: await screenshot("input") };
    });

    let generated;
    await record("generate-identity-experience-fact-drafts", async () => {
      await evaluate(`document.querySelector('#btn-distill-me-start').click()`);
      await waitFor(window.webContents, `() => window.digitalMe.getDistillMeSnapshot().then((snapshot) => {
        const categories = new Set((snapshot.pending || []).map((item) => item.category));
        return snapshot.pending?.length === 3 && categories.has('identity') && categories.has('experience') && categories.has('fact');
      })`, "identity / experience / fact 草稿生成");
      // The snapshot above is only the persistence boundary of the actual UI click.
      // UI acceptance remains strict: all three rendered result cards must contain
      // their source-defined labels and statements before this case can pass.
      const renderedDraftCards = `() => {
        const cards = Array.from(document.querySelectorAll('#distill-me-result .research-mat-row'));
        const content = cards.map((card) => card.innerText || card.textContent || '').join('\\n');
        return cards.length === 3 &&
          content.includes('我是谁') && content.includes('（测试）李明是产品负责人') &&
          content.includes('经历') && content.includes('（测试）2022 年加入星河团队') &&
          content.includes('事实') && content.includes('（测试）当前负责产品工作');
      }`;
      await waitFor(window.webContents, renderedDraftCards, "草稿结果初次渲染", 15000);
      // Re-open the tab after the asynchronous me-page navigation has settled so
      // the screenshot verifies that the same persisted cards are visibly rendered.
      await showDistill();
      await waitFor(window.webContents, renderedDraftCards, "草稿结果可见渲染", 15000);
      generated = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.equal(generated.pending.length, 3);
      assert.deepEqual([...new Set(generated.pending.map((item) => item.category))].sort(), ["experience", "fact", "identity"]);
      return { screenshot: await screenshot("draft-result") };
    });

    await record("view-evidence", async () => {
      const identity = generated.pending.find((item) => item.category === "identity");
      const evidence = await evaluate(`window.digitalMe.getDistillEvidence(${JSON.stringify(identity.id)})`);
      assert.ok(evidence?.evidenceRefs?.[0]?.excerpt?.includes("李明在星河团队负责产品"));
      await evaluate(`document.querySelector('#distill-me-result details summary').click()`);
      await waitFor(window.webContents, `() => Boolean(document.querySelector('#distill-me-result details[open]'))`, "依据抽屉展开", 15000);
      return { screenshot: await screenshot("evidence-drawer") };
    });

    await record("confirm-identity", async () => {
      const identity = generated.pending.find((item) => item.category === "identity");
      const selector = "#distill-me-result .research-mat-row";
      const confirmation = await evaluate(`(async()=>{
        const selector=${JSON.stringify(selector)}, statement=${JSON.stringify(identity.statement)};
        try {
          const cards=Array.from(document.querySelectorAll(selector));
          const card=cards.find((item)=>(item.innerText||item.textContent||'').includes(statement));
          const button=card?.querySelector('.btn-distill-confirm');
          const beforeText=card?.innerText||card?.textContent||'';
          const beforeStatus=beforeText.includes('proposed')?'proposed':null;
          if(!button) return {ok:false,identityCardCount:cards.length,buttonExists:false,beforeText,beforeStatus,selector,outerHTML:card?.outerHTML||null,error:{message:'未找到 identity 卡片中的确认按钮',stack:null}};
          button.click();
          const started=Date.now(); let confirmed=null;
          while(Date.now()-started<15000){
            const snapshot=await window.digitalMe.getDistillMeSnapshot();
            confirmed=(snapshot.identity||[]).find((item)=>item.id===${JSON.stringify(identity.id)});
            if(confirmed?.status==='confirmed'&&confirmed.confirmedAt) break;
            await new Promise((resolve)=>setTimeout(resolve,80));
          }
          const afterCards=Array.from(document.querySelectorAll(selector));
          const afterCard=afterCards.find((item)=>(item.innerText||item.textContent||'').includes(statement));
          return {ok:!!(confirmed?.status==='confirmed'&&confirmed.confirmedAt),identityCardCount:cards.length,buttonExists:true,beforeText,beforeStatus,afterText:afterCard?.innerText||afterCard?.textContent||'',afterStatus:confirmed?.status||null,confirmedAt:confirmed?.confirmedAt||null,selector,outerHTML:afterCard?.outerHTML||card.outerHTML||null};
        } catch(error) {
          return {ok:false,identityCardCount:0,buttonExists:false,beforeText:'',beforeStatus:null,selector,outerHTML:null,error:{message:error?.message||String(error),stack:error?.stack||null,selector,outerHTML:null}};
        }
      })()`);
      fs.writeFileSync(path.join(outputDir, "confirm-identity-diagnostic.json"), JSON.stringify({ confirmation, rendererConsole }, null, 2));
      assert.ok(confirmation.ok, JSON.stringify(confirmation));
      await waitFor(window.webContents, `() => document.querySelector('#distill-me-summary')?.innerText.includes('我是谁 1 条')`, "identity 确认后写入主体档案", 15000);
      const snapshot = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.equal(snapshot.identity.length, 1);
      assert.equal(snapshot.identity[0]?.status, "confirmed");
      assert.ok(snapshot.identity[0]?.confirmedAt, "identity 确认后必须写入 confirmedAt");
      const cardText = await evaluate(`document.querySelector('#distill-me-result')?.innerText || ''`);
      assert.match(cardText, /（测试）李明是产品负责人/);
      assert.match(cardText, /confirmed/);
      fs.writeFileSync(path.join(outputDir, "confirm-identity-diagnostic.json"), JSON.stringify({ confirmation, rendererConsole }, null, 2));
      return { screenshot: await screenshot("confirmed-profile") };
    });

    await record("edit-experience", async () => {
      const experience = generated.pending.find((item) => item.category === "experience");
      const edited = "（测试）编辑经历";
      await evaluate(`window.digitalMe.transitionDistillItem(${JSON.stringify({ itemId: experience.id, action: "edit", patch: { statement: edited } })})`);
      const snapshot = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.equal(snapshot.experiences[0]?.statement, edited);
      assert.equal(snapshot.experiences[0]?.status, "edited");
      return {};
    });

    await record("delete-fact", async () => {
      const fact = generated.pending.find((item) => item.category === "fact");
      await evaluate(`window.digitalMe.transitionDistillItem(${JSON.stringify({ itemId: fact.id, action: "delete" })})`);
      const snapshot = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.equal(snapshot.facts.length, 0);
      return {};
    });

    await record("export-result", async () => {
      await evaluate(`document.querySelector('#btn-distill-export').click()`);
      await waitFor(window.webContents, `() => document.querySelector('#distill-me-msg')?.innerText.includes('已导出主体档案：')`, "导出提示");
      const exportPath = await evaluate(`document.querySelector('#distill-me-msg').innerText.replace('已导出主体档案：','').trim()`);
      assert.ok(fs.existsSync(exportPath), `导出文件不存在：${exportPath}`);
      return { screenshot: await screenshot("export-result") };
    });

    await record("reopen-restores-confirmed-content", async () => {
      const previous = window;
      const url = previous.webContents.getURL();
      window = new BrowserWindow({
        width: 1100,
        height: 780,
        show: false,
        webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true, nodeIntegration: false },
      });
      await window.loadURL(url);
      previous.close();
      await showDistill();
      const restored = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.equal(restored.identity.length, 1);
      assert.equal(restored.experiences[0]?.statement, "（测试）编辑经历");
      assert.equal(restored.facts.length, 0);
      return { screenshot: await screenshot("reopened-profile") };
    });

    await record("model-failure-does-not-write-unconfirmed-content", async () => {
      const before = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      const failureRouting = {
        providers: [{ id: "fake-fail", name: "Fake failure", type: "fake", enabled: true, models: [{ id: "fake-fail/fail", model: "fail", enabled: true }] }],
        routes: { chat: { primary: "fake-fail/fail", fallbacks: [] }, artifact: { primary: "fake-fail/fail", fallbacks: [] }, review: { primary: "fake-fail/fail", fallbacks: [] } },
      };
      await saveRouting(failureRouting);
      const draft = await evaluate(`window.digitalMe.createDistillInput({text:'这条材料的生成应失败。',sourceKind:'direct'})`);
      let failure;
      try {
        await evaluate(`window.digitalMe.generateIdentityExperienceFacts(${JSON.stringify(draft.id)})`);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, "模型失败时 generate 必须拒绝");
      const after = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      assert.deepEqual(after.counts, before.counts, "模型失败不得写入任何未经确认的主体条目");
      await saveRouting(successRouting);
      return { provider: "fake-fail", model: "fail", errorCode: failure.code || "PROVIDER_ERROR" };
    });

    await record("confirmed-content-enters-act-context", async () => {
      // Verify the real assembly interface: doing-context reads confirmed/edited
      // distill-me items and includes them in act context.
      const { assembleDoingContext } = require("../src/doing-context");
      const pkgDir = await evaluate(`(async()=>(await window.digitalMe.getConfig()).packageDir)()`);
      const snapshot = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);

      // Assemble doing context using the real package dir and a minimal pkg stub
      const ctx = assembleDoingContext({
        packageDir: pkgDir,
        pkg: { manifest: { packageId: "test-pkg", version: 1 } },
        taskIntent: "帮我写一段产品介绍",
        scene: "act_behalf",
      });

      // confirmed identity must be present
      assert.ok(Array.isArray(ctx.confirmedContext), "confirmedContext must be an array");
      const ctxIds = ctx.confirmedContext.map((item) => item.id);
      const confirmedIdentity = (snapshot.identity || [])[0];
      assert.ok(confirmedIdentity, "snapshot must have a confirmed identity item");
      assert.ok(ctxIds.includes(confirmedIdentity.id), "confirmed identity must enter act context");

      // Check that the confirmed item retains source and audit fields
      const ctxItem = ctx.confirmedContext.find((item) => item.id === confirmedIdentity.id);
      assert.equal(ctxItem.category, "identity");
      assert.equal(ctxItem.statement, confirmedIdentity.statement);
      assert.ok(ctxItem.confirmedAt, "confirmedAt must be retained");
      assert.ok(Array.isArray(ctxItem.sourceRefs) && ctxItem.sourceRefs.length > 0, "sourceRefs must be retained");
      assert.ok(Array.isArray(ctxItem.evidenceRefs), "evidenceRefs must be retained");
      assert.ok(typeof ctxItem.version === "number" && ctxItem.version >= 1, "version must be retained");

      // Pending/rejected/deleted/revoked must NOT enter
      const allItems = await evaluate(`window.digitalMe.getDistillMeSnapshot()`);
      const badStatuses = ["proposed", "rejected", "deleted", "revoked"];
      const badIds = [];
      for (const cat of ["identity", "experiences", "facts", "pending"]) {
        for (const item of (allItems[cat] || [])) {
          if (badStatuses.includes(item.status)) badIds.push(item.id);
        }
      }
      for (const badId of badIds) {
        assert.equal(ctxIds.includes(badId), false, `item ${badId} with excluded status must not enter act context`);
      }

      // policy must reflect exclusion
      assert.ok(ctx.policy.excludedCount >= 0, "excludedCount must be non-negative");
      assert.equal(ctx.policy.applied, ctx.confirmedContext.length > 0, "policy.applied must reflect whether context was used");

      // auditRef must be present
      assert.ok(ctx.auditRef, "auditRef must be present");

      return { screenshot: null };
    });
  } finally {
    writeRecords();
  }

  console.log("PASS distill acceptance");
  return 0;
}

module.exports = { runDistillMeAcceptanceHarness };
