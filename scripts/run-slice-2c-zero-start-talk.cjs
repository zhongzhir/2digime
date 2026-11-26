'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const gatewayUrl = 'https://relay.muhub.cn';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(executable, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true });
}

function git(args, cwd) {
  const result = run('git', args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function testProject(workspace, testFile) {
  const startedAt = new Date().toISOString();
  const result = run(process.execPath, ['--test', testFile], workspace);
  const finishedAt = new Date().toISOString();
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    exitCode: typeof result.status === 'number' ? result.status : -1,
    outputDigest: sha256(output),
    startedAt,
    finishedAt,
  };
}

function changedFiles(workspace) {
  const raw = git(['status', '--porcelain=v1', '-z'], workspace);
  return raw.split('\0').filter(Boolean).map((row) => row.slice(3).replace(/\\/g, '/'));
}

async function findRuntimeExe(root) {
  try {
    await fsp.access(root);
  } catch {
    return null;
  }
  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await visit(full);
        if (nested) return nested;
      } else if (/^opencode(\.exe)?$/i.test(entry.name)) {
        return full;
      }
    }
    return null;
  }
  return visit(root);
}

async function readAllowance(fetchManagedAiAllowance, installToken) {
  return fetchManagedAiAllowance({ gatewayUrl, installToken, timeoutMs: 10_000 });
}

async function main() {
  if (!fs.existsSync(path.join(repoRoot, 'dist', 'runtime', 'digitalme-runtime.js'))) {
    throw new Error('dist missing; run npm run build first');
  }
  const tokenFile = path.join(process.env.APPDATA || '', 'digitalme-v2', 'install-capability-token.json');
  const installToken = String(JSON.parse(await fsp.readFile(tokenFile, 'utf8')).token || '').trim();
  if (installToken.length < 16) throw new Error('managed install token unavailable');

  const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'slice-2c-projects', 'web-price-card');
  const runDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-slice-2c-zero-start-talk-'));
  const workspace = path.join(runDir, 'workspace');
  const packageRoot = path.join(runDir, 'package');
  const runtimeRoot = path.join(runDir, 'userData', 'runtimes');
  await fsp.cp(fixture, workspace, { recursive: true, force: false, errorOnExist: true });
  git(['init', '--quiet'], workspace);
  git(['config', 'user.name', '2digime zero-start gate'], workspace);
  git(['config', 'user.email', 'zero-start@invalid.local'], workspace);
  git(['add', '.'], workspace);
  git(['commit', '--quiet', '-m', 'fixture baseline'], workspace);
  const projectRevision = git(['rev-parse', 'HEAD'], workspace).trim();
  const testFile = 'test/price-card.test.cjs';
  const baseline = testProject(workspace, testFile);
  if (baseline.exitCode === 0) throw new Error('baseline must fail');

  const { createManagedAiChatComplete, fetchManagedAiAllowance } = require('../dist/capability/managed-ai-client');
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  const { talkThreadFilePath } = require('../dist/intelligence/store');
  const managedComplete = createManagedAiChatComplete({
    gatewayUrl,
    installToken,
    timeoutMs: 180_000,
  });
  const allowanceBefore = await readAllowance(fetchManagedAiAllowance, installToken);
  if (!allowanceBefore || allowanceBefore.status !== 'ACTIVE') throw new Error('managed AI allowance unavailable');

  let acquisitionPrepared = false;
  let expectedConfirmationToken = '';
  let lastDelegateResult = '';
  const talkChat = async (input) => {
    const system = String(input.messages?.[0]?.content || '');
    const lastToolText = String(
      [...(input.messages || [])].reverse().find((message) => message.role === 'tool')?.content || '',
    );
    if (/"confirmationRequired":true/.test(lastToolText)) {
      acquisitionPrepared = true;
      return { text: '需要获取并校验第三方成熟代码执行能力。运行包下载本身不收费，模型沿用兔机米现有免费额度。是否同意继续？' };
    }
    if (/"capabilityId":"cap_acquired_coding_runtime"/.test(lastToolText)) {
      lastDelegateResult = lastToolText;
      return { text: /"actualSuccess":true/.test(lastToolText)
        ? '已经完成价格格式修复，并在授权项目中运行了原有聚焦测试。'
        : '这次代码执行没有完成，项目没有被当作成功交付。' };
    }
    if (/待确认第三方能力获取机械事实/.test(system)) {
      const token = /一次性 acquisitionConfirmationToken：([0-9a-f-]{36})/i.exec(system)?.[1] || '';
      if (!token) throw new Error('acquisition confirmation token missing from second turn');
      if (expectedConfirmationToken && token !== expectedConfirmationToken) {
        throw new Error('acquisition confirmation token mismatch');
      }
      return {
        text: '',
        toolCalls: [{
          id: 'execute-zero-start',
          name: 'delegate',
          arguments: JSON.stringify({
            capabilityId: 'cap_acquired_coding_runtime',
            instruction: '修复现有价格卡格式化缺陷，保持现有模块形状；运行项目已有聚焦测试，确认价格始终保留两位小数。不要修改测试、提交、推送或联网搜索。',
            acquisitionConfirmationToken: token,
          }),
        }],
      };
    }
    if (acquisitionPrepared) {
      return { text: '需要获取并校验第三方成熟代码执行能力。运行包下载本身不收费，模型沿用兔机米现有免费额度。是否同意继续？' };
    }
    return {
      text: '',
      toolCalls: [{
        id: 'prepare-zero-start',
        name: 'delegate',
        arguments: JSON.stringify({
          capabilityId: 'cap_acquired_coding_runtime',
          instruction: '修复现有价格卡格式化缺陷，保持现有模块形状；运行项目已有聚焦测试，确认价格始终保留两位小数。不要修改测试、提交、推送或联网搜索。',
        }),
      }],
    };
  };

  const previousDeadline = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '900000';
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat,
    acquiredCodingCapability: {
      runtimeRoot,
      connection: {
        providerId: 'managed-ai',
        baseUrl: gatewayUrl,
        model: 'managed-ai',
        complete: managedComplete,
      },
      timeoutMs: 600_000,
    },
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'Slice 2C Zero-start', targetDir: packageRoot });
    const first = await bus.invoke('talk', {
      text: '请修复这个价格卡项目的金额格式问题并运行原有测试。',
      contextPaths: [workspace],
    });
    if (!String(first.view.turns.at(-1)?.text || '').includes('是否同意')) {
      throw new Error('first turn did not stop for acquisition consent');
    }
    if (changedFiles(workspace).length) throw new Error('workspace changed before acquisition consent');
    const firstThread = JSON.parse(await fsp.readFile(talkThreadFilePath(packageRoot), 'utf8'));
    const firstPreview = (firstThread.executions || [])
      .find((row) => row.capabilityId === 'prepare_capability_acquisition');
    expectedConfirmationToken = String(JSON.parse(firstPreview?.safeDetail || '{}').confirmationToken || '');
    if (!expectedConfirmationToken) throw new Error('persisted acquisition confirmation token missing');
    const second = await bus.invoke('talk', { text: '同意获取并继续。' });
    const final = testProject(workspace, testFile);
    const thread = JSON.parse(await fsp.readFile(talkThreadFilePath(packageRoot), 'utf8'));
    const execution = [...(thread.executions || [])]
      .reverse()
      .find((row) => row.capabilityId === 'cap_acquired_coding_runtime');
    const preview = (thread.executions || []).find((row) => row.capabilityId === 'prepare_capability_acquisition');
    const runtimeExe = await findRuntimeExe(runtimeRoot);
    const files = changedFiles(workspace);
    const allowanceAfter = await readAllowance(fetchManagedAiAllowance, installToken);
    const receipt = {
      schemaVersion: 'slice-2c-zero-start-talk/1',
      source: 'real_process',
      taskId: '2C-WEB-01',
      projectClass: 'web',
      arm: '2digime_orchestrated',
      runDir,
      workspace,
      projectRevision,
      baselineTest: baseline,
      finalTest: final,
      changedFiles: files,
      scopeBoundary: {
        policy: 'opencode_v1_external_directory_deny',
        operatingSystemSandbox: false,
        outsideScopeWritesProven: false,
      },
      consent: {
        prepared: Boolean(preview?.ok),
        executedAfterNextUserTurn: Boolean(execution),
        userText: '同意获取并继续。',
      },
      agent: runtimeExe
        ? {
            executorId: 'opencode-acquired-runtime',
            version: '1.18.29',
            executableDigest: sha256(await fsp.readFile(runtimeExe)),
          }
        : null,
      talkReceipt: {
        threadId: thread.threadId,
        executionId: execution?.id || '',
        artifactRefs: execution?.producedOutputs || [],
        userVisibleSummary: String(second.view.turns.at(-1)?.text || ''),
      },
      allowance: {
        beforePercent: allowanceBefore.remainingPercent,
        afterPercent: allowanceAfter?.remainingPercent ?? null,
        externalChargeIncurred: false,
        amountCny: 0,
      },
      localCodexUsed: false,
      delegateFailure: execution?.ok ? null : (() => {
        try {
          const parsed = JSON.parse(lastDelegateResult || '{}');
          return String(parsed.failureReason || parsed.summary || '').slice(0, 500) || null;
        } catch {
          return null;
        }
      })(),
      createdAt: new Date().toISOString(),
    };
    const receiptPath = path.join(runDir, 'evidence.json');
    await fsp.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      ok: final.exitCode === 0 && Boolean(execution?.ok) && files.length > 0,
      benchmarkEligible: false,
      benchmarkBlocker: 'no_os_level_outside_scope_write_proof_and_not_same_agent_build_as_direct_arm',
      runDir,
      receiptPath,
      finalExitCode: final.exitCode,
      changedFiles: files,
      executionOk: Boolean(execution?.ok),
      previewRecorded: Boolean(preview?.ok),
      agentVersion: receipt.agent?.version || null,
      allowanceBefore: receipt.allowance.beforePercent,
      allowanceAfter: receipt.allowance.afterPercent,
      localCodexUsed: false,
      delegateFailure: receipt.delegateFailure,
    })}\n`);
    if (!(final.exitCode === 0 && execution?.ok && files.length > 0)) process.exitCode = 1;
  } finally {
    await runtime.stop();
    if (previousDeadline === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = previousDeadline;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
