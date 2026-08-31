/**
 * 对话纵向滚动：真 Electron 窗口生成足够对话，对消息卡片发 wheel，
 * 断言 chat-turns.scrollTop 变化，发送按钮始终在 viewport 内。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, sendChat, skipWelcomeAndEnterShell } from './electron-harness';

async function measureSendInViewport(page: import('playwright').Page) {
  return page.evaluate(`(() => {
    const btn = document.getElementById('btn-chat-send');
    const turns = document.getElementById('chat-turns');
    if (!btn || !turns) return null;
    const br = btn.getBoundingClientRect();
    const inView = br.top >= 0 && br.bottom <= (window.innerHeight + 1) && br.left >= 0 && br.right <= (window.innerWidth + 1);
    return {
      inView,
      top: br.top,
      bottom: br.bottom,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      scrollTop: turns.scrollTop,
      scrollHeight: turns.scrollHeight,
      clientHeight: turns.clientHeight,
    };
  })()`) as Promise<{
    inView: boolean;
    top: number;
    bottom: number;
    innerHeight: number;
    innerWidth: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>;
}

test('Electron 对话：消息再多也不挤出发送钮，滚轮在卡片上能滚列表', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron();
  const { page, app } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    const long = '现场验收需要足够长的对话内容，用来撑开消息列表。'.repeat(8);
    for (let i = 1; i <= 12; i += 1) {
      await sendChat(page, `第${i}条 ${long}`);
    }
    const sizes: Array<{ w: number; h: number; zoom: number }> = [];
    for (const dim of [
      { w: 720, h: 820 },
      { w: 1366, h: 768 },
      { w: 1920, h: 1080 },
    ]) {
      for (const zoom of [1, 1.25, 1.5]) {
        sizes.push({ ...dim, zoom });
      }
    }
    for (const size of sizes) {
      await app.evaluate(
        async ({ BrowserWindow }, next) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) throw new Error('no window');
          win.setSize(next.w, next.h);
          win.webContents.setZoomFactor(next.zoom);
        },
        size,
      );
      await page.waitForTimeout(280);
      const aimed = (await page.evaluate(`(() => {
        const turns = document.getElementById('chat-turns');
        const btn = document.getElementById('btn-chat-send');
        if (!turns || !btn) return null;
        turns.scrollTop = 0;
        const tr = turns.getBoundingClientRect();
        const cards = Array.from(document.querySelectorAll('.chat-turn'));
        const visible = cards.find((c) => {
          const r = c.getBoundingClientRect();
          return r.bottom > tr.top + 10 && r.top < tr.bottom - 10;
        }) || cards[0];
        if (!visible) return null;
        const cr = visible.getBoundingClientRect();
        const x = Math.min(Math.max((cr.left + cr.right) / 2, tr.left + 12), tr.right - 12);
        const y = Math.min(Math.max(Math.max(cr.top, tr.top) + 16, tr.top + 12), tr.bottom - 12);
        const br = btn.getBoundingClientRect();
        return {
          x,
          y,
          inView: br.top >= 0 && br.bottom <= (window.innerHeight + 1) && br.left >= 0 && br.right <= (window.innerWidth + 1),
          top: br.top,
          bottom: br.bottom,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
          scrollTop: turns.scrollTop,
          scrollHeight: turns.scrollHeight,
          clientHeight: turns.clientHeight,
        };
      })()`)) as {
        x: number;
        y: number;
        inView: boolean;
        top: number;
        bottom: number;
        innerHeight: number;
        innerWidth: number;
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
      } | null;
      assert.ok(aimed, `缺少滚动目标 ${size.w}x${size.h}@${size.zoom}`);
      assert.equal(
        aimed.inView,
        true,
        `发送按钮不在 viewport：${JSON.stringify({ size, aimed })}`,
      );
      assert.ok(
        aimed.scrollHeight > aimed.clientHeight + 20,
        `消息列表未溢出，无法验证滚动：${JSON.stringify({ size, aimed })}`,
      );
      await page.mouse.move(aimed.x, aimed.y);
      const scrollBefore = aimed.scrollTop;
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(220);
      const after = await measureSendInViewport(page);
      assert.ok(after);
      assert.ok(
        after.scrollTop > scrollBefore,
        `wheel 后 scrollTop 未增加：before=${scrollBefore} after=${after.scrollTop} size=${JSON.stringify(size)} after=${JSON.stringify(after)}`,
      );
      assert.equal(after.inView, true, `滚动后发送按钮离开 viewport：${JSON.stringify({ size, after })}`);
    }
  } finally {
    await harness.close();
  }
});
