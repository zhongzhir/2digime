import test from 'node:test';
import assert from 'node:assert/strict';
import { contentDigest, normalizeRelRef, normalizeText, sanitizeFileName } from '../digest';
import { artifactIdForJob } from '../../work-runtime/artifact';

test('换行规范化:CRLF/CR/LF 同 digest', () => {
  const lf = contentDigest('line1\nline2');
  assert.equal(contentDigest('line1\r\nline2'), lf);
  assert.equal(contentDigest('line1\rline2'), lf);
});

test('Unicode NFC 规范化:组合形式同 digest', () => {
  const composed = 'caf\u00e9'; // é
  const decomposed = 'cafe\u0301'; // e + 组合重音
  assert.equal(contentDigest(composed), contentDigest(decomposed));
  assert.equal(normalizeText(decomposed), composed);
});

test('同输入重复计算一致', () => {
  const input = '重复计算稳定性 test 123';
  assert.equal(contentDigest(input), contentDigest(input));
  assert.match(contentDigest(input), /^[0-9a-f]{64}$/);
});

test('artifactIdForJob 确定性且稳定', () => {
  assert.equal(artifactIdForJob('job_abc123'), 'art_abc123');
  assert.equal(artifactIdForJob('job_abc123'), artifactIdForJob('job_abc123'));
});

test('相对引用规范化与拒绝规则', () => {
  assert.equal(normalizeRelRef('text\\ab\\x.md'), 'text/ab/x.md');
  assert.throws(() => normalizeRelRef('../x'), /dot segments/);
  assert.throws(() => normalizeRelRef('C:/x'), /must be relative/);
  assert.throws(() => normalizeRelRef('/abs'), /must be relative/);
});

test('文件名安全化', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?.txt'), 'a_b_c_d_e_.txt');
  assert.equal(sanitizeFileName('...'), 'file');
});
