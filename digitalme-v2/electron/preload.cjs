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
  "subject.importMaterial",
  "work.submitTask",
  "work.retryTask",
  "work.reviseArtifact",
  "work.cancelJob",
  "work.getTask",
  "work.listTasks",
  "artifact.getContent",
  "artifact.saveEdit",
  "artifact.export",
  "artifact.revealInFolder",
  "capability.list",
  "collab.simulateInteraction",
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
  getModelStatus: () => ipcRenderer.invoke("shell:getModelStatus"),
  saveModelCredential: (input) => ipcRenderer.invoke("shell:saveModelCredential", input),
  testModelConnection: (input) => ipcRenderer.invoke("shell:testModelConnection", input),
  deleteModelCredential: (input) => ipcRenderer.invoke("shell:deleteModelCredential", input),
});
