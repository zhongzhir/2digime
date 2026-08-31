/**
 * 稳定性收口：任务串台、任务列表滚动/分页、发送中可取消。
 * 真实 Electron DOM，不是源码字符串断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from '../../runtime/tests/electron-harness';

async function openWork(page: import('playwright').Page) {
  await page.locator('#nav-work').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(`(() => {
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
  })()`);
  await page.locator('#panel-work').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(`(() => {
    const toggle = document.getElementById('btn-work-toggle-tasks');
    if (toggle) toggle.click();
    const layout = document.querySelector('#panel-work .work-layout');
    if (layout) layout.setAttribute('data-tasks', 'open');
  })()`);
}

test('任务串台：A 迟到结果不得改写 B 的界面；切回 A 才看到 A', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron();
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await openWork(page);

    const created = (await page.evaluate(`(async () => {
      const api = window.digitalMe;
      const a = await api.invoke('work.converse', { text: 'alpha-unique-token-aaa 请先记下' });
      const b = await api.invoke('work.converse', { text: 'beta-unique-token-bbb 请先记下' });
      return { a: a.taskId, b: b.taskId };
    })()`)) as { a: string; b: string };

    await page.evaluate(`(() => {
      const btn = document.getElementById('btn-new-task');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(500);

    await page.evaluate(`(() => {
      const orig = window.digitalMe.invoke.bind(window.digitalMe);
      window.__dmTaskDelays = { ${JSON.stringify(created.a)}: 1800 };
      window.digitalMe.invoke = async (name, input) => {
        const result = await orig(name, input);
        if (name === 'work.converse' && input && window.__dmTaskDelays[input.taskId]) {
          await new Promise((r) => setTimeout(r, window.__dmTaskDelays[input.taskId]));
        }
        return result;
      };
    })()`);

    await page.evaluate(`(async () => {
      const btn = document.querySelector('#task-list button[data-task-id="${created.a}"]');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(400);
    await page.locator('#work-nl-input').fill('alpha-followup-should-not-leak');
    await page.locator('#btn-work-nl-send').click();
    await page.waitForTimeout(200);

    await page.evaluate(`(async () => {
      const btn = document.querySelector('#task-list button[data-task-id="${created.b}"]');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(500);
    await page.locator('#work-nl-input').fill('beta-followup-visible-now');
    await page.locator('#btn-work-nl-send').click();
    await page.locator('#work-timeline').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);

    const onB = await page.locator('#work-timeline').innerText();
    assert.match(onB, /beta-unique-token-bbb|beta-followup-visible-now/);
    assert.doesNotMatch(onB, /alpha-followup-should-not-leak/);

    await page.evaluate(`(async () => {
      const btn = document.querySelector('#task-list button[data-task-id="${created.a}"]');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(800);
    const onA = await page.locator('#work-timeline').innerText();
    assert.match(onA, /alpha-unique-token-aaa|alpha-followup-should-not-leak/);
    assert.doesNotMatch(onA, /beta-followup-visible-now/);

    for (let i = 0; i < 10; i += 1) {
      const id = i % 2 === 0 ? created.a : created.b;
      await page.evaluate(`(async () => {
        const btn = document.querySelector('#task-list button[data-task-id="${id}"]');
        if (btn) btn.click();
      })()`);
    }
    await page.waitForTimeout(600);
    const afterFlip = (await page.evaluate(`(() => {
      const active = document.querySelector('#task-list li.active');
      const timeline = document.getElementById('work-timeline');
      return {
        activeId: active && active.getAttribute('data-task-id'),
        text: timeline ? timeline.innerText : '',
      };
    })()`)) as { activeId: string | null; text: string };
    assert.equal(afterFlip.activeId, created.b);
    assert.doesNotMatch(String(afterFlip.text), /alpha-followup-should-not-leak/);
  } finally {
    await harness.close();
  }
});

test('任务列表：60 条可滚动、可加载超过 50、选中项不丢', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron();
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await openWork(page);
    await page.evaluate(`(async () => {
      const api = window.digitalMe;
      for (let i = 0; i < 62; i += 1) {
        await api.invoke('work.converse', { text: 'list-item-' + String(i).padStart(3, '0') });
      }
    })()`);
    await page.evaluate(`(() => {
      const layout = document.querySelector('#panel-work .work-layout');
      if (layout) layout.setAttribute('data-tasks', 'open');
      const btn = document.getElementById('btn-new-task');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(500);
    await page.evaluate(`(() => {
      const layout = document.querySelector('#panel-work .work-layout');
      if (layout) layout.setAttribute('data-tasks', 'open');
      const toggle = document.getElementById('btn-work-toggle-tasks');
      if (toggle) toggle.click();
      if (layout) layout.setAttribute('data-tasks', 'open');
    })()`);
    await page.waitForTimeout(300);
    const firstCount = await page.locator('#task-list li').count();
    assert.ok(firstCount <= 50, '默认页不超过 50');
    assert.ok(firstCount >= 1);
    await page.evaluate(`(() => {
      const more = document.getElementById('btn-task-list-more');
      if (more) more.click();
    })()`);
    await page.waitForTimeout(800);
    const afterMore = await page.locator('#task-list li').count();
    assert.ok(afterMore > 50, '加载更多后应超过 50 条');

    const scroll = (await page.evaluate(`(() => {
      const list = document.getElementById('task-list');
      if (!list) return null;
      const before = list.scrollTop;
      list.scrollTop = list.scrollHeight;
      const last = list.querySelector('li:last-child');
      const tasks = document.getElementById('work-tasks');
      const layout = document.querySelector('.work-layout');
      const lr = list.getBoundingClientRect();
      const ir = last ? last.getBoundingClientRect() : null;
      return {
        before,
        after: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        lastVisible: !!(ir && ir.top < lr.bottom && ir.bottom > lr.top),
        lastText: last ? last.textContent : '',
        overflowX: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
        listCount: list.querySelectorAll('li').length,
        tasksDisplay: tasks ? getComputedStyle(tasks).display : '',
        tasksH: tasks ? tasks.getBoundingClientRect().height : 0,
        layoutH: layout ? layout.getBoundingClientRect().height : 0,
        listH: lr.height,
      };
    })()`)) as {
      before: number;
      after: number;
      scrollHeight: number;
      clientHeight: number;
      lastVisible: boolean;
      lastText: string;
      overflowX: boolean;
      listCount?: number;
      tasksDisplay?: string;
      tasksH?: number;
      layoutH?: number;
      listH?: number;
    } | null;
    assert.ok(
      scroll && scroll.scrollHeight > scroll.clientHeight,
      '列表应可纵向滚动 ' + JSON.stringify(scroll),
    );
    assert.ok(scroll.lastVisible, '滚到底应看到最后一条');
    assert.match(String(scroll.lastText), /list-item-/);
    assert.equal(scroll.overflowX, true, '页面不得横向溢出');

    const targetId = await page.evaluate(`(() => {
      const last = document.querySelector('#task-list li:last-child');
      return last && last.getAttribute('data-task-id');
    })()`);
    await page.evaluate(`(() => {
      const btn = document.querySelector('#task-list button[data-task-id="${String(targetId)}"]');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(900);
    const kept = (await page.evaluate(`(() => {
      const list = document.getElementById('task-list');
      const active = document.querySelector('#task-list li.active');
      return {
        scrollTop: list ? list.scrollTop : 0,
        activeId: active && active.getAttribute('data-task-id'),
      };
    })()`)) as { scrollTop: number; activeId: string | null };
    assert.equal(kept.activeId, targetId);
    assert.ok(kept.scrollTop > 0, '切换后列表不得跳回顶部');
  } finally {
    await harness.close();
  }
});

test('新建任务发送中显示正在发送与取消，第二次点击不丢弃提示', { timeout: 180_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: { DIGITALME_V2_CONVERSE_DELAY_MS: '2500' },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await openWork(page);
    await page.evaluate(`(() => {
      const btn = document.getElementById('btn-new-task');
      if (btn) btn.click();
    })()`);
    await page.waitForTimeout(300);
    await page.evaluate(`(() => {
      const g = document.getElementById('goal');
      if (g) {
        g.value = '请帮我写一份短周报';
        g.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await page.evaluate(`(() => {
      const send = document.getElementById('btn-goal-send');
      if (send) send.click();
    })()`);
    await page.waitForTimeout(400);
    const sending = (await page.evaluate(`(() => {
      const send = document.getElementById('btn-goal-send');
      const cancel = document.getElementById('btn-goal-cancel');
      const status = document.getElementById('job-status');
      return {
        sendText: send ? send.textContent : '',
        cancelVisible: !!(cancel && !cancel.hidden),
        status: status ? status.textContent : '',
      };
    })()`)) as { sendText: string; cancelVisible: boolean; status: string };
    assert.match(String(sending.sendText), /正在发送/);
    assert.equal(sending.cancelVisible, true);
    assert.match(String(sending.status), /正在连接|已等待/);

    await page.evaluate(`(() => {
      const nl = document.getElementById('work-nl-input');
      if (nl) {
        nl.value = '第二次点击不应被悄悄丢掉';
        nl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await page.evaluate(`(() => {
      const send = document.getElementById('btn-work-nl-send');
      if (send) send.click();
    })()`);
    await page.waitForTimeout(200);
    const second = await page.locator('#job-status').innerText();
    assert.match(second, /发送中|取消/);

    await page.evaluate(`(() => {
      const cancel = document.getElementById('btn-goal-cancel');
      if (cancel) cancel.click();
    })()`);
    await page.waitForTimeout(400);
    const cancelled = await page.locator('#job-status').innerText();
    assert.match(cancelled, /取消/);
  } finally {
    await harness.close();
  }
});
