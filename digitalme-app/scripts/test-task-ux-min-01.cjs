"use strict";

/**
 * TASK-UX-MIN-01: task list lifecycle, search, pagination contracts.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const taskLifecycle = require("../src/act-behalf/task-lifecycle");
const packageStore = require("../src/act-behalf/deliverable-package-store");

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

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-task-ux-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function seedPackageGenerating(userData, taskId, packageId, deliverableId) {
  const store = packageStore.emptyStore();
  store.packages[packageId] = {
    id: packageId,
    taskId,
    sourcePlanId: "plan_test",
    sourcePlanVersionId: "ver_test",
    lifecycleStatus: "in_progress",
    softDeletedAt: null,
    deliverableIds: [deliverableId],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.deliverables[deliverableId] = {
    id: deliverableId,
    packageId,
    planDisposition: "included",
    generationStatus: "generating",
    title: "生成中",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(packageStore.storePath(userData), JSON.stringify(store, null, 2), "utf8");
}

async function main() {
  await test("rename persists and updates title", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, { title: "旧名", goal: "目标 A", request: "目标 A" });
      const renamed = await taskLifecycle.renameTaskLifecycle(ud, saved.task.taskId, "新任务名");
      assert.equal(renamed.ok, true);
      assert.equal(renamed.task.title, "新任务名");
      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.task.title, "新任务名");
      const listed = actStore.listTasks(ud, { scope: "active" });
      assert.equal(listed.tasks[0].title, "新任务名");
    } finally {
      cleanup(ud);
    }
  });

  await test("archive removes from active and appears in archived", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, { title: "待归档", goal: "g", request: "g" });
      const archived = await taskLifecycle.archiveTaskLifecycle(ud, saved.task.taskId);
      assert.equal(archived.ok, true);
      assert.ok(archived.task.archivedAt);
      const active = actStore.listTasks(ud, { scope: "active" });
      assert.equal(active.total, 0);
      const arch = actStore.listTasks(ud, { scope: "archived" });
      assert.equal(arch.total, 1);
      assert.equal(arch.tasks[0].taskId, saved.task.taskId);
    } finally {
      cleanup(ud);
    }
  });

  await test("restore returns task to active front", async () => {
    const ud = tempUserData();
    try {
      const a = await actStore.saveTask(ud, { title: "A", goal: "a", updatedAt: "2020-01-01T00:00:00.000Z" });
      await new Promise((r) => setTimeout(r, 5));
      const b = await actStore.saveTask(ud, { title: "B", goal: "b" });
      await taskLifecycle.archiveTaskLifecycle(ud, b.task.taskId);
      const restored = await taskLifecycle.restoreTaskLifecycle(ud, b.task.taskId);
      assert.equal(restored.ok, true);
      assert.equal(restored.task.lifecycleStatus, "active");
      assert.equal(restored.task.archivedAt, null);
      const active = actStore.listTasks(ud, { scope: "active" });
      assert.equal(active.total, 2);
      assert.equal(active.tasks[0].taskId, b.task.taskId);
    } finally {
      cleanup(ud);
    }
  });

  await test("soft delete hides from active and archived lists", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, { title: "删我", goal: "x" });
      const del = await taskLifecycle.softDeleteTaskLifecycle(ud, saved.task.taskId);
      assert.equal(del.ok, true);
      assert.ok(del.task.deletedAt);
      assert.equal(actStore.listTasks(ud, { scope: "active" }).total, 0);
      assert.equal(actStore.listTasks(ud, { scope: "archived" }).total, 0);
      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.task.lifecycleStatus, "soft_deleted");
    } finally {
      cleanup(ud);
    }
  });

  await test("soft delete does not remove task record (artifacts path unchanged)", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, {
        title: "有成果",
        goal: "g",
        deliverableExecution: { activePackageId: "pkg_1" },
      });
      await taskLifecycle.softDeleteTaskLifecycle(ud, saved.task.taskId);
      assert.ok(fs.existsSync(actStore.storePath(ud)));
      const raw = JSON.parse(fs.readFileSync(actStore.storePath(ud), "utf8"));
      assert.equal(raw.tasks.length, 1);
      assert.equal(raw.tasks[0].deliverableExecution.activePackageId, "pkg_1");
    } finally {
      cleanup(ud);
    }
  });

  await test("archive blocked while generating", async () => {
    const ud = tempUserData();
    try {
      const pkgId = "pkg_gen_1";
      const delId = "del_gen_1";
      const saved = await actStore.saveTask(ud, {
        title: "生成中",
        goal: "g",
        deliverableExecution: { activePackageId: pkgId },
      });
      seedPackageGenerating(ud, saved.task.taskId, pkgId, delId);
      const blocked = await taskLifecycle.archiveTaskLifecycle(ud, saved.task.taskId);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "generation_in_progress");
      assert.ok(blocked.message.includes("归档"));
    } finally {
      cleanup(ud);
    }
  });

  await test("delete blocked while generating", async () => {
    const ud = tempUserData();
    try {
      const pkgId = "pkg_gen_2";
      const delId = "del_gen_2";
      const saved = await actStore.saveTask(ud, {
        title: "生成中",
        goal: "g",
        deliverableExecution: { activePackageId: pkgId },
      });
      seedPackageGenerating(ud, saved.task.taskId, pkgId, delId);
      const blocked = await taskLifecycle.softDeleteTaskLifecycle(ud, saved.task.taskId);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "generation_in_progress");
      assert.ok(blocked.message.includes("删除"));
    } finally {
      cleanup(ud);
    }
  });

  await test("search matches title and goal separately by scope", async () => {
    const ud = tempUserData();
    try {
      await actStore.saveTask(ud, { title: "Alpha标题", goal: "无关", request: "无关" });
      await actStore.saveTask(ud, { title: "其他", goal: "Beta目标内容", request: "Beta目标内容" });
      const byTitle = actStore.listTasks(ud, { scope: "active", query: "alpha" });
      assert.equal(byTitle.total, 1);
      assert.ok(byTitle.tasks[0].title.includes("Alpha"));
      const byGoal = actStore.listTasks(ud, { scope: "active", query: "beta目标" });
      assert.equal(byGoal.total, 1);
      await taskLifecycle.archiveTaskLifecycle(
        ud,
        actStore.listTasks(ud, { scope: "active", query: "alpha" }).tasks[0].taskId
      );
      assert.equal(actStore.listTasks(ud, { scope: "active", query: "alpha" }).total, 0);
      assert.equal(actStore.listTasks(ud, { scope: "archived", query: "alpha" }).total, 1);
      assert.equal(actStore.listTasks(ud, { scope: "archived", query: "beta" }).total, 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("pagination returns 20 per page with hasMore", async () => {
    const ud = tempUserData();
    try {
      for (let i = 0; i < 25; i += 1) {
        await actStore.saveTask(ud, {
          title: "任务" + i,
          goal: "g" + i,
          updatedAt: new Date(Date.now() - i * 1000).toISOString(),
        });
      }
      const page1 = actStore.listTasks(ud, { scope: "active", offset: 0, limit: 20 });
      assert.equal(page1.tasks.length, 20);
      assert.equal(page1.total, 25);
      assert.equal(page1.hasMore, true);
      const page2 = actStore.listTasks(ud, { scope: "active", offset: 20, limit: 20 });
      assert.equal(page2.tasks.length, 5);
      assert.equal(page2.hasMore, false);
    } finally {
      cleanup(ud);
    }
  });

  await test("list sorted by updatedAt desc", async () => {
    const ud = tempUserData();
    try {
      const old = await actStore.saveTask(ud, {
        title: "旧",
        goal: "o",
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      const fresh = await actStore.saveTask(ud, { title: "新", goal: "n" });
      const listed = actStore.listTasks(ud, { scope: "active" });
      assert.equal(listed.tasks[0].taskId, fresh.task.taskId);
      assert.equal(listed.tasks[1].taskId, old.task.taskId);
    } finally {
      cleanup(ud);
    }
  });

  await test("reload from disk preserves lifecycle fields", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, { title: "持久", goal: "p" });
      await taskLifecycle.archiveTaskLifecycle(ud, saved.task.taskId);
      const reloaded = actStore.loadStore(ud);
      const t = reloaded.tasks.find((x) => x.taskId === saved.task.taskId);
      assert.equal(t.lifecycleStatus, "archived");
      assert.ok(t.archivedAt);
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nTASK-UX-MIN-01:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
