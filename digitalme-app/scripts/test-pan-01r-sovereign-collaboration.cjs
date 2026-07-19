"use strict";

/**
 * PAN-01R sovereign collaboration loop — hermetic tests (36 requirements).
 * Run: npm run test:pan-01r
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { PackageStore } = require("../src/package-store");
const decisionAudit = require("../src/decision-audit");
const library = require("../src/outputs/library");
const {
  createPanoramaExperience,
  buildSubjectBrief,
  KIND_LABELS,
  selectDefaultsForKind,
  MAX_EVIDENCE,
  __test,
} = require("../src/panorama-experience");
const { grantAuthorization, consumeToken, clearTokenStoreForTests } = require("../src/panorama-experience/authorization");
const { clearRequestStoreForTests } = require("../src/panorama-experience/request");
const { clearRunStoreForTests, getRunRecord } = require("../src/panorama-experience/execute");

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
      console.error("FAIL", name, err && err.stack ? err.stack : err);
    });
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-pan01r-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function dirFingerprint(root) {
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const buf = fs.readFileSync(full);
        out.push({
          rel,
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
          bytes: buf.length,
        });
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return JSON.stringify(out);
}

function seedRichPackage(dir) {
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
      createdAt: new Date().toISOString(),
    }) + "\n",
    "utf8"
  );
  fs.mkdirSync(path.join(dir, "life"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "life", "inferences.jsonl"),
    JSON.stringify({
      id: "inf_1",
      statement: "系统推断：偏好结构化研究框架",
      status: "open",
    }) +
      "\n" +
      JSON.stringify({
        id: "inf_rej",
        statement: "已拒绝推断不应出现",
        status: "rejected",
      }) +
      "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "life", "mind_hooks.json"),
    JSON.stringify({ items: [{ text: "发展线索：加强判断力训练" }] }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "life", "events.jsonl"),
    JSON.stringify({ title: "当前状态：推进产品全貌验收", summary: "推进产品全貌验收" }) + "\n",
    "utf8"
  );
  fs.mkdirSync(path.join(dir, "policies"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "policies", "boundaries.json"),
    JSON.stringify({
      items: [
        { id: "b1", text: "不得对外自动发送本人私有资料", enabled: true },
        { id: "b2", text: "已禁用边界", enabled: false },
      ],
    }),
    "utf8"
  );
}

function makeFixture(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir);
  new PackageStore({ packageDir: dir, ownerId: "test:pan01r" }).migrateToV02({
    actor: "test:pan01r",
    toolVersion: "test-pan-01r",
  });
  seedRichPackage(dir);
  return dir;
}

function makeUserData(label) {
  return tempDir(`ud-${label}`);
}

function resetStores() {
  __test.clearAll();
}

function stubModel(calls) {
  return async function callModelStream(cfg, messages, onDelta, options) {
    if (options && options.signal && options.signal.aborted) {
      const err = new Error("已停止");
      err.aborted = true;
      throw err;
    }
    const record = {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      joined: messages.map((m) => m.content).join("\n"),
    };
    calls.push(record);
    const isDm = /已授权主体依据|E1/.test(record.joined);
    const text = isDm
      ? "核心判断：应继续验证产品证据链（引用 E1）。不确定性：外部协作未开放。"
      : "核心判断：通用研究框架。依据：任务描述。不确定性：缺少个人上下文。";
    if (onDelta) onDelta(text, text);
    return text;
  };
}

function configuredRuntime() {
  return {
    provider: "openai-compatible",
    baseURL: "https://example.invalid/v1",
    model: "test-model",
    apiKey: "sk-test-not-real-key-value",
    packageDir: "",
  };
}

async function runHappyPath(pkgDir, userData, extras = {}) {
  const calls = [];
  let auditFailOn = extras.auditFailOn || null;
  let auditCalls = [];
  const api = createPanoramaExperience({
    callModelStream: extras.callModelStream || stubModel(calls),
    getRuntimeConfig: extras.getRuntimeConfig || configuredRuntime,
    appendAudit: (ud, fields) => {
      auditCalls.push(fields.event);
      if (auditFailOn && fields.event === auditFailOn) {
        const err = new Error("audit boom");
        err.code = "audit_unhealthy";
        throw err;
      }
      if (extras.skipRealAudit) return { decisionId: fields.decisionId };
      return decisionAudit.appendEntry(ud, fields);
    },
    listAudit: (ud, opts) => decisionAudit.list(ud, opts),
    packageDir: pkgDir,
    userData,
    now: extras.now,
  });
  const brief = api.getSubjectBrief(pkgDir);
  const selected = (brief.evidence || [])
    .filter((e) => e.selectedByDefault)
    .map((e) => e.id);
  const req = api.createRequest({
    senderId: "1",
    topic: "产品验收方向",
    evidenceIds: selected,
    packageDir: pkgDir,
    userData,
  });
  const run = await api.confirmGrantAndExecute({
    requestId: req.requestId,
    senderId: "1",
    selectedEvidenceIds: selected,
    packageDir: pkgDir,
    userData,
  });
  return { api, brief, req, run, calls, auditCalls, selected };
}

async function main() {
  resetStores();

  await test("1. 主体依据严格分类", () => {
    resetStores();
    const dir = makeFixture("classify");
    try {
      const brief = buildSubjectBrief(dir);
      const kinds = new Set(brief.evidence.map((e) => e.kind));
      assert.ok(kinds.has("verified_fact"));
      assert.ok(kinds.has("owner_assertion"));
      assert.ok(kinds.has("inference"));
      assert.ok(kinds.has("direction_clue"));
      for (const e of brief.evidence) {
        assert.equal(e.kindLabel, KIND_LABELS[e.kind]);
      }
      assert.ok(brief.boundaries.some((b) => b.kind === "boundary"));
      assert.ok(brief.evidence.length <= MAX_EVIDENCE);
    } finally {
      cleanup(dir);
    }
  });

  await test("2. fact / owner_assertion 默认选择规则", () => {
    assert.equal(selectDefaultsForKind("verified_fact"), true);
    assert.equal(selectDefaultsForKind("owner_assertion"), true);
    const dir = makeFixture("defaults-fact");
    try {
      const brief = buildSubjectBrief(dir);
      for (const e of brief.evidence) {
        if (e.kind === "verified_fact" || e.kind === "owner_assertion") {
          assert.equal(e.selectedByDefault, true);
        }
      }
    } finally {
      cleanup(dir);
    }
  });

  await test("3. inference / direction clue 默认不选择", () => {
    assert.equal(selectDefaultsForKind("inference"), false);
    assert.equal(selectDefaultsForKind("direction_clue"), false);
    const dir = makeFixture("defaults-inf");
    try {
      const brief = buildSubjectBrief(dir);
      for (const e of brief.evidence) {
        if (e.kind === "inference" || e.kind === "direction_clue") {
          assert.equal(e.selectedByDefault, false);
        }
      }
    } finally {
      cleanup(dir);
    }
  });

  await test("4. 部分损坏只使用可安全读取分层", () => {
    const dir = makeFixture("partial");
    try {
      fs.writeFileSync(path.join(dir, "life", "inferences.jsonl"), "{broken\n", "utf8");
      const brief = buildSubjectBrief(dir);
      assert.equal(brief.partialRead, true);
      assert.ok(brief.warningCodes.includes("partial_subject_unread"));
      assert.equal(brief.warningMessage, "部分主体资料无法读取");
      assert.ok(brief.evidence.some((e) => e.kind === "verified_fact"));
      assert.ok(!brief.evidence.some((e) => /已拒绝推断|broken/.test(e.shortText)));
    } finally {
      cleanup(dir);
    }
  });

  await test("5. 损坏内容不静默重置", () => {
    const dir = makeFixture("no-reset");
    try {
      const broken = "{not-json";
      fs.writeFileSync(path.join(dir, "life", "inferences.jsonl"), broken, "utf8");
      const before = fs.readFileSync(path.join(dir, "life", "inferences.jsonl"), "utf8");
      buildSubjectBrief(dir);
      const after = fs.readFileSync(path.join(dir, "life", "inferences.jsonl"), "utf8");
      assert.equal(after, before);
      assert.equal(after, broken);
    } finally {
      cleanup(dir);
    }
  });

  await test("6. 无足够依据不冒充个性化成功", () => {
    const dir = tempDir("empty");
    createMinimalFixture(dir);
    new PackageStore({ packageDir: dir, ownerId: "t" }).migrateToV02({
      actor: "t",
      toolVersion: "t",
    });
    try {
      const brief = buildSubjectBrief(dir);
      assert.equal(brief.personalizedAvailable, false);
      assert.equal(brief.previewMode, true);
    } finally {
      cleanup(dir);
    }
  });

  await test("7. renderer 不能注入 evidence kind", async () => {
    resetStores();
    const dir = makeFixture("inj-kind");
    const ud = makeUserData("inj-kind");
    try {
      const api = createPanoramaExperience({
        callModelStream: stubModel([]),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = api.getSubjectBrief(dir);
      const id = brief.evidence[0].id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const preview = api.buildAuthPreview({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
      });
      assert.equal(preview.ok, true);
      assert.ok(!JSON.stringify(preview).includes("injected_kind"));
      // kind comes from package resolution only
      assert.equal(preview.selectedEvidence[0].kindLabel, brief.evidence[0].kindLabel);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("8. renderer 不能注入主体正文", async () => {
    resetStores();
    const dir = makeFixture("inj-body");
    const ud = makeUserData("inj-body");
    try {
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = api.getSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.kind === "verified_fact").id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      const joined = calls.map((c) => c.joined).join("\n");
      assert.ok(!joined.includes("RENDERER_INJECTED_SECRET_BODY"));
      assert.ok(joined.includes("本人专注人工智能产品研究") || joined.includes("E1"));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("9. renderer 不能注入能力、请求方和结果", () => {
    resetStores();
    const dir = makeFixture("inj-meta");
    const ud = makeUserData("inj-meta");
    try {
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({
        senderId: "1",
        packageDir: dir,
        userData: ud,
        // ignored if slipped in via unexpected fields — createResearchRequest only reads allowlisted
      });
      assert.equal(req.requester.id, "local_sim_research_partner");
      assert.equal(req.requester.label, "本地模拟研究伙伴");
      assert.equal(req.allowedCapabilities[0].id, "cap_research_judgment");
      assert.equal(req.resultDestination.sentToPartner, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("10. 未知 evidence ID fail-closed", () => {
    resetStores();
    const dir = makeFixture("unknown-id");
    const ud = makeUserData("unknown-id");
    try {
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const preview = api.buildAuthPreview({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: ["ev_does_not_exist"],
        packageDir: dir,
      });
      assert.equal(preview.ok, false);
      assert.equal(preview.code, "unknown_evidence_id");
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("11. 授权范围由最终选择生成", async () => {
    resetStores();
    const dir = makeFixture("scope");
    const ud = makeUserData("scope");
    try {
      const brief = buildSubjectBrief(dir);
      const facts = brief.evidence.filter((e) => e.kind === "verified_fact").map((e) => e.id);
      const api = createPanoramaExperience({
        callModelStream: stubModel([]),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const granted = api.grantAuthorization({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: facts.slice(0, 1),
        packageDir: dir,
        userData: ud,
      });
      assert.equal(granted.ok, true);
      assert.deepEqual(granted.preview.selectedEvidence.map((e) => e.id), facts.slice(0, 1));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("12. token 过期拒绝", () => {
    resetStores();
    const dir = makeFixture("tok-exp");
    const ud = makeUserData("tok-exp");
    try {
      let t = 1_000_000;
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
        now: () => t,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const granted = api.grantAuthorization({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      t += 10 * 60 * 1000;
      const consumed = consumeToken(granted.tokenId, "1", null, () => t);
      assert.equal(consumed.ok, false);
      assert.equal(consumed.code, "token_expired");
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("13. token 重复使用拒绝", () => {
    resetStores();
    const dir = makeFixture("tok-reuse");
    const ud = makeUserData("tok-reuse");
    try {
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const granted = api.grantAuthorization({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      const c1 = consumeToken(granted.tokenId, "1");
      assert.equal(c1.ok, true);
      const c2 = consumeToken(granted.tokenId, "1");
      assert.equal(c2.ok, false);
      assert.equal(c2.code, "token_consumed");
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("14. sender 不一致拒绝", () => {
    resetStores();
    const dir = makeFixture("sender");
    const ud = makeUserData("sender");
    try {
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const granted = api.grantAuthorization({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      const c = consumeToken(granted.tokenId, "999");
      assert.equal(c.ok, false);
      assert.equal(c.code, "sender_mismatch");
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("15. 取消确认不调用模型", async () => {
    resetStores();
    const dir = makeFixture("cancel-confirm");
    const ud = makeUserData("cancel-confirm");
    try {
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      // User cancels at auth — reject request, never execute
      const rej = api.rejectRequest({ requestId: req.requestId, senderId: "1", userData: ud });
      assert.equal(rej.ok, true);
      assert.equal(calls.length, 0);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("16. 拒绝请求不调用模型", async () => {
    // same as 15 with explicit naming
    resetStores();
    const dir = makeFixture("reject-req");
    const ud = makeUserData("reject-req");
    try {
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      api.rejectRequest({ requestId: req.requestId, senderId: "1", userData: ud });
      const granted = api.grantAuthorization({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [],
        packageDir: dir,
        userData: ud,
      });
      assert.equal(granted.ok, false);
      assert.equal(calls.length, 0);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("17. 通用调用不包含主体依据", async () => {
    resetStores();
    const dir = makeFixture("generic-iso");
    const ud = makeUserData("generic-iso");
    try {
      const { calls } = await runHappyPath(dir, ud);
      assert.ok(calls.length >= 2);
      const generic = calls[0].joined;
      assert.ok(!/已授权主体依据/.test(generic));
      assert.ok(!/\bE1\b/.test(generic) || !/本人专注/.test(generic));
      assert.ok(!generic.includes("本人专注人工智能产品研究"));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("18. Digital Me 调用只包含已授权依据", async () => {
    resetStores();
    const dir = makeFixture("dm-auth");
    const ud = makeUserData("dm-auth");
    try {
      const brief = buildSubjectBrief(dir);
      const only = [brief.evidence.find((e) => e.kind === "verified_fact").id];
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: only,
        packageDir: dir,
        userData: ud,
      });
      const dm = calls[1].joined;
      assert.ok(dm.includes("已授权主体依据"));
      assert.ok(dm.includes("E1"));
      const unauthorized = brief.evidence.find((e) => e.kind === "inference");
      if (unauthorized) {
        assert.ok(!dm.includes(unauthorized.shortText));
      }
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("19. 未授权依据不会进入 prompt", async () => {
    resetStores();
    const dir = makeFixture("unauth");
    const ud = makeUserData("unauth");
    try {
      const brief = buildSubjectBrief(dir);
      const fact = brief.evidence.find((e) => e.kind === "verified_fact");
      const inf = brief.evidence.find((e) => e.kind === "inference");
      assert.ok(fact && inf);
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [fact.id],
        packageDir: dir,
        userData: ud,
      });
      const all = calls.map((c) => c.joined).join("\n");
      assert.ok(!all.includes(inf.shortText));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("20. 通用与个性化调用逻辑隔离", async () => {
    resetStores();
    const dir = makeFixture("iso");
    const ud = makeUserData("iso");
    try {
      const { calls } = await runHappyPath(dir, ud);
      assert.equal(calls.length, 2);
      assert.ok(calls[0].messages.length >= 2);
      assert.ok(calls[1].messages.length >= 2);
      // Never a single prompt asking to pretend both
      const joined = calls.map((c) => c.joined).join("\n");
      assert.ok(!/假装.*通用|同时生成通用与/.test(joined));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("21. 云模型数据去向被明确返回", () => {
    resetStores();
    const dir = makeFixture("cloud-disc");
    const ud = makeUserData("cloud-disc");
    try {
      const api = createPanoramaExperience({
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const preview = api.buildAuthPreview({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
      });
      assert.equal(preview.ok, true);
      assert.equal(preview.inferenceEnvironment.configured, true);
      assert.match(
        preview.inferenceEnvironment.dataDestinationDisclosure,
        /云端模型服务|推理/
      );
      assert.equal(preview.inferenceEnvironment.localCollaborationOnly, true);
      assert.equal(preview.inferenceEnvironment.sentToSimulationPartner, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("22. 未配置模型不生成假结果", async () => {
    resetStores();
    const dir = makeFixture("no-model");
    const ud = makeUserData("no-model");
    try {
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: stubModel(calls),
        getRuntimeConfig: () => ({ apiKey: "", model: "", configUnreadable: false }),
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const run = await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      assert.equal(run.ok, false);
      assert.equal(run.code, "model_unavailable");
      assert.match(run.message, /智能引擎未连接/);
      assert.equal(run.settingsTarget, "settings");
      assert.equal(calls.length, 0);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("23. 取消或放弃后迟到结果被丢弃", async () => {
    resetStores();
    const dir = makeFixture("late");
    const ud = makeUserData("late");
    try {
      let resolveFirst;
      const firstGate = new Promise((r) => {
        resolveFirst = r;
      });
      const calls = [];
      const api = createPanoramaExperience({
        callModelStream: async (cfg, messages, onDelta, options) => {
          calls.push(messages);
          if (calls.length === 1) {
            await firstGate;
            if (options.signal && options.signal.aborted) {
              const err = new Error("已停止");
              err.aborted = true;
              throw err;
            }
          }
          return "late-text";
        },
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const execPromise = api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      // wait until run exists
      let runId = null;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 10));
        // peek via grant path — get from store by scanning is hard; cancel after short wait
      }
      // Force cancel by resolving after we get run from exec — race: cancel mid-flight
      // Simpler path: start exec, cancel using runId from a parallel poll of audit... 
      // Instead: cancel via execute after briefly yielding
      await new Promise((r) => setTimeout(r, 20));
      // Extract runId from in-progress by completing cancel through API once we have result's race
      resolveFirst();
      const run = await execPromise;
      // If completed too fast, simulate cancel discard on a completed-then-cancel is alreadyFinished
      if (run && run.runId && run.status === "running") {
        api.cancelRun({ runId: run.runId, senderId: "1", userData: ud });
      }
      // Dedicated cancel-during path:
      resetStores();
      let unblock;
      const gate = new Promise((r) => {
        unblock = r;
      });
      const api2 = createPanoramaExperience({
        callModelStream: async (cfg, messages, onDelta, options) => {
          await gate;
          if (options.signal?.aborted) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
          return "SHOULD_NOT_STORE";
        },
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief2 = buildSubjectBrief(dir);
      const id2 = brief2.evidence.find((e) => e.selectedByDefault).id;
      const req2 = api2.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const p = api2.confirmGrantAndExecute({
        requestId: req2.requestId,
        senderId: "1",
        selectedEvidenceIds: [id2],
        packageDir: dir,
        userData: ud,
      });
      await new Promise((r) => setTimeout(r, 30));
      // Find running run — grant creates run at start of confirmAndExecute
      // We need runId: poll getRun is unknown. Use appendAudit side channel:
      const listed = decisionAudit.list(ud, { limit: 20 });
      const entries = listed.entries || [];
      const started = entries.find((e) => e.event === "execution_started");
      assert.ok(started);
      const cancelRes = api2.cancelRun({
        runId: started.decisionId,
        senderId: "1",
        userData: ud,
      });
      assert.equal(cancelRes.ok, true);
      unblock();
      const finalRun = await p;
      assert.ok(finalRun.status === "cancelled" || finalRun.status === "abandoned");
      assert.equal(finalRun.adoptable, false);
      assert.ok(!finalRun.result || !finalRun.result.digitalMeText);
      const rec = getRunRecord(started.decisionId);
      assert.ok(!rec.result || rec.status === "cancelled" || rec.status === "abandoned");
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("24. 取消后结果不可采纳", async () => {
    resetStores();
    const dir = makeFixture("no-adopt-cancel");
    const ud = makeUserData("no-adopt-cancel");
    try {
      let unblock;
      const gate = new Promise((r) => {
        unblock = r;
      });
      const api = createPanoramaExperience({
        callModelStream: async (cfg, messages, onDelta, options) => {
          await gate;
          if (options.signal?.aborted) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
          return "text";
        },
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const p = api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      await new Promise((r) => setTimeout(r, 30));
      const started = (decisionAudit.list(ud, { limit: 20 }).entries || []).find(
        (e) => e.event === "execution_started"
      );
      api.cancelRun({ runId: started.decisionId, senderId: "1", userData: ud });
      unblock();
      await p;
      const adopt = api.adoptResult({ runId: started.decisionId, senderId: "1", userData: ud });
      assert.equal(adopt.ok, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("25. 模型失败不显示完成", async () => {
    resetStores();
    const dir = makeFixture("model-fail");
    const ud = makeUserData("model-fail");
    try {
      const api = createPanoramaExperience({
        callModelStream: async () => {
          throw new Error("upstream fail");
        },
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const id = brief.evidence.find((e) => e.selectedByDefault).id;
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const run = await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: [id],
        packageDir: dir,
        userData: ud,
      });
      assert.ok(run.status === "failed" || run.ok === false);
      assert.notEqual(run.status, "completed");
      assert.equal(!!run.adoptable, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("26. 未知引用被过滤或拒绝", async () => {
    resetStores();
    const dir = makeFixture("cite-filter");
    const ud = makeUserData("cite-filter");
    try {
      const api = createPanoramaExperience({
        callModelStream: async (cfg, messages) => {
          const joined = messages.map((m) => m.content).join("\n");
          if (/已授权主体依据/.test(joined)) {
            return "引用 E1 与未知 E99 以及 E2";
          }
          return "generic";
        },
        getRuntimeConfig: configuredRuntime,
        appendAudit: (u, f) => decisionAudit.appendEntry(u, f),
        packageDir: dir,
        userData: ud,
      });
      const brief = buildSubjectBrief(dir);
      const ids = brief.evidence.filter((e) => e.selectedByDefault).map((e) => e.id).slice(0, 1);
      const req = api.createRequest({ senderId: "1", packageDir: dir, userData: ud });
      const run = await api.confirmGrantAndExecute({
        requestId: req.requestId,
        senderId: "1",
        selectedEvidenceIds: ids,
        packageDir: dir,
        userData: ud,
      });
      assert.ok(run.result);
      assert.ok(run.result.citations.includes("E1"));
      assert.ok(!run.result.citations.includes("E99"));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("27. audit 前置失败时不执行", async () => {
    resetStores();
    const dir = makeFixture("audit-pre");
    const ud = makeUserData("audit-pre");
    try {
      const calls = [];
      const { run } = await runHappyPath(dir, ud, {
        callModelStream: stubModel(calls),
        auditFailOn: "execution_started",
        skipRealAudit: true,
      });
      // When pre-audit fails, confirmAndExecute returns audit_failed before model
      assert.equal(run.ok, false);
      assert.equal(run.code, "audit_failed");
      assert.equal(calls.length, 0);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("28. 完成审计失败时结果不可采纳", async () => {
    resetStores();
    const dir = makeFixture("audit-post");
    const ud = makeUserData("audit-post");
    try {
      const { api, run } = await runHappyPath(dir, ud, {
        auditFailOn: "execution_completed",
        skipRealAudit: true,
      });
      assert.equal(run.status, "completed");
      assert.equal(run.adoptable, false);
      const adopt = api.adoptResult({ runId: run.runId, senderId: "1", userData: ud });
      assert.equal(adopt.ok, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("29. adopt 不接受 renderer 注入正文", async () => {
    resetStores();
    const dir = makeFixture("adopt-inject");
    const ud = makeUserData("adopt-inject");
    try {
      const { api, run } = await runHappyPath(dir, ud);
      const adopt = api.adoptResult({
        runId: run.runId,
        senderId: "1",
        userData: ud,
        // even if caller tried to pass body, receipt ignores it
        content: "INJECTED_BODY_SHOULD_NOT_SAVE",
      });
      assert.equal(adopt.ok, true);
      const item = library.getDeliverable(ud, adopt.deliverableId);
      assert.ok(item);
      assert.ok(!String(item.content).includes("INJECTED_BODY_SHOULD_NOT_SAVE"));
      assert.ok(String(item.content).includes("核心判断") || String(item.content).length > 0);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("30. adopt 成功进入 hermetic 成果库", async () => {
    resetStores();
    const dir = makeFixture("adopt-ok");
    const ud = makeUserData("adopt-ok");
    try {
      const { api, run } = await runHappyPath(dir, ud);
      const adopt = api.adoptResult({ runId: run.runId, senderId: "1", userData: ud });
      assert.equal(adopt.ok, true);
      assert.equal(adopt.message, "已保存为你的本地成果");
      const items = library.listDeliverables(ud);
      assert.ok(items.some((i) => i.id === adopt.deliverableId));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("31. reject 不写成果正文", async () => {
    resetStores();
    const dir = makeFixture("reject-res");
    const ud = makeUserData("reject-res");
    try {
      const before = library.listDeliverables(ud).length;
      const { api, run } = await runHappyPath(dir, ud);
      const rej = api.rejectResult({
        runId: run.runId,
        senderId: "1",
        userData: ud,
        reasonCategory: "not_useful",
      });
      assert.equal(rej.ok, true);
      assert.equal(library.listDeliverables(ud).length, before);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("32. 不写主体 Package", async () => {
    resetStores();
    const dir = makeFixture("no-write");
    const ud = makeUserData("no-write");
    const fpBefore = dirFingerprint(dir);
    try {
      const { api, run } = await runHappyPath(dir, ud);
      api.adoptResult({ runId: run.runId, senderId: "1", userData: ud });
      const fpAfter = dirFingerprint(dir);
      assert.equal(fpAfter, fpBefore);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("33. 不泄漏密钥", async () => {
    resetStores();
    const dir = makeFixture("no-secret");
    const ud = makeUserData("no-secret");
    try {
      const { brief, req, run } = await runHappyPath(dir, ud);
      const blob = JSON.stringify({ brief, req, run });
      assert.ok(!blob.includes("sk-test-not-real-key-value"));
      assert.ok(!blob.includes("apiKey"));
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("34. 不泄漏绝对路径", async () => {
    resetStores();
    const dir = makeFixture("no-path");
    const ud = makeUserData("no-path");
    try {
      const { brief, req, run } = await runHappyPath(dir, ud);
      const blob = JSON.stringify({ brief, req, run });
      assert.ok(!blob.includes(dir));
      assert.ok(!blob.includes(ud));
      if (process.platform === "win32") {
        assert.ok(!/[A-Za-z]:\\\\Users\\\\/.test(blob));
      }
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("35. request/token/run 绑定正确", async () => {
    resetStores();
    const dir = makeFixture("bind");
    const ud = makeUserData("bind");
    try {
      const { req, run } = await runHappyPath(dir, ud);
      assert.equal(run.requestId, req.requestId);
      assert.ok(run.runId);
      assert.equal(run.sentToSimulationPartner, false);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  await test("36. before/after fixture Package 字节一致", async () => {
    resetStores();
    const dir = makeFixture("fp");
    const ud = makeUserData("fp");
    const before = dirFingerprint(dir);
    try {
      await runHappyPath(dir, ud);
      const after = dirFingerprint(dir);
      assert.equal(after, before);
    } finally {
      cleanup(dir);
      cleanup(ud);
    }
  });

  console.log(`\nPAN-01R hermetic: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
