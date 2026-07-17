"use strict";

/**
 * Code-owned Tool Profiles (positive allowlist).
 * Executable trust is based on profile membership + PE identity fields,
 * not on the path basename alone.
 */

const {
  LOCAL_CLI_TOOL_ID,
  FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  DEFAULT_ENV_ALLOWLIST,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  TOOL_BROKER_VERSION,
} = require("./schema");
const { extractVersionStrings, normalizeIdentityToken } = require("./pe-identity");

/**
 * Shell / script-host PE identities (OriginalFilename / InternalName tokens).
 * Used only to exclude hosts from the positive passthrough profile — not as a path-basename gate.
 */
const SHELL_HOST_IDENTITY_TOKENS = new Set([
  "cmd",
  "command",
  "powershell",
  "powershell_ise",
  "pwsh",
  "wscript",
  "cscript",
  "mshta",
]);

const LOCAL_CLI_PROFILE = Object.freeze({
  profileId: "local_cli_task_passthrough_v1",
  toolId: LOCAL_CLI_TOOL_ID,
  displayName: "本地命令工具",
  definitionVersion: TOOL_BROKER_VERSION,
  argsTemplate: FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  allowedActions: Object.freeze(["execute_task"]),
  envAllowlist: DEFAULT_ENV_ALLOWLIST,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  defaultMaxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  /**
   * Positive class: generic PE task-passthrough binary.
   * Must be a PE on Windows and must NOT classify as a Windows shell/script host by VersionInfo.
   */
  identityClass: "generic_pe_task_passthrough",
});

function tokensFromIdentity(identity) {
  const out = [];
  for (const field of [identity.originalFilename, identity.internalName, identity.productName]) {
    const t = normalizeIdentityToken(field);
    if (t) out.push(t);
  }
  return out;
}

function isShellHostIdentity(identity) {
  const tokens = tokensFromIdentity(identity);
  return tokens.some((t) => SHELL_HOST_IDENTITY_TOKENS.has(t));
}

/**
 * Verify file identity against the code-owned local_cli profile.
 * @returns {{ ok: true, identity: object, profileId: string } | { ok: false, reasonCodes: string[], identity?: object }}
 */
function verifyLocalCliProfileIdentity(absolutePath) {
  const extracted = extractVersionStrings(absolutePath);
  if (process.platform === "win32") {
    if (!extracted.ok || extracted.isPe === false) {
      return {
        ok: false,
        reasonCodes: ["profile_requires_pe"],
        identity: extracted,
      };
    }
    if (isShellHostIdentity(extracted)) {
      return {
        ok: false,
        reasonCodes: ["profile_identity_mismatch", "shell_host_identity"],
        identity: extracted,
      };
    }
    // Positive membership: PE with VersionInfo that is not a shell host.
    // Missing OriginalFilename is allowed only when no shell-host token appears in any field;
    // require at least one version string to reduce anonymous PE ambiguity.
    const hasAnyLabel =
      !!(extracted.originalFilename || extracted.internalName || extracted.productName || extracted.fileDescription);
    if (!hasAnyLabel) {
      return {
        ok: false,
        reasonCodes: ["profile_identity_incomplete"],
        identity: extracted,
      };
    }
  }

  return {
    ok: true,
    profileId: LOCAL_CLI_PROFILE.profileId,
    identityClass: LOCAL_CLI_PROFILE.identityClass,
    identity: {
      originalFilename: extracted.originalFilename || "",
      internalName: extracted.internalName || "",
      productName: extracted.productName || "",
      fileDescription: extracted.fileDescription || "",
      companyName: extracted.companyName || "",
      isPe: extracted.isPe !== false,
    },
  };
}

function getLocalCliProfile() {
  return LOCAL_CLI_PROFILE;
}

module.exports = {
  LOCAL_CLI_PROFILE,
  SHELL_HOST_IDENTITY_TOKENS,
  getLocalCliProfile,
  verifyLocalCliProfileIdentity,
  isShellHostIdentity,
  tokensFromIdentity,
};
