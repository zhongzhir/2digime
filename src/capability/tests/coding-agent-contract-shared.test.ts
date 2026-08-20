/**
 * 同一上层 Coding Agent 合同：CLI 与 HTTP 运输消费同一 ExecutorTaskPackage。
 * connector 细节不得进入 Job 真相源。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildExecutorTaskPackage } from '../../execution/task-package';
import type { ExecutorTaskPackage, ExecutorRunResult } from '../../execution/external-executor-contract';
import {
  buildOpenCodePromptMessage,
  parseInternalModelRef,
} from '../connectors/opencode-http';

function fakeCliConnector(pkg: ExecutorTaskPackage): Pick<ExecutorRunResult, 'executorId' | 'status' | 'summary' | 'exitCode'> {
  return {
    executorId: 'external-executor-codex-cli',
    status: 'succeeded',
    summary: `cli:${pkg.schemaVersion}:${pkg.jobId}`,
    exitCode: 0,
  };
}

function fakeHttpConnector(pkg: ExecutorTaskPackage): Pick<ExecutorRunResult, 'executorId' | 'status' | 'summary' | 'exitCode'> {
  return {
    executorId: 'external-executor-secondary-http',
    status: 'succeeded',
    summary: `http:${pkg.schemaVersion}:${pkg.jobId}`,
    exitCode: 0,
  };
}

describe('coding-agent shared contract', () => {
  it('CLI and HTTP connectors consume the same ExecutorTaskPackage', () => {
    const pkg = buildExecutorTaskPackage({
      taskId: 'task_1',
      jobId: 'job_1',
      goal: '库存扣减超过当前库存时不应该产生负库存。请定位并修复问题，补充必要测试，保持现有公共 API 不变。',
      workingDirectory: process.cwd(),
      executorId: 'shared',
      executorSelectionReason: 'explicit secondary',
    });
    assert.equal(pkg.schemaVersion, 'executor-task-package/1');
    const cli = fakeCliConnector(pkg);
    const http = fakeHttpConnector(pkg);
    assert.equal(cli.summary.startsWith('cli:executor-task-package/1:job_1'), true);
    assert.equal(http.summary.startsWith('http:executor-task-package/1:job_1'), true);
    assert.notEqual(cli.executorId, http.executorId);
  });

  it('internal model is connector config, not Agent identity', () => {
    const model = parseInternalModelRef('opencode-go/kimi-k2.7-code');
    assert.deepEqual(model, { providerID: 'opencode-go', modelID: 'kimi-k2.7-code' });
    const body = buildOpenCodePromptMessage('只描述问题，不要写修复步骤。', model);
    assert.equal(body.parts[0]?.text.includes('clamp'), false);
    assert.equal(body.parts[0]?.text.includes('Math.max'), false);
  });

  it('HTTP connector source never spawns opencode run', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../connectors/opencode-http.js'),
      'utf8',
    );
    assert.equal(src.includes('child_process'), false);
    assert.equal(/\bspawn\s*\(/.test(src), false);
    assert.match(src, /\/session\//);
    assert.match(src, /POST/);
  });
});
