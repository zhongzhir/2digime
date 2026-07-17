"use strict";

/**
 * Code-owned Tool Profiles with explicit identity contracts.
 * Trust is positive allowlist only — never "any PE except a few shell tokens".
 */

const {
  LOCAL_CLI_TOOL_ID,
  FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  DEFAULT_ENV_ALLOWLIST,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  TOOL_BROKER_VERSION,
} = require("./schema");
const { extractVersionStrings } = require("./pe-identity");
const { verifyAuthenticode } = require("./authenticode");

/**
 * v1 local_cli only admits the Node.js runtime identity contract.
 * pinnedIdentity is a cache of a successful contract match — not a self-attested trust root.
 */
const LOCAL_CLI_NODEJS_PROFILE = Object.freeze({
  profileId: "local_cli_nodejs_v1",
  toolId: LOCAL_CLI_TOOL_ID,
  displayName: "本地命令工具（Node.js）",
  definitionVersion: TOOL_BROKER_VERSION,
  argsTemplate: FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  allowedActions: Object.freeze(["execute_task"]),
  envAllowlist: DEFAULT_ENV_ALLOWLIST,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  defaultMaxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  identityContract: Object.freeze({
    contractId: "nodejs_openjs_v1",
    // ProductName is intentionally not required: some Node.js Windows builds emit a truncated
    // ProductName (e.g. "rocess_title"). FileDescription carries the product identity signal.
    originalFilename: Object.freeze(["node.exe"]),
    internalName: Object.freeze(["node"]),
    companyName: Object.freeze(["Node.js"]),
    fileDescriptionIncludes: Object.freeze(["Node.js"]),
    authenticode: Object.freeze({
      requiredOnWin32: true,
      allowedStatuses: Object.freeze(["Valid"]),
      subjectIncludesAny: Object.freeze(["OpenJS Foundation", "CN=OpenJS Foundation"]),
    }),
  }),
});

const ALLOWED_LOCAL_CLI_PROFILES = Object.freeze([LOCAL_CLI_NODEJS_PROFILE]);
const ALLOWED_PROFILE_IDS = Object.freeze(
  new Set(ALLOWED_LOCAL_CLI_PROFILES.map((p) => p.profileId))
);

function eqIgnoreCase(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function includesIgnoreCase(haystack, needle) {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

function fieldMatchesAny(actual, allowedList) {
  return allowedList.some((item) => eqIgnoreCase(actual, item));
}

function subjectMatches(subject, patterns) {
  return patterns.some((p) => includesIgnoreCase(subject, p));
}

function matchIdentityContract(identity, authenticode, contract) {
  const reasonCodes = [];
  if (!fieldMatchesAny(identity.originalFilename, contract.originalFilename)) {
    reasonCodes.push("profile_identity_mismatch", "identity_original_filename");
  }
  if (!fieldMatchesAny(identity.internalName, contract.internalName)) {
    reasonCodes.push("profile_identity_mismatch", "identity_internal_name");
  }
  if (!fieldMatchesAny(identity.companyName, contract.companyName)) {
    reasonCodes.push("profile_identity_mismatch", "identity_company_name");
  }
  const descOk = (contract.fileDescriptionIncludes || []).some((part) =>
    includesIgnoreCase(identity.fileDescription, part)
  );
  if ((contract.fileDescriptionIncludes || []).length && !descOk) {
    reasonCodes.push("profile_identity_mismatch", "identity_file_description");
  }

  if (process.platform === "win32" && contract.authenticode && contract.authenticode.requiredOnWin32) {
    if (!authenticode || authenticode.ok === false) {
      reasonCodes.push(
        "profile_identity_mismatch",
        "authenticode_required",
        ...((authenticode && authenticode.reasonCodes) || ["authenticode_probe_failed"])
      );
    } else {
      const statusOk = (contract.authenticode.allowedStatuses || []).some((s) =>
        eqIgnoreCase(authenticode.status, s)
      );
      if (!statusOk) {
        reasonCodes.push("profile_identity_mismatch", "authenticode_status");
      }
      if (!subjectMatches(authenticode.subject, contract.authenticode.subjectIncludesAny || [])) {
        reasonCodes.push("profile_identity_mismatch", "authenticode_subject");
      }
    }
  }

  return [...new Set(reasonCodes)];
}

/**
 * Verify file identity against code-owned local_cli profiles.
 * First-time configuration and preparePlan both use this gate — pinnedIdentity cannot invent trust.
 * @returns {{ ok: true, identity: object, profileId: string, contractId: string, authenticode?: object } | { ok: false, reasonCodes: string[], identity?: object }}
 */
function verifyLocalCliProfileIdentity(absolutePath, options = {}) {
  const extracted = extractVersionStrings(absolutePath);

  if (process.platform === "win32") {
    if (!extracted.ok || extracted.isPe === false) {
      return {
        ok: false,
        reasonCodes: ["profile_requires_pe", "profile_identity_mismatch"],
        identity: extracted,
      };
    }

    const cacheKey =
      options.cacheKey ||
      `${absolutePath}|${options.size || 0}|${options.mtimeMs || 0}|${options.sha256 || ""}`;
    const authenticode = verifyAuthenticode(absolutePath, cacheKey);
    const identity = {
      originalFilename: extracted.originalFilename || "",
      internalName: extracted.internalName || "",
      productName: extracted.productName || "",
      fileDescription: extracted.fileDescription || "",
      companyName: extracted.companyName || "",
      isPe: true,
    };

    for (const profile of ALLOWED_LOCAL_CLI_PROFILES) {
      const reasons = matchIdentityContract(identity, authenticode, profile.identityContract);
      if (!reasons.length) {
        return {
          ok: true,
          profileId: profile.profileId,
          contractId: profile.identityContract.contractId,
          identity,
          authenticode: {
            status: authenticode.status || "",
            subject: authenticode.subject || "",
          },
        };
      }
    }

    return {
      ok: false,
      reasonCodes: ["profile_identity_mismatch"],
      identity,
      authenticode: authenticode.ok
        ? { status: authenticode.status, subject: authenticode.subject }
        : undefined,
    };
  }

  // Non-Windows: PE/Authenticode contracts do not apply; admit Node by basename only for dev hosts.
  const base = String(absolutePath || "")
    .split(/[/\\]/)
    .pop()
    .toLowerCase();
  if (base === "node" || base === "node.exe") {
    return {
      ok: true,
      profileId: LOCAL_CLI_NODEJS_PROFILE.profileId,
      contractId: LOCAL_CLI_NODEJS_PROFILE.identityContract.contractId,
      identity: {
        originalFilename: base,
        internalName: "node",
        productName: "",
        fileDescription: "",
        companyName: "",
        isPe: false,
      },
    };
  }
  return { ok: false, reasonCodes: ["profile_identity_mismatch"] };
}

function getLocalCliProfile() {
  return LOCAL_CLI_NODEJS_PROFILE;
}

function isAllowedLocalCliProfileId(profileId) {
  return ALLOWED_PROFILE_IDS.has(String(profileId || "").trim());
}

/**
 * pinnedIdentity is only valid when it reflects a code-owned profileId and field snapshot.
 */
function pinnedIdentityMatches(pinned, liveIdentity, profileId) {
  if (!pinned || typeof pinned !== "object") return false;
  if (!isAllowedLocalCliProfileId(pinned.profileId)) return false;
  if (String(pinned.profileId) !== String(profileId)) return false;
  if (!eqIgnoreCase(pinned.originalFilename, liveIdentity.originalFilename)) return false;
  if (!eqIgnoreCase(pinned.internalName, liveIdentity.internalName)) return false;
  if (!eqIgnoreCase(pinned.companyName, liveIdentity.companyName)) return false;
  return true;
}

function buildPinnedIdentity(profileCheck) {
  return {
    profileId: profileCheck.profileId,
    contractId: profileCheck.contractId,
    originalFilename: profileCheck.identity.originalFilename,
    internalName: profileCheck.identity.internalName,
    companyName: profileCheck.identity.companyName,
    fileDescription: profileCheck.identity.fileDescription,
    productName: profileCheck.identity.productName,
    signerSubject: (profileCheck.authenticode && profileCheck.authenticode.subject) || "",
  };
}

module.exports = {
  LOCAL_CLI_NODEJS_PROFILE,
  LOCAL_CLI_PROFILE: LOCAL_CLI_NODEJS_PROFILE,
  ALLOWED_LOCAL_CLI_PROFILES,
  ALLOWED_PROFILE_IDS,
  getLocalCliProfile,
  isAllowedLocalCliProfileId,
  verifyLocalCliProfileIdentity,
  pinnedIdentityMatches,
  buildPinnedIdentity,
};
