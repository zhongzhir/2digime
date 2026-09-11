/**
 * Institution Backend v0.1 — thin JSON store for org / user mapping / entitlement refs.
 * Never persists prompt, response, Digital Self, or provider master keys.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN_VALUE_KEYS = new Set([
  'prompt',
  'messages',
  'response',
  'responseBody',
  'digitalSelf',
  'memory',
  'conversation',
  'artifactContent',
  'providerMasterKey',
  'deepseekApiKey',
  'openaiApiKey',
]);

function assertNoForbiddenPayload(value, trail = '') {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenPayload(item, `${trail}[${i}]`));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    const key = String(k);
    if (FORBIDDEN_VALUE_KEYS.has(key)) {
      throw new Error(`Institution store forbids persisting field ${trail}.${key}`);
    }
    assertNoForbiddenPayload(v, trail ? `${trail}.${key}` : key);
  }
}

function createStore(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  function read() {
    if (!fs.existsSync(filePath)) {
      return {
        version: 1,
        organizations: {},
        users: {},
        updatedAt: null,
      };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assertNoForbiddenPayload(raw);
    return raw;
  }

  function write(data) {
    assertNoForbiddenPayload(data);
    const next = { ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  return {
    filePath,
    read,
    write,
    mutate(fn) {
      const current = read();
      const next = fn(structuredClone(current));
      return write(next);
    },
  };
}

module.exports = {
  createStore,
  FORBIDDEN_VALUE_KEYS,
  assertNoForbiddenPayload,
};
