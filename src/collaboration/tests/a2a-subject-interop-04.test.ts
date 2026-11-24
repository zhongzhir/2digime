import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  AgentCard,
  Message,
  Task,
  TaskState,
  type AgentCard as A2AAgentCard,
  type Task as A2ATask,
} from '@a2a-js/sdk';
import { ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { CommIdentityStore, createTestCommCipher } from '../../subject-comm/identity-store';
import { remoteEndpointRef, type PeerEndpointRecord } from '../../subject-comm/endpoint';
import {
  DIGITALME_A2A_RELAY_BINDING,
  DIGITALME_A2A_SUBJECT_EXTENSION_URI,
  collaborationRequestFromA2AMessage,
  collaborationRequestToA2AMessage,
  collaborationResponseFromA2ATask,
  collaborationResponseToA2ATask,
  createSignedA2AAgentCard,
  projectPublicSubjectCardToA2A,
  verifyA2AAgentCard,
} from '../../subject-collab/a2a-subject-mapping';
import type {
  CollaborationRequest,
  CollaborationResponse,
  PublicSubjectCard,
} from '../../subject-collab/types';

const AGENT_DIR = path.resolve(__dirname, '../../../reference-agents/research-a2a-agent');

function requestFixture(): CollaborationRequest {
  return {
    exchangeId: 'ex_019ab57e-8e7b-7f31-a6fb-735eaf2d2361',
    fromSubjectId: 'subj_owner_a',
    toSubjectId: 'subj_owner_b',
    at: '2026-11-23T08:00:00.000Z',
    goal: '核对一份机构材料的风险边界',
    hopedContribution: '请给出三条风险提示。',
    disclosure: '[本次任务；本次提供] 只核对公开机构材料',
    contextContract: {
      schemaVersion: 1,
      kind: 'digitalme.personal_context_contract.v1',
      id: 'pcc_slice4_interop',
      taskRef: 'ex_019ab57e-8e7b-7f31-a6fb-735eaf2d2361',
      issuerSubjectId: 'subj_owner_a',
      recipient: {
        subjectId: 'subj_owner_b',
        endpointRef: 'dmep:ep_owner_b',
      },
      purpose: '核对一份机构材料的风险边界',
      fields: [
        {
          ref: 'collaboration:task-context:ex_019ab57e-8e7b-7f31-a6fb-735eaf2d2361',
          value: '只核对公开机构材料',
          sourceSummary: 'current_task',
          assurance: 'task_supplied',
        },
      ],
      issuedAt: '2026-11-23T08:00:00.000Z',
      expiresAt: '2026-11-23T08:15:00.000Z',
      grantId: 'grant_ctx_slice4_interop',
      revocableRef: 'authorization-grant:grant_ctx_slice4_interop',
      contentDigest: 'a'.repeat(64),
    },
    threadId: 'thread_slice4_interop',
  };
}

async function cardFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-a2a-subject-card-'));
  const identity = new CommIdentityStore(root, createTestCommCipher());
  const { profile } = await identity.ensureLocalEndpoint({
    subjectId: 'subj_owner_b',
    displayName: 'Owner B 的兔机米',
    relayUrl: 'https://relay.example.test',
    endpointId: 'ep_owner_b',
  });
  const publicCard: PublicSubjectCard = {
    schemaVersion: 1,
    subjectId: profile.subjectId,
    displayName: profile.displayName,
    endpointRef: remoteEndpointRef(profile.endpointId),
    publicSkills: [{ name: '机构材料核对', summary: '在明确授权范围内核对机构材料。' }],
    cooperationScope: '低风险、最小披露的材料核对。',
    protocol: '2digime-subject-collab/1',
    reachable: true,
  };
  const expectedPeer: PeerEndpointRecord = {
    ...profile,
    pairedAt: '2026-11-23T07:00:00.000Z',
  };
  return { identity, publicCard, expectedPeer };
}

async function startIndependentAgent(): Promise<{
  baseUrl: string;
  child: ChildProcess;
  stop(): Promise<void>;
}> {
  const port = 44111 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(AGENT_DIR, 'server.cjs')], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      RESEARCH_A2A_HOST: '127.0.0.1',
      RESEARCH_A2A_PORT: String(port),
      RESEARCH_A2A_CONTROL_PORT: String(port + 1),
      RESEARCH_A2A_DELAY_MS: '10',
      // The interoperability gate is protocol-only and must not spend money.
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout?.on('data', (chunk) => { childOutput += String(chunk); });
  child.stderr?.on('data', (chunk) => { childOutput += String(chunk); });
  const control = `http://127.0.0.1:${port + 1}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${control}/health`);
      if (response.ok) {
        return {
          baseUrl: `http://127.0.0.1:${port}`,
          child,
          async stop() {
            try {
              await fetch(`${control}/shutdown`, { method: 'POST' });
            } catch {
              child.kill();
            }
          },
        };
      }
    } catch {
      // Independent process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  child.kill();
  throw new Error(`independent A2A agent did not start: ${childOutput.slice(-2000)}`);
}

test('Slice 4: standard signed Agent Card binds Subject, endpoint, skills and Relay security facts', async () => {
  const { identity, publicCard, expectedPeer } = await cardFixture();
  const card = await createSignedA2AAgentCard({ card: publicCard, identity });
  assert.equal(card.supportedInterfaces[0]?.protocolBinding, DIGITALME_A2A_RELAY_BINDING);
  assert.equal(card.supportedInterfaces[0]?.protocolVersion, '1.0');
  assert.equal(card.securitySchemes && Object.keys(card.securitySchemes).length, 0);
  assert.equal(card.securityRequirements.length, 0);
  assert.equal(
    card.capabilities?.extensions.some(
      (item) => item.uri === DIGITALME_A2A_SUBJECT_EXTENSION_URI && item.required,
    ),
    true,
  );

  const verified = await verifyA2AAgentCard({
    card: AgentCard.toJSON(card),
    expectedPeer,
    expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.publicCard, publicCard);

  const tampered = AgentCard.fromJSON(AgentCard.toJSON(card));
  tampered.description = '可读取完整 Digital Self';
  const rejected = await verifyA2AAgentCard({
    card: AgentCard.toJSON(tampered),
    expectedPeer,
    expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.reasons.includes('signature_invalid'));

  const revoked = await verifyA2AAgentCard({
    card: AgentCard.toJSON(card),
    expectedPeer,
    revokedKeyIds: [expectedPeer.keyId],
    expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
  });
  assert.ok(revoked.reasons.includes('key_revoked'));

  const expiredCard = await createSignedA2AAgentCard({
    card: publicCard,
    identity,
    issuedAt: '2026-11-21T08:00:00.000Z',
    expiresAt: '2026-11-22T08:00:00.000Z',
  });
  const expired = await verifyA2AAgentCard({
    card: AgentCard.toJSON(expiredCard),
    expectedPeer,
    expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
    now: '2026-11-23T08:00:00.000Z',
  });
  assert.ok(expired.reasons.includes('card_expired'));
});

test('Slice 4: Message/Task/Artifact are lossless wire projections, not a new product state machine', async () => {
  const request = requestFixture();
  const message = collaborationRequestToA2AMessage(request);
  const decoded = await collaborationRequestFromA2AMessage({
    message: Message.toJSON(message),
    expectedFromSubjectId: request.fromSubjectId,
    expectedToSubjectId: request.toSubjectId,
  });
  assert.deepEqual(decoded, request);

  const tokenOnly = Message.toJSON(message) as Record<string, unknown>;
  tokenOnly.extensions = [];
  tokenOnly.parts = [];
  tokenOnly.metadata = { bearerToken: 'not-a-trust-root' };
  assert.equal(
    await collaborationRequestFromA2AMessage({
      message: tokenOnly,
      expectedFromSubjectId: request.fromSubjectId,
      expectedToSubjectId: request.toSubjectId,
    }),
    null,
  );

  const response: CollaborationResponse = {
    exchangeId: request.exchangeId,
    fromSubjectId: request.toSubjectId,
    toSubjectId: request.fromSubjectId,
    at: '2026-11-23T08:00:05.000Z',
    decision: 'accept',
    reply: '可以合作。',
    contribution: '风险一：权限范围；风险二：撤销；风险三：审计。',
    usedOwnCapability: true,
    evidenceDigest: 'b'.repeat(32),
  };
  const task = collaborationResponseToA2ATask(response, request.threadId);
  assert.equal(task.status?.state, TaskState.TASK_STATE_COMPLETED);
  assert.equal(task.artifacts.length, 1);
  assert.deepEqual(
    await collaborationResponseFromA2ATask({
      task: Task.toJSON(task),
      expectedExchangeId: request.exchangeId,
      expectedFromSubjectId: request.toSubjectId,
      expectedToSubjectId: request.fromSubjectId,
    }),
    response,
  );

  task.status!.state = TaskState.TASK_STATE_FAILED;
  assert.equal(
    await collaborationResponseFromA2ATask({
      task,
      expectedExchangeId: request.exchangeId,
      expectedFromSubjectId: request.toSubjectId,
      expectedToSubjectId: request.fromSubjectId,
    }),
    null,
  );
});

test('Slice 4: independent official A2A server accepts the Message and returns a Task with Artifact', async () => {
  const agent = await startIndependentAgent();
  try {
    const cardResponse = await fetch(`${agent.baseUrl}/.well-known/agent-card.json`);
    assert.equal(cardResponse.ok, true);
    const independentCard = AgentCard.fromJSON(await cardResponse.json()) as A2AAgentCard;
    const factory = new ClientFactory({ transports: [new JsonRpcTransportFactory()] });
    const client = await factory.createFromAgentCard(independentCard);
    const portableMessage = collaborationRequestToA2AMessage(requestFixture());
    // The independent service is an Agent, not an Owner-controlled Subject;
    // base A2A interoperability therefore omits the required 2digime Subject
    // extension and does not upgrade the Agent into a trusted Subject.
    portableMessage.extensions = [];
    portableMessage.metadata = {
      ...(portableMessage.metadata || {}),
      fault: 'protocol_only_offline_probe',
    };
    const result = await client.sendMessage({
      tenant: '',
      message: portableMessage,
      configuration: {
        acceptedOutputModes: ['text/plain', 'text/markdown'],
        taskPushNotificationConfig: undefined,
        returnImmediately: false,
      },
      metadata: undefined,
    });
    assert.ok('status' in result, 'independent implementation must return an A2A Task');
    const task = result as A2ATask;
    assert.ok(
      task.status?.state === TaskState.TASK_STATE_COMPLETED ||
        task.status?.state === TaskState.TASK_STATE_FAILED,
      JSON.stringify(Task.toJSON(task)),
    );
    assert.ok(task.artifacts.length >= 1, 'independent implementation must return an Artifact');
    assert.ok(
      task.artifacts.some((artifact) => artifact.parts.some((part) => part.content?.$case === 'text')),
      'Artifact must contain consumable text',
    );
  } finally {
    await agent.stop();
  }
});

test('Slice 4: a bearer-only card cannot replace the required signed Subject binding', async () => {
  const { publicCard, expectedPeer } = await cardFixture();
  const bearerOnly = projectPublicSubjectCardToA2A({ card: publicCard });
  bearerOnly.capabilities!.extensions = [];
  bearerOnly.securitySchemes = {
    bearer: {
      scheme: {
        $case: 'httpAuthSecurityScheme',
        value: {
          description: 'A token alone is not Subject identity.',
          scheme: 'Bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };
  bearerOnly.securityRequirements = [{ schemes: { bearer: { list: [] } } }];
  const result = await verifyA2AAgentCard({
    card: AgentCard.toJSON(bearerOnly),
    expectedPeer,
    expectedProtocolBinding: DIGITALME_A2A_RELAY_BINDING,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('subject_extension_invalid'));
  assert.ok(result.reasons.includes('signature_missing'));
});
