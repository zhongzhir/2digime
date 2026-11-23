import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { FileSecretStore, type CipherAdapter } from '../infrastructure/secret-store';
import {
  institutionProviderFingerprint,
  OpenIdClientAdapter,
  type InstitutionOidcAdapter,
} from './openid-client-adapter';
import { OwnerIdentityStore } from './owner-identity-store';
import type {
  InstitutionIdentityProvider,
  OidcAuthorizationTransaction,
  OwnerIdentityRecord,
} from './types';

function transactionKey(state: string): string {
  const digest = createHash('sha256').update(state).digest('hex');
  return `oidc.transaction.${digest}`;
}

export class InstitutionFederationService {
  private readonly transactions: FileSecretStore;
  private readonly identities: OwnerIdentityStore;

  constructor(
    packageRoot: string,
    cipher: CipherAdapter,
    private readonly adapter: InstitutionOidcAdapter = new OpenIdClientAdapter(),
  ) {
    this.transactions = new FileSecretStore({
      filePath: path.join(packageRoot, 'identity', 'oidc-transactions.v1.json'),
      cipher,
    });
    this.identities = new OwnerIdentityStore(packageRoot);
  }

  async start(provider: InstitutionIdentityProvider, now: string): Promise<string> {
    const started = await this.adapter.startAuthorization(provider, now);
    await this.transactions.put(
      transactionKey(started.transaction.state),
      JSON.stringify(started.transaction),
    );
    return started.authorizationUrl;
  }

  async complete(input: {
    provider: InstitutionIdentityProvider;
    callbackUrl: string;
    now: string;
  }): Promise<OwnerIdentityRecord> {
    const callback = new URL(input.callbackUrl);
    const state = callback.searchParams.get('state') || '';
    if (!state) throw new Error('OIDC 回调缺少 state');
    const key = transactionKey(state);
    const raw = await this.transactions.get(key);
    if (!raw) throw new Error('OIDC 回调已使用、已过期或不属于本次登录');
    await this.transactions.delete(key);
    const transaction = JSON.parse(raw) as OidcAuthorizationTransaction;
    if (
      transaction.providerId !== input.provider.id ||
      transaction.providerFingerprint !== institutionProviderFingerprint(input.provider) ||
      transaction.redirectUri !== input.provider.redirectUri ||
      transaction.state !== state
    ) {
      throw new Error('OIDC 登录事务绑定不匹配');
    }
    const nowMs = Date.parse(input.now);
    const createdAtMs = Date.parse(transaction.createdAt);
    const expiresAtMs = Date.parse(transaction.expiresAt);
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(createdAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      createdAtMs >= expiresAtMs ||
      nowMs < createdAtMs ||
      nowMs >= expiresAtMs
    ) {
      throw new Error('OIDC 登录事务已过期');
    }
    const verified = await this.adapter.completeAuthorization({
      provider: input.provider,
      callbackUrl: input.callbackUrl,
      transaction,
      verifiedAt: input.now,
    });
    return this.identities.recordVerifiedIdentity(verified);
  }

  ownerIdentityStore(): OwnerIdentityStore {
    return this.identities;
  }
}
