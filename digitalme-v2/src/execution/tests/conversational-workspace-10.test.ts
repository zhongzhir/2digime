/**
 * 2DIGIME-BUILD-01-CONVERSATIONAL-WORKSPACE-10
 * 做事页收敛为持续 Owner—Digital Me 自然语言工作空间（隔离断言，不碰 MUHUB）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const conv = require('../../../electron/renderer/work-conversation.js') as {
  buildWorkTimeline: (input: Record<string, unknown>) => Array<{
    role: string;
    kind: string;
    text: string;
    actions?: Array<{ id: string; label: string }>;
  }>;
  routeWorkNaturalLanguage?: unknown;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    statusLine: string;
    actions: Array<{ id: string; label: string; slot: string }>;
  };
};

const root = path.resolve(__dirname, '../../..');

describe('CONVERSATIONAL-WORKSPACE-10', () => {
  it('首轮成果时间线必含 Digital Me 自然语言验收说明', () => {
    const turns = conv.buildWorkTimeline({
      goal: '优化首页信息层级',
      ctoReport: '本轮成果尚未完全达到目标：构建仍有失败。建议继续修正。',
      userFacingNextStep: '请在对话区说明你更在意的改动点，或发送「按建议继续」。',
      canAdoptSuggested: false,
      hasArtifact: true,
      artifactVersionId: 'ver_1',
    });
    assert.ok(turns.some((t) => t.role === 'user' && t.kind === 'goal'));
    const acceptance = turns.find((t) => t.kind === 'acceptance');
    assert.ok(acceptance);
    assert.match(acceptance!.text, /尚未|建议|目标/);
    assert.ok(turns.some((t) => t.kind === 'next_step'));
    assert.ok(!acceptance!.actions?.some((a) => a.id === 'confirm_adopt'));
  });

  it('达标建议采用时，确认采用出现在验收消息附近', () => {
    const turns = conv.buildWorkTimeline({
      goal: '优化首页',
      ctoReport: '本轮成果已达到目标，建议采用当前版本。',
      canAdoptSuggested: true,
      hasArtifact: true,
      artifactVersionId: 'ver_2',
    });
    const acceptance = turns.find((t) => t.kind === 'acceptance');
    assert.ok(acceptance?.actions?.some((a) => a.id === 'confirm_adopt' && a.label === '采用这份成果'));
  });

  it('D11-A：关键词路由已移除；未达标阶段主动作不再是修订按钮', () => {
    // 设计 v0.2 §9.1：意图由 AI 经 work.converse 判断；渲染层不做关键词路由
    assert.equal(conv.routeWorkNaturalLanguage, undefined);
    const view = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: false,
      jobStatus: 'succeeded',
    });
    assert.equal(view.stage, 'needs_revision');
    assert.ok(!view.actions.some((a) => a.id === 'continue_revise' && a.slot === 'primary'));
  });

  it('执行失败后仍可自然语言交流；重试不是唯一出路', () => {
    const turns = conv.buildWorkTimeline({
      goal: '实现 clampString',
      jobFailed: true,
      failureMessage: '本轮执行未能完成：依赖安装失败。',
    });
    const fail = turns.find((t) => t.kind === 'failure');
    assert.ok(fail);
    assert.match(fail!.text, /未能完成|建议|说明/);
    assert.ok(fail!.actions?.some((a) => a.id === 'retry_job'));

    const blocked = ux.deriveWorkUxView({ jobStatus: 'failed' });
    assert.equal(blocked.stage, 'blocked');
    assert.match(blocked.statusLine, /对话区/);
    const retry = blocked.actions.find((a) => a.id === 'retry_job');
    assert.ok(retry);
    assert.equal(retry!.slot, 'primary');
    assert.match(blocked.statusLine, /对话区/);
  });

  it('renderer：中栏对话 + 固定 NL + 右栏空成果文案 + 不重复 CTO 长报告', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
    assert.match(html, /id="work-timeline"/);
    assert.match(html, /id="work-nl-input"/);
    assert.match(html, /id="btn-work-nl-send"/);
    assert.match(html, /尚未形成可交付成果/);
    assert.match(html, /Digital Me 的结论/);
    assert.match(html, /id="cc-tech-evidence"/);
    assert.match(html, /work-conversation\.js/);
    assert.match(appJs, /function submitWorkNaturalLanguage/);
    assert.match(appJs, /function renderWorkTimeline/);
    assert.match(appJs, /ccCtoReport|ctoReport/);
    assert.match(appJs, /确认采用「/);
    assert.match(appJs, /结束当前交付循环/);
    assert.match(css, /\.work-nl-composer/);
    assert.match(css, /\.work-timeline/);
  });
});
