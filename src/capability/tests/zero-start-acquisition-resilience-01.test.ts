/**
 * DIGITALME-ZERO-START-ACQUISITION-RESILIENCE-01
 * 下载运输回归：302、HTTP 错误、timeout、checksum、fallback、失败真相。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DownloadError, downloadVerifiedFile } from '../http-download';
import { acquireCapability } from '../acquire-capability';
import { createOpenCodeWindowsCandidate } from '../coding-runtime-candidates';
import {
  OPENCODE_PINNED_VERSION,
  OPENCODE_ASSET_SHA256,
  OPENCODE_GITHUB_ASSET_URL,
  OPENCODE_DEFAULT_MIRROR_URL,
  defaultOpencodeSources,
} from '../coding-runtime-manifest';
import { createAcquiredCodingExecutorAdapter } from '../adapters/acquired-coding-executor';
import { mapChatModelToProviderEnv } from '../chat-model-credential-bridge';

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no_port');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dm-acq-'));
}

describe('zero-start-acquisition-resilience-01', () => {
  it('A 302 → 200 写出完整文件', async () => {
    const body = Buffer.from('opencode-zip-bytes');
    const expected = sha256Hex(body);
    const srv = await listen((req, res) => {
      if (req.url === '/start') {
        res.statusCode = 302;
        res.setHeader('Location', '/file');
        res.end();
        return;
      }
      if (req.url === '/file') {
        res.statusCode = 200;
        res.end(body);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const dir = await tmpDir();
    const dest = path.join(dir, 'a.zip');
    try {
      const got = await downloadVerifiedFile({
        url: `${srv.url}/start`,
        dest,
        expectedSha256: expected,
        connectTimeoutMs: 5_000,
        idleTimeoutMs: 5_000,
      });
      assert.equal(got.sha256, expected);
      assert.deepEqual(await fs.readFile(dest), body);
    } finally {
      await srv.close();
    }
  });

  it('B 404 → failureKind=http_status', async () => {
    const srv = await listen((_req, res) => {
      res.statusCode = 404;
      res.end('missing');
    });
    const dest = path.join(await tmpDir(), 'b.zip');
    try {
      await assert.rejects(
        () =>
          downloadVerifiedFile({
            url: srv.url,
            dest,
            expectedSha256: '00'.repeat(32),
            connectTimeoutMs: 5_000,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DownloadError);
          assert.equal(err.failureKind, 'http_status');
          assert.match(err.safeDetail, /http_404/);
          return true;
        },
      );
      await assert.rejects(() => fs.stat(dest));
    } finally {
      await srv.close();
    }
  });

  it('C 无响应必须 timeout，不能挂起', async () => {
    const srv = await listen(() => {
      /* never respond */
    });
    const dest = path.join(await tmpDir(), 'c.zip');
    const started = Date.now();
    try {
      await assert.rejects(
        () =>
          downloadVerifiedFile({
            url: srv.url,
            dest,
            expectedSha256: '00'.repeat(32),
            connectTimeoutMs: 400,
            idleTimeoutMs: 400,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DownloadError);
          assert.equal(err.failureKind, 'timeout');
          return true;
        },
      );
      assert.ok(Date.now() - started < 5_000);
    } finally {
      await srv.close();
    }
  });

  it('D checksum mismatch 删除文件且 failureKind=integrity', async () => {
    const body = Buffer.from('tampered');
    const srv = await listen((_req, res) => {
      res.statusCode = 200;
      res.end(body);
    });
    const dest = path.join(await tmpDir(), 'd.zip');
    try {
      await assert.rejects(
        () =>
          downloadVerifiedFile({
            url: srv.url,
            dest,
            expectedSha256: 'aa'.repeat(32),
            connectTimeoutMs: 5_000,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DownloadError);
          assert.equal(err.failureKind, 'integrity');
          return true;
        },
      );
      await assert.rejects(() => fs.stat(dest));
    } finally {
      await srv.close();
    }
  });

  it('E source A 失败后 source B 成功 → READY', async () => {
    const body = Buffer.from('ok-zip');
    const expected = sha256Hex(body);
    const srv = await listen((req, res) => {
      if (req.url === '/bad') {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end(body);
    });
    const root = await tmpDir();
    try {
      const candidate = createOpenCodeWindowsCandidate({
        expectedSha256: expected,
        expectedVersion: OPENCODE_PINNED_VERSION,
        sources: [
          { id: 'github-release', url: `${srv.url}/bad` },
          { id: 'aliyun-oss-mirror', url: `${srv.url}/good` },
        ],
        extractZip: async (_zip, destDir) => {
          await fs.mkdir(destDir, { recursive: true });
          await fs.writeFile(path.join(destDir, 'opencode.exe'), 'stub', 'utf8');
        },
        probeVersion: () => OPENCODE_PINNED_VERSION,
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, true);
      assert.equal(result.status, 'ready');
      assert.equal(result.source, 'aliyun-oss-mirror');
      assert.equal(result.version, OPENCODE_PINNED_VERSION);
      assert.ok(result.sourceFailures?.some((f) => f.source === 'github-release'));
    } finally {
      await srv.close();
    }
  });

  it('F 全部来源失败保留内部 failure，且不得说连接聊天模型', async () => {
    const srv = await listen((_req, res) => {
      res.statusCode = 503;
      res.end('down');
    });
    const root = await tmpDir();
    try {
      const candidate = createOpenCodeWindowsCandidate({
        expectedSha256: OPENCODE_ASSET_SHA256,
        sources: [
          { id: 'github-release', url: `${srv.url}/a` },
          { id: 'aliyun-oss-mirror', url: `${srv.url}/b` },
        ],
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, false);
      assert.equal(result.status, 'failed');
      assert.equal(result.failureKind, 'http_status');
      assert.ok(result.sourceFailures && result.sourceFailures.length === 2);
      const blob = JSON.stringify(result);
      assert.equal(/聊天模型|请先连接/.test(blob), false);
    } finally {
      await srv.close();
    }
  });

  it('acquire 失败文案不得误报模型未连接', async () => {
    const adapter = createAcquiredCodingExecutorAdapter({
      runtimeRoot: await tmpDir(),
      acquireHook: async () => ({
        status: 'failed',
        ok: false,
        failureKind: 'timeout',
        safeDetail: 'idle_timeout',
        detail: 'idle_timeout',
      }),
    });
    const dir = await tmpDir();
    await assert.rejects(
      () =>
        adapter.execute(
          {
            goal: '改网页',
            artifactType: 'code-change',
            snapshot: {
              id: 's',
              taskId: 'talk',
              createdAt: new Date().toISOString(),
              items: [{ sourcePath: dir, kind: 'folder-entry', status: 'ok' }],
            },
            subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
            executionAuthorization: {
              confirmed: true,
              workingDirectory: dir,
              readScope: ['.'],
              writeScope: ['.'],
            },
          },
          {
            jobId: 'j',
            reportProgress: () => undefined,
            signal: new AbortController().signal,
            secrets: { get: async () => 'key' },
            workDir: path.join(dir, 'work'),
          },
        ),
      (err: unknown) => {
        const text = `${(err as Error).message} ${String((err as { actionable?: string }).actionable || '')}`;
        assert.match(text, /没有改动你的项目/);
        assert.equal(/聊天模型/.test(text), false);
        assert.equal((err as { safeDetail?: string }).safeDetail, 'idle_timeout');
        assert.equal((err as { failureKind?: string }).failureKind, 'timeout');
        return true;
      },
    );
  });

  it('runtime READY 之后凭证桥失败才谈模型连接', async () => {
    const bridged = await mapChatModelToProviderEnv({
      secrets: { get: async () => null },
      connection: { providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'x' },
    });
    assert.equal(bridged, null);
    const adapter = createAcquiredCodingExecutorAdapter({
      runtimeRoot: await tmpDir(),
      acquireHook: async () => ({
        status: 'ready',
        ok: true,
        runtimePath: path.join(os.tmpdir(), 'opencode.exe'),
        version: OPENCODE_PINNED_VERSION,
        source: 'cached',
      }),
    });
    const dir = await tmpDir();
    await assert.rejects(
      () =>
        adapter.execute(
          {
            goal: '改网页',
            artifactType: 'code-change',
            snapshot: {
              id: 's',
              taskId: 'talk',
              createdAt: new Date().toISOString(),
              items: [{ sourcePath: dir, kind: 'folder-entry', status: 'ok' }],
            },
            subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
            executionAuthorization: {
              confirmed: true,
              workingDirectory: dir,
              readScope: ['.'],
              writeScope: ['.'],
            },
          },
          {
            jobId: 'j',
            reportProgress: () => undefined,
            signal: new AbortController().signal,
            secrets: { get: async () => null },
            workDir: path.join(dir, 'work'),
          },
        ),
      (err: unknown) => {
        assert.match(String((err as { actionable?: string }).actionable || ''), /连接模型/);
        assert.equal((err as { failureKind?: string }).failureKind, 'MODEL FAILURE');
        return true;
      },
    );
  });

  it('下载中途无进度会 timeout 并删除部分文件', async () => {
    const srv = await listen((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.write('partial');
      /* 不再继续写，迫使 idle timeout */
    });
    const dest = path.join(await tmpDir(), 'partial.zip');
    try {
      await assert.rejects(
        () =>
          downloadVerifiedFile({
            url: srv.url,
            dest,
            expectedSha256: '00'.repeat(32),
            connectTimeoutMs: 5_000,
            idleTimeoutMs: 400,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DownloadError);
          assert.equal(err.failureKind, 'timeout');
          return true;
        },
      );
      await assert.rejects(() => fs.stat(dest));
    } finally {
      await srv.close();
    }
  });

  it('extract 找不到 exe → extract，不执行', async () => {
    const body = Buffer.from('zip-no-exe');
    const expected = sha256Hex(body);
    const srv = await listen((_req, res) => {
      res.statusCode = 200;
      res.end(body);
    });
    const root = await tmpDir();
    try {
      const candidate = createOpenCodeWindowsCandidate({
        expectedSha256: expected,
        expectedVersion: OPENCODE_PINNED_VERSION,
        sources: [{ id: 'github-release', url: srv.url }],
        extractZip: async (_zip, destDir) => {
          await fs.mkdir(destDir, { recursive: true });
          await fs.writeFile(path.join(destDir, 'readme.txt'), 'no exe', 'utf8');
        },
        probeVersion: () => OPENCODE_PINNED_VERSION,
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, false);
      assert.equal(result.failureKind, 'extract');
      assert.equal(result.sourceFailures?.[0]?.failureKind, 'extract');
    } finally {
      await srv.close();
    }
  });

  it('version 不符 → version，删除目录不执行', async () => {
    const body = Buffer.from('zip-wrong-ver');
    const expected = sha256Hex(body);
    const srv = await listen((_req, res) => {
      res.statusCode = 200;
      res.end(body);
    });
    const root = await tmpDir();
    try {
      const candidate = createOpenCodeWindowsCandidate({
        expectedSha256: expected,
        expectedVersion: OPENCODE_PINNED_VERSION,
        sources: [{ id: 'github-release', url: srv.url }],
        extractZip: async (_zip, destDir) => {
          await fs.mkdir(destDir, { recursive: true });
          await fs.writeFile(path.join(destDir, 'opencode.exe'), 'stub', 'utf8');
        },
        probeVersion: () => '1.18.30',
      });
      const result = await acquireCapability([candidate], { runtimeRoot: root });
      assert.equal(result.ok, false);
      assert.equal(result.failureKind, 'version');
      await assert.rejects(() =>
        fs.stat(path.join(root, 'coding', 'opencode-windows-cli', 'opencode.exe')),
      );
    } finally {
      await srv.close();
    }
  });

  it('清单冻结 1.18.29 与官方 SHA256，不追 latest', () => {
    assert.equal(OPENCODE_PINNED_VERSION, '1.18.29');
    assert.equal(
      OPENCODE_ASSET_SHA256,
      'b32618aa3d1415f6e4f473aec248edef25759203fb707d7d968359d86d4a35ee',
    );
    assert.equal(/releases\/latest/.test(OPENCODE_GITHUB_ASSET_URL), false);
    assert.match(OPENCODE_GITHUB_ASSET_URL, /v1\.18\.29\/opencode-windows-x64\.zip$/);
    assert.match(
      OPENCODE_DEFAULT_MIRROR_URL,
      /2digime-runtime-mirror-cn\.oss-cn-hangzhou\.aliyuncs\.com\/opencode\/1\.18\.29\//,
    );
    const sources = defaultOpencodeSources();
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.id, 'github-release');
    assert.equal(sources[1]?.id, 'aliyun-oss-mirror');
  });
});
