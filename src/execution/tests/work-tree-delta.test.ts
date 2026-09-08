import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { diffWorkTree, snapshotWorkTree } from '../baseline';

test('work-tree delta：内容变了即使 mtime 被写回也必须是 modified', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-tree-hash-'));
  const file = path.join(dir, 'a.txt');
  await fs.writeFile(file, 'hello', 'utf8');
  const before = await snapshotWorkTree(dir);
  await fs.writeFile(file, 'world', 'utf8');
  const prev = before.get('a.txt');
  assert.ok(prev);
  await fs.utimes(file, new Date(prev.mtimeMs), new Date(prev.mtimeMs));
  const after = await snapshotWorkTree(dir);
  const delta = diffWorkTree(before, after);
  assert.deepEqual(delta.modified, ['a.txt']);
  assert.equal(delta.unchanged.includes('a.txt'), false);
});
