"use strict";

/**
 * Hermetic smoke test for the Digital Me MCP server (src/mcp-server).
 *
 * Spawns the server as a child process over stdio (pointed at a temporary
 * Package fixture, never the real package), then verifies:
 *   - server starts and answers MCP requests
 *   - listResources returns the seven dm:// resources
 *   - readResource returns fixture content
 *   - listTools returns dm_get_context / dm_generate / dm_credential
 *   - tool calls succeed (and validate their arguments)
 */

const path = require("node:path");
const assert = require("node:assert/strict");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");

const SERVER_PATH = path.join(__dirname, "..", "src", "mcp-server", "index.js");

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

function firstText(result) {
  assert.ok(result && Array.isArray(result.content), "tool result has content array");
  const item = result.content.find((c) => c && c.type === "text");
  assert.ok(item, "tool result has a text content item");
  return item.text;
}

async function main() {
  const fixture = createHermeticPackageFixture("mcp");
  let client = null;
  try {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH, "--package-dir", fixture.packageDir],
      stderr: "inherit",
    });
    client = new Client(
      { name: "dm-mcp-test-client", version: "0.0.1" },
      { capabilities: {} }
    );
    await client.connect(transport);

    await test("server starts and lists the seven dm:// resources", async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri).sort();
      assert.deepEqual(uris, [...EXPECTED_RESOURCE_URIS].sort());
      for (const r of resources) {
        assert.ok(r.name, "resource has a name: " + r.uri);
        assert.ok(r.mimeType, "resource has a mimeType: " + r.uri);
      }
    });

    await test("readResource dm://persona returns fixture content", async () => {
      const res = await client.readResource({ uri: "dm://persona" });
      assert.ok(res.contents.length >= 1);
      assert.equal(res.contents[0].uri, "dm://persona");
      assert.ok(res.contents[0].text.includes("确定性测试用人格说明"));
    });

    await test("readResource with unknown URI rejects", async () => {
      await assert.rejects(() => client.readResource({ uri: "dm://nope" }));
    });

    await test("listTools returns the three dm_* tools with schemas", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, [...EXPECTED_TOOL_NAMES].sort());
      for (const t of tools) {
        assert.ok(t.description, "tool has a description: " + t.name);
        assert.equal(t.inputSchema && t.inputSchema.type, "object");
      }
    });

    await test("dm_get_context returns goal-related context", async () => {
      const result = await client.callTool({
        name: "dm_get_context",
        arguments: { goal: "帮我起草一封合作邮件" },
      });
      assert.ok(!result.isError, "tool did not report an error");
      const text = firstText(result);
      assert.ok(text.includes("Digital Me 个性化上下文"));
      assert.ok(text.includes("确定性测试用人格说明") || text.includes("摘录"));
    });

    await test("dm_get_context without goal reports an error", async () => {
      const result = await client.callTool({ name: "dm_get_context", arguments: {} });
      assert.ok(result.isError, "tool reported an error");
      assert.ok(firstText(result).includes("goal"));
    });

    await test("dm_generate returns messages for the caller's AI", async () => {
      const result = await client.callTool({
        name: "dm_generate",
        arguments: { goal: "写一段自我介绍", type: "draft" },
      });
      assert.ok(!result.isError, "tool did not report an error");
      const payload = JSON.parse(firstText(result));
      assert.equal(payload.type, "draft");
      assert.ok(Array.isArray(payload.messages));
      assert.equal(payload.messages[0].role, "system");
      assert.equal(payload.messages[1].role, "user");
      assert.ok(payload.messages[1].content.includes("写一段自我介绍"));
    });

    await test("dm_generate rejects an unknown type", async () => {
      const result = await client.callTool({
        name: "dm_generate",
        arguments: { goal: "写一段自我介绍", type: "novel" },
      });
      assert.ok(result.isError, "tool reported an error");
    });

    await test("dm_credential issues a bounded credential", async () => {
      const result = await client.callTool({
        name: "dm_credential",
        arguments: { audience: "cursor", validityDays: 7 },
      });
      assert.ok(!result.isError, "tool did not report an error");
      const credential = JSON.parse(firstText(result));
      assert.equal(credential.type, "DigitalMeContextCredential");
      assert.equal(credential.audience, "cursor");
      assert.equal(credential.validityDays, 7);
      assert.ok(credential.id.startsWith("dmc_"));
      assert.ok(Array.isArray(credential.scope));
      assert.deepEqual(
        [...credential.scope].sort(),
        [...EXPECTED_RESOURCE_URIS].sort()
      );
      const issued = Date.parse(credential.issuedAt);
      const expires = Date.parse(credential.expiresAt);
      assert.ok(Number.isFinite(issued) && Number.isFinite(expires));
      assert.equal(expires - issued, 7 * 24 * 60 * 60 * 1000);
      assert.match(credential.proof, /^[0-9a-f]{64}$/);
      assert.match(credential.subject.packageFingerprint, /^[0-9a-f]{64}$/);
    });

    await test("dm_credential without audience reports an error", async () => {
      const result = await client.callTool({ name: "dm_credential", arguments: {} });
      assert.ok(result.isError, "tool reported an error");
    });

    await test("unknown tool name rejects", async () => {
      await assert.rejects(() =>
        client.callTool({ name: "dm_does_not_exist", arguments: {} })
      );
    });
  } finally {
    if (client) {
      try {
        await client.close();
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
