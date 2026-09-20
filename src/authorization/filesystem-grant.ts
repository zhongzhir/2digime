/**
 * Owner 对本机文件夹的授权。
 * 复用现有 AuthorizationGrant / GrantStore，不是 Digital Self，也不是聊天偏好。
 */
import { createHash } from 'node:crypto';
import { GrantStore } from '../collaboration/grant-store';
import type { AuthorizationGrant } from '../collaboration/schema';
import { canonicalizeFolderPath } from './filesystem-path';

export const LOCAL_FILESYSTEM_CAPABILITY_ID = 'local-filesystem';
export const LOCAL_FILESYSTEM_ACTIONS = ['read', 'write', 'create'] as const;

export type FilesystemGrantView = {
  id: string;
  folder: string;
  grantedAt: string;
};

function grantIdForFolder(canonicalFolder: string): string {
  const digest = createHash('sha256').update(canonicalFolder).digest('hex').slice(0, 32);
  return `fsg_${digest}`;
}

function isActiveFilesystemGrant(grant: AuthorizationGrant): boolean {
  if (grant.status !== 'granted') return false;
  if (grant.origin?.kind !== 'owner_direct') return false;
  if (grant.grantee?.kind !== 'capability') return false;
  if (grant.grantee.capabilityId !== LOCAL_FILESYSTEM_CAPABILITY_ID) return false;
  return true;
}

export async function listActiveFilesystemGrants(packageRoot: string): Promise<FilesystemGrantView[]> {
  const store = await GrantStore.open(packageRoot);
  const all = await store.list();
  return all
    .filter(isActiveFilesystemGrant)
    .map((grant) => ({
      id: grant.id,
      folder: String(grant.scope.resourceRefs?.[0] || '').trim(),
      grantedAt: grant.grantedAt,
    }))
    .filter((item) => item.folder);
}

export async function listActiveFilesystemGrantFolders(packageRoot: string): Promise<string[]> {
  const rows = await listActiveFilesystemGrants(packageRoot);
  return [...new Set(rows.map((row) => canonicalizeFolderPath(row.folder)))];
}

export async function saveFilesystemGrant(input: {
  packageRoot: string;
  subjectId: string;
  folder: string;
  now: string;
}): Promise<FilesystemGrantView> {
  const folder = canonicalizeFolderPath(input.folder);
  const id = grantIdForFolder(folder);
  const store = await GrantStore.open(input.packageRoot);
  const existing = await store.get(id);
  const grant: AuthorizationGrant = {
    id,
    grantorSubjectId: input.subjectId,
    grantee: { kind: 'capability', capabilityId: LOCAL_FILESYSTEM_CAPABILITY_ID },
    scope: {
      actions: [...LOCAL_FILESYSTEM_ACTIONS],
      resourceRefs: [folder],
    },
    origin: { kind: 'owner_direct' },
    status: 'granted',
    grantedAt: existing?.status === 'granted' ? existing.grantedAt : input.now,
  };
  await store.put(grant);
  return { id, folder, grantedAt: grant.grantedAt };
}

export async function revokeFilesystemGrant(input: {
  packageRoot: string;
  grantId: string;
  now: string;
}): Promise<boolean> {
  const store = await GrantStore.open(input.packageRoot);
  const existing = await store.get(input.grantId);
  if (!existing || !isActiveFilesystemGrant(existing)) return false;
  await store.put({
    ...existing,
    status: 'revoked',
    revokedAt: input.now,
  });
  return true;
}
