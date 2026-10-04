/**
 * 发现页完整界面链路（不需要任何密钥，不依赖联网成功）。
 *
 * 为什么要有它：此前 open-web-discovery-01.electron.test 需要 GEMINI_API_KEY 和 Owner 的加密密钥副本，
 * 缺任何一个就整条 skip；而且它只直接调用 IPC 取数，没有走页面自己的 refresh → apply → render 链路。
 * renderView 里的 savedScroll 作用域错误（ReferenceError）因此一直没被发现。
 * 这里在真实 Electron 页面里：
 *  1. 监听 pageerror，任何未捕获异常都让测试失败；
 *  2. 用合成卡片真实渲染（含音频、视频、文章），检查多列网格和卡片内播放器的展开/收起；
 *  3. 跑页面自己的 refresh() 与搜索框提交，要求都落到真实终态（状态条与取消键消失）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from '../../runtime/tests/electron-harness';

const CARDS = [
  { itemId: 'c1', title: '一篇文章', url: 'https://example.invalid/a', source: 'example.invalid', contentType: 'article', reason: '依据：测试', text: '摘要一' },
  { itemId: 'c2', title: '一档播客', url: 'https://example.invalid/p', source: 'example.invalid', contentType: 'audio', mediaUrl: 'https://example.invalid/ep.mp3', mimeType: 'audio/mpeg', text: '摘要二' },
  { itemId: 'c3', title: '一个视频', url: 'https://example.invalid/v', source: 'example.invalid', contentType: 'video', mediaUrl: 'https://example.invalid/v.mp4', mimeType: 'video/mp4', text: '摘要三' },
  { itemId: 'c4', title: '只有节目页', url: 'https://example.invalid/show', source: 'example.invalid', contentType: 'video', text: '摘要四：没有媒体直链也是有效推荐' },
  { itemId: 'c5', title: '又一篇文章', url: 'https://example.invalid/b', source: 'example.invalid', contentType: 'article', text: '摘要五' },
  { itemId: 'c6', title: '再一篇文章', url: 'https://example.invalid/c', source: 'example.invalid', contentType: 'article', text: '摘要六' },
];

test('发现页：真实渲染、卡片内播放、多列瀑布流，且页面链路不抛未捕获异常', { timeout: 300_000 }, async () => {
  const harness = await launchDigitalMeElectron({ extraEnv: { DIGITALME_V2_TALK_STUB: '1' } });
  const { page } = harness;
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
  try {
    await skipWelcomeAndEnterShell(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#nav-discover').click();
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 15_000 });

    // 1) 合成视图真实渲染；renderView 内部任何 ReferenceError 都会让 evaluate 抛出
    await page.evaluate(`(() => {
      window.ContentDiscoverPage.renderView(${JSON.stringify({ headline: '发现', lead: '', cards: CARDS, preferences: [], notice: '', feedMode: 'default' })});
    })()`);
    const list = page.locator('#content-discover-list > li');
    await list.first().waitFor({ timeout: 10_000 });
    assert.equal(await list.count(), CARDS.length);

    // 2) 标签区分：可在这里播放 / 去原站
    const texts = await page.locator('#content-discover-list').innerText();
    assert.match(texts, /音频 · 可在这里播放/);
    assert.match(texts, /视频 · 可在这里播放/);
    assert.match(texts, /视频 · 去原站/);
    assert.match(texts, /去原站观看/);
    assert.match(texts, /没有媒体直链也是有效推荐/, '没有直链的节目页仍然是一张有效卡片');

    // 3) 宽屏多列，无重叠；窄屏单列
    const layout = async () =>
      (await page.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('#content-discover-list > li')).map((n) => n.getBoundingClientRect());
        const columns = new Set(items.map((r) => Math.round(r.left / 8))).size;
        let overlaps = 0;
        for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i], b = items[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
        }
        return { columns, overlaps };
      })()`)) as { columns: number; overlaps: number };
    await page.waitForTimeout(500);
    const wide = await layout();
    assert.ok(wide.columns >= 2, `宽屏应为多列，实际 ${wide.columns}`);
    assert.equal(wide.overlaps, 0);
    const rhythm = (await page.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('#content-discover-list > li'));
      const excerpts = cards.map((n) => {
        const el = n.querySelector('.content-discover-excerpt');
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      });
      const covers = cards.map((n) => {
        const el = n.querySelector('.content-discover-cover');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.height ? Number((r.width / r.height).toFixed(2)) : null;
      }).filter((n) => n);
      return { excerpts, covers };
    })()`)) as { excerpts: number[]; covers: number[] };
    const excerptSpread = Math.max(...rhythm.excerpts) - Math.min(...rhythm.excerpts);
    assert.ok(excerptSpread <= 4, `摘要块高度应一致，实际相差 ${excerptSpread}px`);
    for (const ratio of rhythm.covers) {
      assert.ok(Math.abs(ratio - 16 / 9) < 0.08, `封面比例应为 16:9，实际 ${ratio}`);
    }
    await page.setViewportSize({ width: 560, height: 900 });
    await page.waitForTimeout(500);
    const narrow = await layout();
    assert.equal(narrow.columns, 1, '窄屏应为单列');
    assert.equal(narrow.overlaps, 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);

    // 4) 卡片内播放器：点击前不存在播放器，点击后只在这张卡片内展开，再点收起
    const audioCard = page.locator('#content-discover-list > li', { hasText: '一档播客' });
    assert.equal(await audioCard.locator('audio, video').count(), 0, '未点击前不得先摆出播放器');
    await audioCard.locator('button', { hasText: '在这里收听' }).click();
    assert.equal(await audioCard.locator('.content-discover-player').isVisible(), true);
    assert.equal(await page.locator('#content-discover-list audio, #content-discover-list video').count(), 1, '只在被点的卡片里出现播放器');
    await audioCard.locator('button', { hasText: '收起' }).click();
    assert.equal(await audioCard.locator('.content-discover-player').isVisible(), false);
    assert.equal(await audioCard.locator('audio').count(), 0);

    // 5) 页面自己的 refresh 与搜索，必须落到真实终态
    const settled = async (label: string) => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const s = (await page.evaluate(`(() => {
          const st = document.getElementById('content-discover-status');
          const cancel = document.getElementById('btn-discover-cancel');
          return { status: !!st && !st.hidden, cancel: !!cancel && !cancel.hidden };
        })()`)) as { status: boolean; cancel: boolean };
        if (!s.status && !s.cancel) return;
        await page.waitForTimeout(1000);
      }
      assert.fail(`${label}：超过 120 秒仍停在加载态`);
    };
    // 搜索一开始取消键就必须可见（最长的等待发生在第一批结果之前），点击后落到真实终态
    const cancelVisibleAtStart = await page.evaluate(`(() => {
      void window.ContentDiscoverPage.seek('取消测试查询');
      return !document.getElementById('btn-discover-cancel').hidden;
    })()`);
    assert.equal(cancelVisibleAtStart, true, '搜索刚开始时取消键应已出现');
    await page.evaluate(`(() => { const b = document.getElementById('btn-discover-cancel'); if (b && !b.hidden) b.click(); })()`);
    await settled('cancel');
    await page.evaluate(`window.ContentDiscoverPage.refresh()`);
    await settled('refresh');
    await page.locator('#content-discover-query').fill('适合通勤听的科技播客');
    await page.locator('#content-discover-query').press('Enter');
    await settled('seek');

    assert.deepEqual(pageErrors, [], `页面出现未捕获异常：${pageErrors.join(' | ')}`);
  } finally {
    await harness.close();
  }
});
