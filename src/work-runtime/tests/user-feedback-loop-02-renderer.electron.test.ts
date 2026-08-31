/**
 * 真实渲染层：导出竞态切换、窄窗口 DOM 尺寸，不是 CSS 字符串搜索。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from '../../runtime/tests/electron-harness';

test(
  '渲染层：A 导出 PPT 未完成时切到 B，B 不继承 PPT 状态；窄窗长内容不撑破',
  { timeout: 180_000 },
  async () => {
    const harness = await launchDigitalMeElectron({ exportDelayMs: 1600 });
    const { page, app } = harness;
    try {
      await skipWelcomeAndEnterShell(page);
      await page.locator('#nav-work').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('#nav-work').dispatchEvent('click');
      await page.locator('#panel-work').waitFor({ state: 'visible', timeout: 15_000 });

      const createdPpt = (await page.evaluate(`(async () => {
        const api = window.digitalMe;
        return api.invoke('work.submitTask', {
          goal: '做一份产品汇报 PPT',
          contextRefs: [],
          requestedArtifactType: 'document',
        });
      })()`)) as { taskId: string; jobId: string };
      const waitJob = async (taskId: string, jobId: string) => {
        const started = Date.now();
        let last = '';
        while (Date.now() - started < 40_000) {
          const detail = (await page.evaluate(`(async () => {
              const api = window.digitalMe;
              return api.invoke('work.getTask', { taskId: ${JSON.stringify(taskId)} });
            })()`)) as { latestJob?: { jobId?: string; status?: string }; artifactIds?: string[] };
          last = JSON.stringify(detail && detail.latestJob ? detail.latestJob : detail);
          if (detail.latestJob?.jobId === jobId && detail.latestJob.status === 'succeeded') {
            return detail;
          }
          if (detail.latestJob?.status === 'failed') {
            throw new Error(`job failed for ${taskId}: ${last}`);
          }
          await page.waitForTimeout(200);
        }
        throw new Error(`wait job timeout ${jobId} last=${last}`);
      };
      await waitJob(createdPpt.taskId, createdPpt.jobId);
      const createdArticle = (await page.evaluate(`(async () => {
        const api = window.digitalMe;
        return api.invoke('work.submitTask', {
          goal: '写一篇普通说明文章',
          contextRefs: [],
          requestedArtifactType: 'document',
        });
      })()`)) as { taskId: string; jobId: string };
      assert.notEqual(createdPpt.taskId, createdArticle.taskId);
      await waitJob(createdArticle.taskId, createdArticle.jobId);
      const created = { ppt: createdPpt, article: createdArticle };

      await page.locator('#nav-work').dispatchEvent('click');
      const openArtifactStage = async () => {
        const tab = page.locator('.work-stage-tab[data-work-stage="artifact"]');
        await tab.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
        if (await tab.isVisible().catch(() => false)) {
          await tab.dispatchEvent('click');
        }
      };
      const ensureTaskVisible = async (taskId: string) => {
        const btn = page.locator(`#task-list button[data-task-id="${taskId}"]`);
        if (await btn.isVisible().catch(() => false)) return;
        await page.locator('#btn-work-toggle-tasks').dispatchEvent('click');
        await btn.waitFor({ state: 'visible', timeout: 15_000 });
      };
      await ensureTaskVisible(created.ppt.taskId);
      await page.locator(`#task-list button[data-task-id="${created.ppt.taskId}"]`).dispatchEvent('click');
      await openArtifactStage();
      const pptBtn = page.locator('#btn-export-pptx');
      await pptBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await pptBtn.click();
      await page.locator('#export-status').getByText('正在导出').waitFor({ state: 'visible', timeout: 5_000 });
      await ensureTaskVisible(created.article.taskId);
      await page.locator(`#task-list button[data-task-id="${created.article.taskId}"]`).dispatchEvent('click');
      await openArtifactStage();
      await page.waitForTimeout(300);
      const bState = (await page.evaluate(`(() => {
        const ppt = document.getElementById('btn-export-pptx');
        const status = document.getElementById('export-status');
        return {
          pptHidden: !ppt || ppt.hidden || ppt.getAttribute('hidden') !== null,
          status: String((status && status.textContent) || ''),
        };
      })()`)) as { pptHidden: boolean; status: string };
      assert.equal(bState.pptHidden, true, '普通文章不得显示 PPT 按钮');
      assert.doesNotMatch(bState.status, /PowerPoint|正在导出PowerPoint|已导出PowerPoint/);

      await page.waitForTimeout(1800);
      await ensureTaskVisible(created.ppt.taskId);
      await page.locator(`#task-list button[data-task-id="${created.ppt.taskId}"]`).dispatchEvent('click');
      await openArtifactStage();
      await page.locator('#export-status').getByText('已导出PowerPoint').waitFor({ state: 'visible', timeout: 15_000 });
      const aStatus = await page.locator('#export-status').innerText();
      assert.match(aStatus, /已导出PowerPoint|已导出 PowerPoint/);

      const bw = await app.browserWindow(page);
      await bw.evaluate((win: { setSize: (w: number, h: number) => void }) => {
        win.setSize(720, 820);
      });
      await page.waitForTimeout(200);
      await page.locator('#nav-chat').click();
      const longBits = [
        '这是一段很长的中文说明'.repeat(12),
        'SupercalifragilisticexpialidociousTokenWithoutBreakXXXXXXXX',
        'https://github.com/zhongzhir/2digime/blob/main/README.md?query=very-long',
        'D:\\\\Projects\\\\Digital Me\\\\electron\\\\renderer\\\\app.js',
        '```\nconst x = 1;\nfunction wrap() { return x; }\n```',
      ].join('\n');
      await page.locator('#chat-input').fill(longBits);
      await page.locator('#btn-chat-send').click();
      await page.waitForTimeout(800);
      const layout = (await page.evaluate(`(() => {
        const doc = document.documentElement;
        const turns = document.getElementById('chat-turns');
        const turnText = turns && turns.querySelector('.chat-text, .chat-turn, li');
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          innerWidth: window.innerWidth,
          turnsScrollWidth: turns ? turns.scrollWidth : 0,
          turnsClientWidth: turns ? turns.clientWidth : 0,
          turnOverflowX: turnText ? getComputedStyle(turnText).overflowX : '',
        };
      })()`)) as {
        scrollWidth: number;
        clientWidth: number;
        innerWidth: number;
        turnsScrollWidth: number;
        turnsClientWidth: number;
        turnOverflowX: string;
      };
      assert.ok(
        layout.scrollWidth <= layout.innerWidth + 2,
        `页面被横向撑破 scrollWidth=${layout.scrollWidth} innerWidth=${layout.innerWidth}`,
      );
      if (layout.turnsScrollWidth && layout.turnsClientWidth) {
        assert.ok(layout.turnsScrollWidth <= layout.turnsClientWidth + 24);
      }

      const previewHtml = path.join(os.tmpdir(), 'digitalme-owner-accept-20260831', 'slide-previews', 'index.html');
      try {
        const html = await fs.readFile(previewHtml, 'utf8');
        const pngDir = path.join(os.tmpdir(), 'digitalme-owner-accept-20260831', 'slide-renders');
        await fs.mkdir(pngDir, { recursive: true });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const slides = page.locator('.slide');
        const count = await slides.count();
        for (let i = 0; i < count; i += 1) {
          await slides.nth(i).screenshot({ path: path.join(pngDir, `slide-${i + 1}.png`) });
        }
      } catch {
        /* 预览 HTML 尚未写出时跳过 PNG，不把源码断言当渲染结论 */
      }
    } finally {
      await harness.close();
    }
  },
);
