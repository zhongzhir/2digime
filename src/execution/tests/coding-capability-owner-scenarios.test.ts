/**
 * Owner 场景 B/C 验收开关隔离 — 不得污染默认产品路径。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { probeCodexAvailability } from '../../capability/adapters/external-executor-codex';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ownerEnv = require('../../../electron/owner-scenario-env.cjs') as {
  resolveOwnerScenarioRuntimePatch: (env?: NodeJS.ProcessEnv) => {
    patch: Record<string, unknown>;
    active: boolean;
    forceAvailability: string | null;
    injectUnsupported: boolean;
  };
  applyOwnerScenarioPatch: (
    base: Record<string, unknown>,
    env?: NodeJS.ProcessEnv,
  ) => Record<string, unknown>;
  envForOwnerScene: (scene: string) => Record<string, string>;
  scrubOwnerScenarioEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

describe('coding-capability-owner-scenarios-close-01', () => {
  it('默认无环境变量时不产生 override patch', () => {
    const resolved = ownerEnv.resolveOwnerScenarioRuntimePatch({});
    assert.equal(resolved.active, false);
    assert.equal(resolved.forceAvailability, null);
    assert.equal(resolved.injectUnsupported, false);
    assert.deepEqual(resolved.patch, {});
  });

  it('父进程残留 FORCE 经 scrub 后场景 A 不受影响', () => {
    const dirty = {
      DIGITALME_CODING_CAPABILITY_FORCE: 'needs_setup',
      DIGITALME_INJECT_UNSUPPORTED_DESKTOP: '1',
      PATH: 'C:\\Windows',
    } as NodeJS.ProcessEnv;
    const scrubbed = ownerEnv.scrubOwnerScenarioEnv(dirty);
    assert.equal(scrubbed.DIGITALME_CODING_CAPABILITY_FORCE, undefined);
    assert.equal(scrubbed.DIGITALME_INJECT_UNSUPPORTED_DESKTOP, undefined);
    assert.equal(scrubbed.PATH, 'C:\\Windows');
    const forA = {
      ...scrubbed,
      ...ownerEnv.envForOwnerScene('a'),
    };
    const resolved = ownerEnv.resolveOwnerScenarioRuntimePatch(forA);
    assert.equal(resolved.active, false);
  });

  it('FORCE=needs_setup 只通过派生 options 生效；adapter 不读环境变量', async () => {
    const prev = process.env.DIGITALME_CODING_CAPABILITY_FORCE;
    process.env.DIGITALME_CODING_CAPABILITY_FORCE = 'needs_setup';
    try {
      // 业务层不读 env：无 options 时仍走真实探测路径（此处用不存在路径模拟未安装）
      const realPathProbe = await probeCodexAvailability(
        path.join(os.tmpdir(), 'dm-no-such-codex.js'),
      );
      assert.equal(realPathProbe.available, false);
      assert.equal(realPathProbe.reason, 'needs_setup');

      const forced = await probeCodexAvailability(undefined, {
        forceAvailability: 'needs_setup',
      });
      assert.equal(forced.available, false);
      assert.equal(forced.reason, 'needs_setup');
      assert.match(String(forced.detail), /尚未检测/);
      assert.equal(/DIGITALME_|FORCE/.test(String(forced.detail)), false);
    } finally {
      if (prev === undefined) delete process.env.DIGITALME_CODING_CAPABILITY_FORCE;
      else process.env.DIGITALME_CODING_CAPABILITY_FORCE = prev;
    }
  });

  it('场景 B：当前进程未配置；不创建失败 Task/Job；不落盘测试开关', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-scb-repo-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-scb-pkg-'));
    const env = ownerEnv.envForOwnerScene('b');
    const options = ownerEnv.applyOwnerScenarioPatch(
      {
        documentCapability: 'fake',
        codeAnalysisCapability: 'none',
      },
      env,
    );
    const rt = createDigitalMeRuntime(options as Parameters<typeof createDigitalMeRuntime>[0]);
    await rt.createPackage({ displayName: 'scb', targetDir: pkg });
    const listed = await rt.listCapabilities({ includeAvailability: true });
    assert.equal(listed.executorCapabilityCard?.available, false);
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(result.needsExecutorSetup);
    assert.equal(result.taskId, '');
    assert.equal(result.jobId, '');
    const tasks = await rt.listTasks({ limit: 10 });
    assert.equal(tasks.tasks.length, 0);
    const prefs = path.join(pkg, 'runtime', 'coding-capability-prefs.json');
    assert.equal(await fs.access(prefs).then(() => true).catch(() => false), false);
    const face = JSON.stringify(result.needsExecutorSetup);
    assert.equal(/DIGITALME_|FORCE|INJECT/i.test(face), false);
  });

  it('场景 C：unsupported 仅当前进程；不允许自动执行', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-scc-repo-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-scc-pkg-'));
    const env = ownerEnv.envForOwnerScene('c');
    const options = ownerEnv.applyOwnerScenarioPatch(
      {
        documentCapability: 'fake',
        codeAnalysisCapability: 'none',
      },
      env,
    );
    const rt = createDigitalMeRuntime(options as Parameters<typeof createDigitalMeRuntime>[0]);
    await rt.createPackage({ displayName: 'scc', targetDir: pkg });
    const listed = await rt.listCapabilities({ includeAvailability: true });
    const desk = (listed.codingCapabilities || []).find(
      (c) => c.invocationKind === 'desktop_handoff',
    );
    assert.ok(desk);
    assert.equal(desk!.availability, 'unsupported');
    assert.equal(desk!.supportsAutomaticExecution, false);
    assert.equal(/自动执行/.test(desk!.executionModeLabel), false);
    assert.equal(listed.executorCapabilityCard?.available, false);
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.equal(result.needsExecutionConfirm, undefined);
    assert.ok(result.needsExecutorSetup);
    assert.equal(result.taskId, '');
    assert.match(
      String(result.needsExecutorSetup!.message),
      /已检测|不能由 Digital Me 自动调用/,
    );
    assert.equal(/尚未检测到可用的代码执行能力/.test(String(result.needsExecutorSetup!.message)), false);
  });

  it('默认场景 A 不受 B/C 开关影响；同包去掉开关后恢复真实探测派生', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sca-repo-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sca-pkg-'));

    const blocked = createDigitalMeRuntime(
      ownerEnv.applyOwnerScenarioPatch(
        {
          documentCapability: 'fake',
          codeAnalysisCapability: 'none',
        },
        ownerEnv.envForOwnerScene('b'),
      ) as Parameters<typeof createDigitalMeRuntime>[0],
    );
    await blocked.createPackage({ displayName: 'sca', targetDir: pkg });
    const blockedSubmit = await blocked.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(blockedSubmit.needsExecutorSetup);

    // 同一 package，新进程无 B/C 开关，用 ready hook 模拟真实能力恢复
    const restored = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await restored.openPackage({ dir: pkg });
    const listed = await restored.listCapabilities({ includeAvailability: true });
    assert.equal(listed.executorCapabilityCard?.available, true);
    assert.equal(
      (listed.codingCapabilities || []).some((c) => c.invocationKind === 'desktop_handoff'),
      false,
    );
    const again = await restored.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(again.needsExecutionConfirm);
    assert.equal(again.needsExecutorSetup, undefined);
  });

  it('unsupported 注入不在默认产品选项中出现', () => {
    const base = ownerEnv.applyOwnerScenarioPatch(
      { documentCapability: 'fake' },
      {},
    );
    assert.equal(base.unsupportedDesktopCodingCapability, undefined);
    assert.equal(base.externalExecutorCapability, undefined);
  });

  it('验收环境可接通真实代码执行、备用运输与只读资料，且不污染默认路径', () => {
    const integrated = ownerEnv.applyOwnerScenarioPatch(
      { documentCapability: 'fake' },
      {
        DIGITALME_EXECUTOR_CLI_KIND: 'atomcode',
        DIGITALME_SECONDARY_HTTP_BASE_URL: 'http://127.0.0.1:9',
        DIGITALME_SECONDARY_HTTP_PASSWORD: 'x',
        DIGITALME_SECONDARY_HTTP_MODEL: 'internal/model',
        DIGITALME_MCP_ALLOWED_DIR: 'C:\\tmp\\notes',
        DIGITALME_MCP_LOOKUP_DIR: 'C:\\tmp\\notes\\notes',
        DIGITALME_MCP_ALLOWED_TOOLS: 'list_directory,read_text_file',
      },
    );
    assert.equal(
      (integrated.externalExecutorCapability as { cliKind?: string } | undefined)?.cliKind,
      'atomcode',
    );
    assert.equal(
      (integrated.secondaryExecutorCapability as { http?: { baseUrl?: string } } | undefined)?.http
        ?.baseUrl,
      'http://127.0.0.1:9',
    );
    assert.equal(
      (integrated.mcpReadonlyCapability as { queryMode?: string } | undefined)?.queryMode,
      'filesystem-lookup',
    );
    const scrubbed = ownerEnv.scrubOwnerScenarioEnv({
      DIGITALME_EXECUTOR_CLI_KIND: 'atomcode',
      DIGITALME_MCP_ALLOWED_DIR: 'C:\\tmp\\notes',
      PATH: 'C:\\Windows',
    } as NodeJS.ProcessEnv);
    assert.equal(scrubbed.DIGITALME_EXECUTOR_CLI_KIND, undefined);
    assert.equal(scrubbed.DIGITALME_MCP_ALLOWED_DIR, undefined);
    assert.equal(scrubbed.PATH, 'C:\\Windows');
    const def = ownerEnv.applyOwnerScenarioPatch({ documentCapability: 'fake' }, {});
    assert.equal(def.mcpReadonlyCapability, undefined);
    assert.equal(def.secondaryExecutorCapability, undefined);
  });

  it('启动器文案不向用户面强调环境变量名（checklist 使用 --scene）', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../scripts/start-software-dev-owner-acceptance.cjs'),
      'utf8',
    );
    assert.match(src, /--scene=a/);
    assert.match(src, /--scene=b/);
    assert.match(src, /--scene=c/);
    assert.match(src, /scrubOwnerScenarioEnv/);
    // Owner checklist 模板应使用 scene 开关，而非要求用户手敲测试注入变量名作为主路径
    assert.match(src, /--fresh-session --scene=b/);
    assert.match(src, /--resume-session/);
    assert.match(src, /--fixture-project/);
    assert.match(src, /resumeCommand/);
  });
});
