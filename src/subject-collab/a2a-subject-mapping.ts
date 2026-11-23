/**
 * A2A v1.0 projection for Subject <-> Subject collaboration.
 *
 * These objects are wire projections only. They do not create another Task,
 * Artifact, identity, authorization, or collaboration authority inside 2digime.
 */
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  A2A_PROTOCOL_VERSION,
  AgentCard,
  Message,
  Role,
  Task,
  TaskState,
  generateAgentCardSignature,
  verifyAgentCardSignature,
  type AgentCard as A2AAgentCard,
  type Message as A2AMessage,
  type Part,
  type Task as A2ATask,
} from '@a2a-js/sdk';
import type { CommIdentityStore } from '../subject-comm/identity-store';
import type { PeerEndpointRecord, SubjectEndpointPublic } from '../subject-comm/endpoint';
import { parseRemoteEndpointRef, remoteEndpointRef } from '../subject-comm/endpoint';
import { isPersonalContextContract } from './personal-context-contract';
import type {
  CollaborationRequest,
  CollaborationResponse,
  PublicSubjectCard,
} from './types';

export const DIGITALME_A2A_SUBJECT_EXTENSION_URI =
  'https://2digime.example/spec/a2a/subject-binding/v1' as const;
export const DIGITALME_A2A_RELAY_BINDING = '2DIGIME-RELAY' as const;
export const DIGITALME_A2A_REQUEST_KIND =
  'digitalme.a2a.subject_collaboration_request.v1' as const;
export const DIGITALME_A2A_TASK_KIND =
  'digitalme.a2a.subject_collaboration_task.v1' as const;

interface DigitalMeSubjectExtensionParams {
  subjectId: string;
  endpointRef: string;
  issuedAt: string;
  expiresAt: string;
  cooperationScope: string;
  sourceCardProtocol: '2digime-subject-collab/1';
  transportSecurity: {
    endToEndEncryption: 'X25519+AES-256-GCM';
    envelopeSignature: 'Ed25519';
    peerTrust: 'paired-endpoint-key';
  };
  authorization: {
    grantAuthority: 'AuthorizationGrant';
    personalContextContract: 'digitalme.personal_context_contract.v1';
    ownerDelegationPresentationFormat: 'application/vp+jwt';
  };
}

interface A2ARequestData {
  kind: typeof DIGITALME_A2A_REQUEST_KIND;
  exchangeId: string;
  fromSubjectId: string;
  toSubjectId: string;
  at: string;
  goal: string;
  hopedContribution: string;
  disclosure: string;
  contextContract: CollaborationRequest['contextContract'];
  threadId: string;
}

interface A2ATaskData {
  kind: typeof DIGITALME_A2A_TASK_KIND;
  exchangeId: string;
  fromSubjectId: string;
  toSubjectId: string;
  at: string;
  decision: CollaborationResponse['decision'];
  reply: string;
  contribution?: string;
  usedOwnCapability?: true;
  evidenceDigest?: string;
}

export interface A2AAgentCardVerification {
  ok: boolean;
  reasons: string[];
  card?: A2AAgentCard;
  publicCard?: PublicSubjectCard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function skillId(name: string, summary: string): string {
  return `skill_${createHash('sha256').update(`${name}\n${summary}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function defaultRelayInterfaceUrl(endpointRef: string): string {
  const endpointId = parseRemoteEndpointRef(endpointRef);
  if (!endpointId) throw new Error('A2A Agent Card endpointRef invalid');
  return `dmep://${encodeURIComponent(endpointId)}/a2a`;
}

function extensionParams(
  card: PublicSubjectCard,
  issuedAt: string,
  expiresAt: string,
): DigitalMeSubjectExtensionParams {
  return {
    subjectId: card.subjectId,
    endpointRef: card.endpointRef,
    issuedAt,
    expiresAt,
    cooperationScope: card.cooperationScope,
    sourceCardProtocol: '2digime-subject-collab/1',
    transportSecurity: {
      endToEndEncryption: 'X25519+AES-256-GCM',
      envelopeSignature: 'Ed25519',
      peerTrust: 'paired-endpoint-key',
    },
    authorization: {
      grantAuthority: 'AuthorizationGrant',
      personalContextContract: 'digitalme.personal_context_contract.v1',
      ownerDelegationPresentationFormat: 'application/vp+jwt',
    },
  };
}

export function projectPublicSubjectCardToA2A(input: {
  card: PublicSubjectCard;
  interfaceUrl?: string;
  protocolBinding?: string;
  issuedAt?: string;
  expiresAt?: string;
}): A2AAgentCard {
  const protocolBinding = input.protocolBinding || DIGITALME_A2A_RELAY_BINDING;
  const interfaceUrl = input.interfaceUrl || defaultRelayInterfaceUrl(input.card.endpointRef);
  const issuedAt = input.issuedAt || new Date().toISOString();
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) throw new Error('A2A Agent Card issuedAt invalid');
  const expiresAt = input.expiresAt || new Date(issuedMs + 24 * 60 * 60 * 1000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= issuedMs) {
    throw new Error('A2A Agent Card expiresAt must be after issuedAt');
  }
  return {
    name: input.card.displayName,
    description: input.card.cooperationScope,
    supportedInterfaces: [
      {
        url: interfaceUrl,
        protocolBinding,
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: undefined,
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: DIGITALME_A2A_SUBJECT_EXTENSION_URI,
          description:
            'Binds this A2A surface to an Owner-controlled 2digime Subject and its current paired E2EE endpoint.',
          required: true,
          params: extensionParams(input.card, issuedAt, expiresAt),
        },
      ],
    },
    // The custom Relay binding is authenticated by the required subject
    // extension plus paired envelope keys. Do not mislabel that as OAuth,
    // bearer-token, API-key, or mTLS authentication.
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: input.card.publicSkills.map((skill) => ({
      id: skillId(skill.name, skill.summary),
      name: skill.name,
      description: skill.summary,
      tags: ['subject-collaboration'],
      examples: [],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json', 'text/plain'],
      securityRequirements: [],
    })),
    signatures: [],
  };
}

export async function createSignedA2AAgentCard(input: {
  card: PublicSubjectCard;
  identity: CommIdentityStore;
  interfaceUrl?: string;
  protocolBinding?: string;
  issuedAt?: string;
  expiresAt?: string;
}): Promise<A2AAgentCard> {
  const profile = await input.identity.getLocalProfile();
  const keys = await input.identity.loadKeyMaterial();
  if (!profile || !keys) throw new Error('A2A Agent Card signing identity unavailable');
  if (input.card.subjectId !== profile.subjectId) {
    throw new Error('A2A Agent Card subject does not match signing Subject');
  }
  if (input.card.endpointRef !== remoteEndpointRef(profile.endpointId)) {
    throw new Error('A2A Agent Card endpoint does not match signing endpoint');
  }
  if (keys.keyId !== profile.keyId) throw new Error('A2A Agent Card signing key mismatch');
  const unsigned = projectPublicSubjectCardToA2A(input);
  const sign = generateAgentCardSignature(createPrivateKey(keys.signPrivatePem), {
    alg: 'EdDSA',
    kid: keys.keyId,
    typ: 'JOSE',
  });
  return sign(unsigned);
}

function parseSubjectExtension(card: A2AAgentCard): DigitalMeSubjectExtensionParams | null {
  const extension = card.capabilities?.extensions.find(
    (item) => item.uri === DIGITALME_A2A_SUBJECT_EXTENSION_URI,
  );
  if (!extension?.required || !isRecord(extension.params)) return null;
  const value = extension.params;
  if (
    typeof value.subjectId !== 'string' ||
    typeof value.endpointRef !== 'string' ||
    typeof value.issuedAt !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    typeof value.cooperationScope !== 'string' ||
    value.sourceCardProtocol !== '2digime-subject-collab/1' ||
    !isRecord(value.transportSecurity) ||
    value.transportSecurity.endToEndEncryption !== 'X25519+AES-256-GCM' ||
    value.transportSecurity.envelopeSignature !== 'Ed25519' ||
    value.transportSecurity.peerTrust !== 'paired-endpoint-key' ||
    !isRecord(value.authorization) ||
    value.authorization.grantAuthority !== 'AuthorizationGrant' ||
    value.authorization.personalContextContract !== 'digitalme.personal_context_contract.v1' ||
    value.authorization.ownerDelegationPresentationFormat !== 'application/vp+jwt'
  ) {
    return null;
  }
  return value as unknown as DigitalMeSubjectExtensionParams;
}

export function publicSubjectCardFromA2A(card: A2AAgentCard): PublicSubjectCard | null {
  const extension = parseSubjectExtension(card);
  if (!extension || !card.name.trim() || !card.skills.length) return null;
  return {
    schemaVersion: 1,
    subjectId: extension.subjectId,
    displayName: card.name.trim(),
    endpointRef: extension.endpointRef,
    publicSkills: card.skills.map((skill) => ({
      name: skill.name.trim(),
      summary: skill.description.trim(),
    })),
    cooperationScope: extension.cooperationScope,
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
}

export async function verifyA2AAgentCard(input: {
  card: unknown;
  expectedPeer: SubjectEndpointPublic | PeerEndpointRecord;
  revokedKeyIds?: readonly string[];
  expectedProtocolBinding?: string;
  now?: string;
  maxClockSkewMs?: number;
}): Promise<A2AAgentCardVerification> {
  let card: A2AAgentCard;
  try {
    card = AgentCard.fromJSON(input.card);
  } catch {
    return { ok: false, reasons: ['agent_card_shape_invalid'] };
  }
  const reasons: string[] = [];
  const subjectCard = publicSubjectCardFromA2A(card);
  if (!subjectCard) reasons.push('subject_extension_invalid');
  if (subjectCard?.subjectId !== input.expectedPeer.subjectId) reasons.push('subject_binding_mismatch');
  if (subjectCard?.endpointRef !== remoteEndpointRef(input.expectedPeer.endpointId)) {
    reasons.push('endpoint_binding_mismatch');
  }
  const supported = card.supportedInterfaces.some(
    (item) =>
      item.protocolVersion === A2A_PROTOCOL_VERSION &&
      (!input.expectedProtocolBinding || item.protocolBinding === input.expectedProtocolBinding),
  );
  if (!supported) reasons.push('protocol_interface_mismatch');
  if (!card.signatures.length) reasons.push('signature_missing');
  if ((input.revokedKeyIds || []).includes(input.expectedPeer.keyId)) reasons.push('key_revoked');
  const extension = parseSubjectExtension(card);
  if (extension) {
    const issuedMs = Date.parse(extension.issuedAt);
    const expiresMs = Date.parse(extension.expiresAt);
    const nowMs = Date.parse(input.now || new Date().toISOString());
    const skew = input.maxClockSkewMs ?? 5 * 60 * 1000;
    if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
      reasons.push('card_time_invalid');
    } else {
      if (issuedMs > nowMs + skew) reasons.push('card_not_yet_valid');
      if (expiresMs <= nowMs) reasons.push('card_expired');
    }
  }
  try {
    const verify = verifyAgentCardSignature(async (kid) => {
      if (kid !== input.expectedPeer.keyId) throw new Error('unexpected signing key');
      return createPublicKey({
        key: Buffer.from(input.expectedPeer.signPublicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
    });
    await verify(card);
  } catch {
    reasons.push('signature_invalid');
  }
  return reasons.length
    ? { ok: false, reasons }
    : { ok: true, reasons: [], card, publicCard: subjectCard! };
}

function dataPart(value: unknown): Part {
  return {
    content: { $case: 'data', value },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  };
}

function textPart(value: string): Part {
  return {
    content: { $case: 'text', value },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

export function collaborationRequestToA2AMessage(request: CollaborationRequest): A2AMessage {
  const data: A2ARequestData = {
    kind: DIGITALME_A2A_REQUEST_KIND,
    exchangeId: request.exchangeId,
    fromSubjectId: request.fromSubjectId,
    toSubjectId: request.toSubjectId,
    at: request.at,
    goal: request.goal,
    hopedContribution: request.hopedContribution,
    disclosure: request.disclosure,
    contextContract: request.contextContract,
    threadId: request.threadId,
  };
  return {
    messageId: randomUUID(),
    contextId: request.threadId,
    taskId: '',
    role: Role.ROLE_USER,
    parts: [
      textPart(`${request.goal}\n\n${request.hopedContribution}`.trim()),
      dataPart(data),
    ],
    metadata: {
      exchangeId: request.exchangeId,
      authorizationGrantId: request.contextContract?.grantId || '',
      // Tokens are deliberately not an authentication fact here. Transport
      // authentication comes from the verified Relay envelope and signed Card.
      transportBinding: DIGITALME_A2A_RELAY_BINDING,
    },
    extensions: [DIGITALME_A2A_SUBJECT_EXTENSION_URI],
    referenceTaskIds: [],
  };
}

function findData(parts: Part[], kind: string): Record<string, unknown> | null {
  for (const part of parts) {
    if (part.content?.$case !== 'data' || !isRecord(part.content.value)) continue;
    if (part.content.value.kind === kind) return part.content.value;
  }
  return null;
}

export function collaborationRequestFromA2AMessage(input: {
  message: unknown;
  expectedFromSubjectId: string;
  expectedToSubjectId: string;
}): CollaborationRequest | null {
  let message: A2AMessage;
  try {
    message = Message.fromJSON(input.message);
  } catch {
    return null;
  }
  if (
    message.role !== Role.ROLE_USER ||
    !message.extensions.includes(DIGITALME_A2A_SUBJECT_EXTENSION_URI)
  ) {
    return null;
  }
  const data = findData(message.parts, DIGITALME_A2A_REQUEST_KIND);
  if (!data) return null;
  const contract = data.contextContract;
  if (
    typeof data.exchangeId !== 'string' ||
    data.fromSubjectId !== input.expectedFromSubjectId ||
    data.toSubjectId !== input.expectedToSubjectId ||
    typeof data.at !== 'string' ||
    typeof data.goal !== 'string' ||
    typeof data.hopedContribution !== 'string' ||
    typeof data.disclosure !== 'string' ||
    !isPersonalContextContract(contract) ||
    typeof data.threadId !== 'string' ||
    data.threadId !== message.contextId
  ) {
    return null;
  }
  return {
    exchangeId: data.exchangeId,
    fromSubjectId: input.expectedFromSubjectId,
    toSubjectId: input.expectedToSubjectId,
    at: data.at,
    goal: data.goal,
    hopedContribution: data.hopedContribution,
    disclosure: data.disclosure,
    contextContract: contract,
    threadId: data.threadId,
  };
}

function responseState(decision: CollaborationResponse['decision']): TaskState {
  if (decision === 'accept') return TaskState.TASK_STATE_COMPLETED;
  if (decision === 'decline') return TaskState.TASK_STATE_REJECTED;
  return TaskState.TASK_STATE_INPUT_REQUIRED;
}

export function collaborationResponseToA2ATask(
  response: CollaborationResponse,
  contextId: string,
): A2ATask {
  const data: A2ATaskData = {
    kind: DIGITALME_A2A_TASK_KIND,
    exchangeId: response.exchangeId,
    fromSubjectId: response.fromSubjectId,
    toSubjectId: response.toSubjectId,
    at: response.at,
    decision: response.decision,
    reply: response.reply,
    ...(response.contribution ? { contribution: response.contribution } : {}),
    ...(response.usedOwnCapability ? { usedOwnCapability: true } : {}),
    ...(response.evidenceDigest ? { evidenceDigest: response.evidenceDigest } : {}),
  };
  const statusMessage: A2AMessage = {
    messageId: randomUUID(),
    contextId,
    taskId: response.exchangeId,
    role: Role.ROLE_AGENT,
    parts: [textPart(response.reply), dataPart(data)],
    metadata: undefined,
    extensions: [DIGITALME_A2A_SUBJECT_EXTENSION_URI],
    referenceTaskIds: [],
  };
  return {
    id: response.exchangeId,
    contextId,
    status: {
      state: responseState(response.decision),
      message: statusMessage,
      timestamp: response.at,
    },
    artifacts:
      response.decision === 'accept'
        ? [
            {
              artifactId: `artifact_${response.exchangeId}`,
              name: 'subject-contribution',
              description: 'Contribution returned by an independent Digital Subject.',
              parts: [textPart(response.contribution || response.reply), dataPart(data)],
              metadata: response.evidenceDigest
                ? { sha256: response.evidenceDigest }
                : undefined,
              extensions: [DIGITALME_A2A_SUBJECT_EXTENSION_URI],
            },
          ]
        : [],
    history: [],
    metadata: { kind: DIGITALME_A2A_TASK_KIND },
  };
}

export function collaborationResponseFromA2ATask(input: {
  task: unknown;
  expectedExchangeId: string;
  expectedFromSubjectId: string;
  expectedToSubjectId: string;
}): CollaborationResponse | null {
  let task: A2ATask;
  try {
    task = Task.fromJSON(input.task);
  } catch {
    return null;
  }
  if (task.id !== input.expectedExchangeId || !task.status) return null;
  const candidateParts = [
    ...(task.status.message?.parts || []),
    ...task.artifacts.flatMap((artifact) => artifact.parts || []),
  ];
  const data = findData(candidateParts, DIGITALME_A2A_TASK_KIND);
  if (!data) return null;
  const decision = data.decision;
  if (
    data.exchangeId !== input.expectedExchangeId ||
    data.fromSubjectId !== input.expectedFromSubjectId ||
    data.toSubjectId !== input.expectedToSubjectId ||
    typeof data.at !== 'string' ||
    (decision !== 'accept' &&
      decision !== 'decline' &&
      decision !== 'clarify' &&
      decision !== 'alternative') ||
    typeof data.reply !== 'string'
  ) {
    return null;
  }
  const expectedState = responseState(decision);
  if (task.status.state !== expectedState) return null;
  return {
    exchangeId: input.expectedExchangeId,
    fromSubjectId: input.expectedFromSubjectId,
    toSubjectId: input.expectedToSubjectId,
    at: data.at,
    decision,
    reply: data.reply,
    ...(typeof data.contribution === 'string' && data.contribution
      ? { contribution: data.contribution }
      : {}),
    ...(data.usedOwnCapability === true ? { usedOwnCapability: true } : {}),
    ...(typeof data.evidenceDigest === 'string' && data.evidenceDigest
      ? { evidenceDigest: data.evidenceDigest }
      : {}),
  };
}

function a2aCardPath(packageRoot: string, subjectId: string): string {
  const key = createHash('sha256').update(subjectId, 'utf8').digest('hex').slice(0, 24);
  return path.join(packageRoot, 'collaboration', 'a2a-agent-cards', `${key}.json`);
}

export async function writePeerA2AAgentCard(
  packageRoot: string,
  subjectId: string,
  card: A2AAgentCard,
): Promise<void> {
  const file = a2aCardPath(packageRoot, subjectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(AgentCard.toJSON(card), null, 2)}\n`, 'utf8');
}

export async function readPeerA2AAgentCard(
  packageRoot: string,
  subjectId: string,
): Promise<A2AAgentCard | null> {
  try {
    return AgentCard.fromJSON(JSON.parse(await fs.readFile(a2aCardPath(packageRoot, subjectId), 'utf8')));
  } catch {
    return null;
  }
}
