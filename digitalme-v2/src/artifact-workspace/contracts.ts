import type { Artifact, ArtifactContent, ArtifactVersion } from '../work-runtime/artifact';

/**
 * Artifact Workspace 契约 — Artifact 是一等对象,不是模型回复附件。
 * 页面直接查看/编辑/复制/导出/打开目录/版本记录/任务关联。
 */
export type ExportFormat = 'docx' | 'md';

export interface ArtifactWorkspacePort {
  getContent(
    artifactId: string,
    versionId?: string,
  ): Promise<{ artifact: Artifact; content: ArtifactContent; text?: string }>;
  /** 自动保存;追加 user 版本并移动 head。不要求"采用结果"。P1 仅 text 类内容可编辑。 */
  saveEdit(artifactId: string, text: string): Promise<{ version: ArtifactVersion }>;
  export(artifactId: string, format: ExportFormat, targetPath?: string): Promise<{ path: string }>;
  revealInFolder(artifactId: string): Promise<void>;
}
