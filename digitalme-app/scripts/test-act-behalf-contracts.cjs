"use strict";

/**
 * DM-Core-01A hermetic contracts: select context, parse output, task store.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { buildSelectedSelfContext } = require("../src/act-behalf/select-self-context");
const { parseActBehalfOutput, buildActBehalfMessages } = require("../src/act-behalf/parse-output");
const actStore = require("../src/act-behalf/task-store");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-act-behalf-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  await test("selectedSelfContext is bounded and labeled", () => {
    const huge = "私密".repeat(8000);
    const ctx = buildSelectedSelfContext({
      persona: huge,
      styleGuide: "风格要点",
      lifeSummary: "经历摘要",
      boundariesSummary: "边界",
      longTermMemory: '{"k":"v"}\n'.repeat(200),
      decisionFrameworks: '{"f":1}',
    });
    assert.ok(ctx.items.length >= 2);
    assert.ok(ctx.combinedText.length <= ctx.budget + 50);
    assert.ok(!ctx.combinedText.includes("私密".repeat(1000)));
    assert.ok(ctx.note.includes("摘录") || ctx.note.includes("不足") || ctx.note.includes("确认"));
    assert.ok(!ctx.note.includes("与当前任务相关"));
  });

  await test("parseActBehalfOutput splits four sections", () => {
    const raw =
      "## 使用的本人信息\n\n用了人格卡\n\n" +
      "## 本人已有事实或观点\n\n我重视本地优先\n\n" +
      "## Digital Me 的新分析或建议\n\n建议分三步推进\n\n" +
      "## 完整结果\n\n最终可交付文稿";
    const p = parseActBehalfOutput(raw);
    assert.equal(p.parseOk, true);
    assert.ok(p.usedSelfInfo.includes("人格卡"));
    assert.ok(p.existingUserPositions.includes("本地优先"));
    assert.ok(p.digitalMeInferences.includes("三步"));
    assert.ok(p.result.includes("可交付"));
  });

  await test("buildActBehalfMessages does not dump unmarked package", () => {
    const msgs = buildActBehalfMessages({
      title: "t",
      request: "帮我写周报",
      selectedSelfContextText: "### 人格\n本地优先",
    });
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].content.includes("本人已有事实或观点"));
    assert.ok(msgs[1].content.includes("本地优先"));
    assert.ok(msgs[1].content.includes("唯一允许引用"));
  });

  await test("task store save/list/get survives reload", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, {
        title: "周报任务",
        request: "代表我整理周报",
        status: "completed",
        selectedSelfContext: {
          items: [{ source: "persona", label: "人格", text: "本地优先" }],
          combinedText: "本地优先",
          userEdited: true,
        },
        existingUserPositions: "重视本地",
        digitalMeInferences: "建议分条写",
        result: "完整周报草稿",
      });
      assert.equal(saved.ok, true);
      assert.ok(saved.task.taskId);
      const listed = actStore.listTasks(ud);
      assert.equal(listed.tasks.length, 1);
      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.ok, true);
      assert.equal(got.task.result, "完整周报草稿");
      assert.equal(got.task.existingUserPositions, "重视本地");
      assert.equal(got.task.digitalMeInferences, "建议分条写");
      assert.ok(fs.existsSync(actStore.storePath(ud)));
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nact-behalf contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
