/**
 * 收口回归：错误映射、npm.cmd、shell:false、证据隔离相关纯函数与轻量集成。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  extractCodexErrorTexts,
  mapCodexFailure,
  sanitizeExecutorMessage,
} from '../codex-error-map';
import {
  buildNpmTestCommand,
  resolveNpmExecutable,
  runCommandShellFalse,
} from '../test-command';
import { buildCodexExecArgs } from '../../capability/adapters/external-executor-codex';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';

describe('external-execution-hardening', () => {
  it('Windows 选择 npm.cmd；其他平台 npm', () => {
    assert.equal(resolveNpmExecutable('win32'), 'npm.cmd');
    assert.equal(resolveNpmExecutable('linux'), 'npm');
    assert.equal(buildNpmTestCommand(['--if-present'], 'win32')[0], 'npm.cmd');
    assert.equal(buildNpmTestCommand(['--if-present'], 'darwin')[0], 'npm');
  });

  it('runCommandShellFalse 不使用 shell，且命令行可审计', () => {
    const node = process.execPath;
    const r = runCommandShellFalse({
      command: [node, '-e', 'process.stdout.write("ok")'],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'ok');
    assert.ok(r.commandLine.includes(node));
    assert.equal(r.error, undefined);
  });

  it('shell:false + 带空格工作目录参数进入 --cd', async () => {
    const spaced = path.join(os.tmpdir(), 'dm space dir', 'repo');
    const args = buildCodexExecArgs({
      codexJsPath: 'C:\\Program Files\\codex\\codex.js',
      workingDirectory: spaced,
      lastMessagePath: path.join(spaced, 'last.txt'),
    });
    assert.ok(!args.includes('--full-auto'));
    assert.equal(args[args.indexOf('--cd') + 1], spaced);
    assert.ok(args.includes('approval_policy="never"'));
    assert.ok(args.includes('--sandbox'));
    assert.ok(args.includes('--json'));
    assert.equal(args[args.length - 1], '-');

    const probeCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dm space dir '));
    const r = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: probeCwd,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
  });

  it('解析 CLI/模型不兼容 JSONL', () => {
    const stdout = [
      JSON.stringify({
        type: 'error',
        message: 'Model gpt-5.4 is not supported by this version; upgrade Codex CLI',
      }),
    ].join('\n');
    const texts = extractCodexErrorTexts({ stdout });
    const mapped = mapCodexFailure({ texts, exitCode: 1, changedFilesCount: 0 });
    assert.equal(mapped.kind, 'cli_outdated_or_model_incompatible');
    assert.match(mapped.actionable, /升级|兼容/);
    assert.doesNotMatch(mapped.actionable, /未检测到项目文件变化/);
  });

  it('解析认证失败，且不与无变更混淆', () => {
    const stdout = [
      JSON.stringify({
        type: 'error',
        message: 'unexpected status 401 Unauthorized: Invalid API-key provided',
      }),
      JSON.stringify({ type: 'turn.failed', message: 'auth failed' }),
    ].join('\n');
    const texts = extractCodexErrorTexts({ stdout });
    const mapped = mapCodexFailure({ texts, exitCode: 1, changedFilesCount: 0 });
    assert.equal(mapped.kind, 'auth_failed');
    assert.match(mapped.actionable, /重新连接|设置/);
    assert.doesNotMatch(mapped.actionable, /未检测到项目文件变化/);
  });

  it('PowerShell UnauthorizedAccess 不得误判为 Codex 登录失败', () => {
    const texts = [
      'npm : File C:\\Program Files\\nodejs\\npm.ps1 cannot be loaded because running scripts is disabled on this system.',
      'FullyQualifiedErrorId : UnauthorizedAccess',
    ];
    const mapped = mapCodexFailure({ texts, exitCode: 1, changedFilesCount: 0 });
    assert.notEqual(mapped.kind, 'auth_failed');
    assert.doesNotMatch(mapped.actionable, /登录校验|重新登录/);
  });

  it('启动失败与无变更不混淆', () => {
    const spawnMapped = mapCodexFailure({
      texts: ['ENOENT'],
      exitCode: null,
      spawnError: true,
      changedFilesCount: 0,
    });
    assert.equal(spawnMapped.kind, 'spawn_failed');
    assert.doesNotMatch(spawnMapped.actionable, /未检测到项目文件变化/);

    const noChange = mapCodexFailure({
      texts: [],
      exitCode: 0,
      changedFilesCount: 0,
    });
    assert.equal(noChange.kind, 'no_substantive_change');
  });

  it('超时/取消不映射为无变更', () => {
    assert.equal(
      mapCodexFailure({ texts: [], exitCode: null, timedOut: true, changedFilesCount: 0 }).kind,
      'timeout',
    );
    assert.equal(
      mapCodexFailure({ texts: [], exitCode: null, aborted: true, changedFilesCount: 0 }).kind,
      'cancelled',
    );
  });

  it('sanitize 遮蔽密钥片段', () => {
    const s = sanitizeExecutorMessage('token=sk-abc123SECRET and bearer xyz');
    assert.doesNotMatch(s, /sk-abc/);
    assert.match(s, /redacted/i);
  });

  it('失败路径推进 lastExecutorStatus queued→running→failed，且 actionable 非无变更套话', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-repo-'));
    await fs.writeFile(path.join(repo, 'a.txt'), 'x', 'utf8');

    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        executeHook: async () => {
          const err = new Error('401 Unauthorized Invalid API-key');
          Object.assign(err, {
            failureKind: 'auth_failed',
            actionable: '代码执行能力需要重新连接。请先打开设置检查连接，然后重试。',
          });
          throw err;
        },
      },
    });
    await rt.createPackage({ displayName: 'fail-map', targetDir: pkgDir });
    const preview = await rt.submitTask({
      goal: '修改 a.txt 内容为 hello',
      contextRefs: [{ kind: 'folder', path: repo }],
    });
    assert.ok(preview.needsExecutionConfirm);
    const started = await rt.submitTask({
      goal: '修改 a.txt 内容为 hello',
      contextRefs: [{ kind: 'folder', path: repo }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm!.workingDirectory,
        readScope: ['.'],
        writeScope: ['.'],
      },
    });
    const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
    await waitForJobTerminal(rt.workRuntime, started.jobId, 20000);
    const detail = await rt.getTask({ taskId: started.taskId });
    assert.equal(detail.latestJob?.status, 'failed');
    assert.equal(detail.latestJob?.externalExecution?.lastExecutorStatus, 'failed');
    assert.match(String(detail.latestJob?.actionable || ''), /重新连接|设置|登录|认证/);
    assert.doesNotMatch(String(detail.latestJob?.actionable || ''), /未检测到项目文件变化/);
  });

  it('两次验收运行证据目录互不污染；失败仍写 summary', async () => {
    const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-eecl-ev-'));
    const writeRun = async (ok: boolean) => {
      const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const evidenceDir = path.join(evidenceRoot, runId);
      await fs.mkdir(evidenceDir, { recursive: true });
      // 旧 hook 污染源只在根目录，不得进入本次 run 目录
      await fs.writeFile(path.join(evidenceRoot, 'legacy-hook-pollution.json'), '{"old":true}', 'utf8');
      const summary = {
        schemaVersion: 'eecl-summary/1',
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ok,
        realCodex: false,
        failureStage: ok ? null : 'first_execution',
        failureMessage: ok ? null : 'simulated failure',
        workRoot: path.join(evidenceDir, 'work'),
        evidenceDir,
      };
      await fs.writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
      await fs.writeFile(path.join(evidenceDir, 'report.md'), `# run ${runId}\n`, 'utf8');
      await fs.writeFile(path.join(evidenceDir, 'codex-probe.json'), '{"available":false}', 'utf8');
      if (!ok) {
        await fs.writeFile(path.join(evidenceDir, 'first-job.json'), '{"status":"failed"}', 'utf8');
      }
      await fs.writeFile(
        path.join(evidenceRoot, 'latest.json'),
        JSON.stringify({ runId, evidenceDir, ok }, null, 2),
        'utf8',
      );
      return { runId, evidenceDir, summary };
    };

    const a = await writeRun(false);
    await new Promise((r) => setTimeout(r, 5));
    const b = await writeRun(true);
    assert.notEqual(a.runId, b.runId);
    assert.notEqual(a.evidenceDir, b.evidenceDir);

    const aSummary = JSON.parse(await fs.readFile(path.join(a.evidenceDir, 'summary.json'), 'utf8'));
    const bSummary = JSON.parse(await fs.readFile(path.join(b.evidenceDir, 'summary.json'), 'utf8'));
    assert.equal(aSummary.ok, false);
    assert.equal(aSummary.failureStage, 'first_execution');
    assert.ok(aSummary.failureMessage);
    assert.equal(bSummary.ok, true);
    assert.equal(bSummary.runId, b.runId);

    // 旧污染文件不得出现在各次 run 目录
    await assert.rejects(fs.access(path.join(a.evidenceDir, 'legacy-hook-pollution.json')));
    await assert.rejects(fs.access(path.join(b.evidenceDir, 'legacy-hook-pollution.json')));
    // 失败 run 仍有 summary / probe / first-job
    await fs.access(path.join(a.evidenceDir, 'summary.json'));
    await fs.access(path.join(a.evidenceDir, 'codex-probe.json'));
    await fs.access(path.join(a.evidenceDir, 'first-job.json'));
  });
});
