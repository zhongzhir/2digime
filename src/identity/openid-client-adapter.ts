import { createHash } from 'node:crypto';
import type * as OpenIdClient from 'openid-client';
import type {
  InstitutionIdentityProvider,
  OidcAuthorizationTransaction,
  VerifiedFederatedIdentity,
} from './types';

export interface AuthorizationStart {
  authorizationUrl: string;
  transaction: OidcAuthorizationTransaction;
}

export interface InstitutionOidcAdapter {
  startAuthorization(
    provider: InstitutionIdentityProvider,
    now: string,
    ttlMs?: number,
  ): Promise<AuthorizationStart>;
  completeAuthorization(input: {
    provider: InstitutionIdentityProvider;
    callbackUrl: string;
    transaction: OidcAuthorizationTransaction;
    verifiedAt: string;
  }): Promise<VerifiedFederatedIdentity>;
}

type OpenIdClientModule = typeof OpenIdClient;
type OpenIdConfiguration = Awaited<ReturnType<OpenIdClientModule['discovery']>>;

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenIdClientModule>;

function loopback(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]')
  );
}

export function validateInstitutionProvider(provider: InstitutionIdentityProvider): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(provider.id)) throw new Error('OIDC provider id 无效');
  const issuer = new URL(provider.issuer);
  const redirect = new URL(provider.redirectUri);
  const insecureLocalIssuer = provider.allowInsecureLoopback === true && loopback(issuer);
  if (issuer.protocol !== 'https:' && !insecureLocalIssuer) {
    throw new Error('机构身份源必须使用 HTTPS');
  }
  const loopbackRedirectAllowed =
    loopback(redirect) &&
    (provider.allowLoopbackRedirect === true || provider.allowInsecureLoopback === true);
  if (redirect.protocol !== 'https:' && !loopbackRedirectAllowed) {
    throw new Error('机构身份回调必须使用 HTTPS；原生应用仅可显式启用 loopback HTTP 回调');
  }
  if (!provider.scopes.includes('openid')) throw new Error('OIDC scope 必须包含 openid');
  if (provider.securityProfile === 'fapi2') throw new Error('FAPI2_PROFILE_NOT_IMPLEMENTED');
  if (
    provider.clientAuthentication.method === 'client_secret_basic' &&
    !provider.clientAuthentication.clientSecret
  ) {
    throw new Error('OIDC confidential client 缺少服务端密钥');
  }
}

export class OpenIdClientAdapter implements InstitutionOidcAdapter {
  private readonly configs = new Map<
    string,
    { fingerprint: string; config: OpenIdConfiguration }
  >();

  private providerFingerprint(provider: InstitutionIdentityProvider): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          issuer: provider.issuer,
          clientId: provider.clientId,
          redirectUri: provider.redirectUri,
          clientAuthenticationMethod: provider.clientAuthentication.method,
          clientSecret:
            provider.clientAuthentication.method === 'client_secret_basic'
              ? provider.clientAuthentication.clientSecret
              : '',
          allowInsecureLoopback: provider.allowInsecureLoopback === true,
          allowLoopbackRedirect: provider.allowLoopbackRedirect === true,
        }),
      )
      .digest('hex');
  }

  private async clientAndConfig(
    provider: InstitutionIdentityProvider,
  ): Promise<{ client: OpenIdClientModule; config: OpenIdConfiguration }> {
    validateInstitutionProvider(provider);
    const client = await dynamicImport('openid-client');
    const fingerprint = this.providerFingerprint(provider);
    const cached = this.configs.get(provider.id);
    if (cached?.fingerprint === fingerprint) return { client, config: cached.config };
    const auth =
      provider.clientAuthentication.method === 'client_secret_basic'
        ? client.ClientSecretBasic(provider.clientAuthentication.clientSecret)
        : client.None();
    const config = await client.discovery(
      new URL(provider.issuer),
      provider.clientId,
      {
        redirect_uris: [provider.redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: provider.clientAuthentication.method,
      },
      auth,
      provider.allowInsecureLoopback
        ? { execute: [client.allowInsecureRequests] }
        : undefined,
    );
    this.configs.set(provider.id, { fingerprint, config });
    return { client, config };
  }

  async startAuthorization(
    provider: InstitutionIdentityProvider,
    now: string,
    ttlMs = 10 * 60_000,
  ): Promise<AuthorizationStart> {
    const { client, config } = await this.clientAndConfig(provider);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const authorizationUrl = client.buildAuthorizationUrl(config, {
      response_type: 'code',
      redirect_uri: provider.redirectUri,
      scope: provider.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return {
      authorizationUrl: authorizationUrl.href,
      transaction: {
        providerId: provider.id,
        state,
        nonce,
        codeVerifier,
        redirectUri: provider.redirectUri,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
      },
    };
  }

  async completeAuthorization(input: {
    provider: InstitutionIdentityProvider;
    callbackUrl: string;
    transaction: OidcAuthorizationTransaction;
    verifiedAt: string;
  }): Promise<VerifiedFederatedIdentity> {
    const { client, config } = await this.clientAndConfig(input.provider);
    const tokens = await client.authorizationCodeGrant(config, new URL(input.callbackUrl), {
      pkceCodeVerifier: input.transaction.codeVerifier,
      expectedState: input.transaction.state,
      expectedNonce: input.transaction.nonce,
    });
    const idClaims = tokens.claims();
    const expectedIssuer = config.serverMetadata().issuer;
    if (!idClaims?.sub || idClaims.iss !== expectedIssuer) {
      throw new Error('OIDC 已验证身份缺少稳定 issuer/sub');
    }
    let claims: Record<string, unknown> = { ...idClaims };
    if (tokens.access_token && config.serverMetadata().userinfo_endpoint) {
      const userInfo = await client.fetchUserInfo(config, tokens.access_token, idClaims.sub);
      claims = { ...claims, ...userInfo };
    }
    const responseScopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [];
    const grantedScopes = responseScopes.length ? responseScopes : input.provider.scopes;
    const amr = Array.isArray(claims.amr)
      ? claims.amr.filter((value): value is string => typeof value === 'string')
      : [];
    const authenticatedAt =
      typeof claims.auth_time === 'number'
        ? new Date(claims.auth_time * 1000).toISOString()
        : undefined;
    return {
      providerId: input.provider.id,
      issuer: String(idClaims.iss),
      subject: idClaims.sub,
      ...(typeof claims.org_id === 'string' ? { organizationId: claims.org_id } : {}),
      ...(typeof claims.tid === 'string' ? { tenantId: claims.tid } : {}),
      ...(typeof claims.acr === 'string' ? { acr: claims.acr } : {}),
      amr,
      ...(authenticatedAt ? { authenticatedAt } : {}),
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      emailVerified: claims.email_verified === true,
      ...(typeof claims.phone_number === 'string' ? { phoneNumber: claims.phone_number } : {}),
      phoneNumberVerified: claims.phone_number_verified === true,
      grantedScopes: [...new Set(grantedScopes)].sort(),
      verifiedAt: input.verifiedAt,
    };
  }
}
