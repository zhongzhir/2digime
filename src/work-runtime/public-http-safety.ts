/**
 * 公开 HTTP(S) 目标边界：协议/凭据/主机名 + DNS 全地址校验 + 连接钉死已验证 IP。
 * 禁止只看 hostname 字符串；禁止校验后再解析（DNS rebinding）。
 */
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import * as net from 'node:net';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';

export type LookupAddressesFn = (hostname: string) => Promise<string[]>;

export interface PinnedPublicDestination {
  url: URL;
  hostname: string;
  addresses: string[];
  pin: string;
  family: 4 | 6;
}

export interface SafePublicHttpDeps {
  lookupAddresses?: LookupAddressesFn;
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** 测试注入：在已钉死 IP 后替代真实套接字。生产路径不使用。 */
  transport?: (input: {
    url: URL;
    pin: string;
    servername: string;
    headers: Record<string, string>;
  }) => Promise<{ status: number; headers?: Record<string, string>; body: string }>;
}

export interface SafePublicHttpGetResult {
  status: number;
  body: string;
  finalUrl: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

export async function defaultLookupAddresses(hostname: string): Promise<string[]> {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '');
  if (!host) throw Object.assign(new Error('空主机名'), { code: 'dns' });
  if (net.isIP(host)) return [normalizeIp(host)];
  try {
    const found = await dns.promises.lookup(host, { all: true, verbatim: true });
    const addresses = found.map((item) => normalizeIp(item.address)).filter(Boolean);
    if (addresses.length === 0) {
      throw Object.assign(new Error(`无法解析 ${host}`), { code: 'ENOTFOUND' });
    }
    return unique(addresses);
  } catch (err) {
    const code = (err as { code?: string })?.code || 'dns';
    throw Object.assign(new Error(`DNS 解析失败：${host}`), { code, cause: err });
  }
}

export function normalizeIp(raw: string): string {
  const ip = String(raw || '').trim().toLowerCase();
  if (!ip) return '';
  if (net.isIP(ip) === 4) return ip;
  if (net.isIP(ip) === 6) return expandIpv6(ip);
  return ip;
}

export function isBlockedPublicIp(raw: string): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return true;
  const kind = net.isIP(ip);
  if (kind === 0 && !ip.includes(':')) return false;
  const mapped = extractIpv4Mapped(ip);
  if (mapped) return isBlockedIpv4(mapped);
  if (kind === 4) return isBlockedIpv4(ip);
  return isBlockedIpv6(ip);
}

export function isBlockedPublicHost(hostname: string): boolean {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal') return true;
  if (net.isIP(h) && isBlockedPublicIp(h)) return true;
  return false;
}

export function assertSafePublicHttpUrl(raw: string): URL {
  const trimmed = String(raw || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('不是可访问的公开网址'), { code: 'invalid_url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('只允许访问 http 或 https 网址'), { code: 'protocol' });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('拒绝带凭据的网址'), { code: 'credentials' });
  }
  if (isBlockedPublicHost(parsed.hostname)) {
    throw Object.assign(new Error('拒绝访问本机或内网地址'), { code: 'ssrf' });
  }
  if (net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) && isBlockedPublicIp(parsed.hostname)) {
    throw Object.assign(new Error('拒绝访问本机或内网地址'), { code: 'ssrf' });
  }
  return parsed;
}

export function resolvePublicRedirect(currentUrl: string, location: string): string {
  const next = new URL(String(location || ''), currentUrl);
  return assertSafePublicHttpUrl(next.toString()).toString();
}

export async function assertSafePublicDestination(
  raw: string,
  lookupAddresses: LookupAddressesFn = defaultLookupAddresses,
): Promise<PinnedPublicDestination> {
  const url = assertSafePublicHttpUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = unique((await lookupAddresses(hostname)).map(normalizeIp).filter(Boolean));
  } catch (err) {
    const code = (err as { code?: string })?.code || 'dns';
    throw Object.assign(new Error(`DNS 解析失败：${hostname}`), {
      code: code === 'ssrf' ? 'ssrf' : 'dns',
      cause: err,
    });
  }
  if (addresses.length === 0) {
    throw Object.assign(new Error(`DNS 解析失败：${hostname}`), { code: 'dns' });
  }
  const allowed = addresses.filter((addr) => !isBlockedPublicIp(addr));
  if (allowed.length === 0) {
    throw Object.assign(
      new Error(`拒绝访问解析到内网或不可路由地址的主机：${hostname} → ${addresses.join(', ')}`),
      { code: 'ssrf', addresses },
    );
  }
  const pin = pickPinnedAddress(allowed);
  return {
    url,
    hostname,
    addresses: allowed,
    pin,
    family: net.isIP(pin) === 6 ? 6 : 4,
  };
}

export function createPinnedLookup(pin: string, family: 4 | 6): NonNullable<HttpsRequestOptions['lookup']> {
  const pinned = normalizeIp(pin);
  return ((_hostname, requestOptions, callback) => {
    const cb = typeof requestOptions === 'function' ? requestOptions : callback;
    const opts = typeof requestOptions === 'function' ? undefined : requestOptions;
    if (!cb) return;
    if (opts && typeof opts === 'object' && 'all' in opts && opts.all) {
      (cb as (err: Error | null, result: dns.LookupAddress[]) => void)(null, [{ address: pinned, family }]);
      return;
    }
    (cb as (err: Error | null, address: string, fam: number) => void)(null, pinned, family);
  }) as NonNullable<HttpsRequestOptions['lookup']>;
}

function pickPinnedAddress(addresses: string[]): string {
  const v4 = addresses.find((addr) => net.isIP(addr) === 4);
  return v4 || addresses[0]!;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function isBlockedIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return true;
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return (
    inMask(n, ipv4ToInt('0.0.0.0')!, 8) ||
    inMask(n, ipv4ToInt('10.0.0.0')!, 8) ||
    inMask(n, ipv4ToInt('127.0.0.0')!, 8) ||
    inMask(n, ipv4ToInt('169.254.0.0')!, 16) ||
    inMask(n, ipv4ToInt('172.16.0.0')!, 12) ||
    inMask(n, ipv4ToInt('192.168.0.0')!, 16) ||
    inMask(n, ipv4ToInt('100.64.0.0')!, 10) ||
    inMask(n, ipv4ToInt('192.0.0.0')!, 24) ||
    inMask(n, ipv4ToInt('192.0.2.0')!, 24) ||
    inMask(n, ipv4ToInt('198.51.100.0')!, 24) ||
    inMask(n, ipv4ToInt('203.0.113.0')!, 24) ||
    inMask(n, ipv4ToInt('198.18.0.0')!, 15) ||
    inMask(n, ipv4ToInt('224.0.0.0')!, 4) ||
    inMask(n, ipv4ToInt('240.0.0.0')!, 4)
  );
}

function isBlockedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip);
  const mapped = extractIpv4Mapped(expanded);
  if (mapped) return isBlockedIpv4(mapped);
  const value = ipv6ToBigInt(expanded);
  if (value === null) return true;
  if (value === 0n) return true;
  if (value === 1n) return true;
  if (ipv6InCidr(value, 'fc00::', 7)) return true;
  if (ipv6InCidr(value, 'fe80::', 10)) return true;
  if (ipv6InCidr(value, 'ff00::', 8)) return true;
  if (ipv6InCidr(value, '2001:db8::', 32)) return true;
  if (ipv6InCidr(value, '100::', 64)) return true;
  if (ipv6InCidr(value, 'fec0::', 10)) return true;
  return false;
}

function extractIpv4Mapped(ip: string): string | null {
  const expanded = expandIpv6(ip);
  const m = /^0000:0000:0000:0000:0000:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/i.exec(expanded);
  if (!m) return null;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inMask(value: number, base: number, bits: number): boolean {
  if (bits <= 0) return true;
  const shift = 32 - bits;
  return value >>> shift === base >>> shift;
}

function expandIpv6(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (raw.includes('.')) {
    const lastColon = raw.lastIndexOf(':');
    const v6 = raw.slice(0, lastColon);
    const v4 = raw.slice(lastColon + 1);
    const n = ipv4ToInt(v4);
    if (n === null) return raw;
    const hi = ((n >>> 16) & 0xffff).toString(16);
    const lo = (n & 0xffff).toString(16);
    return expandIpv6(`${v6}:${hi}:${lo}`);
  }
  const halves = raw.split('::');
  let head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  let tail = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (halves.length === 1) {
    head = raw.split(':').filter(Boolean);
    tail = [];
  }
  const missing = Math.max(0, 8 - head.length - tail.length);
  const full = [...head, ...Array(missing).fill('0'), ...tail].map((part) => part.padStart(4, '0'));
  while (full.length < 8) full.push('0000');
  return full.slice(0, 8).join(':');
}

function ipv6ToBigInt(expanded: string): bigint | null {
  try {
    return BigInt(
      `0x${expandIpv6(expanded)
        .split(':')
        .map((p) => p.padStart(4, '0'))
        .join('')}`,
    );
  } catch {
    return null;
  }
}

function ipv6InCidr(value: bigint, base: string, bits: number): boolean {
  const baseVal = ipv6ToBigInt(base);
  if (baseVal === null) return false;
  const shift = 128n - BigInt(bits);
  return value >> shift === baseVal >> shift;
}

function releaseResponse(res: IncomingMessage): void {
  res.resume();
  res.destroy();
}

/**
 * 连接前校验并钉死 IP；每次重定向重新校验。Host / TLS SNI 仍用原域名。
 */
export async function safePublicHttpGet(
  url: string,
  headers?: Record<string, string>,
  redirectLeft = DEFAULT_MAX_REDIRECTS,
  deps: SafePublicHttpDeps = {},
): Promise<SafePublicHttpGetResult> {
  const dest = await assertSafePublicDestination(url, deps.lookupAddresses ?? defaultLookupAddresses);
  const parsed = dest.url;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const reqHeaders = {
    accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1',
    'user-agent': 'DigitalMe-readonly-lookup',
    ...(headers || {}),
    host: parsed.host,
  };
  if (deps.transport) {
    const hopped = await deps.transport({
      url: parsed,
      pin: dest.pin,
      servername: dest.hostname,
      headers: reqHeaders,
    });
    const status = hopped.status;
    const loc = String(hopped.headers?.location || hopped.headers?.Location || '');
    if (status >= 300 && status < 400 && loc) {
      if (redirectLeft <= 0) {
        throw Object.assign(new Error('重定向次数过多'), { code: 'redirect' });
      }
      const next = resolvePublicRedirect(parsed.toString(), loc);
      return safePublicHttpGet(next, headers, redirectLeft - 1, deps);
    }
    return { status, body: hopped.body, finalUrl: parsed.toString() };
  }
  return new Promise((resolve, reject) => {
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        servername: dest.hostname,
        lookup: createPinnedLookup(dest.pin, dest.family),
        headers: reqHeaders,
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode || 0;
        const loc = String(res.headers.location || '');
        if (status >= 300 && status < 400 && loc) {
          releaseResponse(res);
          if (redirectLeft <= 0) {
            reject(Object.assign(new Error('重定向次数过多'), { code: 'redirect' }));
            return;
          }
          let next: string;
          try {
            next = resolvePublicRedirect(parsed.toString(), loc);
          } catch (err) {
            reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'ssrf' }));
            return;
          }
          safePublicHttpGet(next, headers, redirectLeft - 1, deps).then(resolve, reject);
          return;
        }
        const type = String(res.headers['content-type'] || '').toLowerCase();
        if (
          type &&
          !/application\/json|application\/feed\+json|json\+oembed|text\/|application\/vnd\.github|application\/xml|xml/.test(type)
        ) {
          releaseResponse(res);
          reject(Object.assign(new Error('内容类型不受支持'), { code: 'content_type' }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(timeoutMs);
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBodyBytes) {
            req.destroy(Object.assign(new Error('响应过大'), { code: 'too_large' }));
            return;
          }
          chunks.push(Buffer.from(c));
        });
        res.on('end', () => {
          resolve({ status, body: Buffer.concat(chunks).toString('utf8'), finalUrl: parsed.toString() });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}
