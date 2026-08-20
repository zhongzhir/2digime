import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../json-store';
import { makeTempDir } from './helpers';

interface Sample {
  id: string;
  value: string;
}

test('put/get 往返与 list', async () => {
  const dir = await makeTempDir('store');
  const store = new JsonObjectStore<Sample>({ dir });
  await store.put({ id: 'obj_a', value: 'one' });
  await store.put({ id: 'obj_b', value: 'two' });
  assert.deepEqual(await store.get('obj_a'), { id: 'obj_a', value: 'one' });
  assert.equal(await store.get('obj_missing'), null);
  const all = await store.list();
  assert.equal(all.length, 2);
  const filtered = await store.list((o) => o.value === 'two');
  assert.deepEqual(filtered, [{ id: 'obj_b', value: 'two' }]);
});

test('重复 put 幂等', async () => {
  const dir = await makeTempDir('store-idem');
  const store = new JsonObjectStore<Sample>({ dir });
  await store.put({ id: 'obj_a', value: 'same' });
  await store.put({ id: 'obj_a', value: 'same' });
  assert.deepEqual(await store.get('obj_a'), { id: 'obj_a', value: 'same' });
  assert.equal((await store.list()).length, 1);
});

test('原子写产生 .bak,主文件损坏后由 .bak 恢复并上报', async () => {
  const dir = await makeTempDir('store-recover');
  const warnings: string[] = [];
  const store = new JsonObjectStore<Sample>({ dir, onWarning: (m) => warnings.push(m) });
  await store.put({ id: 'obj_a', value: 'v1' });
  await store.put({ id: 'obj_a', value: 'v2' }); // .bak = v1
  const mainFile = path.join(dir, 'obj_a.json');
  await fs.writeFile(mainFile, '{not-json', 'utf8'); // 模拟损坏
  const recovered = await store.get('obj_a');
  assert.deepEqual(recovered, { id: 'obj_a', value: 'v1' });
  assert.equal(warnings.length, 1);
  // 恢复已回写主文件
  assert.deepEqual(JSON.parse(await fs.readFile(mainFile, 'utf8')), { id: 'obj_a', value: 'v1' });
});

test('非法 id 拒绝(路径安全)', async () => {
  const dir = await makeTempDir('store-id');
  const store = new JsonObjectStore<Sample>({ dir });
  await assert.rejects(() => store.put({ id: '../escape', value: 'x' }), /invalid object id/);
  await assert.rejects(() => store.get('a/b'), /invalid object id/);
});
