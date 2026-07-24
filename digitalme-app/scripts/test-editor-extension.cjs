"use strict";

/**
 * Hermetic test for the Digital Me editor extension (src/editor-extension).
 *
 * Verifies:
 *   - extension files exist (manifest / tsconfig / sources / icon)
 *   - package.json contribution points match the implementation
 *   - TypeScript compiles cleanly to dist/ (auto `npm install` when the
 *     extension's node_modules is missing)
 *   - compiled mcp-client.js loads in plain Node (no `vscode` dependency)
 *   - DigitalMeMcpClient connects to the real MCP server over stdio against
 *     a temporary Package fixture and exercises resources/tools
 *   - compiled extension.js registers the contributed commands and views
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");

const EXT_DIR = path.join(__dirname, "..", "src", "editor-extension");
const DIST_DIR = path.join(EXT_DIR, "dist");
const SERVER_PATH = path.join(__dirname, "..", "src", "mcp-server", "index.js");

const EXPECTED_COMMANDS = [
  "digitalme.getContext",
  "digitalme.generate",
  "digitalme.generateCredential",
];
const EXPECTED_VIEWS = ["digitalme.contextView", "digitalme.credentialView"];
const EXPECTED_RESOURCE_URIS = [
  "dm://persona",
  "dm://style-guide",
  "dm://boundaries",
  "dm://memory",
  "dm://frameworks",
  "dm://identity",
  "dm://life-summary",
];
const EXPECTED_TOOL_NAMES = ["dm_get_context", "dm_generate", "dm_credential"];

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureExtensionDependencies() {
  const needed = [
    path.join(EXT_DIR, "node_modules", "typescript", "bin", "tsc"),
    path.join(EXT_DIR, "node_modules", "@types", "vscode", "package.json"),
    path.join(EXT_DIR, "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
  ];
  if (needed.every((p) => fs.existsSync(p))) return;
  console.log("[editor-extension] installing extension dependencies (npm install)…");
  const result = spawnSync("npm install --no-fund --no-audit", {
    cwd: EXT_DIR,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("npm install failed in src/editor-extension (exit " + result.status + ")");
  }
}

function compileExtension() {
  const tsc = path.join(EXT_DIR, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", "./"], {
    cwd: EXT_DIR,
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "tsc compile exited with code " + result.status);
}

async function main() {
  const fixture = createHermeticPackageFixture("editor-ext");
  let client = null;
  try {
    await test("extension files exist", async () => {
      const files = [
        "package.json",
        "tsconfig.json",
        path.join("src", "extension.ts"),
        path.join("src", "mcp-client.ts"),
        path.join("src", "context-view.ts"),
        path.join("src", "credential-view.ts"),
        path.join("resources", "icon.svg"),
      ];
      for (const rel of files) {
        assert.ok(fs.existsSync(path.join(EXT_DIR, rel)), "missing file: " + rel);
      }
    });

    await test("package.json declares the expected contribution points", async () => {
      const pkg = readJson(path.join(EXT_DIR, "package.json"));
      assert.equal(pkg.main, "./dist/extension.js");
      assert.ok(pkg.engines && pkg.engines.vscode, "engines.vscode present");
      assert.ok(pkg.activationEvents.includes("onStartupFinished"));
      const commands = (pkg.contributes.commands || []).map((c) => c.command).sort();
      assert.deepEqual(commands, [...EXPECTED_COMMANDS].sort());
      const views = (pkg.contributes.views.digitalme || []).map((v) => v.id).sort();
      assert.deepEqual(views, [...EXPECTED_VIEWS].sort());
      const containers = pkg.contributes.viewsContainers.activitybar || [];
      assert.ok(containers.some((c) => c.id === "digitalme"), "activitybar container digitalme");
      assert.ok(
        fs.existsSync(path.join(EXT_DIR, containers[0].icon)),
        "activitybar icon exists: " + containers[0].icon
      );
      assert.ok(
        (pkg.dependencies || {})["@modelcontextprotocol/sdk"],
        "depends on @modelcontextprotocol/sdk"
      );
    });

    await test("tsconfig targets commonjs and compiles src/ to dist/", async () => {
      const tsconfig = readJson(path.join(EXT_DIR, "tsconfig.json"));
      assert.equal(tsconfig.compilerOptions.module, "commonjs");
      assert.equal(tsconfig.compilerOptions.outDir, "dist");
      assert.equal(tsconfig.compilerOptions.rootDir, "src");
      assert.equal(tsconfig.compilerOptions.strict, true);
    });

    await test("icon.svg is a well-formed svg", async () => {
      const svg = fs.readFileSync(path.join(EXT_DIR, "resources", "icon.svg"), "utf8");
      assert.ok(svg.includes("<svg"), "contains <svg");
      assert.ok(svg.includes("</svg>"), "contains </svg>");
    });

    await test("TypeScript compiles cleanly to dist/", async () => {
      ensureExtensionDependencies();
      compileExtension();
      for (const name of ["extension.js", "mcp-client.js", "context-view.js", "credential-view.js"]) {
        assert.ok(fs.existsSync(path.join(DIST_DIR, name)), "dist output exists: " + name);
      }
    });

    await test("compiled mcp-client.js loads in plain Node without vscode", async () => {
      const source = fs.readFileSync(path.join(DIST_DIR, "mcp-client.js"), "utf8");
      assert.ok(!source.includes('require("vscode")'), "mcp-client must not require vscode");
      const mod = require(path.join(DIST_DIR, "mcp-client.js"));
      assert.equal(typeof mod.DigitalMeMcpClient, "function");
      assert.equal(typeof mod.resolveServerSpec, "function");
      assert.equal(mod.DEFAULT_SERVER_COMMAND, "dm-mcp");
    });

    await test("resolveServerSpec defaults to the dm-mcp command", async () => {
      const { resolveServerSpec } = require(path.join(DIST_DIR, "mcp-client.js"));
      assert.deepEqual(resolveServerSpec(), { command: "dm-mcp", args: [] });
      assert.deepEqual(resolveServerSpec({ command: "  ", args: [] }), {
        command: "dm-mcp",
        args: [],
      });
      assert.deepEqual(
        resolveServerSpec({ command: "node", args: ["server.js"], packageDir: "D:\\pkg" }),
        { command: "node", args: ["server.js", "--package-dir", "D:\\pkg"] }
      );
    });

    await test("client connects to the MCP server over stdio and lists resources", async () => {
      const { DigitalMeMcpClient } = require(path.join(DIST_DIR, "mcp-client.js"));
      client = new DigitalMeMcpClient({
        command: process.execPath,
        args: [SERVER_PATH, "--package-dir", fixture.packageDir],
      });
      assert.equal(client.connected, false);
      await client.connect();
      assert.equal(client.connected, true);
      const resources = await client.listResources();
      assert.deepEqual(
        resources.map((r) => r.uri).sort(),
        [...EXPECTED_RESOURCE_URIS].sort()
      );
      for (const r of resources) {
        assert.ok(r.name, "resource has a name: " + r.uri);
      }
    });

    await test("readResourceText returns fixture persona content", async () => {
      const text = await client.readResourceText("dm://persona");
      assert.ok(text.includes("确定性测试用人格说明"));
    });

    await test("listTools returns the three dm_* tools", async () => {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.map((t) => t.name).sort(),
        [...EXPECTED_TOOL_NAMES].sort()
      );
    });

    await test("getContext returns personalized context for a goal", async () => {
      const text = await client.getContext("帮我审阅这段代码");
      assert.ok(text.includes("Digital Me 个性化上下文"));
      assert.ok(text.includes("确定性测试用人格说明") || text.includes("摘录"));
    });

    await test("generate returns messages JSON for the caller's AI", async () => {
      const text = await client.generate("写一段项目说明", "summary");
      const payload = JSON.parse(text);
      assert.equal(payload.type, "summary");
      assert.equal(payload.messages[0].role, "system");
      assert.equal(payload.messages[1].role, "user");
      assert.ok(payload.messages[1].content.includes("写一段项目说明"));
    });

    await test("generateCredential returns a bounded credential", async () => {
      const text = await client.generateCredential("cursor", 7);
      const credential = JSON.parse(text);
      assert.equal(credential.type, "DigitalMeContextCredential");
      assert.equal(credential.audience, "cursor");
      assert.equal(credential.validityDays, 7);
      assert.ok(credential.id.startsWith("dmc_"));
      assert.match(credential.proof, /^[0-9a-f]{64}$/);
    });

    await test("tool argument validation errors surface as thrown errors", async () => {
      await assert.rejects(() => client.getContext(""), /goal/);
    });

    await test("calls after disconnect reject", async () => {
      await client.disconnect();
      assert.equal(client.connected, false);
      await assert.rejects(() => client.listResources(), /尚未连接/);
      client = null;
    });

    await test("compiled extension.js registers contributed commands and views", async () => {
      const source = fs.readFileSync(path.join(DIST_DIR, "extension.js"), "utf8");
      for (const id of EXPECTED_COMMANDS) {
        assert.ok(source.includes('registerCommand("' + id + '"'), "registers command " + id);
      }
      for (const id of EXPECTED_VIEWS) {
        assert.ok(source.includes('registerTreeDataProvider("' + id + '"'), "registers view " + id);
      }
      assert.ok(source.includes("activate"), "exports activate");
      assert.ok(source.includes("deactivate"), "exports deactivate");
    });
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
    cleanupHermeticPackageFixture(fixture.packageDir);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
