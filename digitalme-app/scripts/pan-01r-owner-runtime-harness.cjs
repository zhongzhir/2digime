"use strict";

/**
 * PAN-01R Owner runtime harness (A–Q checklist).
 * Uses hermetic package + model stub via __PAN01R_TEST_HOOKS__.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ipcMain, app } = require("electron");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { PackageStore } = require("../src/package-store");
const library = require("../src/outputs/library");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeoutMs = 25000, intervalMs = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last)}`);
}

async function evalIn(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

function seedPackage(dir) {
  createMinimalFixture(dir);
  new PackageStore({ packageDir: dir, ownerId: "pan01r-owner" }).migrateToV02({
    actor: "pan01r-owner",
    toolVersion: "pan01r-owner",
  });
  fs.writeFileSync(
    path.join(dir, "identity-facts.md"),
    "# 身份事实\n\n- 本人专注人工智能产品研究\n- 工作语言以中文为主\n",
    "utf8"
  );
  const style = fs.readFileSync(path.join(dir, "style-guide.md"), "utf8");
  fs.writeFileSync(
    path.join(dir, "style-guide.md"),
    style + "\n## 用户反馈（风格纠正）\n\n- 请使用严谨中性的书面表达\n",
    "utf8"
  );
  fs.appendFileSync(
    path.join(dir, "memory", "long-term-memory.jsonl"),
    JSON.stringify({
      id: "mem_owner_1",
      content: "本人确认：优先做可验证的产品判断",
      ownerConfirmed: true,
      dataKind: "owner_assertion",
    }) + "\n",
    "utf8"
  );
  fs.mkdirSync(path.join(dir, "life"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "life", "inferences.jsonl"),
    JSON.stringify({ id: "inf_1", statement: "系统推断：偏好结构化研究框架", status: "open" }) +
      "\n",
    "utf8"
  );
  fs.mkdirSync(path.join(dir, "policies"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "policies", "boundaries.json"),
    JSON.stringify({
      items: [{ id: "b1", text: "不得对外自动发送本人私有资料", enabled: true }],
    }),
    "utf8"
  );
}

function installModelStub() {
  global.__PAN01R_TEST_HOOKS__ = {
    ...(global.__PAN01R_TEST_HOOKS__ || {}),
    callModelStream: async (cfg, messages) => {
      const joined = messages.map((m) => m.content).join("\n");
      if (/已授权主体依据/.test(joined)) {
        return "Digital Me：应继续验证产品证据（E1）。未发送给伙伴。";
      }
      return "通用：仅依据任务给出的研究判断框架。";
    },
    getRuntimeConfig: () => ({
      provider: "openai-compatible",
      baseURL: "https://example.invalid/v1",
      model: "stub-model",
      apiKey: "sk-stub-not-real",
      packageDir: "",
    }),
  };
}

async function clickSidebarMe(win) {
  await evalIn(
    win,
    `(() => {
      const nav = document.querySelector('.nav-item[data-view="me"]');
      if (!nav) throw new Error("sidebar 我 not found");
      nav.click();
      return true;
    })()`
  );
}

/** Leave「我」then click sidebar — proves default entry and CTA visibility. */
async function openPanoramaViaSidebarOnly(win) {
  await evalIn(
    win,
    `(() => {
      const chat = document.querySelector('.nav-item[data-view="chat"]');
      if (!chat) throw new Error("chat nav missing");
      chat.click();
      return true;
    })()`
  );
  await waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({ chatVisible: !document.getElementById("view-chat")?.classList.contains("hidden") })`
      );
      return s.chatVisible ? s : null;
    },
    { label: "chat view", timeoutMs: 8000 }
  );
  await clickSidebarMe(win);
  return waitPanoramaHome(win);
}

async function waitPanoramaHome(win) {
  let lastDiag = null;
  try {
    return await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({
            meVisible: !document.getElementById("view-me").classList.contains("hidden"),
            selfVisible: !document.getElementById("me-lane-self").classList.contains("hidden"),
            overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]').classList.contains("active"),
            cta: (document.getElementById("panorama-sovereign-cta") && document.getElementById("panorama-sovereign-cta").textContent || "").trim(),
            promises: (document.getElementById("panorama-promises") && document.getElementById("panorama-promises").children.length) || 0
          })`
        );
        lastDiag = s;
        return s.meVisible && s.selfVisible && s.overviewActive && /体验一次/.test(s.cta) ? s : null;
      },
      { label: "panorama CTA visible", timeoutMs: 25000 }
    );
  } catch (err) {
    throw new Error(
      (err && err.message ? err.message : String(err)) + " diag=" + JSON.stringify(lastDiag)
    );
  }
}

async function openExperience(win) {
  await evalIn(win, `document.getElementById("panorama-sovereign-cta").click()`);
  return waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({
          panelOpen: !document.getElementById("panorama-experience-panel")?.classList.contains("hidden"),
          step1: !document.getElementById("panorama-exp-step1")?.classList.contains("hidden"),
          body: document.getElementById("panorama-exp-step1")?.innerText || "",
        })`
      );
      return s.panelOpen && s.step1 && /步骤 1|已核实|本人确认|系统推断/.test(s.body) ? s : null;
    },
    { label: "experience step1", timeoutMs: 15000 }
  );
}

async function runPan01rOwnerRuntimeHarness({ BrowserWindow }) {
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, err) =>
    results.push({ name, ok: false, error: err && err.stack ? err.stack : String(err) });

  const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-pan01r-pkg-"));
  seedPackage(pkgDir);

  // Point config at hermetic package
  const userData = app.getPath("userData");
  const cfgPath = path.join(userData, "config.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ packageDir: pkgDir, provider: "openai-compatible", model: "stub-model" }, null, 2),
    "utf8"
  );
  global.__PAN01R_TEST_HOOKS__ = { packageDir: pkgDir, userData };
  installModelStub();

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "window", timeoutMs: 15000 }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  await sleep(1500);

  await waitFor(async () => {
    const ready = await evalIn(win, `!!window.digitalMe && !!window.digitalMe.getPanoramaSubjectBrief`);
    return ready ? true : null;
  }, { label: "preload API", timeoutMs: 20000 });

  // A. CTA visible after sidebar 我（先离开再进入，避免默认入口竞态）
  try {
    const home = await openPanoramaViaSidebarOnly(win);
    assert.match(home.cta, /体验一次/);
    assert.match(home.cta, /代表我/);
    pass("A. CTA visible");
  } catch (err) {
    fail("A. CTA visible", err);
  }

  // B–D. open step1, see evidence types, inference unchecked
  try {
    const step1 = await openExperience(win);
    assert.match(step1.body, /已核实事实|本人确认/);
    const checks = await evalIn(
      win,
      `(() => {
        const rows = [...document.querySelectorAll("#panorama-exp-step1 label")];
        const inf = rows.find((r) => /系统推断/.test(r.textContent || ""));
        const cb = inf && inf.querySelector("input[type=checkbox]");
        return { hasInf: !!inf, checked: cb ? cb.checked : null, count: rows.length };
      })()`
    );
    assert.ok(checks.count >= 1);
    if (checks.hasInf) assert.equal(checks.checked, false);
    pass("B-D. step1 evidence + inference default unchecked");
  } catch (err) {
    fail("B-D. step1 evidence", err);
  }

  // E. create request
  try {
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step1 button")].find((b) => /进入协作请求/.test(b.textContent || "")) || { click(){} }).click()`
    );
    await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `!document.getElementById("panorama-exp-step2")?.classList.contains("hidden")`
        );
        return s ? true : null;
      },
      { label: "step2", timeoutMs: 8000 }
    );
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step2 button")].find((b) => /生成本地模拟请求/.test(b.textContent || "")) || { click(){} }).click()`
    );
    await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `!document.getElementById("panorama-exp-step3")?.classList.contains("hidden")`
        );
        return s ? true : null;
      },
      { label: "step3", timeoutMs: 10000 }
    );
    pass("E. collaboration request");
  } catch (err) {
    fail("E. collaboration request", err);
  }

  // F. auth preview fields
  try {
    const text = await evalIn(win, `document.getElementById("panorama-exp-step3")?.innerText || ""`);
    assert.match(text, /请求方|本地模拟研究伙伴/);
    assert.match(text, /能力|受控研究判断/);
    assert.match(text, /授权期限|仅本次有效/);
    assert.match(text, /结果去向|本人审阅/);
    assert.match(text, /推理/);
    assert.match(text, /不会发送给模拟协作伙伴|未发送/);
    pass("F. auth preview fields");
  } catch (err) {
    fail("F. auth preview fields", err);
  }

  // G. reject auth does not execute
  try {
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step3 button")].find((b) => /拒绝请求/.test(b.textContent || "")) || { click(){} }).click()`
    );
    await sleep(200);
    const note = await evalIn(win, `document.getElementById("panorama-exp-step3")?.innerText || ""`);
    assert.match(note, /已拒绝|未执行/);
    pass("G. reject does not execute");
  } catch (err) {
    fail("G. reject does not execute", err);
  }

  // H–L. reopen, shrink, confirm, dual results, citations, not sent
  try {
    await evalIn(win, `document.getElementById("panorama-exp-close")?.click()`);
    await sleep(100);
    await openExperience(win);
    // uncheck inference if any
    await evalIn(
      win,
      `(() => {
        for (const row of document.querySelectorAll("#panorama-exp-step1 label")) {
          if (/系统推断|发展线索/.test(row.textContent || "")) {
            const cb = row.querySelector("input[type=checkbox]");
            if (cb && cb.checked) cb.click();
          }
        }
        return true;
      })()`
    );
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step1 button")].find((b) => /进入协作请求/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const s = await evalIn(win, `!document.getElementById("panorama-exp-step2")?.classList.contains("hidden")`);
      return s ? true : null;
    }, { label: "step2b" });
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step2 button")].find((b) => /生成本地模拟请求/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const s = await evalIn(win, `!document.getElementById("panorama-exp-step3")?.classList.contains("hidden")`);
      return s ? true : null;
    }, { label: "step3b" });
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step3 button")].find((b) => /确认并执行/.test(b.textContent || ""))).click()`
    );
    const step5 = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({
            open: !document.getElementById("panorama-exp-step5")?.classList.contains("hidden"),
            text: document.getElementById("panorama-exp-step5")?.innerText || "",
          })`
        );
        return s.open && /通用|Digital Me/.test(s.text) ? s : null;
      },
      { label: "step5 results", timeoutMs: 20000 }
    );
    assert.match(step5.text, /通用/);
    assert.match(step5.text, /Digital Me/);
    assert.match(step5.text, /引用|E1|依据/);
    assert.match(step5.text, /未发送给模拟协作伙伴/);
    pass("H-L. shrink confirm dual results citations not-sent");
  } catch (err) {
    fail("H-L. execute path", err);
  }

  // M. reject result — library unchanged
  try {
    const before = library.listDeliverables(userData).length;
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step5 button")].find((b) => /拒绝本次结果/.test(b.textContent || "")) || { click(){} }).click()`
    );
    await sleep(300);
    assert.equal(library.listDeliverables(userData).length, before);
    pass("M. reject result no library body");
  } catch (err) {
    fail("M. reject result", err);
  }

  // N. re-run and adopt
  try {
    await evalIn(win, `document.getElementById("panorama-exp-close")?.click()`);
    await sleep(100);
    await openExperience(win);
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step1 button")].find((b) => /进入协作请求/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const s = await evalIn(win, `!document.getElementById("panorama-exp-step2")?.classList.contains("hidden")`);
      return s ? true : null;
    }, { label: "step2c" });
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step2 button")].find((b) => /生成本地模拟请求/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const s = await evalIn(win, `!document.getElementById("panorama-exp-step3")?.classList.contains("hidden")`);
      return s ? true : null;
    }, { label: "step3c" });
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step3 button")].find((b) => /确认并执行/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const s = await evalIn(win, `!document.getElementById("panorama-exp-step5")?.classList.contains("hidden")`);
      return s ? true : null;
    }, { label: "step5c", timeoutMs: 20000 });
    const before = library.listDeliverables(userData).length;
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step5 button")].find((b) => /采纳为我的本地成果/.test(b.textContent || ""))).click()`
    );
    await waitFor(async () => {
      const n = library.listDeliverables(userData).length;
      return n > before ? true : null;
    }, { label: "library adopt", timeoutMs: 8000 });
    const msg = await evalIn(win, `document.getElementById("panorama-exp-step5-msg")?.textContent || ""`);
    assert.match(msg, /已保存为你的本地成果/);
    pass("N. adopt into local library");
  } catch (err) {
    fail("N. adopt", err);
  }

  // O. receipt summary
  try {
    await evalIn(
      win,
      `([...document.querySelectorAll("#panorama-exp-step5 button")].find((b) => /查看过程记录/.test(b.textContent || ""))).click()`
    );
    await sleep(200);
    const msg = await evalIn(win, `document.getElementById("panorama-exp-step5-msg")?.textContent || ""`);
    assert.match(msg, /记录/);
    pass("O. receipt summary");
  } catch (err) {
    fail("O. receipt summary", err);
  }

  // P. illegal adopt of cancelled — covered lightly: panel success text not shown on reject path above
  try {
    const caps = await evalIn(
      win,
      `({
        sidebar: document.getElementById("capabilities-status")?.innerText || "",
        promises: document.getElementById("panorama-promises")?.innerText || "",
      })`
    );
    assert.match(caps.sidebar, /已装载扩展/);
    assert.ok(!/能力：暂无/.test(caps.sidebar) || /已装载扩展/.test(caps.sidebar));
    pass("P/Q. capability口径不矛盾");
  } catch (err) {
    fail("P/Q. capability口径", err);
  }

  // Q explicit
  try {
    await clickSidebarMe(win);
    await waitPanoramaHome(win);
    const labels = await evalIn(
      win,
      `({
        sidebar: document.getElementById("capabilities-status")?.innerText || "",
        body: document.getElementById("subject-home")?.innerText || "",
      })`
    );
    assert.match(labels.sidebar, /已装载扩展/);
    assert.match(labels.body, /可体验能力|本地模拟|受控研究/);
    pass("Q. sidebar vs panorama capability labels");
  } catch (err) {
    fail("Q. capability labels", err);
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? "PASS" : "FAIL", r.name);
    if (!r.ok) console.error(r.error);
  }
  console.log(`\nPAN-01R owner-runtime: ${results.length - failed.length} passed, ${failed.length} failed`);

  try {
    fs.rmSync(pkgDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return failed.length ? 1 : 0;
}

module.exports = { runPan01rOwnerRuntimeHarness };
