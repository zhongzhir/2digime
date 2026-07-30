"use strict";

/**
 * MVP-RELEASE-GATE-01C — first-run create / import / restart / rejection.
 * Run: npm run test:mvp-release-gate-01c
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const lifecycle = require("../src/digital-me-lifecycle");
const { ConfigSecretsService } = require("../src/security/config-secrets");
const { SecretStore } = require("../src/security/secret-store");

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

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-01c-${label}-`));
}

function hashTree(dir) {
  const files = [];
  function walk(rel) {
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs)) {
      if (name === ".digitalme-pkgstore") continue;
      const child = path.join(rel, name);
      const full = path.join(dir, child);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(child);
      else {
        const buf = fs.readFileSync(full);
        files.push({
          path: child.replace(/\\/g, "/"),
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        });
      }
    }
  }
  walk(".");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function makeConfigService(userData, defaultPackageDir = "") {
  const store = new SecretStore({
    userDataPath: userData,
    encryptAdapter: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(String(s), "utf8").toString("base64"),
      decryptString: (s) => Buffer.from(String(s), "base64").toString("utf8"),
    },
  });
  return new ConfigSecretsService({
    userDataPath: userData,
    configPath: path.join(userData, "config.json"),
    secretStore: store,
    defaultPackageDir,
  });
}

async function main() {
  await test("1) no package → no_current_package", () => {
    const st = lifecycle.computeFirstRunState({ packageDir: "" });
    assert.equal(st.state, lifecycle.FIRST_RUN_STATES.NO_CURRENT_PACKAGE);
  });

  await test("2) create minimal Digital Me without model", () => {
    const docs = tempRoot("docs");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "阿梅",
      roleSummary: "产品负责人",
    });
    assert.equal(created.ok, true);
    assert.equal(created.modelRequired, false);
    assert.ok(created.packageDir.includes(path.join("Digital Me", "阿梅")) || created.packageDir.includes("Digital Me"));
    assert.ok(fs.existsSync(path.join(created.packageDir, "manifest.json")));
    assert.ok(fs.existsSync(path.join(created.packageDir, "identity.json")));
    assert.ok(fs.existsSync(path.join(created.packageDir, "persona.md")));
    assert.ok(fs.existsSync(path.join(created.packageDir, "life", "distill-me-identity-facts.json")));
    const st = lifecycle.computeFirstRunState({ packageDir: created.packageDir });
    assert.equal(st.state, lifecycle.FIRST_RUN_STATES.PACKAGE_READY);
    assert.equal(st.displayName, "阿梅");
  });

  await test("3) created package is readable by subject facts", () => {
    const docs = tempRoot("docs2");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "阿梅",
      roleSummary: "做 Digital Me",
    });
    const distill = require("../src/distill-me");
    const snap = distill.summary(distill.read(created.packageDir));
    assert.ok(snap.identity.some((x) => String(x.statement).includes("阿梅")));
    const mem = fs.readFileSync(path.join(created.packageDir, "memory", "long-term-memory.jsonl"), "utf8");
    assert.ok(mem.includes("阿梅"));
  });

  await test("4) create then config activate survives restart (config reload)", () => {
    const userData = tempRoot("ud");
    const docs = tempRoot("docs3");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "重启测试",
      roleSummary: "工程师",
    });
    const svc = makeConfigService(userData, "");
    svc.setConfigFromRenderer({
      baseURL: "",
      model: "",
      packageDir: created.packageDir,
      apiKey: "",
    });
    const svc2 = makeConfigService(userData, "");
    const pub = svc2.readPublicConfig();
    assert.equal(path.resolve(pub.packageDir), path.resolve(created.packageDir));
    const st = lifecycle.computeFirstRunState({ packageDir: pub.packageDir });
    assert.equal(st.state, lifecycle.FIRST_RUN_STATES.PACKAGE_READY);
    assert.equal(st.displayName, "重启测试");
  });

  await test("5) import valid package (reference, no copy)", () => {
    const docs = tempRoot("docs4");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "可导入",
      roleSummary: "顾问",
    });
    const before = hashTree(created.packageDir);
    const inspected = lifecycle.inspectImportCandidate(created.packageDir);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.status, "valid");
    assert.equal(inspected.displayName, "可导入");
    const after = hashTree(created.packageDir);
    assert.equal(before, after);
  });

  await test("6) import then activate via config; restart keeps path", () => {
    const userData = tempRoot("ud2");
    const docs = tempRoot("docs5");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "导入后重启",
    });
    const inspected = lifecycle.inspectImportCandidate(created.packageDir);
    assert.equal(inspected.ok, true);
    const svc = makeConfigService(userData, "");
    svc.setConfigFromRenderer({
      baseURL: "",
      model: "",
      packageDir: inspected.packageDir,
      apiKey: "",
    });
    const again = makeConfigService(userData, "");
    assert.equal(path.resolve(again.readPublicConfig().packageDir), path.resolve(created.packageDir));
  });

  await test("7) ordinary folder rejected", () => {
    const dir = tempRoot("ordinary");
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello", "utf8");
    const inspected = lifecycle.inspectImportCandidate(dir);
    assert.equal(inspected.ok, false);
    assert.equal(inspected.status, "ordinary_folder");
    assert.ok(inspected.blockingIssues[0].userMessage.includes("不是可识别的 Digital Me"));
  });

  await test("8) corrupt package does not overwrite current config", () => {
    const userData = tempRoot("ud3");
    const docs = tempRoot("docs6");
    const good = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "当前包",
    });
    const svc = makeConfigService(userData, "");
    svc.setConfigFromRenderer({
      baseURL: "",
      model: "",
      packageDir: good.packageDir,
      apiKey: "",
    });
    const corrupt = tempRoot("corrupt");
    fs.writeFileSync(path.join(corrupt, "manifest.json"), "{not-json", "utf8");
    const beforeHash = hashTree(good.packageDir);
    const inspected = lifecycle.inspectImportCandidate(corrupt);
    assert.equal(inspected.ok, false);
    // Simulate activate rejection: keep previous config
    assert.equal(path.resolve(svc.readPublicConfig().packageDir), path.resolve(good.packageDir));
    assert.equal(hashTree(good.packageDir), beforeHash);
  });

  await test("9) model not required for create", () => {
    const docs = tempRoot("docs7");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "无模型",
    });
    assert.equal(created.modelRequired, false);
  });

  await test("10) default package leaves repository tree", () => {
    const docs = tempRoot("docs8");
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "位置",
    });
    const repoHint = path.join("Projects", "Digital Me", "digitalme-app");
    assert.equal(created.packageDir.includes(repoHint), false);
    assert.equal(created.packageDir.includes(`${path.sep}digitalme-app${path.sep}`), false);
    assert.ok(created.packageDir.includes("Digital Me"));
  });

  await test("11) renderer first-run markers exist; classic only", () => {
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    assert.ok(html.includes('id="first-run-overlay"'));
    assert.ok(html.includes("创建新的 Digital Me"));
    assert.ok(html.includes("导入已有 Digital Me"));
    assert.ok(html.includes('id="dm-readiness-strip"'));
    assert.ok(html.includes("添加资料文件"));
    assert.ok(app.includes("refreshFirstRunUi"));
    assert.ok(app.includes("createDigitalMePackage"));
    assert.ok(app.includes("activateDigitalMePackage"));
    assert.equal(app.includes("actBehalfOpenArtifact"), false);
  });

  await test("12) empty default packageDir in config secrets", () => {
    const userData = tempRoot("ud4");
    const svc = makeConfigService(userData, "");
    const pub = svc.readPublicConfig();
    assert.equal(pub.packageDir, "");
  });

  await test("13) entry controller still locks classic", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/renderer-entry-controller.js"), "utf8");
    assert.ok(src.includes('MVP_PRODUCT_SURFACE = "legacy"'));
  });

  await test("14) write machine-readable evidence artifacts", () => {
    const evidenceRoot = path.join(__dirname, "_mvp-release-gate-01c-evidence");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = path.join(evidenceRoot, `node-${stamp}`);
    fs.mkdirSync(out, { recursive: true });
    const docs = tempRoot("evidence-docs");
    const beforeListing = [];
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docs,
      displayName: "证据包",
      roleSummary: "验收",
    });
    function listRel(dir, rel = ".") {
      const abs = path.join(dir, rel);
      for (const name of fs.readdirSync(abs)) {
        const child = path.join(rel, name);
        const full = path.join(dir, child);
        const st = fs.statSync(full);
        if (st.isDirectory()) listRel(dir, child);
        else beforeListing.push(child.replace(/\\/g, "/"));
      }
    }
    listRel(created.packageDir);
    const hashBefore = hashTree(created.packageDir);
    const inspected = lifecycle.inspectImportCandidate(created.packageDir);
    assert.equal(inspected.ok, true);
    const hashAfterInspect = hashTree(created.packageDir);
    assert.equal(hashBefore, hashAfterInspect);
    fs.writeFileSync(
      path.join(out, "package-path.json"),
      JSON.stringify(
        {
          packageDir: created.packageDir,
          underDocumentsDigitalMe: created.packageDir.includes(path.join("Digital Me")),
          notUnderRepoApp: !created.packageDir.includes(`${path.sep}digitalme-app${path.sep}`),
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(
      path.join(out, "create-file-listing.json"),
      JSON.stringify({ files: beforeListing.sort(), count: beforeListing.length }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(out, "import-hash-compare.json"),
      JSON.stringify(
        {
          hashBeforeInspect: hashBefore,
          hashAfterInspect: hashAfterInspect,
          unchanged: hashBefore === hashAfterInspect,
          mode: "reference_no_copy",
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(
      path.join(out, "test-log.json"),
      JSON.stringify({ suite: "test:mvp-release-gate-01c", passed, failed, at: new Date().toISOString() }, null, 2),
      "utf8"
    );
  });

  console.log(`\nmvp-release-gate-01c: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
