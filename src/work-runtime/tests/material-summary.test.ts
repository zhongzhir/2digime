import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialSummary, classifySkipReason } from '../material-summary';
import type { SnapshotItem } from '../context-snapshot';
import { buildAppliedUnderstanding } from '../../subject-core/user-facing-overview';

test('material summary: 已读与跳过计数与原因', () => {
  const items: SnapshotItem[] = [
    {
      sourcePath: '/tmp/a/notes.md',
      kind: 'folder-entry',
      status: 'ok',
      extractedTextRef: 'ref_1',
      relativePath: 'notes.md',
    },
    {
      sourcePath: '/tmp/a/skip.exe',
      kind: 'folder-entry',
      status: 'warning',
      warning: '格式暂不支持',
      relativePath: 'skip.exe',
    },
    {
      sourcePath: '/tmp/a/empty.txt',
      kind: 'folder-entry',
      status: 'warning',
      warning: '空文件',
      relativePath: 'empty.txt',
    },
    {
      sourcePath: '/tmp/a/bad.docx',
      kind: 'folder-entry',
      status: 'warning',
      warning: '无法读取: not a zip',
      relativePath: 'bad.docx',
    },
  ];
  const summary = buildMaterialSummary(items);
  assert.ok(summary);
  assert.equal(summary!.readCount, 1);
  assert.equal(summary!.skippedCount, 3);
  assert.match(summary!.summaryLine, /已读取 1 个文件/);
  assert.match(summary!.summaryLine, /3 个文件暂未纳入/);
  assert.equal(summary!.included[0]?.displayName, 'notes.md');
  assert.equal(summary!.skipped.find((s) => s.displayName === 'skip.exe')?.reason, '格式暂不支持');
  assert.equal(summary!.skipped.find((s) => s.displayName === 'empty.txt')?.reason, '空文件');
  assert.equal(summary!.skipped.find((s) => s.displayName === 'bad.docx')?.reason, '无法读取');
});

test('classifySkipReason: over_limit', () => {
  assert.equal(
    classifySkipReason({
      sourcePath: 'x',
      kind: 'file',
      status: 'warning',
      warning: '已达到扫描预算，输出为部分结果',
    }),
    'over_limit',
  );
});

test('buildAppliedUnderstanding: 固定文案且最多 3 条', () => {
  const now = new Date().toISOString();
  const applied = buildAppliedUnderstanding({
    schemaVersion: 1,
    subjectId: 's',
    selectedEventIds: ['e1', 'e2', 'e3', 'e4'],
    entries: [
      { eventId: 'e1', kind: 'preference', title: '结论先行', detail: '先写结论', tags: [], occurredAt: now },
      { eventId: 'e2', kind: 'experience', title: '精简', detail: '控制篇幅', tags: [], occurredAt: now },
      { eventId: 'e3', kind: 'principle', title: '决策事项', detail: '只保留决策', tags: [], occurredAt: now },
      { eventId: 'e4', kind: 'goal', title: '不应出现', detail: '第四条', tags: [], occurredAt: now },
    ],
    selectionReasons: [],
    excludedEventIds: [],
    subjectContextDigest: 'd',
  });
  assert.ok(applied);
  assert.equal(applied!.notice, '已结合你之前确认的内容');
  assert.equal(applied!.items.length, 3);
  assert.ok(!applied!.items.some((i) => /不应出现/.test(i.text)));
});

test('buildAppliedUnderstanding: 无注入时不返回', () => {
  assert.equal(buildAppliedUnderstanding(null), undefined);
  assert.equal(
    buildAppliedUnderstanding({
      schemaVersion: 1,
      subjectId: 's',
      selectedEventIds: [],
      entries: [],
      selectionReasons: [],
      excludedEventIds: [],
      subjectContextDigest: 'd',
    }),
    undefined,
  );
});
