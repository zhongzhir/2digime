/**
 * Discover 联网能力的机械状态。不是语义分类器。
 * UI 只用人话；reason code 留给 runtime / 测试。
 */
export const NETWORK_DISCOVERY_CODES = [
  'AVAILABLE',
  'DISABLED',
  'NOT_CONFIGURED',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'TEMPORARY_ERROR',
] as const;

export type NetworkDiscoveryCode = (typeof NETWORK_DISCOVERY_CODES)[number];

export const FEED_REASON_CODES = [
  'DIRECTORY_EMPTY',
  'NETWORK_DISABLED',
  'NETWORK_NOT_CONFIGURED',
  'NETWORK_AUTH_FAILED',
  'NETWORK_TEMPORARY_ERROR',
  'NO_CONSUMABLE_CANDIDATES',
  'MODEL_SELECTION_EMPTY',
  'AI_NOT_CONNECTED',
  'CACHED_FEED',
  'LOCAL_DIRECTORY',
  'REPLENISHED',
  'CURRENT_INTENT',
] as const;

export type FeedReasonCode = (typeof FEED_REASON_CODES)[number];

export function classifySearchFailure(err: unknown): Exclude<NetworkDiscoveryCode, 'AVAILABLE' | 'DISABLED' | 'NOT_CONFIGURED'> {
  const rec = err as { kind?: string; status?: number; httpStatus?: number; message?: string };
  const status = Number(rec.status || rec.httpStatus || 0);
  const kind = String(rec.kind || '').toLowerCase();
  const labeled = String((err as { status?: string }).status || '').toUpperCase();
  const message = String(rec.message || err || '').toLowerCase();
  if (labeled === 'RATE_LIMITED' || kind === 'quota' || status === 429 || /rate.?limit|quota/.test(message)) {
    return 'RATE_LIMITED';
  }
  if (
    labeled === 'AUTH_FAILED' ||
    kind === 'auth' ||
    kind === 'unauthorized' ||
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|api key|invalid.*key/.test(message)
  ) {
    return 'AUTH_FAILED';
  }
  return 'TEMPORARY_ERROR';
}

export function humanNetworkNotice(input: {
  networking: NetworkDiscoveryCode;
  hasCachedCards: boolean;
  hasLocalItems: boolean;
}): string {
  if (input.hasCachedCards) {
    if (
      input.networking === 'AUTH_FAILED' ||
      input.networking === 'TEMPORARY_ERROR' ||
      input.networking === 'RATE_LIMITED'
    ) {
      return '暂时无法获取新内容，可以稍后再试或检查联网设置。';
    }
    return '';
  }
  if (input.networking === 'AUTH_FAILED') {
    return '联网发现暂时不可用，可以到设置中检查连接。';
  }
  if (input.networking === 'TEMPORARY_ERROR' || input.networking === 'RATE_LIMITED') {
    return '暂时无法获取新内容，可以稍后再试或检查联网设置。';
  }
  if (input.networking === 'DISABLED' || input.networking === 'NOT_CONFIGURED') {
    if (input.hasLocalItems) return '目前还没有可展示的内容。';
    return '目前还没有可展示的内容。开启联网发现后，兔机米可以从公开网络帮你找。';
  }
  if (!input.hasLocalItems) return '这次没有找到可以直接看的内容。';
  return '这次没有找到可以直接看的内容。';
}
