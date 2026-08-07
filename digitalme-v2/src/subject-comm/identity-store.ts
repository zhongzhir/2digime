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

interface PeersFile {
  version: 1;
  self: LocalEndpointProfile | null;
  peers: Record<string, PeerEndpointRecord>;
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
  if (!result.content) return { version: 1, self: null, peers: {} };
  try {
    const parsed = JSON.parse(result.content) as PeersFile;
    return {
      version: 1,
      self: parsed.self || null,
      peers: parsed.peers || {},
    };
  } catch {
    return { version: 1, self: null, peers: {} };
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

  async ensureLocalEndpoint(input: {
    subjectId: string;
    displayName: string;
    relayUrl: string;
    endpointId?: string;
  }): Promise<{ profile: LocalEndpointProfile; created: boolean }> {
    const peers = await loadPeers(this.packageRoot);
    if (peers.self) {
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
    await this.secrets.put(SECRET_SIGN, material.signPrivatePem);
    await this.secrets.put(SECRET_ENC, material.encPrivatePem);

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
