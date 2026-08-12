/**
 * 2DIGIME-BUILD-01-OWNER-REVISION-ROUTING-FIX-22
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { decideConverseEffects } from '../work-converse';
import {
  classifyOwnerRevisionRoute,
  isClearOwnerDirectedRevision,
  isVagueOwnerRevision,
} from '../work-revision-routing';
import { decideControlledRevision } from '../controlled-revision';

describe('owner-revision-routing-fix-22', () => {
  it('路由：明确修订 / 含糊 / 咨询', () => {
    assert.equal(
      classifyOwnerRevisionRoute({
        userText: '按你说的改吧：把 start 的返回值改成 done，并同步测试。',
        hasArtifact: true,
        intent: 'artifact_feedback',
      }),
      'user_directed_revision',
    );
    assert.equal(
      classifyOwnerRevisionRoute({
        userText: '我在想要不要把颜色换成蓝色系，你怎么看？',
        hasArtifact: true,
        intent: 'artifact_feedback',
      }),
      'clarify_revision',
    );
    assert.equal(
      classifyOwnerRevisionRoute({
        userText: '能不能用？是否达到目标？还需要修改吗？',
        hasArtifact: true,
      }),
      'consultation',
    );
    assert.equal(isClearOwnerDirectedRevision('把 start 改成 done'), true);
    assert.equal(isVagueOwnerRevision('我在想要不要再改改'), true);
  });

  it('decideConverseEffects：artifact_feedback 明确修订 → startAuthorized revision', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'artifact_feedback',
        confidence: 0.92,
        reply: '好的，我会把返回值改成 done 并同步测试。',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '按你说的改吧：把 start 的返回值改成 done，并同步测试。',
    });
    assert.equal(d.startAuthorized, true);
    assert.equal(d.startMode, 'revision');
    assert.equal(d.needsClarification, false);
  });

  it('decideConverseEffects：含糊修订 → 澄清且不授权', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'artifact_feedback',
        confidence: 0.9,
        reply: '可以再改改样式。',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '我在想要不要把颜色换成蓝色系，你怎么看？',
    });
    assert.equal(d.startAuthorized, false);
    assert.equal(d.needsClarification, true);
  });

  it('decideConverseEffects：咨询不授权执行', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'query_status',
        confidence: 0.95,
        reply: '现在还不建议当作可用版本。',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '能不能用？是否达到目标？还需要修改吗？有什么风险？建议下一步是什么？',
      consultContext: {
        goal: '改 formatLabel',
        stageLabel: '待你决定',
        hasArtifact: true,
        jobRunning: false,
        ownerDecision: 'undecided',
        ctoReport: '现在能不能用：否',
      },
    });
    assert.equal(d.startAuthorized, false);
    assert.equal(d.adoptRequested, false);
  });

  it('autoRevisionPaused=true 时 system_auto 仍被阻止', () => {
    const gate = decideControlledRevision({
      evidence: {
        decision: 'needs_revision',
        revisionPlan: '改成 done',
        checks: [{ id: 'goal', verdict: 'unsatisfied', detail: '仍返回 start-processing' }],
        failureMessage: '未达标',
      },
      confirmedPlanVersion: 2,
      hasConfirmedPlan: true,
      hasActiveJob: false,
      loop: {
        paused: true,
        pauseReason: 'user_pause',
        attempts: [],
        autoRoundCount: 1,
      },
      modelAvailable: true,
      pausedByUser: true,
      cancelled: false,
    });
    assert.equal(gate.action, 'noop');
    assert.equal(gate.stopReason, 'paused');
  });

  it('源码接线：Owner 修订优先用户原文；pause 不挡住 startAuthorized revision', async () => {
    const root = path.resolve(__dirname, '../../..');
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(app, /Owner 明确修订以用户原文为主/);
    assert.match(app, /startAuthorized && res\.startMode === "revision"/);
    const converse = await fs.readFile(path.join(root, 'src/work-runtime/work-converse.ts'), 'utf8');
    assert.match(converse, /classifyOwnerRevisionRoute/);
    assert.match(converse, /startMode === 'revision'/);
  });

  it('无 Artifact 时明确修改句不授权 revision', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'artifact_feedback',
        confidence: 0.95,
        reply: '好的。',
      },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
      userText: '把 start 改成 done',
    });
    assert.equal(d.startAuthorized, false);
  });
});
