"use strict";

/**
 * Unit tests for R1 renderer entry controller (permission / generation / latch).
 * Run: node scripts/test-r1-renderer-entry.cjs
 */

const assert = require("node:assert/strict");
const {
  createRendererEntryController,
} = require("../src/renderer-entry-controller");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    const allowed = c.requestNextFromHarness("unit");
    assert.equal(allowed.ok, true);
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
