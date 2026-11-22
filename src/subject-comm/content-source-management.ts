/**
 * 普通用户来源管理：复用开放内容摄入与同一 Source Portfolio。
 * 只验证地址是否能产生可消费候选，不判断内容是否“适合某个人”。
 */
import type { NetworkItemStore } from '../relay-service/network-item-store';
import type { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { normalizeCanonicalUrl } from './content-canonical';
import { ingestSource } from './content-ingest';
import {
  listContentSourceViews,
  recordContentSourceAttempts,
  registerContentSource,
  setContentSourceEnabled,
  type ContentSourceView,
} from './content-source-portfolio';

export interface ContentSourceManagementResult {
  sources: ContentSourceView[];
  notice?: string;
}

export async function listManagedContentSources(
  packageRoot: string,
  now: string,
): Promise<ContentSourceManagementResult> {
  return { sources: await listContentSourceViews(packageRoot, now) };
}

export async function addManagedContentSource(input: {
  packageRoot: string;
  url: string;
  label?: string;
  store: NetworkItemStore;
  now: string;
  fetchImpl?: typeof safePublicHttpGet;
  signal?: AbortSignal;
}): Promise<ContentSourceManagementResult> {
  let sourceUrl = '';
  try {
    sourceUrl = normalizeCanonicalUrl(input.url);
    if (new URL(sourceUrl).protocol !== 'https:') throw new Error('https_required');
  } catch {
    return {
      sources: await listContentSourceViews(input.packageRoot, input.now),
      notice: '请输入可公开访问的 HTTPS 内容来源地址。',
    };
  }
  const ingested = await ingestSource({
    sourceUrl,
    store: input.store,
    limit: 24,
    now: input.now,
    via: 'feed',
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!ingested.items.length) {
    return {
      sources: await listContentSourceViews(input.packageRoot, input.now),
      notice: '没有从这个地址读到可用内容，暂未加入。',
    };
  }

  const contentTypes = [...new Set(
    ingested.items
      .map((item) => item.content.contentType || 'article')
      .filter((type): type is 'article' | 'video' | 'image' | 'audio' =>
        type === 'article' || type === 'video' || type === 'image' || type === 'audio'),
  )];
  const fallbackLabel = (() => {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return '我的内容来源';
    }
  })();
  let source = await registerContentSource({
    packageRoot: input.packageRoot,
    url: sourceUrl,
    label: String(input.label || ingested.sourceTitle || fallbackLabel).trim().slice(0, 120),
    kind: 'media_rss',
    contentTypes: contentTypes.length ? contentTypes : ['article'],
    origin: 'user',
    now: input.now,
    enabled: true,
  });
  if (!source.enabled) {
    source = (await setContentSourceEnabled(input.packageRoot, source.id, true, input.now)) || source;
  }
  await recordContentSourceAttempts(input.packageRoot, input.now, [{
    sourceId: source.id,
    ok: true,
    itemCount: ingested.items.length,
  }]);
  return {
    sources: await listContentSourceViews(input.packageRoot, input.now),
    notice: `已加入“${source.label}”，本次读到 ${ingested.items.length} 条内容。`,
  };
}

export async function toggleManagedContentSource(input: {
  packageRoot: string;
  sourceId: string;
  enabled: boolean;
  now: string;
}): Promise<ContentSourceManagementResult> {
  const source = input.sourceId
    ? await setContentSourceEnabled(input.packageRoot, input.sourceId, input.enabled, input.now)
    : null;
  return {
    sources: await listContentSourceViews(input.packageRoot, input.now),
    notice: source
      ? `${source.enabled ? '已启用' : '已停用'}“${source.label}”。`
      : '没有找到这个内容来源。',
  };
}
