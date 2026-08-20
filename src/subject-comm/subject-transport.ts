/**
 * SubjectTransport — 仅负责把主体消息可靠交给对方。
 * 不含协作决策、匹配、Growth、Task、Artifact 业务规则。
 */
import type { SubjectRef } from '../collaboration/schema';
import type { SubjectEnvelope } from './envelope';

export interface SubjectTransportHealth {
  mode: 'local_trusted' | 'remote';
  reachable: boolean;
  capabilities: string[];
}

export interface SubjectTransport {
  send(envelope: SubjectEnvelope): Promise<{ delivered: boolean; duplicate?: boolean }>;
  listInbox(opts?: { unreadOnly?: boolean }): Promise<SubjectEnvelope[]>;
  /** 传输层 ACK；不等于业务接受 / 继续了解 */
  acknowledge(envelopeId: string): Promise<{ ok: boolean }>;
  health(): Promise<SubjectTransportHealth>;
  resolvePeer(packageDir: string): Promise<SubjectRef & { brief?: string; packageDir: string }>;
  registerEndpoint(ref: SubjectRef, packageDir: string): Promise<void>;
  lookupPackageDir(endpointRef: string): Promise<string | null>;
  openByEndpointRef(endpointRef: string): Promise<{
    runtime: import('../runtime/digitalme-runtime').DigitalMeRuntime;
    subjectRef: SubjectRef;
    stop: () => Promise<void>;
  }>;
}
