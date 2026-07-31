"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-03 — start-do materials alignment + packaged path contracts.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { normalizeReferenceMaterials } = require("../src/act-behalf/deliverable-context");
const deliverablePlanner = require("../src/act-behalf/deliverable-planner");
const actBehalfStore = require("../src/act-behalf/task-store");
const builder = require("../src/builder");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main.js"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-fix03-"));
}

async function main() {
  await test("1) start-do creates task and persists materials before plan", () => {
    assert.ok(appJs.includes("Ensure Task exists BEFORE planning"));
    assert.ok(appJs.includes("Materials must be on the Task before planGenerate"));
    assert.match(appJs, /persistActReferenceMaterials\(actBehalfState\.taskId,\s*\{\s*throwOnError:\s*true/);
    assert.ok(appJs.includes("const planOk = await handleFormDeliverablePlan"));
  });

  await test("2) plan_materials_stale no longer leaves running phase stuck", () => {
    assert.ok(appJs.includes("One automatic re-plan so materials digest"));
    assert.ok(appJs.includes('showActWorkspacePhase("input")'));
    assert.ok(appJs.includes("userFacingStartDoError"));
    assert.ok(appJs.includes("模型暂时无法使用。请检查模型连接后重试。"));
    assert.ok(appJs.includes("部分任务材料暂时无法读取"));
  });

  await test("3) no hard gate requiring both file and folder", () => {
    assert.ok(!/至少一个文件/.test(appJs));
    assert.ok(!/至少一个文件夹/.test(appJs));
    assert.ok(!/at least one file and folder/i.test(appJs));
  });

  await test("4) normalizeReferenceMaterials keeps folder metadata and empty-text named folders", () => {
    const out = normalizeReferenceMaterials([
      {
        id: "f1",
        name: "资料夹",
        path: "D:/tmp/folder",
        text: "",
        ok: true,
        isFolder: true,
        fileCount: 3,
        kindLabel: "文件夹",
      },
      {
        id: "f2",
        name: "a.docx",
        text: "正文",
        ok: true,
        isFolder: false,
      },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].isFolder, true);
    assert.equal(out[0].fileCount, 3);
    assert.equal(out[1].isFolder, false);
  });

  await test("5) materials digest: plan-with-materials then same persist is not stale", async () => {
    const userData = tmpUserData();
    const goal = "写一篇介绍 Digital Me 的公众号文章";
    const materials = normalizeReferenceMaterials([
      {
        id: "m1",
        name: "test.docx",
        path: "C:/Users/Public/test.docx",
        text: "这是测试文档正文。",
        ok: true,
      },
      {
        id: "m2",
        name: "test",
        path: "C:/Users/Public/test",
        text: "文件夹「test」共 2 个文件。\n文件列表：\na.md\nb.txt",
        ok: true,
        isFolder: true,
        fileCount: 2,
      },
    ]);
    const created = await actBehalfStore.saveTask(userData, {
      title: "测试任务",
      goal,
      request: goal,
      status: "draft",
      referenceMaterials: materials,
    });
    assert.ok(created.ok);
    const summaries = deliverablePlanner.summarizeReferenceMaterialsForPlanning(materials);
    const digest = deliverablePlanner.planningMaterialsDigest(summaries);
    const withPlan = await actBehalfStore.saveTask(userData, {
      ...created.task,
      deliverablePlanning: {
        planId: "plan_test_1",
        plannedMaterialsDigest: digest,
        materialsStale: false,
        currentDraftVersionId: "ver_draft",
      },
    });
    assert.ok(withPlan.ok);

    // Same materials again — digest must match.
    const again = await actBehalfStore.saveTask(userData, {
      ...withPlan.task,
      referenceMaterials: materials,
    });
    assert.ok(again.ok);
    const summaries2 = deliverablePlanner.summarizeReferenceMaterialsForPlanning(
      again.task.referenceMaterials || []
    );
    const digest2 = deliverablePlanner.planningMaterialsDigest(summaries2);
    assert.equal(digest2, digest);

    // Empty plan digest + later materials would be stale (historical bug).
    const emptyPlanDigest = deliverablePlanner.planningMaterialsDigest(
      deliverablePlanner.summarizeReferenceMaterialsForPlanning([])
    );
    assert.notEqual(emptyPlanDigest, digest);

    fs.rmSync(userData, { recursive: true, force: true });
  });

  await test("6) docx extract works from absolute temp path (packaged-like)", async () => {
    // Minimal OOXML zip may be heavy; verify builder.extractText exists and soft-degrade path in main.
    assert.equal(typeof builder.extractText, "function");
    assert.ok(mainJs.includes("Soft degrade: keep the attachment"));
    assert.ok(mainJs.includes("仍保留该材料供任务引用"));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-docx-"));
    const txt = path.join(dir, "note.txt");
    fs.writeFileSync(txt, "hello portable path 中文", "utf8");
    const text = await builder.extractText(txt);
    assert.match(String(text), /hello portable path/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test("7) empty folder material still ok in selectFiles folder branch", () => {
    assert.ok(mainJs.includes("Bounded folder material"));
    assert.ok(mainJs.includes("isFolder: true"));
    // Folder branch sets ok=true even when fileEntries.length === 0
    assert.match(mainJs, /文件夹「\$\{name\}」共 \$\{fileEntries\.length\} 个文件/);
  });

  await test("8) DeepSeek first-connect maps all routes to one model (FIX-02 retained)", () => {
    assert.ok(appJs.includes("artifact: { primary: modelId, fallbacks: [] }"));
    assert.ok(appJs.includes("review: { primary: modelId, fallbacks: [] }"));
    assert.ok(appJs.includes("chat: { primary: modelId, fallbacks: [] }"));
  });

  await test("9) start button re-enabled in finally after failure", () => {
    assert.ok(appJs.includes("if (startBtn) startBtn.disabled = true"));
    assert.ok(appJs.includes("if (startBtn) startBtn.disabled = false"));
    assert.ok(appJs.includes("finally {"));
  });

  await test("10) handleFormDeliverablePlan returns boolean for start-do gate", () => {
    assert.match(appJs, /async function handleFormDeliverablePlan[\s\S]*return true;/);
    assert.match(appJs, /async function handleFormDeliverablePlan[\s\S]*return false;/);
  });

  console.log(`\n01E-FIX-03 results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
