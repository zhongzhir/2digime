"use strict";

/**
 * Unit tests for R1 renderer entry controller + runtime gates.
 * Run: node scripts/test-r1-renderer-entry.cjs
 */

const assert = require("node:assert/strict");
const {
  createRendererEntryController,
  parseExplicitGeneration,
} = require("../src/renderer-entry-controller");
const { createRendererEntryRuntime } = require("../src/renderer-entry-runtime");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fakeWindow(urlRef) {
  return {
    isDestroyed: () => false,
    webContents: {
      id: 1,
      getURL: () => urlRef.url,
    },
    on() {},
  };
}

async function main() {
  const results = [];
  const pass = (name) => {
    results.push({ name, ok: true });
    console.log("PASS", name);
  };
  const fail = (name, err) => {
    results.push({ name, ok: false, err: String(err && err.stack ? err.stack : err) });
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  };

  try {
    const c = createRendererEntryController({ readyTimeoutMs: 50 });
    assert.equal(c.resolveInitialEntry(), "legacy");
    const denied = c.requestFromRenderer("next", "probe");
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "entry_upgrade_forbidden");
    pass("1. ordinary renderer cannot request legacy→next");
  } catch (err) {
    fail("1. ordinary renderer cannot request legacy→next", err);
  }

  try {
    const c = createRendererEntryController({ readyTimeoutMs: 50 });
    process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
    const { generation } = c.beginNextNavigation();
    c.armReadyTimer(generation, () => {});
    const first = c.acceptSignalReady({
      generation,
      webContentsId: 1,
      expectedWebContentsId: 1,
      isNextPage: true,
    });
    assert.equal(first.ok, true);
    const second = c.acceptSignalReady({
      generation,
      webContentsId: 1,
      expectedWebContentsId: 1,
      isNextPage: true,
    });
    assert.equal(second.ok, false);
    assert.equal(second.code, "already_consumed");
    const wrong = c.acceptSignalReady({
      generation: generation + 9,
      webContentsId: 1,
      expectedWebContentsId: 1,
      isNextPage: true,
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.code, "generation_mismatch");
    pass("2. ready generation one-shot + mismatch rejection");
  } catch (err) {
    fail("2. ready generation one-shot + mismatch rejection", err);
  } finally {
    delete process.env.DIGITALME_R1_SPIKE_HARNESS;
  }

  try {
    const c = createRendererEntryController({ readyTimeoutMs: 40 });
    process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
    const { generation } = c.beginNextNavigation();
    let timedOut = false;
    c.armReadyTimer(generation, () => {
      timedOut = true;
      c.latchFallback({ category: "ready_timeout", generation });
    });
    await sleep(80);
    assert.equal(timedOut, true);
    assert.equal(c.snapshot().fallbackLatched, true);
    assert.equal(c.snapshot().effectiveEntry, "legacy");
    const blocked = c.requestNextFromHarness("retry");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "fallback_latched");
    const late = c.acceptSignalReady({
      generation,
      webContentsId: 1,
      expectedWebContentsId: 1,
      isNextPage: true,
    });
    assert.equal(late.ok, false);
    pass("3. ready timeout latches and blocks re-entry");
  } catch (err) {
    fail("3. ready timeout latches and blocks re-entry", err);
  } finally {
    delete process.env.DIGITALME_R1_SPIKE_HARNESS;
  }

  try {
    const c = createRendererEntryController({ readyTimeoutMs: 50 });
    process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
    c.beginNextNavigation();
    const okLegacy = c.requestFromRenderer("legacy", "return");
    assert.equal(okLegacy.ok, true);
    assert.equal(okLegacy.action, "load_legacy");
    pass("4. next→legacy allowed from renderer");
  } catch (err) {
    fail("4. next→legacy allowed from renderer", err);
  } finally {
    delete process.env.DIGITALME_R1_SPIKE_HARNESS;
  }

  try {
    assert.equal(parseExplicitGeneration(undefined).code, "generation_required");
    assert.equal(parseExplicitGeneration(null).code, "generation_required");
    assert.equal(parseExplicitGeneration("").code, "generation_required");
    assert.equal(parseExplicitGeneration("  ").code, "generation_required");
    assert.equal(parseExplicitGeneration(Number.NaN).code, "generation_invalid");
    assert.equal(parseExplicitGeneration(1.5).code, "generation_invalid");
    assert.equal(parseExplicitGeneration(-1).code, "generation_invalid");
    assert.equal(parseExplicitGeneration(0).code, "generation_invalid");
    assert.equal(parseExplicitGeneration("abc").code, "generation_invalid");
    assert.deepEqual(parseExplicitGeneration(3), { ok: true, generation: 3 });
    assert.deepEqual(parseExplicitGeneration("7"), { ok: true, generation: 7 });

    const c = createRendererEntryController({ readyTimeoutMs: 200 });
    const { generation } = c.beginNextNavigation();
    c.armReadyTimer(generation, () => {});
    assert.equal(
      c.acceptSignalReady({
        generation: undefined,
        webContentsId: 1,
        expectedWebContentsId: 1,
        isNextPage: true,
      }).code,
      "generation_required"
    );
    assert.equal(
      c.acceptSignalReady({
        generation: 1.2,
        webContentsId: 1,
        expectedWebContentsId: 1,
        isNextPage: true,
      }).code,
      "generation_invalid"
    );
    pass("5. missing/invalid generation rejected");
  } catch (err) {
    fail("5. missing/invalid generation rejected", err);
  }

  try {
    const c = createRendererEntryController({ readyTimeoutMs: 500 });
    const { generation } = c.beginNextNavigation();
    // Armed before "load"; early ready with next page must succeed.
    c.armReadyTimer(generation, () => {});
    assert.equal(c.snapshot().readyArmed, true);
    const early = c.acceptSignalReady({
      generation,
      webContentsId: 1,
      expectedWebContentsId: 1,
      isNextPage: true,
    });
    assert.equal(early.ok, true);
    assert.equal(early.generation, generation);
    pass("6. ready accepted when armed before load completes");
  } catch (err) {
    fail("6. ready accepted when armed before load completes", err);
  }

  try {
    process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
    const urlRef = { url: "file:///legacy/index.html" };
    let nextLoads = 0;
    const runtime = createRendererEntryRuntime({
      readyTimeoutMs: 2000,
      loadLegacyEntry: async () => {
        urlRef.url = "file:///renderer/index.html";
        return { ok: true, mode: "legacy_file" };
      },
      loadNextEntry: async () => {
        nextLoads += 1;
        await sleep(80);
        urlRef.url = "file:///renderer-next/dist/index.html";
        return { ok: true, mode: "production_load" };
      },
      isNextPageUrl: (url) => String(url).includes("renderer-next"),
    });
    runtime.bindWindow(fakeWindow(urlRef));

    const first = await runtime.handleHarnessRequestNext("first");
    const second = await runtime.handleHarnessRequestNext("second");
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "navigation_in_progress");
    await sleep(150);
    assert.equal(nextLoads, 1);
    pass("7. concurrent next requests: second returns navigation_in_progress");
  } catch (err) {
    fail("7. concurrent next requests: second returns navigation_in_progress", err);
  } finally {
    delete process.env.DIGITALME_R1_SPIKE_HARNESS;
  }

  try {
    process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
    const urlRef = { url: "file:///renderer-next/dist/index.html" };
    const runtime = createRendererEntryRuntime({
      readyTimeoutMs: 2000,
      loadLegacyEntry: async () => ({ ok: true }),
      loadNextEntry: async () => ({ ok: true }),
      isNextPageUrl: () => true,
    });
    runtime.bindWindow(fakeWindow(urlRef));
    runtime.controller.beginNextNavigation();
    // Simulate armed next without inventing generation in handleSignalReady.
    const gen = runtime.controller.getBoundGeneration();
    runtime.controller.armReadyTimer(gen, () => {});

    const missing = runtime.handleSignalReady({ webContentsId: 1 });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "generation_required");

    const ok = runtime.handleSignalReady({ generation: gen, webContentsId: 1 });
    assert.equal(ok.ok, true);
    pass("8. runtime signalReady requires explicit generation");
  } catch (err) {
    fail("8. runtime signalReady requires explicit generation", err);
  } finally {
    delete process.env.DIGITALME_R1_SPIKE_HARNESS;
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`R1 entry unit tests failed: ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`R1 entry unit tests passed: ${results.length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
