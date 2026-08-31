/**
 * 使用反馈 P0：协作信息架构与助手身份（对照当前仓库实现，不按旧截图盲改）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { buildConverseSystemPrompt } from '../work-converse';
import { isTechnicalLeadTask } from '../remote-github-audit';

const repoRoot = path.resolve(__dirname, '../../..');

test('使用反馈 P0：协作入口与页面使用用户语言，并将动作和状态并列', async () => {
  const html = await fs.readFile(path.join(repoRoot, 'electron/renderer/index.html'), 'utf8');
  const css = await fs.readFile(path.join(repoRoot, 'electron/renderer/styles.css'), 'utf8');
  assert.match(html, /id="nav-collab">协作<\/button>/);
  assert.doesNotMatch(html, /协作（实验）|实验能力：协作|这是实验能力/);
  assert.match(html, /可以联系另一个用户的数字之我/);
  assert.match(html, /当前支持范围/);
  assert.match(html, /class="collab-home-split"/);
  assert.match(html, /aria-label="协作动作"/);
  assert.match(html, /aria-label="协作状态"/);
  assert.match(html, /id="collab-list-pending"/);
  assert.match(css, /\.collab-home-split\s*\{[\s\S]*grid-template-columns:/);
  assert.match(
    css,
    /@media \(max-width: 980px\)[\s\S]*\.collab-home-split\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  );
});

test('使用反馈 P0：默认是全能助手，仅技术任务使用技术负责人视角', () => {
  const writing = buildConverseSystemPrompt('根据已有文稿和 PPT 大纲，生成可下载的 Word 和 PPT 文件。');
  assert.match(writing, /全能助手/);
  assert.doesNotMatch(writing, /请以技术负责人的身份与用户讨论/);
  assert.match(writing, /禁止让用户运行脚本/);
  assert.match(writing, /可复制到其他 AI 工具的完整提示词/);

  const audit = buildConverseSystemPrompt('审计 github.com/zhongzhir 账号下的项目，看看有没有问题。');
  assert.match(audit, /技术负责人/);
  assert.equal(isTechnicalLeadTask('帮我规划下周学习和沟通安排'), false);
  assert.equal(isTechnicalLeadTask('审计 github.com/zhongzhir 账号下的项目'), true);
});
