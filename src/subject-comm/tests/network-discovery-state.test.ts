import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelHttpError } from '../../infrastructure/model-http';
import { classifySearchFailure, humanNetworkNotice } from '../network-discovery-state';

test('classifySearchFailure distinguishes auth from temporary errors', () => {
  assert.equal(classifySearchFailure(new ModelHttpError('unauthorized', 'nope', 401)), 'AUTH_FAILED');
  assert.equal(classifySearchFailure(Object.assign(new Error('forbidden'), { status: 403 })), 'AUTH_FAILED');
  assert.equal(classifySearchFailure(new ModelHttpError('timeout', 'slow', 0)), 'TEMPORARY_ERROR');
  assert.equal(classifySearchFailure(new ModelHttpError('server_error', 'boom', 503)), 'TEMPORARY_ERROR');
});

test('humanNetworkNotice never exposes reason codes and reflects real network state', () => {
  assert.match(
    humanNetworkNotice({ networking: 'NOT_CONFIGURED', hasCachedCards: false, hasLocalItems: false }),
    /开启联网发现/,
  );
  assert.equal(
    humanNetworkNotice({ networking: 'AUTH_FAILED', hasCachedCards: false, hasLocalItems: false }).includes('开启联网发现'),
    false,
  );
  assert.match(
    humanNetworkNotice({ networking: 'AUTH_FAILED', hasCachedCards: false, hasLocalItems: false }),
    /设置中检查连接/,
  );
  assert.match(
    humanNetworkNotice({ networking: 'TEMPORARY_ERROR', hasCachedCards: true, hasLocalItems: true }),
    /暂时无法获取新内容/,
  );
  const emptyLocal = humanNetworkNotice({
    networking: 'AVAILABLE',
    hasCachedCards: false,
    hasLocalItems: true,
  });
  assert.equal(/NETWORK_|CACHED_FEED|AUTH_FAILED/.test(emptyLocal), false);
  assert.match(emptyLocal, /没有找到可以直接看的内容/);
});
