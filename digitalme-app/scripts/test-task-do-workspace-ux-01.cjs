"use strict";

/**
 * TASK-DO-WORKSPACE-UX-01 — workspace UX contracts.
 * Run: npm run test:task-do-workspace-ux-01
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const artifactOpen = require("../src/act-behalf/deliverable-artifact-open");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-wsux-${label}-`));
}

function readAppSources() {
  const root = path.join(__dirname, "..", "src", "renderer");
  return {
    html: fs.readFileSync(path.join(root, "index.html"), "utf8"),
    app: fs.readFileSync(path.join(root, "app.js"), "utf8"),
    css: fs.readFileSync(path.join(root, "styles.css"), "utf8"),
  };
}

async function main() {
  await test("1) no first-screen title input as primary field", () => {
    const { html } = readAppSources();
    assert.ok(html.includes('id="act-request"'));
    assert.ok(html.includes("描述你希望完成的工作"));
    assert.ok(html.includes('id="act-rename-row"'));
    assert.ok(html.includes("act-rename-row hidden") || html.includes('class="act-rename-row hidden"'));
    assert.equal(html.includes("任务标题（可选）"), false);
  });

  await test("2) large task requirement editor", () => {
    const { html, css, app } = readAppSources();
    assert.ok(html.includes("act-request-editor"));
    assert.ok(css.includes("min-height: 280px") || css.includes("min-height:280px"));
    assert.ok(app.includes("autosizeActRequest"));
  });

  await test("3) task materials labeling + add file/folder", () => {
    const { html } = readAppSources();
    assert.ok(html.includes("任务材料"));
    assert.ok(html.includes("添加完成这项工作需要使用的文件、文件夹或已有成果"));
    assert.ok(html.includes('id="btn-act-add-file"'));
    assert.ok(html.includes('id="btn-act-add-folder"'));
    assert.ok(html.includes(">添加文件夹<"));
    assert.equal(/参考材料/.test(html.replace(/任务材料[\s\S]*?添加文件夹/, "")), false);
  });

  await test("4) primary start action is 开始做", () => {
    const { html, app } = readAppSources();
    assert.ok(html.includes('id="btn-act-start-do"'));
    assert.ok(html.includes(">开始做<"));
    assert.ok(app.includes("handleStartDoWork"));
    assert.ok(app.includes("actBehalfPlanGenerate"));
    assert.ok(app.includes("actBehalfConfirmPlanAndGenerate"));
  });

  await test("5) default UI hides role / expected / understanding / plan", () => {
    const { html } = readAppSources();
    assert.equal(html.includes("本次角色"), false);
    assert.equal(html.includes("期望成果"), false);
    assert.equal(html.includes("更多意图选项"), false);
    assert.ok(html.includes('id="act-deliverable-plan-panel"'));
    assert.ok(html.includes('hidden') && html.includes("act-deliverable-plan-panel"));
    // Plan panel present but not default visible primary path
    assert.ok(html.includes('id="btn-act-form-plan"') && html.includes('class="hidden"'));
  });

  await test("6) in-page result + revision + accept + open local", () => {
    const { html, app } = readAppSources();
    assert.ok(html.includes('id="act-workspace-result"'));
    assert.ok(html.includes('id="act-result-body"'));
    assert.ok(html.includes("继续修改"));
    assert.ok(html.includes(">发送修改<"));
    assert.ok(html.includes(">采用结果<"));
    assert.ok(html.includes(">打开本地文件<"));
    assert.ok(app.includes("actBehalfGetArtifactContent"));
    assert.ok(app.includes("actBehalfOpenLocalArtifact"));
    assert.ok(app.includes("handleSendRevision"));
    assert.ok(app.includes("revisionGuidance"));
  });

  await test("7) secure artifact content read rejects path injection", () => {
    const ud = tempDir("read");
    const denied = artifactOpen.readArtifactContent(ud, {
      path: "C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts",
      relativePath: "..\\\\..\\\\secret.md",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "path_not_allowed");
  });

  await test("8) secure content read uses store IDs only", async () => {
    const ud = tempDir("content");
    const pkgId = "pkg_wsux";
    const delId = "del_wsux";
    const verId = "ver_wsux";
    const artId = "art_wsux";
    const committed = await artifactFs.commitVersionFiles(ud, {
      packageId: pkgId,
      deliverableId: delId,
      versionId: verId,
      files: { "artifact.md": "# Hello\n\nBody from authority." },
      manifest: { attemptId: "att_wsux" },
    });
    const file = committed.files[0];
    await packageStore.mutateStore(ud, (s) => {
      s.packages[pkgId] = {
        id: pkgId,
        taskId: "task_wsux",
        deliverableIds: [delId],
        softDeletedAt: null,
      };
      s.deliverables[delId] = {
        id: delId,
        packageId: pkgId,
        title: "文档",
        kind: "document",
        planDisposition: "included",
        generationStatus: "ready",
        currentVersionId: verId,
      };
      s.versions[verId] = {
        id: verId,
        deliverableId: delId,
        packageId: pkgId,
        artifactRef: { id: artId, format: "md", relativePath: file.relativePath },
        artifactRefs: [{ id: artId, format: "md", relativePath: file.relativePath }],
        reviewStatus: null,
      };
      s.artifacts[artId] = {
        id: artId,
        versionId: verId,
        format: "md",
        relativePath: file.relativePath,
      };
      return { ok: true };
    });

    const got = artifactOpen.readArtifactContent(ud, {
      artifactId: artId,
      versionId: verId,
      deliverableId: delId,
      taskId: "task_wsux",
    });
    assert.equal(got.ok, true);
    assert.ok(got.content.includes("Body from authority"));

    const opened = artifactOpen.resolveOpenableArtifact(ud, {
      artifactId: artId,
      versionId: verId,
      deliverableId: delId,
      taskId: "task_wsux",
    });
    assert.equal(opened.ok, true);
  });

  await test("9) auto title helper exists without model call", () => {
    const { app } = readAppSources();
    assert.ok(app.includes("function deriveTaskTitleFromGoal"));
    assert.ok(app.includes("deriveTaskTitleFromGoal(goal)"));
  });

  await test("10) classic surface + no restored open dual-path", () => {
    const { app } = readAppSources();
    const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
    assert.equal(preload.includes("actBehalfOpenArtifact"), false);
    assert.equal(preload.includes("actBehalfRevealArtifact"), false);
    assert.ok(preload.includes("actBehalfOpenLocalArtifact"));
    assert.ok(preload.includes("actBehalfGetArtifactContent"));
    assert.equal(app.includes("actBehalfOpenArtifact"), false);
    const entry = fs.readFileSync(path.join(__dirname, "../src/renderer-entry-controller.js"), "utf8");
    assert.ok(entry.includes('MVP_PRODUCT_SURFACE = "legacy"'));
  });

  await test("11) materials enter generation context path still referenced", () => {
    const ctx = fs.readFileSync(path.join(__dirname, "../src/act-behalf/deliverable-context.js"), "utf8");
    assert.ok(ctx.includes("referenceMaterials") || ctx.includes("budgetAttachmentContext"));
    const gen = fs.readFileSync(path.join(__dirname, "../src/act-behalf/deliverable-generation.js"), "utf8");
    assert.ok(gen.includes("revisionGuidance"));
    assert.ok(gen.includes("用户对本成果的修改要求"));
  });

  console.log(`\ntask-do-workspace-ux-01: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
