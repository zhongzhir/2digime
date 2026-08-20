/**
 * CONVERSATIONAL-WORKSPACE-10A — 确认采用仅属中栏 Digital Me 验收消息。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const conv = require('../../../electron/renderer/work-conversation.js') as {
  buildWorkTimeline: (input: Record<string, unknown>) => Array<{
    kind: string;
    actions?: Array<{ id: string; label: string }>;
  }>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string; column: string }>;
  };
  assertActionBudget: (view: {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string; column: string }>;
  }) => { ok: boolean; errors: string[] };
};

const root = path.resolve(__dirname, '../../..');

describe('CONVERSATIONAL-WORKSPACE-10A interaction ownership', () => {
  it('达标时确认采用只出现在中栏验收消息 actions', () => {
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

  it('needs_review 右栏 UX 不派生确认采用', () => {
    const view = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: true,
      jobStatus: 'succeeded',
      codeChange: true,
    });
    assert.equal(view.stage, 'needs_review');
    assert.ok(!view.actions.some((a) => a.id === 'accept'));
    assert.equal(ux.assertActionBudget(view).ok, true);
  });

  it('renderer 强制隐藏右栏确认采用按钮；中栏仍处理 confirm_adopt', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const stageJs = await fs.readFile(path.join(root, 'electron/renderer/work-ux-stage.js'), 'utf8');
    assert.match(appJs, /确认采用仅在中栏时间线/);
    assert.match(appJs, /actionId === "confirm_adopt"/);
    assert.match(stageJs, /采用入口只在中栏|确认采用仅在中栏/);
    assert.doesNotMatch(
      stageJs,
      /stage === 'needs_review'[\s\S]{0,400}push\('accept',\s*'确认采用'/,
    );
  });
});
