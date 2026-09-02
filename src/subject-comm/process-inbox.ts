/**
 * 统一处理收件箱：signal / signal_response / collaboration_sync / subject_collab。
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
  const collabInbox = await runtime.drainSubjectCollabInbox();
  const items = await transport.listInbox({ unreadOnly: true });
  let collabSynced = 0;
  for (const env of items) {
    if (env.kind === 'subject_collab') continue;
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
      continue;
    }
    await transport.acknowledge(env.envelopeId);
  }

  const host = new SignalOpportunityHost(runtime, transport);
  const signalPart = await host.processInbox();
  return { processed: signalPart.processed + collabSynced + collabInbox.processed, collabSynced };
}
