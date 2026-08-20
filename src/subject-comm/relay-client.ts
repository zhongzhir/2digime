/**
 * Relay HTTP 客户端 — 不记录正文 / 私钥。
 * 每次请求独立连接（见 relay-http），断网恢复后可自动重试成功。
 */
import type { RelayAckResponse, RelayFetchResponse, RelaySubmitResponse, RelayWireEnvelope } from './relay-wire';
import { defaultRelayHttp, relayNetworkError, type RelayHttpFn } from './relay-http';

export class RelayClient {
  private readonly http: RelayHttpFn;

  constructor(
    private readonly relayUrl: string,
    http: RelayHttpFn = defaultRelayHttp,
  ) {
    this.http = http;
  }

  private base(): string {
    return this.relayUrl.replace(/\/+$/, '');
  }

  private async json<T>(
    pathAndQuery: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.base()}${pathAndQuery}`;
    let res;
    try {
      const req =
        init.body != null
          ? {
              url,
              method: init.method || 'GET',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(init.body),
            }
          : {
              url,
              method: init.method || 'GET',
            };
      res = await this.http(req);
    } catch (error) {
      const err =
        error instanceof Error && (error as Error & { category?: string }).category
          ? error
          : relayNetworkError(error, 'relay_http');
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`relay_http_failed:${res.status}`);
      (err as Error & { category?: string }).category =
        res.status >= 500 || res.status === 429 ? 'relay_unavailable' : 'relay_http_status';
      (err as Error & { diagnostics?: unknown }).diagnostics = {
        category: (err as Error & { category?: string }).category,
        phase: 'relay_http_status',
        name: 'HttpStatusError',
        code: `HTTP_${res.status}`,
        causeCode: 'NONE',
        message: (res.text || '').slice(0, 160),
      };
      throw err;
    }
    try {
      return JSON.parse(res.text || '{}') as T;
    } catch (error) {
      throw relayNetworkError(error, 'relay_bad_json');
    }
  }

  async health(): Promise<{ ok: boolean; reachable: boolean }> {
    try {
      const body = await this.json<{ ok?: boolean }>('/health');
      return { ok: !!body.ok, reachable: true };
    } catch {
      return { ok: false, reachable: false };
    }
  }

  async submit(wire: RelayWireEnvelope): Promise<RelaySubmitResponse> {
    return this.json<RelaySubmitResponse>('/v1/envelopes', {
      method: 'POST',
      body: wire,
    });
  }

  async fetchFor(endpointId: string): Promise<RelayFetchResponse> {
    return this.json<RelayFetchResponse>(
      `/v1/envelopes?to=${encodeURIComponent(endpointId)}`,
    );
  }

  async ack(endpointId: string, envelopeId: string): Promise<RelayAckResponse> {
    return this.json<RelayAckResponse>(`/v1/envelopes/${encodeURIComponent(envelopeId)}/ack`, {
      method: 'POST',
      body: { endpointId },
    });
  }
}
