import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { NdjsonEventLog } from '../event-log';
import { makeTempDir } from './helpers';

interface Evt {
  id: string;
  subjectId: string;
  n: number;
}

test('追加与按 subject 重放(保序)', async () => {
  const dir = await makeTempDir('log');
  const log = new NdjsonEventLog<Evt>({ dir });
  await log.append({ id: 'e1', subjectId: 'subj_a', n: 1 });
  await log.append({ id: 'e2', subjectId: 'subj_a', n: 2 });
  await log.append({ id: 'e3', subjectId: 'subj_b', n: 3 });
  const seen: number[] = [];
  for await (const event of log.replay('subj_a')) seen.push(event.n);
  assert.deepEqual(seen, [1, 2]);
});

test('重复 eventId 拒绝(含跨实例检测)', async () => {
  const dir = await makeTempDir('log-dup');
  const log = new NdjsonEventLog<Evt>({ dir });
  await log.append({ id: 'e1', subjectId: 'subj_a', n: 1 });
  await assert.rejects(() => log.append({ id: 'e1', subjectId: 'subj_a', n: 9 }), /duplicate event id/);
  const reopened = new NdjsonEventLog<Evt>({ dir });
  await assert.rejects(
    () => reopened.append({ id: 'e1', subjectId: 'subj_a', n: 9 }),
    /duplicate event id/,
  );
});

test('损坏行隔离并上报,不静默吞掉,原始日志保持不动', async () => {
  const dir = await makeTempDir('log-corrupt');
  const log = new NdjsonEventLog<Evt>({ dir });
  await log.append({ id: 'e1', subjectId: 'subj_a', n: 1 });
  const logFile = path.join(dir, 'subj_a.ndjson');
  await fs.appendFile(logFile, '{broken json line\n', 'utf8');
  await fs.appendFile(logFile, `${JSON.stringify({ id: 'e2', subjectId: 'subj_a', n: 2 })}\n`, 'utf8');

  const reports: string[] = [];
  const reopened = new NdjsonEventLog<Evt>({
    dir,
    onCorruptLine: (subjectId, lineNumber, reason) => reports.push(`${subjectId}:${lineNumber}:${reason}`),
  });
  const seen: number[] = [];
  for await (const event of reopened.replay('subj_a')) seen.push(event.n);

  assert.deepEqual(seen, [1, 2]); // 有效事件不受影响
  assert.equal(reports.length, 1);
  assert.match(reports[0] as string, /^subj_a:2:invalid json/);
  const quarantine = await fs.readFile(path.join(dir, 'subj_a.quarantine.ndjson'), 'utf8');
  assert.match(quarantine, /broken json line/);
  const original = await fs.readFile(logFile, 'utf8');
  assert.match(original, /broken json line/); // append-only:原始行未被改写
});

test('事件无修改 API(类型层保证)且序列化单行', async () => {
  const dir = await makeTempDir('log-immutable');
  const log = new NdjsonEventLog<{ id: string; subjectId: string; text: string }>({ dir });
  await log.append({ id: 'e1', subjectId: 'subj_a', text: 'line1\nline2' }); // JSON.stringify 转义换行
  const raw = await fs.readFile(path.join(dir, 'subj_a.ndjson'), 'utf8');
  assert.equal(raw.trimEnd().split('\n').length, 1);
});
