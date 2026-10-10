'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {
  beginTalk,
  sendTalkAndWait,
  talkState,
  waitForPersistedCancellation,
  waitForTalkCompletion,
} = require('./ui-request-lifecycle.cjs');
const {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} = require('../../dist/runtime/tests/electron-harness.js');

test('validation helper waits past the transient assistant node', { timeout: 90_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB_DELAY_MS: '1500',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const lifecycle = await beginTalk(harness.page, '无付费延迟验证');
    await harness.page.waitForTimeout(250);
    const interim = await talkState(harness.page);
    assert.equal(interim.sendDisabled, true);
    assert.equal(interim.cancelVisible, true);
    assert.equal(interim.processingVisible, true);
    assert.equal(interim.assistantCount, lifecycle.beforeAssistantCount + 1);
    const completed = await waitForTalkCompletion(harness.page, lifecycle, 10_000);
    assert.ok(completed.elapsedMs >= 1_200, `completed too early: ${completed.elapsedMs}ms`);
    const finalState = await talkState(harness.page);
    assert.equal(finalState.sendDisabled, false);
    assert.equal(finalState.processingVisible, false);
  } finally {
    await harness.close();
  }
});

test('artifact result opens from the real Talk result card and reports the shell result', { timeout: 90_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const completed = await sendTalkAndWait(
      harness.page,
      '请执行无付费成果打开验证，并把文本保存到应用成果区。',
      20_000,
    );
    const turns = (((completed.view || {}).view || {}).turns || []);
    const result = turns[turns.length - 1] && turns[turns.length - 1].result;
    assert.ok(result && result.path);
    assert.equal(fs.readFileSync(result.path, 'utf8'), '公开虚构数据：无付费成果打开验证。');
    const card = harness.page.locator('.talk-result-card').last();
    await card.waitFor({ state: 'visible' });
    await card.locator('.talk-result-open').click();
    await harness.page.locator('#chat-status').filter({ hasText: /已打开 artifact-open-test\.txt/ }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  } finally {
    await harness.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      fs.rmSync(harness.userData, { recursive: true, force: true });
    } catch {
      // Windows may briefly keep the file opened by shell.openPath. The caller
      // records this as cleanup-only; it does not change the observed open result.
    }
  }
});

test('validation helper waits for persisted cancellation before leaving the case', { timeout: 90_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB_HANG: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const lifecycle = await beginTalk(harness.page, '无付费取消验证');
    await harness.page.locator('#btn-chat-cancel').click();
    const cancelled = await waitForPersistedCancellation(harness.page, lifecycle, 10_000);
    const turns = (((cancelled.view || {}).view || {}).turns || []);
    const terminalCount = turns.length;
    assert.match(String(turns[turns.length - 1].text || ''), /取消/);
    await harness.page.waitForTimeout(1_000);
    const late = await harness.page.evaluate(() => window.digitalMe.invoke('talk', {}));
    assert.equal((((late || {}).view || {}).turns || []).length, terminalCount);
    assert.equal(/已经完成/.test(JSON.stringify(late)), false);
  } finally {
    await harness.close();
  }
});
