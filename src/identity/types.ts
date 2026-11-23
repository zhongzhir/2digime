export type InstitutionSecurityProfile = 'oidc-code-pkce' | 'fapi2';

export type OidcClientAuthentication =
  | { method: 'none' }
  | { method: 'client_secret_basic'; clientSecret: string };

export interface InstitutionIdentityProvider {
  id: string;
  displayName: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  clientAuthentication: OidcClientAuthentication;
  securityProfile: InstitutionSecurityProfile;
  /** 只允许本机开发身份源；不得用于正式机构接入。 */
  allowInsecureLoopback?: boolean;
}

export interface OidcAuthorizationTransaction {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface VerifiedFederatedIdentity {
  providerId: string;
  issuer: string;
  subject: string;
  organizationId?: string;
  tenantId?: string;
  acr?: string;
  amr: string[];
  authenticatedAt?: string;
  email?: string;
  emailVerified: boolean;
  phoneNumber?: string;
  phoneNumberVerified: boolean;
  grantedScopes: string[];
  verifiedAt: string;
}

export interface OwnerIdentityRecord {
  id: string;
  providerId: string;
  issuer: string;
  subject: string;
  organizationId?: string;
  tenantId?: string;
  assurance: {
    acr?: string;
    amr: string[];
    authenticatedAt?: string;
  };
  contact: {
    emailHint?: string;
    emailVerified: boolean;
    phoneHint?: string;
    phoneVerified: boolean;
  };
  grantedScopes: string[];
  createdAt: string;
  lastVerifiedAt: string;
  revokedAt?: string;
}

export interface SubjectOwnerBinding {
  id: string;
  ownerIdentityId: string;
  subjectId: string;
  createdAt: string;
  confirmationRef: string;
  revokedAt?: string;
}
