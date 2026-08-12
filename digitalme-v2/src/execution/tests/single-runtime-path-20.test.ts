/**
 * 2DIGIME-BUILD-01-SINGLE-RUNTIME-PATH-20
 * 唯一主链：converse → 模型规划 → 确认 → submitTask；封死无规划开始处理。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import {
  CONVERSE_PLAN_FAILED_NOTICE,
  CONVERSE_UNPARSEABLE_NOTICE,
  decideConverseEffects,
  extractJsonObject,
  isUserVisiblePlan,
  parseConverseModelOutput,
} from '../../work-runtime/work-converse';
import {
  resolveCodexLaunch,
  resolveCodexNativeExe,
  buildCodexExecArgs,
} from '../../capability/adapters/external-executor-codex';
import { hiddenSpawnOptions } from '../hidden-spawn';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string }>;
  };
  assertActionBudget: (view: {
    stage: string;
    actions: Array<{ id: string; label?: string; slot: string }>;
  }) => {
    ok: boolean;
    errors: string[];
  };
};

describe('single-runtime-path-20', () => {
  it('drafting without plan never exposes start_submit', () => {
    const view = ux.deriveWorkUxView({
      workMode: 'compose',
      hasPlanDraft: false,
      hasArtifact: false,
    });
    assert.equal(view.stage, 'drafting');
    assert.equal(view.actions.some((a) => a.id === 'start_submit'), false);
    const budget = ux.assertActionBudget(view);
    assert.equal(budget.ok, true);
  });

  it('JSON extract tolerates fences and surrounding prose', () => {
    const raw =
      '说明如下：\n```json\n{"intent":"add_goal_info","confidence":0.9,"reply":"明白","planUpdate":"目标：x"}\n```\n完';
    const extracted = extractJsonObject(raw);
    assert.ok(extracted);
    const parsed = parseConverseModelOutput(raw);
    assert.equal(parsed?.intent, 'add_goal_info');
    assert.equal(parsed?.planUpdate, '目标：x');
  });

  it('technical parse failure uses plan-failed notice, not 没听懂', () => {
    const d = decideConverseEffects({
      parsed: null,
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
    });
    assert.equal(d.reply, CONVERSE_PLAN_FAILED_NOTICE);
    assert.notEqual(d.reply, CONVERSE_UNPARSEABLE_NOTICE);
    assert.equal(d.needsClarification, false);
  });

  it('seed_internal is not user-visible', () => {
    assert.equal(isUserVisiblePlan({ source: 'seed_internal' }), false);
    assert.equal(isUserVisiblePlan({ source: 'model' }), true);
    assert.equal(isUserVisiblePlan({}), true);
  });

  it('modify_code without confirmedPlanVersion is rejected without Job', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-srp20-'));
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      converseChat: async () => ({
        text: JSON.stringify({
          intent: 'add_goal_info',
          confidence: 0.95,
          reply: '已理解目标并给出规划。',
          planUpdate: '目标：改 formatLabel\n交付：测试通过\n路径：修改并验证\n准备：项目文件夹\n边界：不推送',
        }),
      }),
      externalExecutorCapability: { forceAvailability: 'ready', executeHook: async () => ({ exitCode: 0, summary: 'ok', claimedChangedFiles: [] }) },
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: 'srp20', targetDir: path.join(root, 'pkg') });
    const proj = path.join(root, 'repo');
    await fs.mkdir(proj);
    await fs.writeFile(path.join(proj, 'index.js'), 'module.exports={}\n');
    const first = await bus.invoke('work.converse', {
      text: '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing',
      contextRefs: [{ kind: 'folder', path: proj }],
    });
    assert.ok(first.taskId);
    assert.equal(first.plan?.source, 'model');
    await assert.rejects(
      () =>
        bus.invoke('work.submitTask', {
          goal: '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing',
          contextRefs: [{ kind: 'folder', path: proj }],
          intentKind: 'modify_code',
          existingTaskId: first.taskId,
        }),
      (err: unknown) => (err as { code?: string }).code === 'plan_confirmation_required',
    );
    await runtime.stop();
  });

  it('Windows prefers native vendor codex.exe for launch; spawn options stay silent', () => {
    try {
      const launch = resolveCodexLaunch();
      if (process.platform === 'win32' && launch.mode === 'native') {
        assert.match(launch.executable, /codex\.exe$/i);
        assert.equal(launch.argsPrefix.length, 0);
        const native = resolveCodexNativeExe(launch.codexJsPath);
        assert.equal(native, launch.executable);
      }
      const opts = hiddenSpawnOptions({ env: process.env });
      assert.equal(opts.shell, false);
      assert.equal(opts.windowsHide, true);
      const cli = buildCodexExecArgs({
        codexJsPath: launch.codexJsPath,
        workingDirectory: 'D:\\proj',
        lastMessagePath: 'D:\\tmp\\last.txt',
      });
      assert.equal(cli[0], 'exec');
      assert.ok(!cli.some((a) => /codex\.js$/i.test(a)));
    } catch (err) {
      // 本机未安装 Codex 时跳过原生断言
      assert.match(String((err as Error).message || err), /尚未检测到|代码执行能力/);
    }
  });

  it('app.js seals legacy submit click path', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/app.js'),
      'utf8',
    );
    assert.match(src, /SINGLE-RUNTIME-PATH-20/);
    assert.match(src, /封死旧「开始处理」/);
    assert.match(src, /confirmPlanAndStartDevelopment/);
    assert.match(src, /seed_internal/);
  });
});
