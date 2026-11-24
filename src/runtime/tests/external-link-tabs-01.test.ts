import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

type WindowOpenDecision = { action: 'deny' };
type ExternalLinkModule = {
  externalWindowOpenDecision: (
    url: string,
    openExternal: (url: string) => Promise<void>,
  ) => WindowOpenDecision;
};

const externalLinks = require(path.join(process.cwd(), 'electron', 'external-links.cjs')) as ExternalLinkModule;

test('successive Discover card links are handed to the default browser without Electron popup replacement', async () => {
  const opened: string[] = [];
  const openExternal = async (url: string) => {
    opened.push(url);
  };

  const first = externalLinks.externalWindowOpenDecision('https://example.com/first', openExternal);
  const second = externalLinks.externalWindowOpenDecision('https://example.com/second', openExternal);

  assert.deepEqual(first, { action: 'deny' });
  assert.deepEqual(second, { action: 'deny' });
  assert.deepEqual(opened, ['https://example.com/first', 'https://example.com/second']);
});

test('external link handler rejects non-web protocols', async () => {
  const opened: string[] = [];
  const decision = externalLinks.externalWindowOpenDecision('file:///C:/secret.txt', async (url: string) => {
    opened.push(url);
  });

  assert.deepEqual(decision, { action: 'deny' });
  assert.deepEqual(opened, []);
});
