"use strict";
/**
 * preload — 暴露领域命令 + 领域事件订阅。
 * 文件对话框属于 App Shell 辅助面(非领域命令),单独挂在 dialogs 下。
 */
const { contextBridge, ipcRenderer } = require("electron");

const COMMAND_NAMES = [
  "subject.createPackage",
  "subject.openPackage",
  "subject.getOverview",
  "subject.confirmExperience",
  "subject.respondToLearning",
  "subject.captureInput",
  "subject.importMaterial",
  "subject.removeMaterial",
  "work.submitTask",
  "work.retryTask",
  "work.reviseArtifact",
  "work.cancelJob",
  "work.getTask",
  "work.listTasks",
  "work.converse",
  "artifact.getContent",
  "artifact.saveEdit",
  "artifact.export",
  "artifact.revealInFolder",
  "capability.list",
  "collab.interact",
  "subject.communicate",
];

contextBridge.exposeInMainWorld("digitalMe", {
  commands: COMMAND_NAMES.slice(),
  invoke(name, input) {
    if (!COMMAND_NAMES.includes(name)) {
      return Promise.reject(new Error(`command not exposed: ${name}`));
    }
    return ipcRenderer.invoke("command:invoke", name, input ?? {});
  },
  onEvent(listener) {
    const handler = (_evt, event) => {
      try {
        listener(event);
      } catch {
        /* renderer listener faults must not break bridge */
      }
    };
    ipcRenderer.on("domain:event", handler);
    return () => ipcRenderer.removeListener("domain:event", handler);
  },
  onBoot(listener) {
    const handler = (_evt, info) => listener(info);
    ipcRenderer.on("shell:boot", handler);
    return () => ipcRenderer.removeListener("shell:boot", handler);
  },
  dialogs: {
    pickOpenFiles: () => ipcRenderer.invoke("shell:pickOpenFiles"),
    pickOpenDirectory: () => ipcRenderer.invoke("shell:pickOpenDirectory"),
    pickSaveDirectory: () => ipcRenderer.invoke("shell:pickSaveDirectory"),
  },
  inspectSoftwareProject: (folderPath) =>
    ipcRenderer.invoke("shell:inspectSoftwareProject", { path: folderPath }),
  prepareSoftwareProject: (input) =>
    ipcRenderer.invoke("shell:prepareSoftwareProject", input || {}),
  detectProjectRun: (input) => ipcRenderer.invoke("shell:detectProjectRun", input || {}),
  tryRunProject: (input) => ipcRenderer.invoke("shell:tryRunProject", input || {}),
  saveRevisionImage: (input) => ipcRenderer.invoke("shell:saveRevisionImage", input || {}),
  getDefaultSubjectDir: () => ipcRenderer.invoke("shell:getDefaultSubjectDir"),
  getModelStatus: () => ipcRenderer.invoke("shell:getModelStatus"),
  saveModelCredential: (input) => ipcRenderer.invoke("shell:saveModelCredential", input),
  testModelConnection: (input) => ipcRenderer.invoke("shell:testModelConnection", input),
  deleteModelCredential: (input) => ipcRenderer.invoke("shell:deleteModelCredential", input),
  getRemoteCapabilityStatus: () => ipcRenderer.invoke("shell:getRemoteCapabilityStatus"),
  testRemoteCapability: (input) => ipcRenderer.invoke("shell:testRemoteCapability", input),
  saveRemoteCapability: (input) => ipcRenderer.invoke("shell:saveRemoteCapability", input),
  disableRemoteCapability: () => ipcRenderer.invoke("shell:disableRemoteCapability"),
  revealPath: (targetPath) => ipcRenderer.invoke("shell:revealPath", targetPath),
  conversation: {
    list: () => ipcRenderer.invoke("shell:conversationList"),
    append: (input) => ipcRenderer.invoke("shell:conversationAppend", input),
    clear: () => ipcRenderer.invoke("shell:conversationClear"),
    reply: (input) => ipcRenderer.invoke("shell:conversationReply", input),
    growthHint: (input) => ipcRenderer.invoke("shell:conversationGrowthHint", input),
  },
  onOpenHelp(listener) {
    const handler = (_evt, info) => listener(info);
    ipcRenderer.on("shell:open-help", handler);
    return () => ipcRenderer.removeListener("shell:open-help", handler);
  },
});
