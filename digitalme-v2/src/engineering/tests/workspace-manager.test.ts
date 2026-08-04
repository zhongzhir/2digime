import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  IsolatedWorkspaceManager,
  WorkspacePathEscapeError,
  digestTree,
} from '../workspace-manager';
import {
  CODING_AGENT_DEFAULT_ACTIONS,
  codingAgentMayHold,
  maxPermissionLevel,
} from '../../capability/adapters/software-engineering-contract';

test('P2B.1 workspace copies source without node_modules and records digest', async () => {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-src-'));
  await fs.writeFile(path.join(src, 'a.txt'), 'hello', 'utf8');
  await fs.mkdir(path.join(src, 'node_modules'));
  await fs.writeFile(path.join(src, 'node_modules', 'x.js'), 'no', 'utf8');
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-parent-'));
  const mgr = new IsolatedWorkspaceManager();
  const ws = await mgr.create({ sourceRoot: src, parentDir: parent });
  assert.ok(ws.baseDigest.length === 64);
  assert.equal(await fs.readFile(path.join(ws.rootPath, 'a.txt'), 'utf8'), 'hello');
  await assert.rejects(() => fs.access(path.join(ws.rootPath, 'node_modules', 'x.js')));
});

test('P2B.1 path escape is rejected', async () => {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-src2-'));
  await fs.writeFile(path.join(src, 'a.txt'), 'x', 'utf8');
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-parent2-'));
  const mgr = new IsolatedWorkspaceManager();
  const ws = await mgr.create({ sourceRoot: src, parentDir: parent });
  assert.throws(() => mgr.resolveInside(ws, '../outside.txt'), WorkspacePathEscapeError);
});

test('P2B.1 coding agent default permissions stay L1', () => {
  assert.equal(maxPermissionLevel(CODING_AGENT_DEFAULT_ACTIONS), 'L1');
  assert.equal(codingAgentMayHold([...CODING_AGENT_DEFAULT_ACTIONS, 'repository_apply']), false);
});

test('digest changes when file content changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-dig-'));
  await fs.writeFile(path.join(dir, 'a.txt'), '1', 'utf8');
  const d1 = await digestTree(dir, new Set());
  await fs.writeFile(path.join(dir, 'a.txt'), '2', 'utf8');
  const d2 = await digestTree(dir, new Set());
  assert.notEqual(d1, d2);
});
