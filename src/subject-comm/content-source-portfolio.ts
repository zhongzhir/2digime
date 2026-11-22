/**
 * 本地内容来源组合：只保存来源身份和摄入执行事实，不保存用户画像，也不做相关性排序。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';
import { normalizeCanonicalUrl, sourcePublisherId } from './content-canonical';
import { allowsDefaultSupply } from './domestic-source-boundary';
import {
  OPEN_SOURCE_CATALOG,
  catalogEndpointsFor,
  type OpenCatalogContentType,
  type OpenCatalogKind,
  type OpenSourceEndpoint,
} from './open-source-catalog';

export type ContentSourceOrigin = 'built_in' | 'discovered' | 'user';

export interface ContentSourceRecord {
  id: string;
  label: string;
  url: string;
  kind: OpenCatalogKind;
  contentTypes: OpenCatalogContentType[];
  origin: ContentSourceOrigin;
  enabled: boolean;
  addedAt: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
  nextRefreshAt?: string;
  consecutiveFailures: number;
  lastItemCount: number;
  totalItemCount: number;
  /** 来源分页协议游标；仅用于继续摄入，不参与内容排序。 */
  cursor?: string;
  /** HTTP 条件刷新协议事实；不参与内容排序。 */
  etag?: string;
  lastModified?: string;
  lastNotModifiedAt?: string;
}

interface ContentSourcePortfolioFile {
  version: 1;
  sources: ContentSourceRecord[];
}

export interface ContentSourceAttempt {
  sourceId: string;
  ok: boolean;
  itemCount: number;
  notModified?: boolean;
  cursor?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  errorCode?: string;
}

/** 普通用户可见的来源投影。它来自同一 Portfolio，不形成第二份来源状态。 */
export interface ContentSourceView {
  id: string;
  label: string;
  url: string;
  contentTypes: OpenCatalogContentType[];
  origin: ContentSourceOrigin;
  enabled: boolean;
  availability: 'disabled' | 'not_checked' | 'available' | 'failing';
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
  nextRefreshAt?: string;
  consecutiveFailures: number;
  lastItemCount: number;
  totalItemCount: number;
}

const SUCCESS_REFRESH_MS = 30 * 60 * 1000;
const FAILURE_BACKOFF_BASE_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const locks = new Map<string, Promise<unknown>>();

function protocolHeader(value: string | null | undefined): string | null {
  if (value == null) return null;
  const clean = String(value).replace(/[\r\n]/g, '').trim().slice(0, 512);
  return clean || null;
}

function protocolCursor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const clean = String(value).replace(/[\r\n]/g, '').trim().slice(0, 8192);
  return clean || null;
}

export function contentSourceConditionalHeaders(
  source: Pick<ContentSourceRecord, 'etag' | 'lastModified'>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const etag = protocolHeader(source.etag);
  const lastModified = protocolHeader(source.lastModified);
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  return headers;
}

export function contentSourcePortfolioPath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'source-portfolio.json');
}

function emptyPortfolio(): ContentSourcePortfolioFile {
  return { version: 1, sources: [] };
}

async function readPortfolio(packageRoot: string): Promise<ContentSourcePortfolioFile> {
  try {
    const raw = JSON.parse(await fs.readFile(contentSourcePortfolioPath(packageRoot), 'utf8')) as Partial<ContentSourcePortfolioFile>;
    if (raw.version !== 1 || !Array.isArray(raw.sources)) return emptyPortfolio();
    return { version: 1, sources: raw.sources as ContentSourceRecord[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPortfolio();
    throw error;
  }
}

async function writePortfolio(packageRoot: string, file: ContentSourcePortfolioFile): Promise<void> {
  const target = contentSourcePortfolioPath(packageRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteFile(target, `${JSON.stringify(file, null, 2)}\n`);
}

async function withPortfolioLock<T>(packageRoot: string, task: () => Promise<T>): Promise<T> {
  const key = contentSourcePortfolioPath(packageRoot);
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current, () => current);
  locks.set(key, chained);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

function sourceFromEndpoint(endpoint: OpenSourceEndpoint, now: string): ContentSourceRecord {
  return {
    id: endpoint.id,
    label: endpoint.label,
    url: normalizeCanonicalUrl(endpoint.url),
    kind: endpoint.kind,
    contentTypes: [...endpoint.contentTypes],
    origin: 'built_in',
    enabled: true,
    addedAt: now,
    consecutiveFailures: 0,
    lastItemCount: 0,
    totalItemCount: 0,
  };
}

function mergeBuiltIns(file: ContentSourcePortfolioFile, now: string): boolean {
  const byId = new Map(file.sources.map((source) => [source.id, source]));
  let changed = false;
  for (const endpoint of OPEN_SOURCE_CATALOG) {
    const existing = byId.get(endpoint.id);
    if (!existing) {
      const source = sourceFromEndpoint(endpoint, now);
      file.sources.push(source);
      byId.set(source.id, source);
      changed = true;
      continue;
    }
    const canonical = normalizeCanonicalUrl(endpoint.url);
    if (
      existing.label !== endpoint.label ||
      existing.url !== canonical ||
      existing.kind !== endpoint.kind ||
      JSON.stringify(existing.contentTypes) !== JSON.stringify(endpoint.contentTypes)
    ) {
      existing.label = endpoint.label;
      existing.url = canonical;
      existing.kind = endpoint.kind;
      existing.contentTypes = [...endpoint.contentTypes];
      changed = true;
    }
  }
  return changed;
}

export async function ensureContentSourcePortfolio(packageRoot: string, now: string): Promise<ContentSourceRecord[]> {
  return withPortfolioLock(packageRoot, async () => {
    const file = await readPortfolio(packageRoot);
    const changed = mergeBuiltIns(file, now);
    if (changed) await writePortfolio(packageRoot, file);
    return file.sources.map((source) => ({ ...source, contentTypes: [...source.contentTypes] }));
  });
}

function sourceView(source: ContentSourceRecord): ContentSourceView {
  const availability: ContentSourceView['availability'] = !source.enabled
    ? 'disabled'
    : source.consecutiveFailures > 0
      ? 'failing'
      : source.lastSuccessAt
        ? 'available'
        : 'not_checked';
  return {
    id: source.id,
    label: source.label,
    url: source.url,
    contentTypes: [...source.contentTypes],
    origin: source.origin,
    enabled: source.enabled,
    availability,
    ...(source.lastAttemptAt ? { lastAttemptAt: source.lastAttemptAt } : {}),
    ...(source.lastSuccessAt ? { lastSuccessAt: source.lastSuccessAt } : {}),
    ...(source.lastFailureAt ? { lastFailureAt: source.lastFailureAt } : {}),
    ...(source.lastErrorCode ? { lastErrorCode: source.lastErrorCode } : {}),
    ...(source.nextRefreshAt ? { nextRefreshAt: source.nextRefreshAt } : {}),
    consecutiveFailures: source.consecutiveFailures,
    lastItemCount: source.lastItemCount,
    totalItemCount: source.totalItemCount,
  };
}

export async function listContentSourceViews(packageRoot: string, now: string): Promise<ContentSourceView[]> {
  const rows = await ensureContentSourcePortfolio(packageRoot, now);
  return rows
    .map(sourceView)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label, 'zh-CN'));
}

/**
 * 已停用或当前抓取失败的来源不继续进入候选池。这里只投影来源执行事实，
 * 不判断内容主题或个人相关性。
 */
export async function inactiveContentSourcePublisherIds(
  packageRoot: string,
  now: string,
): Promise<Set<string>> {
  const sources = await ensureContentSourcePortfolio(packageRoot, now);
  return new Set(
    sources
      .filter((source) => !source.enabled || source.consecutiveFailures > 0)
      .map((source) => sourcePublisherId(source.url)),
  );
}

export function sourceRefreshDue(source: ContentSourceRecord, now: string): boolean {
  if (!source.enabled) return false;
  if (!source.nextRefreshAt) return true;
  return Date.parse(source.nextRefreshAt) <= Date.parse(now);
}

export async function dueCatalogFeedSources(
  packageRoot: string,
  now: string,
  kinds: string[],
): Promise<ContentSourceRecord[]> {
  return (await dueCatalogSources(packageRoot, now, kinds)).filter((source) => source.kind === 'media_rss');
}

export async function dueCatalogSources(
  packageRoot: string,
  now: string,
  kinds: string[],
): Promise<ContentSourceRecord[]> {
  const sources = await ensureContentSourcePortfolio(packageRoot, now);
  const allowed = new Set(catalogEndpointsFor(kinds).map((row) => row.id));
  const wanted = new Set(kinds);
  return sources.filter(
    (source) =>
      (allowed.has(source.id) || source.origin !== 'built_in') &&
      source.contentTypes.some((type) => wanted.has(type)) &&
      allowsDefaultSupply({ url: source.url, publisher: source.label }) &&
      sourceRefreshDue(source, now),
  );
}

export async function recordContentSourceAttempts(
  packageRoot: string,
  now: string,
  attempts: ContentSourceAttempt[],
): Promise<ContentSourceRecord[]> {
  if (!attempts.length) return ensureContentSourcePortfolio(packageRoot, now);
  return withPortfolioLock(packageRoot, async () => {
    const file = await readPortfolio(packageRoot);
    mergeBuiltIns(file, now);
    const byId = new Map(file.sources.map((source) => [source.id, source]));
    const nowMs = Date.parse(now);
    for (const attempt of attempts) {
      const source = byId.get(attempt.sourceId);
      if (!source) continue;
      source.lastAttemptAt = now;
      source.lastItemCount = Math.max(0, Math.floor(attempt.itemCount || 0));
      if ('cursor' in attempt) {
        const value = protocolCursor(attempt.cursor);
        if (value) source.cursor = value;
        else delete source.cursor;
      }
      if ('etag' in attempt) {
        const value = protocolHeader(attempt.etag);
        if (value) source.etag = value;
        else delete source.etag;
      }
      if ('lastModified' in attempt) {
        const value = protocolHeader(attempt.lastModified);
        if (value) source.lastModified = value;
        else delete source.lastModified;
      }
      const unchangedStillUnreachable =
        attempt.ok &&
        attempt.notModified === true &&
        source.lastErrorCode === 'content_unreachable';
      if (attempt.notModified) source.lastNotModifiedAt = now;
      if (attempt.ok && !unchangedStillUnreachable) {
        source.lastSuccessAt = now;
        source.consecutiveFailures = 0;
        delete source.lastErrorCode;
        source.totalItemCount += source.lastItemCount;
        source.nextRefreshAt = new Date(nowMs + SUCCESS_REFRESH_MS).toISOString();
      } else {
        source.lastFailureAt = now;
        source.lastErrorCode = unchangedStillUnreachable
          ? 'content_unreachable'
          : protocolHeader(attempt.errorCode) || 'source_error';
        source.consecutiveFailures += 1;
        const backoff = Math.min(
          FAILURE_BACKOFF_BASE_MS * 2 ** Math.max(0, source.consecutiveFailures - 1),
          FAILURE_BACKOFF_MAX_MS,
        );
        source.nextRefreshAt = new Date(nowMs + backoff).toISOString();
      }
    }
    await writePortfolio(packageRoot, file);
    return file.sources.map((source) => ({ ...source, contentTypes: [...source.contentTypes] }));
  });
}

/** 用户或模型发现兼容的开放来源后注册；最终是否启用仍由 origin/授权边界决定。 */
export async function registerContentSource(input: {
  packageRoot: string;
  url: string;
  label: string;
  kind: OpenCatalogKind;
  contentTypes: OpenCatalogContentType[];
  origin: Exclude<ContentSourceOrigin, 'built_in'>;
  now: string;
  enabled?: boolean;
}): Promise<ContentSourceRecord> {
  return withPortfolioLock(input.packageRoot, async () => {
    const file = await readPortfolio(input.packageRoot);
    mergeBuiltIns(file, input.now);
    const url = normalizeCanonicalUrl(input.url);
    const existing = file.sources.find((source) => source.url === url);
    if (existing) return { ...existing, contentTypes: [...existing.contentTypes] };
    const source: ContentSourceRecord = {
      id: sourcePublisherId(url),
      label: String(input.label || new URL(url).hostname).trim().slice(0, 120),
      url,
      kind: input.kind,
      contentTypes: [...new Set(input.contentTypes)],
      origin: input.origin,
      enabled: input.enabled ?? input.origin === 'user',
      addedAt: input.now,
      consecutiveFailures: 0,
      lastItemCount: 0,
      totalItemCount: 0,
    };
    file.sources.push(source);
    await writePortfolio(input.packageRoot, file);
    return { ...source, contentTypes: [...source.contentTypes] };
  });
}

/** 可逆的来源管理；不删除历史执行事实。 */
export async function setContentSourceEnabled(
  packageRoot: string,
  sourceId: string,
  enabled: boolean,
  now: string,
): Promise<ContentSourceRecord | null> {
  return withPortfolioLock(packageRoot, async () => {
    const file = await readPortfolio(packageRoot);
    mergeBuiltIns(file, now);
    const source = file.sources.find((row) => row.id === sourceId);
    if (!source) return null;
    source.enabled = enabled;
    await writePortfolio(packageRoot, file);
    return { ...source, contentTypes: [...source.contentTypes] };
  });
}

