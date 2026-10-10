'use strict';

async function talkState(page) {
  return page.evaluate(() => {
    const send = document.getElementById('btn-chat-send');
    const cancel = document.getElementById('btn-chat-cancel');
    const processing = document.querySelector('.talk-processing');
    return {
      sendDisabled: Boolean(send && send.disabled),
      cancelVisible: Boolean(cancel && !cancel.hidden),
      processingVisible: Boolean(processing),
      assistantCount: document.querySelectorAll('.chat-turn-assistant').length,
    };
  });
}

async function pollState(page, predicate, timeoutMs, failure) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await talkState(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error(failure);
}

async function beginTalk(page, text, timeoutMs = 10_000) {
  await page.locator('#nav-chat').click();
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: timeoutMs });
  const beforeAssistantCount = await page.locator('.chat-turn-assistant').count();
  const beforeView = await page.evaluate(() => window.digitalMe.invoke('talk', {}));
  const beforeTurnCount = (((beforeView || {}).view || {}).turns || []).length;
  const startedAt = Date.now();
  await page.locator('#chat-input').fill(text);
  await page.locator('#btn-chat-send').click();
  await pollState(
    page,
    (state) => state.sendDisabled && state.cancelVisible && state.processingVisible,
    timeoutMs,
    'talk request did not enter the running UI state',
  );
  return { beforeAssistantCount, beforeTurnCount, startedAt };
}

async function waitForTalkCompletion(page, lifecycle, timeoutMs = 300_000) {
  await pollState(
    page,
    (state) => !state.sendDisabled && !state.processingVisible &&
      state.assistantCount > lifecycle.beforeAssistantCount,
    timeoutMs,
    'talk request did not reach a completed UI state',
  );
  const view = await page.evaluate(() => window.digitalMe.invoke('talk', {}));
  const turns = (((view || {}).view || {}).turns || []);
  if (turns.length <= lifecycle.beforeTurnCount) {
    throw new Error('talk UI became idle before a new persisted turn was available');
  }
  return { view, elapsedMs: Date.now() - lifecycle.startedAt };
}

async function sendTalkAndWait(page, text, timeoutMs = 300_000) {
  const lifecycle = await beginTalk(page, text);
  return waitForTalkCompletion(page, lifecycle, timeoutMs);
}

async function waitForPersistedCancellation(page, lifecycle, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let view;
  while (Date.now() < deadline) {
    view = await page.evaluate(() => window.digitalMe.invoke('talk', {}));
    const turns = (((view || {}).view || {}).turns || []);
    const last = turns[turns.length - 1];
    if (
      turns.length > lifecycle.beforeTurnCount &&
      last &&
      last.role === 'assistant' &&
      /取消/.test(String(last.text || ''))
    ) {
      return { view, elapsedMs: Date.now() - lifecycle.startedAt };
    }
    await page.waitForTimeout(100);
  }
  throw new Error('cancel UI returned before backend persisted the cancellation terminal state');
}

module.exports = {
  beginTalk,
  sendTalkAndWait,
  talkState,
  waitForPersistedCancellation,
  waitForTalkCompletion,
};
