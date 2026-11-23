import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import type {
  InstitutionAuthorityScope,
  OwnerIdentityRecord,
  SubjectOwnerBinding,
  VerifiedFederatedIdentity,
} from './types';

interface OwnerIdentityFile {
  version: 1;
  identities: Record<string, OwnerIdentityRecord>;
  bindings: Record<string, SubjectOwnerBinding>;
}

function identityDir(packageRoot: string): string {
  return path.join(packageRoot, 'identity');
}

function identityPath(packageRoot: string): string {
  return path.join(identityDir(packageRoot), 'owner-identities.json');
}

function auditPath(packageRoot: string): string {
  return path.join(identityDir(packageRoot), 'owner-identity-audit.ndjson');
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

function emptyFile(): OwnerIdentityFile {
  return { version: 1, identities: {}, bindings: {} };
}

function validFile(content: string): boolean {
  try {
    const value = JSON.parse(content) as Partial<OwnerIdentityFile>;
    return value.version === 1 && !!value.identities && !!value.bindings;
  } catch {
    return false;
  }
}

function maskEmail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const at = value.lastIndexOf('@');
  if (at <= 0) return undefined;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain) return undefined;
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return `***${digits.slice(-4)}`;
}

export class OwnerIdentityStore {
  constructor(private readonly packageRoot: string) {}

  private async load(): Promise<OwnerIdentityFile> {
    const result = await readFileWithRecovery(identityPath(this.packageRoot), validFile);
    if (!result.content) return emptyFile();
    const parsed = JSON.parse(result.content) as OwnerIdentityFile;
    return {
      version: 1,
      identities: parsed.identities || {},
      bindings: parsed.bindings || {},
    };
  }

  private async save(file: OwnerIdentityFile): Promise<void> {
    await fs.mkdir(identityDir(this.packageRoot), { recursive: true });
    await atomicWriteFile(identityPath(this.packageRoot), `${JSON.stringify(file, null, 2)}\n`);
  }

  private async audit(event: Record<string, unknown>): Promise<void> {
    await fs.mkdir(identityDir(this.packageRoot), { recursive: true });
    await fs.appendFile(auditPath(this.packageRoot), `${JSON.stringify(event)}\n`, 'utf8');
  }

  async recordVerifiedIdentity(verified: VerifiedFederatedIdentity): Promise<OwnerIdentityRecord> {
    const file = await this.load();
    const id = stableId('oid', verified.issuer, verified.subject);
    const existing = file.identities[id];
    if (existing && (existing.issuer !== verified.issuer || existing.subject !== verified.subject)) {
      throw new Error('Owner identity 稳定标识冲突');
    }
    const emailHint = maskEmail(verified.email);
    const phoneHint = maskPhone(verified.phoneNumber);
    const next: OwnerIdentityRecord = {
      id,
      providerId: verified.providerId,
      issuer: verified.issuer,
      subject: verified.subject,
      ...(verified.organizationId ? { organizationId: verified.organizationId } : {}),
      ...(verified.tenantId ? { tenantId: verified.tenantId } : {}),
      assurance: {
        ...(verified.acr ? { acr: verified.acr } : {}),
        amr: [...verified.amr],
        ...(verified.authenticatedAt ? { authenticatedAt: verified.authenticatedAt } : {}),
      },
      contact: {
        ...(emailHint ? { emailHint } : {}),
        emailVerified: verified.emailVerified,
        ...(phoneHint ? { phoneHint } : {}),
        phoneVerified: verified.phoneNumberVerified,
      },
      grantedScopes: [...verified.grantedScopes].sort(),
      createdAt: existing?.createdAt || verified.verifiedAt,
      lastVerifiedAt: verified.verifiedAt,
      ...(existing?.revokedAt ? { revokedAt: existing.revokedAt } : {}),
    };
    file.identities[id] = next;
    await this.save(file);
    await this.audit({
      at: verified.verifiedAt,
      action: existing ? 'owner_identity_reverified' : 'owner_identity_verified',
      ownerIdentityId: id,
      providerId: verified.providerId,
    });
    return next;
  }

  async bindToSubject(input: {
    ownerIdentityId: string;
    subjectId: string;
    targetAuthority?: InstitutionAuthorityScope;
    confirmationRef: string;
    confirmed: boolean;
    at: string;
  }): Promise<SubjectOwnerBinding> {
    if (!input.confirmed) throw new Error('机构登录不能自动授权 Digital Subject');
    if (!input.confirmationRef.trim()) throw new Error('绑定必须有 Owner 确认引用');
    const file = await this.load();
    const identity = file.identities[input.ownerIdentityId];
    if (!identity || identity.revokedAt) throw new Error('Owner identity 不可用');
    const identityScoped = Boolean(identity.organizationId || identity.tenantId);
    const targetScoped = Boolean(
      input.targetAuthority?.organizationId || input.targetAuthority?.tenantId,
    );
    if (identityScoped !== targetScoped) {
      throw new Error('机构身份与 Digital Subject 的租户范围不完整');
    }
    if (
      identity.organizationId !== input.targetAuthority?.organizationId ||
      identity.tenantId !== input.targetAuthority?.tenantId
    ) {
      throw new Error('机构身份与 Digital Subject 的租户范围不匹配');
    }
    const id = stableId('osb', input.ownerIdentityId, input.subjectId);
    const existing = file.bindings[id];
    if (existing && !existing.revokedAt) return existing;
    const binding: SubjectOwnerBinding = {
      id,
      ownerIdentityId: input.ownerIdentityId,
      subjectId: input.subjectId,
      createdAt: input.at,
      confirmationRef: input.confirmationRef,
    };
    file.bindings[id] = binding;
    await this.save(file);
    await this.audit({
      at: input.at,
      action: 'owner_subject_bound',
      ownerIdentityId: input.ownerIdentityId,
      subjectId: input.subjectId,
      bindingId: id,
      confirmationRef: input.confirmationRef,
    });
    return binding;
  }

  async revokeBinding(bindingId: string, at: string): Promise<boolean> {
    const file = await this.load();
    const binding = file.bindings[bindingId];
    if (!binding || binding.revokedAt) return false;
    binding.revokedAt = at;
    await this.save(file);
    await this.audit({ at, action: 'owner_subject_binding_revoked', bindingId });
    return true;
  }

  async revokeIdentity(ownerIdentityId: string, at: string): Promise<boolean> {
    const file = await this.load();
    const identity = file.identities[ownerIdentityId];
    if (!identity || identity.revokedAt) return false;
    identity.revokedAt = at;
    for (const binding of Object.values(file.bindings)) {
      if (binding.ownerIdentityId === ownerIdentityId && !binding.revokedAt) binding.revokedAt = at;
    }
    await this.save(file);
    await this.audit({ at, action: 'owner_identity_revoked', ownerIdentityId });
    return true;
  }

  async list(): Promise<{ identities: OwnerIdentityRecord[]; bindings: SubjectOwnerBinding[] }> {
    const file = await this.load();
    return {
      identities: Object.values(file.identities),
      bindings: Object.values(file.bindings),
    };
  }
}
