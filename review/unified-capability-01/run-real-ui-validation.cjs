"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const EVIDENCE_DIR = path.join(__dirname, "evidence");
const RESULT_FILE = path.join(__dirname, "ui-validation-result.json");
const KEY_CSV =
  process.env.DIGITALME_VALIDATION_KEY_CSV ||
  "D:\\Projects\\Digital Me\\trial\\默认业务空间-apiKey-7639591.csv";
const BASE_URL =
  "https://ws-ok2fv132ihswnia7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.8-flash";
const DEPS =
  process.env.DIGITALME_VALIDATION_DEPS ||
  "D:\\Projects\\Digital Me\\.task-worktrees\\core-link-01\\node_modules";
const BUDGET = {
  targetCny: 2,
  priorKnownCny: 0.1847536,
  priorUnknownReserveCny: 0.5,
  currentAbortedSuiteReserveCny: 0.3,
  uiHarnessAbortedRequestReserveCny: 0.1,
  talkHarnessInflightReserveCny: 0.6,
};

function readKeyValueCsv(file) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const values = {};
  for (const row of rows) {
    const comma = row.indexOf(",");
    if (comma < 0) continue;
    const name = row.slice(0, comma).replace(/^"|"$/g, "").trim();
    const value = row.slice(comma + 1).replace(/^"|"$/g, "").trim();
    values[name] = value;
  }
  if (!values.apiKey || values.apiKey.length < 20) {
    throw new Error("credential CSV does not contain a usable apiKey field");
  }
  return values.apiKey;
}

function redact(value) {
  return String(value || "")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(authorization|api[_-]?key|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function readNdjson(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map(function (line) {
        try {
          return JSON.parse(line);
        } catch {
          return { parseError: true };
        }
      });
  } catch {
    return [];
  }
}

function collectResponseTraces(value, out) {
  if (!value || typeof value !== "object") return;
  if (
    value.provider === "responses" &&
    typeof value.elapsedMs === "number" &&
    value.usage &&
    typeof value.usage.estimatedCostCny === "number"
  ) {
    const key = value.responseId || JSON.stringify([
      value.elapsedMs,
      value.usage.inputTokens,
      value.usage.outputTokens,
      value.webSearchCalls,
      value.webExtractorCalls,
    ]);
    out.set(key, value);
  }
  for (const child of Object.values(value)) collectResponseTraces(child, out);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const apiKey = readKeyValueCsv(KEY_CSV);
  const playwright = require(path.join(DEPS, "playwright"));
  const electronPath = require(path.join(DEPS, "electron"));
  if (typeof electronPath !== "string") throw new Error("Electron executable was not resolved");

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "digitalme-unified-ui-"));
  const report = {
    task: "DIGITALME-UNIFIED-CAPABILITY-01",
    startedAt: new Date().toISOString(),
    endpoint: BASE_URL,
    model: MODEL,
    key: { source: "local CSV, read in runner process", persisted: "encrypted isolated SecretStore only" },
    isolatedUserData: userData,
    budget: BUDGET,
    tasks: {},
    failures: [],
  };
  let app;
  let page;
  let subjectDir = "";
  let artifactSnapshot = null;
  let stoppedForBudget = false;
  const electronBootstrap = path.join(
    os.tmpdir(),
    "digitalme-unified-main-" + process.pid + "-" + Date.now() + ".cjs",
  );
  const bootstrapTrace = path.join(userData, "bootstrap-trace.log");
  const startupLogs = { stdout: [], stderr: [] };

  const allTraces = async function () {
    const traces = new Map();
    if (page) {
      try {
        const talk = await page.evaluate(async function () {
          return window.digitalMe.invoke("talk", {});
        });
        collectResponseTraces(talk, traces);
      } catch {
        // Page may be closing.
      }
    }
    if (subjectDir) {
      const diagnostics = readNdjson(
        path.join(subjectDir, "content", "discovery-diagnostics.ndjson"),
      );
      collectResponseTraces(diagnostics, traces);
    }
    return traces;
  };

  const budgetState = async function () {
    const traces = await allTraces();
    let thisRunKnownCny = 0;
    for (const trace of traces.values()) thisRunKnownCny += trace.usage.estimatedCostCny;
    const admissionCny =
      BUDGET.priorKnownCny +
      BUDGET.priorUnknownReserveCny +
      BUDGET.currentAbortedSuiteReserveCny +
      BUDGET.uiHarnessAbortedRequestReserveCny +
      BUDGET.talkHarnessInflightReserveCny +
      thisRunKnownCny;
    return {
      thisRunKnownCny,
      traceCount: traces.size,
      admissionCny,
      canStartAnotherRequest: admissionCny < BUDGET.targetCny,
    };
  };

  const requireBudget = async function () {
    const state = await budgetState();
    report.budget.latest = state;
    if (!state.canStartAnotherRequest) {
      stoppedForBudget = true;
      throw new Error("VALIDATION_BUDGET_REACHED");
    }
  };

  const screenshot = async function (name) {
    if (!page) return;
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, name + ".png"),
      fullPage: true,
    });
  };

  const eventsSince = async function (start) {
    return page.evaluate(function (from) {
      return (window.__unifiedValidationEvents || []).slice(from);
    }, start);
  };

  const eventCount = async function () {
    return page.evaluate(function () {
      return (window.__unifiedValidationEvents || []).length;
    });
  };

  const talkView = async function () {
    return page.evaluate(async function () {
      return window.digitalMe.invoke("talk", {});
    });
  };

  const lastAssistant = function (view) {
    const turns = (((view || {}).view || {}).turns || []).filter(function (turn) {
      return turn.role === "assistant";
    });
    return turns[turns.length - 1] || null;
  };

  const waitForTalkBusy = async function (expected, timeoutMs) {
    await page.waitForFunction(
      function (busy) {
        const button = document.getElementById("btn-chat-send");
        return Boolean(button && button.disabled) === busy;
      },
      expected,
      { timeout: timeoutMs },
    );
  };

  const sendTalk = async function (text, name) {
    await requireBudget();
    await page.locator("#nav-chat").click();
    await page.locator("#panel-chat").waitFor({ state: "visible", timeout: 20000 });
    const before = await page.locator(".chat-turn-assistant").count();
    const eventStart = await eventCount();
    const began = Date.now();
    await page.locator("#chat-input").fill(text);
    await page.locator("#btn-chat-send").click();
    await waitForTalkBusy(true, 10000);
    await page.locator(".chat-turn-assistant").nth(before).waitFor({
      state: "visible",
      timeout: 300000,
    });
    await waitForTalkBusy(false, 300000);
    const view = await talkView();
    const assistant = lastAssistant(view);
    const result = {
      elapsedMs: Date.now() - began,
      response: assistant
        ? {
            text: redact(assistant.text),
            result: assistant.result || null,
            capabilityTrace: assistant.capabilityTrace || [],
          }
        : null,
      events: await eventsSince(eventStart),
      permissionDialogVisible: await page.locator("#folder-access-dialog").isVisible(),
    };
    report.tasks[name] = result;
    await screenshot(name);
    report.budget.latest = await budgetState();
    return { view, assistant, result };
  };

  const runDiscover = async function (query, name) {
    await requireBudget();
    await page.locator("#nav-discover").click();
    await page.locator("#panel-discover").waitFor({ state: "visible", timeout: 20000 });
    const eventStart = await eventCount();
    const began = Date.now();
    await page.locator("#content-discover-query").fill(query);
    await page.locator("#btn-content-discover-search").click();
    await page
      .locator('#content-discover[data-replenishing="1"]')
      .waitFor({ state: "attached", timeout: 10000 })
      .catch(function () {});
    await page.locator('#content-discover[data-replenishing="0"]').waitFor({
      state: "attached",
      timeout: 280000,
    });
    await page.locator("#btn-discover-cancel").waitFor({
      state: "hidden",
      timeout: 280000,
    });
    await page.waitForTimeout(700);
    const cards = await page.locator("#content-discover-list .content-discover-card").evaluateAll(
      function (nodes) {
        return nodes.map(function (node) {
          const title = node.querySelector("h3");
          const source = node.querySelector(".content-discover-source");
          const excerpt = node.querySelector(".content-discover-excerpt");
          return {
            title: title ? title.textContent : "",
            url: node.getAttribute("data-url") || "",
            publishedDay: node.getAttribute("data-published-day") || "",
            textOrigin: node.getAttribute("data-text-origin") || "",
            source: source ? source.textContent : "",
            excerpt: excerpt ? excerpt.textContent : "",
          };
        });
      },
    );
    const notice = await page.locator("#content-discover-notice").innerText().catch(function () {
      return "";
    });
    const diagnostics = subjectDir
      ? readNdjson(path.join(subjectDir, "content", "discovery-diagnostics.ndjson"))
      : [];
    const result = {
      query,
      elapsedMs: Date.now() - began,
      cards,
      notice: redact(notice),
      events: await eventsSince(eventStart),
      diagnostic: diagnostics[diagnostics.length - 1] || null,
    };
    report.tasks[name] = result;
    await screenshot(name);
    report.budget.latest = await budgetState();
    return result;
  };

  try {
    fs.writeFileSync(
      electronBootstrap,
      [
        "const fs = require('node:fs');",
        "process.env.NODE_PATH = " + JSON.stringify(DEPS) + " + require('node:path').delimiter + (process.env.NODE_PATH || '');",
        "require('node:module').Module._initPaths();",
        "const trace = " + JSON.stringify(bootstrapTrace) + ";",
        "const mark = (value) => { try { fs.appendFileSync(trace, new Date().toISOString() + ' ' + value + '\\n'); } catch {} };",
        "mark('bootstrap.entry');",
        "const { app } = require('electron');",
        "app.whenReady().then(() => mark('electron.ready'));",
        "app.on('browser-window-created', () => mark('browser-window-created'));",
        "process.on('unhandledRejection', (error) => mark('unhandledRejection ' + String(error && error.stack || error)));",
        "process.on('uncaughtException', (error) => mark('uncaughtException ' + String(error && error.stack || error)));",
        "require(" + JSON.stringify(path.join(ROOT, "electron", "main.cjs")) + ");",
        "mark('bootstrap.required-main');",
        "",
      ].join("\n"),
      "utf8",
    );
    app = await playwright._electron.launch({
      executablePath: electronPath,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        electronBootstrap,
      ],
      cwd: ROOT,
      timeout: 60000,
      env: Object.assign({}, process.env, {
        NODE_PATH: DEPS,
        DIGITALME_V2_ROOT: ROOT,
        DIGITALME_V2_USER_DATA: userData,
        DIGITALME_V2_ELECTRON_TEST: "0",
        DIGITALME_V2_UX_ACCEPTANCE: "0",
        DIGITALME_V2_DIGITAL_SELF_STUB: "0",
        DIGITALME_V2_TALK_STUB: "0",
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: "0",
        DIGITALME_V2_TALK_UI_DEADLINE_MS: "300000",
      }),
    });
    const child = app.process();
    if (child.stdout) child.stdout.on("data", function (chunk) {
      startupLogs.stdout.push(redact(chunk).slice(0, 2000));
    });
    if (child.stderr) child.stderr.on("data", function (chunk) {
      startupLogs.stderr.push(redact(chunk).slice(0, 2000));
    });
    page = await app.firstWindow({ timeout: 45000 });
    await page.waitForLoadState("domcontentloaded");

    if (process.env.DIGITALME_VALIDATION_STARTUP_ONLY === "1") {
      report.startupOnly = { windowCreated: true };
      return;
    }

    const configured = await page.evaluate(
      async function (input) {
        const saved = await window.digitalMe.saveModelCredential({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
          providerPreset: "openai-compatible",
        });
        await window.digitalMe.saveAiCapabilitySettings({ path: "byok" });
        await window.digitalMe.saveWebDiscoverySettings({ enabled: true, path: "byok" });
        const status = await window.digitalMe.getModelStatus();
        return {
          saveModelReady: saved.modelReady,
          activeModelReady: status.modelReady,
          model: status.modelMeta && status.modelMeta.model,
          host: status.modelMeta && status.modelMeta.baseUrlHost,
          aiCapabilityPath: status.aiCapabilityPath,
        };
      },
      { apiKey, baseUrl: BASE_URL, model: MODEL },
    );
    report.configuration = configured;

    const shell = page.locator("#view-shell");
    if (!(await shell.isVisible().catch(function () { return false; }))) {
      const skip = page.locator("#btn-welcome-skip-model");
      if (await skip.isVisible().catch(function () { return false; })) await skip.click();
    }
    await shell.waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#nav-chat").click();
    await page.locator("#chat-input").waitFor({ state: "visible", timeout: 15000 });

    await page.evaluate(function () {
      window.__unifiedValidationEvents = [];
      window.digitalMe.onCapabilityProgress(function (event) {
        window.__unifiedValidationEvents.push(event);
      });
    });
    const subject = await page.evaluate(async function () {
      return window.digitalMe.getDefaultSubjectDir();
    });
    subjectDir = subject.dir;
    report.subjectDir = subjectDir;

    const crypto = await runDiscover(
      "找一些关于数字货币的最新报道和深度分析文章。",
      "01-digital-currency",
    );

    if (crypto.cards.length >= 2) {
      const cards = page.locator("#content-discover-list .content-discover-card");
      await cards.nth(0).getByRole("button", { name: "选择 / 取消比较" }).click();
      await cards.nth(1).getByRole("button", { name: "选择 / 取消比较" }).click();
      await page.getByRole("button", { name: "一起比较" }).click();
      await page.locator("#panel-chat").waitFor({ state: "visible", timeout: 15000 });
      await sendTalk(
        "请比较这两篇原文的核心观点差异，并把关键判断分别绑定到对应来源；没有读到正文的部分请明说。",
        "02-source-comparison",
      );
    } else {
      report.tasks["02-source-comparison"] = {
        skipped: true,
        reason: "fewer than two qualified Digital Currency cards",
      };
    }

    await runDiscover(
      "找一些关于区块链的最新报道和深度分析文章。",
      "03-blockchain-topic-switch",
    );
    await runDiscover(
      "找一些关于固态电池产业化进展的最新报道和深度分析文章。",
      "04-unseen-news-topic",
    );

    await sendTalk(
      "如果我给你说清楚数字之我的内容，你能不能起草一个标准的播客制作文件，给专业工具来完成制作。",
      "05-podcast-consultation",
    );

    const produced = await sendTalk(
      "请根据以下材料，现在生成播客制作文件，保存到应用成果区。材料：数字之我不是静态档案，而是在长期互动中不断更新、由本人授权边界保护的协作主体。请用两人对话形式，包含节目标题、角色设定、分段脚本、音效提示和交付说明。",
      "06-podcast-artifact",
    );
    const resultPath =
      produced.assistant && produced.assistant.result && produced.assistant.result.path;
    if (resultPath) {
      const content = fs.readFileSync(resultPath, "utf8");
      artifactSnapshot = {
        path: resultPath,
        bytes: Buffer.byteLength(content),
        chars: content.length,
        content: redact(content),
      };
      report.tasks["06-podcast-artifact"].readback = artifactSnapshot;
      report.tasks["06-podcast-artifact"].openResult = await page.evaluate(
        async function (target) {
          return window.digitalMe.openPath(target);
        },
        resultPath,
      );
    }

    await requireBudget();
    const externalDir = path.join(userData, "external-target");
    fs.mkdirSync(externalDir, { recursive: true });
    await page.locator("#nav-chat").click();
    const permissionEventStart = await eventCount();
    const beforePermission = await page.locator(".chat-turn-assistant").count();
    await page.locator("#chat-input").fill(
      "请现在把一段测试说明保存到这个外部目录：" +
        externalDir +
        "。文件名为 permission-check.md。",
    );
    await page.locator("#btn-chat-send").click();
    await waitForTalkBusy(true, 10000);
    await page.locator("#folder-access-dialog").waitFor({ state: "visible", timeout: 300000 });
    const waitingCopy = {
      dialog: await page.locator("#folder-access-dialog").innerText(),
      status: await page.locator("#chat-status").innerText(),
      doing: await page.locator("[data-talk-doing]").innerText().catch(function () { return ""; }),
    };
    await screenshot("07-waiting-permission");
    await page.locator("#btn-folder-deny").click();
    await page.locator(".chat-turn-assistant").nth(beforePermission).waitFor({
      state: "visible",
      timeout: 300000,
    });
    await waitForTalkBusy(false, 300000);
    report.tasks["07-waiting-permission"] = {
      waitingCopy: waitingCopy,
      deniedFinal: lastAssistant(await talkView()),
      events: await eventsSince(permissionEventStart),
      fileExistsAfterDeny: fs.existsSync(path.join(externalDir, "permission-check.md")),
    };
    report.budget.latest = await budgetState();

    await requireBudget();
    await page.locator("#nav-chat").click();
    const cancelStart = await eventCount();
    await page.locator("#chat-input").fill(
      "请搜索今天关于海洋碳汇的最新进展，并读取来源后总结。",
    );
    await page.locator("#btn-chat-send").click();
    await waitForTalkBusy(true, 10000);
    await page.locator("#btn-chat-cancel").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500);
    await page.locator("#btn-chat-cancel").click();
    await page.locator("#chat-status").filter({ hasText: /取消/ }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    report.tasks["08-cancel"] = {
      status: await page.locator("#chat-status").innerText(),
      events: await eventsSince(cancelStart),
      fee: "unknown while in flight; not counted as zero",
    };
    await screenshot("08-cancel");
  } catch (error) {
    const message = redact(error && error.stack ? error.stack : error);
    if (message.includes("VALIDATION_BUDGET_REACHED")) stoppedForBudget = true;
    report.failures.push(message);
  } finally {
    try {
      report.budget.final = await budgetState();
    } catch {
      report.budget.final = report.budget.latest || null;
    }
    report.stoppedForBudget = stoppedForBudget;
    report.startupLogs = startupLogs;
    report.bootstrapTrace = fs.existsSync(bootstrapTrace)
      ? redact(fs.readFileSync(bootstrapTrace, "utf8")).slice(0, 12000)
      : "";
    report.completedAt = new Date().toISOString();
    if (artifactSnapshot) report.artifactSnapshot = artifactSnapshot;
    if (page && subjectDir) {
      report.discoveryDiagnostics = readNdjson(
        path.join(subjectDir, "content", "discovery-diagnostics.ndjson"),
      );
    }
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
    if (app) {
      try {
        await app.close();
      } catch {
        // Ignore close errors after evidence is saved.
      }
    }
    fs.rmSync(electronBootstrap, { force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    console.log(JSON.stringify({
      ok: report.failures.length === 0,
      stoppedForBudget: stoppedForBudget,
      taskCount: Object.keys(report.tasks).length,
      knownThisRunCny: report.budget.final && report.budget.final.thisRunKnownCny,
      resultFile: RESULT_FILE,
    }));
  }
}

main().catch(function (error) {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
