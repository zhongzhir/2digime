"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  presentCredential,
  revokeCredential,
  verifyCredentialStatus,
  listCredentials,
  loadCredentialStore,
} = require("../src/identity/credential-flow");
const { verifyCredential } = require("../src/identity/vc");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-cred-flow-"));
const storePath = path.join(tmpDir, "credentials.json");

const pkg = {
  persona: "注重长期价值的产品创始人。",
  lifeSummary: "十年创业经历，两次融资。",
  decisionFrameworks: '{"frameworks":[]}',
  styleGuide: "简洁直接。",
};

// Test 1: present fails without audience
const noAudience = presentCredential(tmpDir, pkg, {});
assert(noAudience.ok === false && /出示对象/.test(noAudience.message), "present fails without audience");

// Test 2: present fails with empty package data
const emptyPkg = presentCredential(tmpDir, { persona: "", lifeSummary: "" }, { audience: "partner" });
assert(emptyPkg.ok === false && /没有足够的信息/.test(emptyPkg.message), "present fails with empty package data");

// Test 3: credential generation and presentation (full scope)
const presented = presentCredential(tmpDir, pkg, { audience: "拟合作的技术团队", validDays: 30, scope: "full" });
assert(presented.ok === true && presented.credential, "present succeeds");
const cred = presented.credential;
assert(typeof cred.id === "string" && cred.id.startsWith("cred_"), "credential id generated");
assert(cred.audience === "拟合作的技术团队", "audience recorded");
assert(cred.scope === "full", "scope recorded");
assert(cred.revoked === false && cred.revokedAt === null, "fresh credential not revoked");
assert(cred.presentedAt && !Number.isNaN(new Date(cred.presentedAt).getTime()), "presentedAt is valid ISO date");
assert(cred.validUntil && new Date(cred.validUntil) > new Date(), "validUntil is in the future");
assert(cred.vc && cred.vc.proof && cred.vc.credentialSubject, "credential carries signed VC");
assert(cred.vc.audience === "拟合作的技术团队", "VC audience set");
assert(
  Array.isArray(cred.vc.credentialSubject.claims) && cred.vc.credentialSubject.claims.length === 4,
  "full scope collects all 4 claim categories"
);
assert(verifyCredential(tmpDir, cred.vc).valid === true, "presented VC signature verifies");

// Test 4: persistence — credentials.json written and reloadable
assert(fs.existsSync(storePath), "credentials.json persisted");
const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8"));
assert(Array.isArray(onDisk.credentials) && onDisk.credentials.length === 1, "store contains 1 credential");
assert(onDisk.credentials[0].id === cred.id, "persisted credential id matches");
assert(Array.isArray(onDisk.auditLog) && typeof onDisk.updatedAt === "string", "store has auditLog and updatedAt");
const reloaded = loadCredentialStore(tmpDir);
assert(reloaded.credentials.length === 1 && reloaded.credentials[0].vc.proof, "store reloads from disk");

// Test 5: scoped presentation — identity scope only includes identity claims
const scoped = presentCredential(tmpDir, pkg, { audience: "招聘方", scope: "identity" });
assert(scoped.ok === true, "scoped present succeeds");
const scopeClaims = scoped.credential.vc.credentialSubject.claims;
assert(
  scopeClaims.length === 1 && scopeClaims[0].category === "identity",
  "identity scope only includes identity claims"
);
assert(scoped.credential.vc.credentialSubject.scope === "identity", "scope recorded in credential subject");

// Test 6: list credentials
const listed = listCredentials(tmpDir);
assert(listed.ok === true && listed.credentials.length === 2, "list returns all credentials");
assert(Array.isArray(listed.auditLog), "list includes audit log");

// Test 7: verify status — fresh credential is valid
const statusValid = verifyCredentialStatus(tmpDir, cred.id);
assert(statusValid.ok === true && statusValid.valid === true, "fresh credential is valid");

// Test 8: verify status — unknown id rejected
const statusMissing = verifyCredentialStatus(tmpDir, "cred_nonexistent");
assert(
  statusMissing.ok === false && statusMissing.valid === false && statusMissing.reason === "not_found",
  "unknown credential id rejected"
);

// Test 9: revoke — then verification fails with reason revoked
const revoked = revokeCredential(tmpDir, cred.id);
assert(revoked.ok === true, "revoke succeeds");
const afterRevoke = verifyCredentialStatus(tmpDir, cred.id);
assert(afterRevoke.valid === false && afterRevoke.reason === "revoked", "revoked credential fails verification");
const revokedRecord = listCredentials(tmpDir).credentials.find((c) => c.id === cred.id);
assert(revokedRecord.revoked === true && !!revokedRecord.revokedAt, "revocation persisted with timestamp");
const revokedOnDisk = JSON.parse(fs.readFileSync(storePath, "utf8")).credentials.find((c) => c.id === cred.id);
assert(revokedOnDisk.revoked === true, "revocation persisted to disk");

// Test 10: double revoke rejected
const doubleRevoke = revokeCredential(tmpDir, cred.id);
assert(doubleRevoke.ok === false && /已撤销/.test(doubleRevoke.message), "double revoke rejected");

// Test 11: revoke unknown id rejected
const revokeMissing = revokeCredential(tmpDir, "cred_nonexistent");
assert(revokeMissing.ok === false && /不存在/.test(revokeMissing.message), "revoke unknown id rejected");

// Test 12: expired credential fails verification
const expiring = presentCredential(tmpDir, pkg, { audience: "临时方", validDays: 1 });
assert(expiring.ok === true, "short-lived present succeeds");
const storeToExpire = loadCredentialStore(tmpDir);
const expRec = storeToExpire.credentials.find((c) => c.id === expiring.credential.id);
expRec.validUntil = new Date(Date.now() - 86400000).toISOString();
fs.writeFileSync(storePath, JSON.stringify(storeToExpire, null, 2), "utf8");
const statusExpired = verifyCredentialStatus(tmpDir, expiring.credential.id);
assert(statusExpired.valid === false && statusExpired.reason === "expired", "expired credential fails verification");

// Test 13: audit log records all operations with details
const finalStore = loadCredentialStore(tmpDir);
const actions = finalStore.auditLog.map((e) => e.action);
assert(actions.filter((a) => a === "present").length === 3, "audit log records 3 presents");
assert(actions.filter((a) => a === "revoke").length === 1, "audit log records 1 revoke");
const presentEntry = finalStore.auditLog.find((e) => e.credentialId === cred.id && e.action === "present");
assert(
  presentEntry &&
    presentEntry.details &&
    presentEntry.details.audience === "拟合作的技术团队" &&
    presentEntry.details.scope === "full" &&
    presentEntry.details.validDays === 30 &&
    !!presentEntry.timestamp,
  "present audit entry carries details and timestamp"
);
const revokeEntry = finalStore.auditLog.find((e) => e.credentialId === cred.id && e.action === "revoke");
assert(revokeEntry && revokeEntry.details.audience === "拟合作的技术团队", "revoke audit entry carries audience");

// Test 14: default validDays is 30
const defaultDays = presentCredential(tmpDir, { persona: "x" }, { audience: "默认期方" });
assert(defaultDays.ok === true, "default-days present succeeds");
const dayMs = new Date(defaultDays.credential.validUntil) - new Date(defaultDays.credential.presentedAt);
assert(Math.round(dayMs / 86400000) === 30, "default validity is 30 days");

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
