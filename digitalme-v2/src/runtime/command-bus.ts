import type { CommandBus, CommandMap, CommandName } from './commands';
import { COMMAND_NAMES } from './commands';
import type { DigitalMeRuntime } from './digitalme-runtime';

/**
 * 将 DigitalMeRuntime 适配为 CommandBus。
 * Electron main 只经此调用领域层,不直接散落业务分支。
 */
export function createCommandBus(runtime: DigitalMeRuntime): CommandBus {
  return {
    async invoke<K extends CommandName>(
      name: K,
      input: CommandMap[K]['input'],
    ): Promise<CommandMap[K]['output']> {
      if (!(COMMAND_NAMES as readonly string[]).includes(name)) {
        throw new Error(`unknown command: ${String(name)}`);
      }
      switch (name) {
        case 'subject.createPackage':
          return (await runtime.createPackage(
            input as CommandMap['subject.createPackage']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.openPackage':
          return (await runtime.openPackage(
            input as CommandMap['subject.openPackage']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.getOverview':
          return (await runtime.getOverview(
            (input as CommandMap['subject.getOverview']['input']) || {},
          )) as CommandMap[K]['output'];
        case 'subject.confirmExperience':
          return (await runtime.confirmExperience(
            input as CommandMap['subject.confirmExperience']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.respondToLearning':
          return (await runtime.respondToLearning(
            input as CommandMap['subject.respondToLearning']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.captureInput':
          return (await runtime.captureSubjectInput(
            input as CommandMap['subject.captureInput']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.importMaterial':
          return (await runtime.importSubjectMaterial(
            input as CommandMap['subject.importMaterial']['input'],
          )) as CommandMap[K]['output'];
        case 'subject.removeMaterial':
          return (await runtime.removeSubjectMaterial(
            input as CommandMap['subject.removeMaterial']['input'],
          )) as CommandMap[K]['output'];
        case 'work.submitTask':
          return (await runtime.submitTask(
            input as CommandMap['work.submitTask']['input'],
          )) as CommandMap[K]['output'];
        case 'work.retryTask':
          return (await runtime.retryTask(
            input as CommandMap['work.retryTask']['input'],
          )) as CommandMap[K]['output'];
        case 'work.reviseArtifact':
          return (await runtime.reviseArtifact(
            input as CommandMap['work.reviseArtifact']['input'],
          )) as CommandMap[K]['output'];
        case 'work.cancelJob':
          return (await runtime.cancelJob(
            input as CommandMap['work.cancelJob']['input'],
          )) as CommandMap[K]['output'];
        case 'work.getTask':
          return (await runtime.getTask(
            input as CommandMap['work.getTask']['input'],
          )) as CommandMap[K]['output'];
        case 'work.listTasks':
          return (await runtime.listTasks(
            (input as CommandMap['work.listTasks']['input']) || {},
          )) as CommandMap[K]['output'];
        case 'artifact.getContent': {
          const req = input as CommandMap['artifact.getContent']['input'];
          const got = await runtime.getContent(req);
          const headVersionId = got.artifact.headVersionId;
          let ownerDecision: CommandMap['artifact.getContent']['output']['ownerDecision'];
          try {
            const decision = await runtime.getArtifactOwnerDecision(
              req.artifactId,
              headVersionId,
            );
            ownerDecision = {
              status: decision.status,
              artifactVersionId: decision.artifactVersionId,
              ...(decision.decidedAt ? { decidedAt: decision.decidedAt } : {}),
            };
          } catch {
            ownerDecision = {
              status: 'undecided',
              artifactVersionId: headVersionId,
            };
          }
          return {
            content: got.content,
            ...(got.text !== undefined ? { text: got.text } : {}),
            headVersionId,
            versionCount: got.artifact.versions.length,
            ownerDecision,
            ...(got.bundle !== undefined ? { bundle: got.bundle } : {}),
            ...(got.evidenceStale ? { evidenceStale: true } : {}),
          } as CommandMap[K]['output'];
        }
        case 'artifact.saveEdit':
          return (await runtime.saveEdit(
            input as CommandMap['artifact.saveEdit']['input'],
          )) as CommandMap[K]['output'];
        case 'artifact.export':
          return (await runtime.exportArtifact(
            input as CommandMap['artifact.export']['input'],
          )) as CommandMap[K]['output'];
        case 'artifact.revealInFolder':
          return (await runtime.revealInFolder(
            input as CommandMap['artifact.revealInFolder']['input'],
          )) as CommandMap[K]['output'];
        case 'capability.list':
          return (await runtime.listCapabilities(
            (input || {}) as CommandMap['capability.list']['input'],
          )) as CommandMap[K]['output'];
        case 'collab.interact':
          return (await runtime.interactCollab(
            input as CommandMap['collab.interact']['input'],
          )) as CommandMap[K]['output'];
        default: {
          const _exhaustive: never = name;
          throw new Error(`unhandled command: ${String(_exhaustive)}`);
        }
      }
    },
  };
}
