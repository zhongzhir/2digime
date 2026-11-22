/**
 * 本端通信身份 + 对端公钥目录。
 * 私钥仅经 FileSecretStore（Electron safeStorage / 测试 AES 适配器）；不明文 JSON。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import {
  createAesGcmCipherAdapter,
  type CipherAdapter,
  FileSecretStore,
} from '../infrastructure/secret-store';
import {
  generateCommKeyMaterial,
  type CommKeyMaterial,
} from './crypto-identity';
import {
  createSignedKeyTransition,
  verifySignedKeyTransition,
  type SignedKeyTransition,
} from './key-transition';
import {
  SUBJECT_ENDPOINT_PROTOCOL,
  remoteEndpointRef,
  parseRemoteEndpointRef,
  type LocalEndpointProfile,
  type PeerEndpointRecord,
  type SubjectEndpointPublic,
} from './endpoint';
import { nowIso } from '../shared/ids';

const SECRET_SIGN = 'comm.identity.signPrivatePem';
const SECRET_ENC = 'comm.identity.encPrivatePem';
const SECRET_BUNDLE_PREFIX = 'comm.identity.bundle.';

export interface LocalIdentityTransition {
  proof: SignedKeyTransition;
  previousProfile: LocalEndpointProfile;
  nextProfile: LocalEndpointProfile;
  requiredPeerEndpointIds: string[];
  readyPeerEndpointIds: string[];
  committedPeerEndpointIds: string[];
  phase: 'preparing' | 'active';
  updatedAt: string;
}

export interface PeerIdentityTransition {
  proof: SignedKeyTransition;
  previousEndpointId: string;
  nextEndpointId: string;
  preparedAt: string;
}

interface CompletedPeerIdentityTransition {
  subjectId: string;
  previousEndpointId: string;
  nextEndpointId: string;
  previousKeyId: string;
  nextKeyId: string;
  committedAt: string;
}

interface PeersFile {
  version: 2;
  self: LocalEndpointProfile | null;
  peers: Record<string, PeerEndpointRecord>;
  /** subjectId -> keyId -> revokedAt。只记录对端通信身份，不等于 Owner 授权撤销。 */
  revokedPeerKeys: Record<string, Record<string, string>>;
  localTransition: LocalIdentityTransition | null;
  peerTransitions: Record<string, PeerIdentityTransition>;
  completedPeerTransitions: Record<string, CompletedPeerIdentityTransition>;
  retiredLocalKeys: Record<string, string>;
}

function peersPath(packageRoot: string): string {
  return path.join(packageRoot, 'collaboration', 'peers.json');
}

function secretsPath(packageRoot: string): string {
  return path.join(packageRoot, 'collaboration', 'comm-secrets.v1.json');
}

async function loadPeers(packageRoot: string): Promise<PeersFile> {
  const result = await readFileWithRecovery(peersPath(packageRoot), (c) => {
    try {
      JSON.parse(c);
      return true;
    } catch {
      return false;
    }
  });
  const empty = (): PeersFile => ({
    version: 2,
    self: null,
    peers: {},
    revokedPeerKeys: {},
    localTransition: null,
    peerTransitions: {},
    completedPeerTransitions: {},
    retiredLocalKeys: {},
  });
  if (!result.content) return empty();
  try {
    const parsed = JSON.parse(result.content) as Partial<PeersFile>;
    return {
      version: 2,
      self: parsed.self || null,
      peers: parsed.peers || {},
      revokedPeerKeys: parsed.revokedPeerKeys || {},
      localTransition: parsed.localTransition || null,
      peerTransitions: parsed.peerTransitions || {},
      completedPeerTransitions: parsed.completedPeerTransitions || {},
      retiredLocalKeys: parsed.retiredLocalKeys || {},
    };
  } catch {
    return empty();
  }
}

async function savePeers(packageRoot: string, file: PeersFile): Promise<void> {
  await fs.mkdir(path.dirname(peersPath(packageRoot)), { recursive: true });
  await atomicWriteFile(peersPath(packageRoot), `${JSON.stringify(file, null, 2)}\n`);
}

export class CommIdentityStore {
  private readonly secrets: FileSecretStore;

  constructor(
    private readonly packageRoot: string,
    cipher: CipherAdapter,
  ) {
    this.secrets = new FileSecretStore({
      filePath: secretsPath(packageRoot),
      cipher,
    });
  }

  private bundleKey(keyId: string): string {
    if (!/^[A-Za-z0-9_.-]+$/.test(keyId)) throw new Error('通信 keyId 格式无效');
    return `${SECRET_BUNDLE_PREFIX}${keyId}`;
  }

  private async putKeyBundle(material: CommKeyMaterial): Promise<void> {
    await this.secrets.put(this.bundleKey(material.keyId), JSON.stringify(material));
  }

  private async getKeyBundle(keyId: string): Promise<CommKeyMaterial | null> {
    const raw = await this.secrets.get(this.bundleKey(keyId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CommKeyMaterial;
      if (
        parsed.keyId !== keyId ||
        !parsed.signPrivatePem ||
        !parsed.signPublicSpkiB64 ||
        !parsed.encPrivatePem ||
        !parsed.encPublicSpkiB64
      ) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async ensureLocalEndpoint(input: {
    subjectId: string;
    displayName: string;
    relayUrl: string;
    endpointId?: string;
  }): Promise<{ profile: LocalEndpointProfile; created: boolean }> {
    const peers = await loadPeers(this.packageRoot);
    if (peers.self) {
      if (peers.localTransition) {
        const requestedRelay = (input.relayUrl || peers.self.relayUrl).replace(/\/+$/, '');
        if (requestedRelay !== peers.self.relayUrl.replace(/\/+$/, '')) {
          throw new Error('端点交接完成前不能修改 Relay');
        }
        return { profile: peers.self, created: false };
      }
      // 允许更新 relayUrl / displayName
      peers.self = {
        ...peers.self,
        displayName: input.displayName || peers.self.displayName,
        relayUrl: input.relayUrl || peers.self.relayUrl,
      };
      await savePeers(this.packageRoot, peers);
      return { profile: peers.self, created: false };
    }

    const material = generateCommKeyMaterial();
    // 完整 bundle 先落盘，profile 只有随后才会成为活动端点。
    await this.putKeyBundle(material);

    const endpointId =
      input.endpointId ||
      `ep_${input.subjectId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}_${Date.now().toString(36)}`;

    const profile: LocalEndpointProfile = {
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      subjectId: input.subjectId,
      endpointId,
      displayName: input.displayName,
      relayUrl: input.relayUrl.replace(/\/+$/, ''),
      signPublicKey: material.signPublicSpkiB64,
      encPublicKey: material.encPublicSpkiB64,
      keyId: material.keyId,
      createdAt: nowIso(),
    };
    peers.self = profile;
    await savePeers(this.packageRoot, peers);
    return { profile, created: true };
  }

  async getLocalProfile(): Promise<LocalEndpointProfile | null> {
    return (await loadPeers(this.packageRoot)).self;
  }

  async loadKeyMaterial(): Promise<CommKeyMaterial | null> {
    const self = await this.getLocalProfile();
    if (!self) return null;
    const bundled = await this.getKeyBundle(self.keyId);
    if (
      bundled &&
      bundled.signPublicSpkiB64 === self.signPublicKey &&
      bundled.encPublicSpkiB64 === self.encPublicKey
    ) return bundled;
    // 旧安装只读兼容；轮换准备时会迁入完整 bundle。
    const signPrivatePem = await this.secrets.get(SECRET_SIGN);
    const encPrivatePem = await this.secrets.get(SECRET_ENC);
    if (!signPrivatePem || !encPrivatePem) return null;
    return {
      keyId: self.keyId,
      signPrivatePem,
      signPublicSpkiB64: self.signPublicKey,
      encPrivatePem,
      encPublicSpkiB64: self.encPublicKey,
    };
  }

  async getLocalTransition(): Promise<LocalIdentityTransition | null> {
    return (await loadPeers(this.packageRoot)).localTransition;
  }

  /** 新、旧完整密钥都先加密落盘；活动 profile 此时仍保持旧端点。 */
  async prepareLocalTransition(input: {
    endpointId?: string;
    relayUrl?: string;
    issuedAt?: string;
    expiresAt?: string;
  } = {}): Promise<LocalIdentityTransition> {
    const peers = await loadPeers(this.packageRoot);
    if (peers.localTransition) return peers.localTransition;
    const previousProfile = peers.self;
    if (!previousProfile) throw new Error('尚未配置远程端点');
    const relayUrl = (input.relayUrl || previousProfile.relayUrl).replace(/\/+$/, '');
    if (relayUrl !== previousProfile.relayUrl.replace(/\/+$/, '')) {
      throw new Error('当前轮换闭环只支持同一 Relay 内迁移端点');
    }
    const previousKeys = await this.loadKeyMaterial();
    if (!previousKeys) throw new Error('当前通信密钥不可用');
    await this.putKeyBundle(previousKeys);

    const nextKeys = generateCommKeyMaterial();
    await this.putKeyBundle(nextKeys);
    const createdAt = input.issuedAt || nowIso();
    const endpointId = input.endpointId ||
      `ep_${previousProfile.subjectId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}_${Date.now().toString(36)}`;
    if (endpointId === previousProfile.endpointId) {
      throw new Error('交接期间新旧 endpointId 必须不同');
    }
    if (peers.peers[endpointId]) throw new Error('新 endpointId 已被对端占用');
    const nextProfile: LocalEndpointProfile = {
      ...previousProfile,
      endpointId,
      relayUrl,
      signPublicKey: nextKeys.signPublicSpkiB64,
      encPublicKey: nextKeys.encPublicSpkiB64,
      keyId: nextKeys.keyId,
      createdAt,
    };
    const proof = createSignedKeyTransition({
      previousProfile,
      previousKeys,
      nextProfile,
      nextKeys,
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    const transition: LocalIdentityTransition = {
      proof,
      previousProfile,
      nextProfile,
      requiredPeerEndpointIds: Object.keys(peers.peers).sort(),
      readyPeerEndpointIds: [],
      committedPeerEndpointIds: [],
      phase: 'preparing',
      updatedAt: nowIso(),
    };
    peers.localTransition = transition;
    await savePeers(this.packageRoot, peers);
    return transition;
  }

  async markLocalTransitionReady(
    transitionId: string,
    peerEndpointId: string,
  ): Promise<LocalIdentityTransition> {
    const peers = await loadPeers(this.packageRoot);
    const transition = peers.localTransition;
    if (!transition || transition.proof.statement.transitionId !== transitionId) {
      throw new Error('本机没有对应的端点交接');
    }
    if (!transition.requiredPeerEndpointIds.includes(peerEndpointId)) {
      throw new Error('交接就绪消息来自非目标端点');
    }
    if (!transition.readyPeerEndpointIds.includes(peerEndpointId)) {
      transition.readyPeerEndpointIds.push(peerEndpointId);
      transition.readyPeerEndpointIds.sort();
      transition.updatedAt = nowIso();
      await savePeers(this.packageRoot, peers);
    }
    return transition;
  }

  async activateLocalTransition(): Promise<LocalIdentityTransition> {
    const peers = await loadPeers(this.packageRoot);
    const transition = peers.localTransition;
    if (!transition) throw new Error('本机没有待激活的端点交接');
    if (transition.phase === 'active') return transition;
    const missing = transition.requiredPeerEndpointIds.filter(
      (id) => !transition.readyPeerEndpointIds.includes(id),
    );
    if (missing.length) throw new Error('仍有对端未确认新端点');
    if (!(await this.getKeyBundle(transition.nextProfile.keyId))) {
      throw new Error('新端点完整密钥 bundle 不可用');
    }
    // profile 和 phase 由 peers.json 的一次原子替换共同提交。
    peers.self = transition.nextProfile;
    transition.phase = 'active';
    transition.updatedAt = nowIso();
    await savePeers(this.packageRoot, peers);
    return transition;
  }

  async markLocalTransitionCommitted(
    transitionId: string,
    peerEndpointId: string,
  ): Promise<LocalIdentityTransition> {
    const peers = await loadPeers(this.packageRoot);
    const transition = peers.localTransition;
    if (!transition || transition.proof.statement.transitionId !== transitionId) {
      throw new Error('本机没有对应的端点交接');
    }
    if (transition.phase !== 'active') throw new Error('端点交接尚未激活');
    if (!transition.requiredPeerEndpointIds.includes(peerEndpointId)) {
      throw new Error('交接确认来自非目标端点');
    }
    if (!transition.committedPeerEndpointIds.includes(peerEndpointId)) {
      transition.committedPeerEndpointIds.push(peerEndpointId);
      transition.committedPeerEndpointIds.sort();
      transition.updatedAt = nowIso();
      await savePeers(this.packageRoot, peers);
    }
    return transition;
  }

  async finalizeLocalTransition(): Promise<boolean> {
    let peers = await loadPeers(this.packageRoot);
    const transition = peers.localTransition;
    if (!transition || transition.phase !== 'active') return false;
    const missing = transition.requiredPeerEndpointIds.filter(
      (id) => !transition.committedPeerEndpointIds.includes(id),
    );
    if (missing.length) return false;

    // 先删旧私钥，再删恢复记录；中断后重复执行仍安全。
    await this.secrets.delete(this.bundleKey(transition.previousProfile.keyId));
    await this.secrets.delete(SECRET_SIGN);
    await this.secrets.delete(SECRET_ENC);
    peers = await loadPeers(this.packageRoot);
    if (peers.localTransition?.proof.statement.transitionId !== transition.proof.statement.transitionId) {
      return false;
    }
    peers.retiredLocalKeys[transition.previousProfile.keyId] = nowIso();
    peers.localTransition = null;
    await savePeers(this.packageRoot, peers);
    return true;
  }

  async putPeer(peer: SubjectEndpointPublic): Promise<PeerEndpointRecord> {
    const peers = await loadPeers(this.packageRoot);
    const record: PeerEndpointRecord = {
      ...peer,
      relayUrl: peer.relayUrl.replace(/\/+$/, ''),
      pairedAt: nowIso(),
    };
    peers.peers[peer.endpointId] = record;
    await savePeers(this.packageRoot, peers);
    return record;
  }

  async getPeer(endpointId: string): Promise<PeerEndpointRecord | null> {
    const peers = await loadPeers(this.packageRoot);
    return peers.peers[endpointId] || null;
  }

  async getPeerByEndpointRef(endpointRef: string): Promise<PeerEndpointRecord | null> {
    const id = parseRemoteEndpointRef(endpointRef);
    if (!id) return null;
    return this.getPeer(id);
  }

  async listPeers(): Promise<PeerEndpointRecord[]> {
    const peers = await loadPeers(this.packageRoot);
    return Object.values(peers.peers);
  }

  async revokePeerKey(input: {
    subjectId: string;
    keyId: string;
    revokedAt?: string;
  }): Promise<void> {
    const subjectId = input.subjectId.trim();
    const keyId = input.keyId.trim();
    if (!subjectId || !keyId) throw new Error('撤销记录缺少 subjectId 或 keyId');
    const peers = await loadPeers(this.packageRoot);
    const revoked = peers.revokedPeerKeys[subjectId] || {};
    revoked[keyId] = input.revokedAt || nowIso();
    peers.revokedPeerKeys[subjectId] = revoked;
    await savePeers(this.packageRoot, peers);
  }

  async listRevokedPeerKeyIds(subjectId: string): Promise<string[]> {
    const peers = await loadPeers(this.packageRoot);
    return Object.keys(peers.revokedPeerKeys[subjectId] || {}).sort();
  }

  async isPeerKeyRevoked(subjectId: string, keyId: string): Promise<boolean> {
    const peers = await loadPeers(this.packageRoot);
    return Boolean(peers.revokedPeerKeys[subjectId]?.[keyId]);
  }

  async acceptPeerTransition(input: {
    proof: SignedKeyTransition;
    fromEndpointId: string;
    now?: string;
  }): Promise<PeerIdentityTransition> {
    const peers = await loadPeers(this.packageRoot);
    const statement = input.proof?.statement;
    if (!statement) throw new Error('端点交接证明缺少声明');
    if (peers.completedPeerTransitions[statement.transitionId]) {
      throw new Error('该对端交接已完成');
    }
    const previous = peers.peers[input.fromEndpointId];
    if (!previous) throw new Error('端点交接来自未配对端点');
    const verified = verifySignedKeyTransition({
      proof: input.proof,
      expectedPrevious: previous,
      revokedKeyIds: Object.keys(peers.revokedPeerKeys[previous.subjectId] || {}),
      ...(input.now ? { now: input.now } : {}),
    });
    if (!verified.ok) throw new Error(`端点交接证明无效: ${verified.reasons.join(',')}`);
    const existing = peers.peers[statement.next.endpointId];
    if (
      existing &&
      (existing.subjectId !== statement.subjectId || existing.keyId !== statement.next.keyId)
    ) throw new Error('新 endpointId 已绑定其他主体或 key');

    peers.peers[statement.next.endpointId] = {
      protocolVersion: SUBJECT_ENDPOINT_PROTOCOL,
      subjectId: statement.subjectId,
      endpointId: statement.next.endpointId,
      displayName: statement.displayName,
      relayUrl: statement.relayUrl.replace(/\/+$/, ''),
      signPublicKey: statement.next.signPublicKey,
      encPublicKey: statement.next.encPublicKey,
      keyId: statement.next.keyId,
      pairedAt: nowIso(),
    };
    const pending: PeerIdentityTransition = {
      proof: input.proof,
      previousEndpointId: statement.previous.endpointId,
      nextEndpointId: statement.next.endpointId,
      preparedAt: nowIso(),
    };
    peers.peerTransitions[statement.transitionId] = pending;
    await savePeers(this.packageRoot, peers);
    return pending;
  }

  async commitPeerTransition(input: {
    transitionId: string;
    fromEndpointId: string;
  }): Promise<{ previous: PeerEndpointRecord | null; next: PeerEndpointRecord }> {
    const peers = await loadPeers(this.packageRoot);
    const completed = peers.completedPeerTransitions[input.transitionId];
    if (completed) {
      const next = peers.peers[completed.nextEndpointId];
      if (!next || input.fromEndpointId !== completed.nextEndpointId) {
        throw new Error('交接提交端点不匹配');
      }
      return { previous: null, next };
    }
    const pending = peers.peerTransitions[input.transitionId];
    if (!pending || input.fromEndpointId !== pending.nextEndpointId) {
      throw new Error('没有匹配的新端点交接准备记录');
    }
    const statement = pending.proof.statement;
    const next = peers.peers[pending.nextEndpointId];
    if (!next || next.keyId !== statement.next.keyId) {
      throw new Error('新端点 key 与交接证明不匹配');
    }
    const previous = peers.peers[pending.previousEndpointId] || null;
    const revoked = peers.revokedPeerKeys[statement.subjectId] || {};
    revoked[statement.previous.keyId] = nowIso();
    peers.revokedPeerKeys[statement.subjectId] = revoked;
    delete peers.peers[pending.previousEndpointId];
    delete peers.peerTransitions[input.transitionId];
    peers.completedPeerTransitions[input.transitionId] = {
      subjectId: statement.subjectId,
      previousEndpointId: statement.previous.endpointId,
      nextEndpointId: statement.next.endpointId,
      previousKeyId: statement.previous.keyId,
      nextKeyId: statement.next.keyId,
      committedAt: nowIso(),
    };
    await savePeers(this.packageRoot, peers);
    return { previous, next };
  }

  toSubjectRef(peer: SubjectEndpointPublic): {
    subjectId: string;
    displayName: string;
    endpointRef: string;
  } {
    return {
      subjectId: peer.subjectId,
      displayName: peer.displayName,
      endpointRef: remoteEndpointRef(peer.endpointId),
    };
  }

  /** 检测私钥是否明文落在 peers.json（审计用）。 */
  async assertNoPlaintextPrivateKeys(): Promise<boolean> {
    const raw = await fs.readFile(peersPath(this.packageRoot), 'utf8').catch(() => '');
    if (/BEGIN PRIVATE KEY|signPrivatePem|encPrivatePem/.test(raw)) return false;
    return true;
  }
}

/** 测试用：固定 AES 密钥的 CipherAdapter（仅测试/CLI，非生产 Windows 路径）。 */
export function createTestCommCipher(): CipherAdapter {
  return createAesGcmCipherAdapter(Buffer.alloc(32, 7));
}
