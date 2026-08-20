/**
 * 统一处理收件箱：signal / signal_response / collaboration_sync。
 * ACK = 通信层；不等于业务接受。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { SubjectTransport } from './subject-transport';
import { SignalOpportunityHost } from './signal-host';
import {
  applyCollaborationSyncLocally,
  isCollaborationSyncPayload,
} from './collaboration-sync-apply';

export async function processTransportInbox(
  runtime: DigitalMeRuntime,
  transport: SubjectTransport,
): Promise<{ processed: number; collabSynced: number }> {
  // 先处理协作同步（幂等 merge）
  const items = await transport.listInbox({ unreadOnly: true });
  let collabSynced = 0;
  for (const env of items) {
    if (env.kind !== 'collaboration_sync') continue;
    if (!isCollaborationSyncPayload(env.payload)) {
      await transport.acknowledge(env.envelopeId);
      continue;
    }
    try {
      await applyCollaborationSyncLocally(
        runtime.subject.requireActive().rootDir,
        env.payload,
      );
      collabSynced += 1;
    } catch {
      // 保留未 ACK 以便重试；不破坏包
      continue;
    }
    await transport.acknowledge(env.envelopeId);
  }

  const host = new SignalOpportunityHost(runtime, transport);
  const signalPart = await host.processInbox();
  return { processed: signalPart.processed + collabSynced, collabSynced };
}
