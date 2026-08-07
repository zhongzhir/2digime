/**
 * 主体通信身份密钥 — 标准 Node crypto（Ed25519 签名 + X25519 ECDH + AES-256-GCM）。
 * 禁止自创算法；私钥从不上传 Relay。
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

export interface CommKeyMaterial {
  keyId: string;
  /** PKCS8 PEM */
  signPrivatePem: string;
  signPublicSpkiB64: string;
  /** PKCS8 PEM */
  encPrivatePem: string;
  encPublicSpkiB64: string;
}

export interface SealedPayload {
  ephPublicSpkiB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

function b64(buf: Buffer): string {
  return buf.toString('base64');
}

function fromB64(s: string): Buffer {
  return Buffer.from(s, 'base64');
}

export function generateCommKeyMaterial(keyId?: string): CommKeyMaterial {
  const id =
    keyId ||
    `ck_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  const signPair = generateKeyPairSync('ed25519');
  const encPair = generateKeyPairSync('x25519');
  return {
    keyId: id,
    signPrivatePem: signPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    signPublicSpkiB64: signPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    encPrivatePem: encPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    encPublicSpkiB64: encPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function loadSignPrivate(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function loadSignPublic(spkiB64: string): KeyObject {
  return createPublicKey({ key: fromB64(spkiB64), format: 'der', type: 'spki' });
}

export function loadEncPrivate(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function loadEncPublic(spkiB64: string): KeyObject {
  return createPublicKey({ key: fromB64(spkiB64), format: 'der', type: 'spki' });
}

/** 规范化签名输入（不含私钥、不含明文业务字段以外的日志敏感项）。 */
export function canonicalRelaySignBytes(input: {
  envelopeId: string;
  fromEndpointId: string;
  toEndpointId: string;
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  sealedJson: string;
}): Buffer {
  const lines = [
    'dm-relay-v1',
    input.envelopeId,
    input.fromEndpointId,
    input.toEndpointId,
    input.keyId,
    input.createdAt,
    input.expiresAt || '',
    input.sealedJson,
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

export function signRelayEnvelope(
  signPrivatePem: string,
  bytes: Buffer,
): string {
  return b64(sign(null, bytes, loadSignPrivate(signPrivatePem)));
}

export function verifyRelayEnvelope(
  signPublicSpkiB64: string,
  bytes: Buffer,
  signatureB64: string,
): boolean {
  try {
    return verify(null, bytes, loadSignPublic(signPublicSpkiB64), fromB64(signatureB64));
  } catch {
    return false;
  }
}

/**
 * 面向收件人 X25519 公钥加密：临时密钥 + ECDH + HKDF + AES-256-GCM。
 */
export function sealedCanonicalJson(sealed: SealedPayload): string {
  return JSON.stringify({
    ephPublicSpkiB64: sealed.ephPublicSpkiB64,
    ivB64: sealed.ivB64,
    tagB64: sealed.tagB64,
    ciphertextB64: sealed.ciphertextB64,
  });
}

export function sealForRecipient(
  recipientEncPublicSpkiB64: string,
  plaintextUtf8: string,
): SealedPayload {
  const eph = generateKeyPairSync('x25519');
  const recipientPub = loadEncPublic(recipientEncPublicSpkiB64);
  const shared = diffieHellman({
    privateKey: eph.privateKey,
    publicKey: recipientPub,
  });
  const key = Buffer.from(
    hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('digitalme-relay-e2ee-v1'), 32),
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ephPublicSpkiB64: eph.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    ivB64: b64(iv),
    tagB64: b64(tag),
    ciphertextB64: b64(data),
  };
}

export function openSealedPayload(
  recipientEncPrivatePem: string,
  sealed: SealedPayload,
): string {
  const ephPub = loadEncPublic(sealed.ephPublicSpkiB64);
  const shared = diffieHellman({
    privateKey: loadEncPrivate(recipientEncPrivatePem),
    publicKey: ephPub,
  });
  const key = Buffer.from(
    hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('digitalme-relay-e2ee-v1'), 32),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, fromB64(sealed.ivB64));
  decipher.setAuthTag(fromB64(sealed.tagB64));
  return Buffer.concat([
    decipher.update(fromB64(sealed.ciphertextB64)),
    decipher.final(),
  ]).toString('utf8');
}
