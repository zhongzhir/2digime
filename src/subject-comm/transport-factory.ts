/**
 * 按本机配置解析 SubjectTransport：有 Relay 配置则优先 Relay，否则 Local。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { CipherAdapter } from '../infrastructure/secret-store';
import { LocalPackageTransport } from '../collaboration/transport';
import { RelayTransport } from './relay-transport';
import { createTestCommCipher, CommIdentityStore } from './identity-store';
import type { SubjectTransport } from './subject-transport';

/** Electron 启动时注入 safeStorage 适配器；测试可注入固定密钥适配器。 */
let injectedCommCipher: CipherAdapter | null = null;

export function setCommCipher(cipher: CipherAdapter | null): void {
  injectedCommCipher = cipher;
}

export function resolveCommCipher(explicit?: CipherAdapter): CipherAdapter {
  return explicit || injectedCommCipher || createTestCommCipher();
}

export async function openRelayIfConfigured(
  runtime: DigitalMeRuntime,
  cipher?: CipherAdapter,
): Promise<RelayTransport | null> {
  const root = runtime.subject.requireActive().rootDir;
  const c = resolveCommCipher(cipher);
  const store = new CommIdentityStore(root, c);
  const self = await store.getLocalProfile();
  if (!self) return null;
  return new RelayTransport({ packageRoot: root, cipher: c, relayUrl: self.relayUrl });
}

export async function getCollaborationTransport(
  runtime: DigitalMeRuntime,
  cipher?: CipherAdapter,
): Promise<LocalPackageTransport> {
  const relay = await openRelayIfConfigured(runtime, cipher);
  return new LocalPackageTransport(runtime, { relay });
}

export async function getActiveSubjectTransport(
  runtime: DigitalMeRuntime,
  cipher?: CipherAdapter,
): Promise<SubjectTransport> {
  const t = await getCollaborationTransport(runtime, cipher);
  return t.asSubjectTransport();
}
