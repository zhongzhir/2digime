/**
 * Relay HTTP 客户端 — 不记录正文 / 私钥。
 */
import type { RelayAckResponse, RelayFetchResponse, RelaySubmitResponse, RelayWireEnvelope } from './relay-wire';

export class RelayClient {
  constructor(private readonly relayUrl: string) {}

  private base(): string {
    return this.relayUrl.replace(/\/+$/, '');
  }

  async health(): Promise<{ ok: boolean; reachable: boolean }> {
    try {
      const res = await fetch(`${this.base()}/health`);
      if (!res.ok) return { ok: false, reachable: false };
      const body = (await res.json()) as { ok?: boolean };
      return { ok: !!body.ok, reachable: true };
    } catch {
      return { ok: false, reachable: false };
    }
  }

  async submit(wire: RelayWireEnvelope): Promise<RelaySubmitResponse> {
    const res = await fetch(`${this.base()}/v1/envelopes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(wire),
    });
    if (!res.ok) {
      const err = new Error(`relay_submit_failed:${res.status}`);
      (err as Error & { category?: string }).category = 'relay_unavailable';
      throw err;
    }
    return (await res.json()) as RelaySubmitResponse;
  }

  async fetchFor(endpointId: string): Promise<RelayFetchResponse> {
    const res = await fetch(
      `${this.base()}/v1/envelopes?to=${encodeURIComponent(endpointId)}`,
    );
    if (!res.ok) {
      const err = new Error(`relay_fetch_failed:${res.status}`);
      (err as Error & { category?: string }).category = 'relay_unavailable';
      throw err;
    }
    return (await res.json()) as RelayFetchResponse;
  }

  async ack(endpointId: string, envelopeId: string): Promise<RelayAckResponse> {
    const res = await fetch(`${this.base()}/v1/envelopes/${encodeURIComponent(envelopeId)}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpointId }),
    });
    if (!res.ok) {
      const err = new Error(`relay_ack_failed:${res.status}`);
      (err as Error & { category?: string }).category = 'relay_unavailable';
      throw err;
    }
    return (await res.json()) as RelayAckResponse;
  }
}
