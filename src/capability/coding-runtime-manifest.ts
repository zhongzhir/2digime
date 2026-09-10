/**
 * Public Alpha 冻结的 Coding runtime 获取清单。
 * OpenCode 是成熟 provider candidate，不是产品架构。
 * 版本与 SHA256 随 2digime release 显式升级，不追 latest。
 */
export const OPENCODE_CANDIDATE_ID = 'opencode-windows-cli';
export const OPENCODE_PINNED_VERSION = '1.18.29';
export const OPENCODE_ASSET_NAME = 'opencode-windows-x64.zip';
/** 官方 GitHub Release asset digest（sha256: 前缀已去掉）。 */
export const OPENCODE_ASSET_SHA256 =
  'b32618aa3d1415f6e4f473aec248edef25759203fb707d7d968359d86d4a35ee';

export const OPENCODE_GITHUB_SOURCE_ID = 'github-release';
export const OPENCODE_MIRROR_SOURCE_ID = 'aliyun-oss-mirror';

export const OPENCODE_GITHUB_ASSET_URL =
  'https://github.com/anomalyco/opencode/releases/download/v1.18.29/opencode-windows-x64.zip';

/** 只读 HTTPS 镜像。Hash 才是信任根。可用环境变量覆盖以便试验。 */
export const OPENCODE_DEFAULT_MIRROR_URL =
  'https://2digime-runtime-mirror-cn.oss-cn-hangzhou.aliyuncs.com/opencode/1.18.29/opencode-windows-x64.zip';

export interface RuntimeAcquireSource {
  id: string;
  url: string;
}

export function opencodeMirrorUrl(): string {
  const override = String(process.env.DIGITALME_OPENCODE_MIRROR_URL || '').trim();
  return override || OPENCODE_DEFAULT_MIRROR_URL;
}

export function defaultOpencodeSources(): RuntimeAcquireSource[] {
  return [
    { id: OPENCODE_GITHUB_SOURCE_ID, url: OPENCODE_GITHUB_ASSET_URL },
    { id: OPENCODE_MIRROR_SOURCE_ID, url: opencodeMirrorUrl() },
  ];
}
