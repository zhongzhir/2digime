/**
 * Isolated real acquire (opt-in: DIGITALME_REAL_ACQUIRE=1).
 * 不进入默认快速回归；本任务会话会显式打开。
 */
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { acquireCapability } from '../acquire-capability';
import { createOpenCodeWindowsCandidate, probeOpencodeVersion } from '../coding-runtime-candidates';
import {
  OPENCODE_DEFAULT_MIRROR_URL,
  OPENCODE_GITHUB_ASSET_URL,
  OPENCODE_PINNED_VERSION,
} from '../coding-runtime-manifest';
import { createAcquiredCodingExecutorAdapter } from '../adapters/acquired-coding-executor';
import { providerCredentialKey } from '../../infrastructure/secret-store';

const enabled = process.env.DIGITALME_REAL_ACQUIRE === '1';

async function loadChatConnection(): Promise<{
  connection: { providerId: string; baseUrl: string; model: string };
  secrets: { get: (k: string) => Promise<string | null> };
} | null> {
  const file = path.resolve(
    __dirname,
    '../../../scripts/_mvp-p14-real-capability-evidence/.runtime-model-credential.json',
  );
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      providerId?: string;
    };
    const apiKey = String(raw.apiKey || '').trim();
    const baseUrl = String(raw.baseUrl || '').trim();
    const model = String(raw.model || '').trim();
    if (!apiKey || !baseUrl || !model) return null;
    const providerId = String(raw.providerId || 'openai-compatible').trim() || 'openai-compatible';
    return {
      connection: { providerId, baseUrl, model },
      secrets: { get: async (k) => (k === providerCredentialKey(providerId) ? apiKey : null) },
    };
  } catch {
    return null;
  }
}

describe('zero-start-acquisition-isolated-trial', { skip: !enabled }, () => {
  it(
    'Trial A GitHub source → checksum → extract → 1.18.29',
    { timeout: 600_000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-a-'));
      const candidate = createOpenCodeWindowsCandidate({
        sources: [{ id: 'github-release', url: OPENCODE_GITHUB_ASSET_URL }],
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, true, result.safeDetail || result.detail);
      assert.equal(result.version, OPENCODE_PINNED_VERSION);
      assert.equal(result.source, 'github-release');
      assert.ok(result.runtimePath);
      const probed = probeOpencodeVersion(result.runtimePath);
      assert.ok(probed && probed.includes(OPENCODE_PINNED_VERSION), String(probed));
      (globalThis as { __dmAcqRuntime?: string }).__dmAcqRuntime = result.runtimePath;
      (globalThis as { __dmAcqRoot?: string }).__dmAcqRoot = root;
    },
  );

  it(
    'Trial B source A 不可用时切到下一源，版本仍 1.18.29',
    { timeout: 600_000 },
    async () => {
      const dead = createServer((_req, res) => {
        res.statusCode = 404;
        res.end('no');
      });
      await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
      const addr = dead.address();
      if (!addr || typeof addr === 'string') throw new Error('no_port');
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-b-'));
      try {
        const candidate = createOpenCodeWindowsCandidate({
          sources: [
            { id: 'github-release', url: `http://127.0.0.1:${addr.port}/missing.zip` },
            { id: 'aliyun-oss-mirror', url: OPENCODE_DEFAULT_MIRROR_URL },
          ],
        });
        const result = await acquireCapability([candidate], { runtimeRoot: root });
        assert.equal(result.ok, true, result.safeDetail || result.detail);
        assert.equal(result.version, OPENCODE_PINNED_VERSION);
        assert.equal(result.source, 'aliyun-oss-mirror');
        assert.ok(result.sourceFailures?.some((f) => f.source === 'github-release'));
        assert.ok(result.runtimePath);
        const probed = probeOpencodeVersion(result.runtimePath);
        assert.ok(probed && probed.includes(OPENCODE_PINNED_VERSION), String(probed));
        (globalThis as { __dmAcqRoot?: string }).__dmAcqRoot = root;
        (globalThis as { __dmAcqSource?: string }).__dmAcqSource = result.source;
        console.log(
          JSON.stringify({
            trial: 'B',
            ok: result.ok,
            source: result.source,
            version: result.version,
            sourceFailures: result.sourceFailures,
            probed,
          }),
        );
      } finally {
        await new Promise<void>((resolve, reject) => dead.close((err) => (err ? reject(err) : resolve())));
      }
    },
  );

  it(
    'acquired runtime 修改授权项目且 Result Truth 为真',
    { timeout: 600_000 },
    async () => {
      const cred = await loadChatConnection();
      assert.ok(cred, '需要本机已有聊天模型凭证才能跑真实 Coding');
      const cachedRoot = (globalThis as { __dmAcqRoot?: string }).__dmAcqRoot;
      const runtimeRoot = cachedRoot || (await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-c-')));
      if (!cachedRoot) {
        const dead = createServer((_req, res) => {
          res.statusCode = 404;
          res.end('no');
        });
        await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
        const addr = dead.address();
        if (!addr || typeof addr === 'string') throw new Error('no_port');
        try {
          const candidate = createOpenCodeWindowsCandidate({
            sources: [
              { id: 'github-release', url: `http://127.0.0.1:${addr.port}/missing.zip` },
              { id: 'aliyun-oss-mirror', url: OPENCODE_DEFAULT_MIRROR_URL },
            ],
          });
          const acquired = await acquireCapability([candidate], { runtimeRoot });
          assert.equal(acquired.ok, true, acquired.safeDetail);
          assert.equal(acquired.source, 'aliyun-oss-mirror');
        } finally {
          await new Promise<void>((resolve, reject) => dead.close((err) => (err ? reject(err) : resolve())));
        }
      }
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-proj-'));
      await fs.writeFile(
        path.join(project, 'index.html'),
        '<!doctype html><html><body><p>hello</p></body></html>\n',
        'utf8',
      );
      await fs.writeFile(path.join(project, 'README.md'), 'plain page\n', 'utf8');
      const beforeHtml = await fs.readFile(path.join(project, 'index.html'), 'utf8');
      const adapter = createAcquiredCodingExecutorAdapter({
        runtimeRoot,
        connection: cred.connection,
      });
      const output = await adapter.execute(
        {
          goal: '给这个小网页增加明暗主题切换，并把使用方法补到 README。完成后检查一下修改是否合理。',
          artifactType: 'code-change',
          snapshot: {
            id: 'iso',
            taskId: 'talk',
            createdAt: new Date().toISOString(),
            items: [{ sourcePath: project, kind: 'folder-entry', status: 'ok' }],
          },
          subjectContext: { subjectId: 'iso', derivedAt: new Date().toISOString(), entries: [] },
          executionAuthorization: {
            confirmed: true,
            workingDirectory: project,
            readScope: ['.'],
            writeScope: ['.'],
          },
        },
        {
          jobId: 'iso1',
          reportProgress: () => undefined,
          signal: new AbortController().signal,
          secrets: cred.secrets,
          workDir: path.join(runtimeRoot, 'work-iso'),
        },
      );
      const afterHtml = await fs.readFile(path.join(project, 'index.html'), 'utf8');
      const afterReadme = await fs.readFile(path.join(project, 'README.md'), 'utf8');
      const names = await fs.readdir(project);
      const changedHtml = afterHtml !== beforeHtml;
      const changedReadme = afterReadme !== 'plain page\n';
      assert.equal(output.artifact.type, 'code-change');
      assert.equal(changedHtml, true, 'index.html 必须被真实修改');
      assert.equal(changedReadme, true, 'README.md 必须被真实修改');
      console.log(
        JSON.stringify({
          project,
          names,
          htmlChanged: changedHtml,
          readmeChanged: changedReadme,
          htmlBytes: Buffer.byteLength(afterHtml),
          readmeBytes: Buffer.byteLength(afterReadme),
          acquireSource: (globalThis as { __dmAcqSource?: string }).__dmAcqSource || 'aliyun-oss-mirror',
        }),
      );
    },
  );

  it(
    'OSS checksum mismatch 不 extract 不执行',
    { timeout: 600_000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-bad-'));
      const candidate = createOpenCodeWindowsCandidate({
        expectedSha256: 'aa'.repeat(32),
        sources: [{ id: 'aliyun-oss-mirror', url: OPENCODE_DEFAULT_MIRROR_URL }],
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, false);
      assert.equal(result.failureKind, 'integrity');
      assert.equal(result.sourceFailures?.[0]?.failureKind, 'integrity');
      await assert.rejects(() =>
        fs.stat(path.join(root, 'download', 'aliyun-oss-mirror-opencode-windows-x64.zip')),
      );
      await assert.rejects(() =>
        fs.stat(path.join(root, 'coding', 'opencode-windows-cli', 'opencode.exe')),
      );
    },
  );
});
