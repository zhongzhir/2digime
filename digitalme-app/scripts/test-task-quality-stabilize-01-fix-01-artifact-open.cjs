"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01 — secure artifact open contracts.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packageStore = require("../src/act-behalf/deliverable-package-store");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const {
  resolveOpenableArtifact,
  openArtifactSecure,
  revealArtifactSecure,
  userMessageForOpenCode,
} = require("../src/act-behalf/deliverable-artifact-open");

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

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-open-fix-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function seedArtifact(userData, opts) {
  const packageId = opts.packageId || "delivery_test_pkg";
  const deliverableId = opts.deliverableId || "deliverable_test_doc";
  const versionId = opts.versionId || "dver_test_v1";
  const artifactId = opts.artifactId || "aref_test_md";
  const name = opts.name || "artifact.md";
  const body = opts.body || "# Hello\n\n内容。\n";
  const taskId = opts.taskId || "abt_test_task";

  const committed = await artifactFs.commitVersionFiles(userData, {
    packageId,
    deliverableId,
    versionId,
    files: { [name]: body },
    manifest: { attemptId: "dgatt_test" },
  });
  const file = committed.files[0];
  const artifact = {
    id: artifactId,
    versionId,
    storageKind: "local_deliverable_relative",
    relativePath: file.relativePath,
    contentHash: file.contentHash,
    mimeType: "text/markdown",
    byteSize: file.byteSize,
    format: name.split(".").pop(),
    createdAt: new Date().toISOString(),
  };
  await packageStore.mutateStore(userData, (s) => {
    s.packages[packageId] = {
      id: packageId,
      taskId,
      deliverableIds: [deliverableId],
      lifecycleStatus: "completed",
      completionStatus: "complete",
      softDeletedAt: null,
    };
    s.deliverables[deliverableId] = {
      id: deliverableId,
      packageId,
      kind: "document",
      title: "测试文档",
      planDisposition: "included",
      generationStatus: "ready",
      currentVersionId: versionId,
      versionIds: [versionId],
    };
    s.versions[versionId] = {
      id: versionId,
      deliverableId,
      packageId,
      artifactRef: artifact,
      artifactRefs: [artifact],
      contentAvailable: true,
    };
    s.artifacts[artifactId] = artifact;
    return true;
  });
  return { packageId, deliverableId, versionId, artifactId, taskId, relativePath: file.relativePath };
}

async function main() {
  await test("existing markdown file resolves and opens", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, { name: "artifact.md" });
      const opened = [];
      const res = await openArtifactSecure({
        userData: ud,
        payload: {
          artifactId: seeded.artifactId,
          versionId: seeded.versionId,
          deliverableId: seeded.deliverableId,
          taskId: seeded.taskId,
        },
        shell: {
          openPath: async (p) => {
            opened.push(p);
            assert.ok(fs.existsSync(p));
            assert.ok(path.isAbsolute(p));
            return "";
          },
        },
      });
      assert.equal(res.ok, true);
      assert.equal(opened.length, 1);
      assert.ok(opened[0].includes("artifact.md"));
    } finally {
      cleanup(ud);
    }
  });

  await test("renderer must pass stable IDs only — path injection rejected", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      const res = await openArtifactSecure({
        userData: ud,
        payload: {
          artifactId: seeded.artifactId,
          path: "C:\\\\Windows\\\\System32\\\\notepad.exe",
        },
        shell: { openPath: async () => "" },
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, "path_not_allowed");
      assert.equal(res.message, "暂时无法打开成果。");
    } finally {
      cleanup(ud);
    }
  });

  await test("main resolves path from authoritative store", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      const resolved = resolveOpenableArtifact(ud, { artifactId: seeded.artifactId });
      assert.equal(resolved.ok, true);
      assert.ok(path.isAbsolute(resolved.abs));
      assert.ok(resolved.abs.includes("deliverable-artifacts"));
      assert.equal(resolved.artifact.id, seeded.artifactId);
    } finally {
      cleanup(ud);
    }
  });

  await test("missing file returns file_missing", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      const abs = artifactFs.resolveAbsolute(ud, seeded.relativePath);
      fs.unlinkSync(abs);
      const res = await openArtifactSecure({
        userData: ud,
        payload: { artifactId: seeded.artifactId },
        shell: { openPath: async () => "" },
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, "file_missing");
      assert.equal(res.message, "成果文件已移动或删除。");
    } finally {
      cleanup(ud);
    }
  });

  await test("artifact not belonging to version rejected", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      await packageStore.mutateStore(ud, (s) => {
        s.artifacts.aref_orphan = {
          ...s.artifacts[seeded.artifactId],
          id: "aref_orphan",
          versionId: seeded.versionId,
        };
        // Keep version.artifactRefs without orphan
        return true;
      });
      const res = await openArtifactSecure({
        userData: ud,
        payload: { artifactId: "aref_orphan", versionId: seeded.versionId },
        shell: { openPath: async () => "" },
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, "invalid_artifact_reference");
    } finally {
      cleanup(ud);
    }
  });

  await test("version not belonging to task rejected", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, { taskId: "abt_real" });
      const res = await openArtifactSecure({
        userData: ud,
        payload: {
          artifactId: seeded.artifactId,
          taskId: "abt_other_task",
        },
        shell: { openPath: async () => "" },
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, "invalid_artifact_reference");
    } finally {
      cleanup(ud);
    }
  });

  await test("shell.openPath error is not swallowed", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      const res = await openArtifactSecure({
        userData: ud,
        payload: { artifactId: seeded.artifactId },
        shell: { openPath: async () => "Failed to open" },
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, "open_failed");
      assert.equal(res.message, "暂时无法打开成果。");
      assert.ok(res.detail && /Failed to open/.test(res.detail));
    } finally {
      cleanup(ud);
    }
  });

  await test("html and image formats resolve", async () => {
    const ud = tempUserData();
    try {
      const html = await seedArtifact(ud, {
        packageId: "delivery_html",
        deliverableId: "deliverable_html",
        versionId: "dver_html",
        artifactId: "aref_html",
        name: "artifact.html",
        body: "<html><body>ok</body></html>",
      });
      const r1 = resolveOpenableArtifact(ud, { artifactId: html.artifactId });
      assert.equal(r1.ok, true);

      const pngBuf = artifactFs.minimalPngBuffer();
      const img = await seedArtifact(ud, {
        packageId: "delivery_img",
        deliverableId: "deliverable_img",
        versionId: "dver_img",
        artifactId: "aref_img",
        name: "artifact.png",
        body: pngBuf,
      });
      const r2 = resolveOpenableArtifact(ud, { artifactId: img.artifactId });
      assert.equal(r2.ok, true);
    } finally {
      cleanup(ud);
    }
  });

  await test("reveal uses store path", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedArtifact(ud, {});
      const shown = [];
      const res = revealArtifactSecure({
        userData: ud,
        payload: { artifactId: seeded.artifactId },
        shell: { showItemInFolder: (p) => shown.push(p) },
      });
      assert.equal(res.ok, true);
      assert.equal(shown.length, 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("user messages stay plain language", () => {
    assert.equal(userMessageForOpenCode("file_missing"), "成果文件已移动或删除。");
    assert.equal(userMessageForOpenCode("artifact_not_found"), "成果文件不存在。");
    assert.equal(userMessageForOpenCode("open_failed"), "暂时无法打开成果。");
  });

  await test("renderer open buttons carry stable ids and prefer md", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.ok(src.includes('data-action="open-deliverable-artifact"'));
    assert.ok(src.includes("data-artifact-id="));
    assert.ok(src.includes("data-version-id="));
    assert.ok(src.includes("data-deliverable-id="));
    assert.ok(src.includes('document: ["md", "docx", "html"]'));
    assert.ok(!src.includes("data-path="));
    // New render must not emit legacy open aliases.
    assert.ok(!src.includes('data-action="open-primary"'));
    assert.ok(!src.includes('data-action="open-art"'));
    assert.ok(src.includes("bindArtifactOpenButtons"));
    const appSrc = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    assert.ok(appSrc.includes("正在打开…"));
    assert.ok(appSrc.includes("data-opening"));
    assert.ok(appSrc.includes("actBehalfOpenArtifact"));
    assert.ok(appSrc.includes("已打开成果"));
    assert.ok(appSrc.includes("暂时无法打开成果"));
    assert.ok(appSrc.includes("openDeliverableArtifactFromButton"));
    assert.ok(appSrc.includes("bindArtifactOpenButtons"));
    assert.ok(appSrc.includes("handleArtifactOpenButtonClick"));
    assert.ok(appSrc.includes("event.currentTarget"));
    assert.ok(appSrc.includes('dataset.openBound'));
    assert.ok(appSrc.includes("[artifact-open]"));
    assert.ok(appSrc.includes("direct_handler_entered"));
    // New open-deliverable-artifact must not be handled by panel delegation.
    assert.ok(appSrc.includes('if (action === "open-deliverable-artifact") {\n    return;') || appSrc.includes('action === "open-deliverable-artifact") {\r\n    return;') || /action === "open-deliverable-artifact"\)\s*\{\s*return;/.test(appSrc));
    assert.ok(!appSrc.includes('setActProgress("已打开草稿任务。")'));
    assert.ok(!appSrc.includes("handleDeliverableArtifactClickCapture"));
  });

  await test("partial package: ready items openable, failed have no open button markup rule", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.ok(src.includes('if (st === "成果已完成" && primary)'));
    assert.ok(src.includes("成果未能生成"));
  });

  await test("acceptance harness resolves modules via __dirname not cwd", () => {
    const harness = fs.readFileSync(
      path.join(__dirname, "electron-artifact-open-acceptance.cjs"),
      "utf8"
    );
    assert.ok(harness.includes("function fromAppRoot"));
    assert.ok(harness.includes('path.resolve(__dirname, "..", ...parts)'));
    assert.ok(harness.includes("main().catch"));
    assert.ok(!harness.includes('require("./src/'));
    assert.ok(!/new\s+BrowserWindow/.test(harness));
    assert.ok(!harness.includes("dialog.show"));

    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      function fromAppRoot(...parts) {
        return path.resolve(__dirname, "..", ...parts);
      }
      const modPath = fromAppRoot("src", "act-behalf", "deliverable-package-store");
      assert.ok(fs.existsSync(modPath + ".js") || fs.existsSync(modPath));
      const store = require(modPath);
      assert.equal(typeof store.loadStore, "function");
      const openPath = fromAppRoot("src", "act-behalf", "deliverable-artifact-open");
      const openMod = require(openPath);
      assert.equal(typeof openMod.openArtifactSecure, "function");
    } finally {
      process.chdir(prev);
    }
  });

  console.log("\nartifact-open-fix:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();
